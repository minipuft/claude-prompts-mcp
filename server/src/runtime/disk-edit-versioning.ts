// @lifecycle canonical - Records the version a disk edit produced, or the loader's refusal of it.
/**
 * What a file edited on disk does to a resource's version history.
 *
 * A hand edit is a supported input with the guarantees of a tool write (owner ruling R5): it gets
 * a version row and a rollback point, through the same `VersionHistoryService` calls the
 * `resource_manager` processors make, and a file that will not load is reported rather than
 * versioned. The hot-reload change tracker calls {@link DiskEditVersionRecorder.record} for each
 * served change BEFORE it logs the change, and the observer holds the reload until that handler
 * returns, so the row exists before anything serves the edit.
 *
 * THE PRIOR STATE COMES FROM THE LIVE REGISTRY. Tool writes bridge the state before the edit when
 * the newest row does not already hold it (`recordEditResult`), and that state is what makes the
 * first edit of a never-versioned resource rollback-reachable. On disk it is already gone when the
 * watcher fires; what still holds it is the catalog, because the change-tracker registration runs
 * ahead of every reload (`hot-reload-auxiliaries.ts` orders it first). A bridge row carries no file
 * tree for the reason `recordEditResult` states, so a rollback to it restores through the
 * resource's snapshot contract rather than byte for byte.
 *
 * THE PRODUCED STATE COMES FROM THE DISK, through the projection `cpm` uses
 * (`cli-shared/resource-snapshot.ts`), which is the server's own projection fed from the files —
 * one projection, so an unchanged file records nothing and a later tool write bridges nothing.
 * The same identity decides that a file a tool already recorded records nothing either: the
 * newest row is asked at record time (`compareWithLatest`), because the catalog lags every write
 * made outside this process.
 *
 * Prompts and gates only: they are the kinds the change tracker locates (`TrackedResourceType`).
 */

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { GateGuide } from '#engine/gates/types.js';
import type { VersionHistoryService } from '#modules/versioning/index.js';
import type { FileChangeOperation, TrackedResourceType } from '#shared/types/index.js';

import { projectResourceSnapshot } from '#cli-shared/resource-snapshot.js';
import { GateDefinitionLoader } from '#engine/gates/core/gate-definition-loader.js';
import { gateSnapshotContract } from '#mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { canonicalPromptSnapshot } from '#modules/versioning/projections/prompt-snapshot.js';
import {
  createRowDescription,
  updateRowDescription,
} from '#modules/versioning/snapshot-contract.js';
import { hashCanonical } from '#shared/utils/hash.js';
import { loadYamlFileWithResult } from '#shared/utils/yaml/yaml-file-loader.js';

/** One served change, located by the change tracker: which resource, and its entry file. */
export interface DiskEditChange {
  resourceType: TrackedResourceType;
  resourceId: string;
  operation: FileChangeOperation;
  /** The resource's entry file (`prompt.yaml`, `{id}.yaml`, `gate.yaml`) — never a companion. */
  entryPath: string;
}

/** What {@link DiskEditVersioning.record} did. A persistence failure is thrown, not returned. */
export type DiskEditOutcome =
  | { kind: 'refused'; reason: string }
  | { kind: 'recorded'; version: number }
  | { kind: 'unchanged' }
  | { kind: 'purged'; removed: number };

/** The port the change tracker's watcher registration records through. */
export interface DiskEditVersioning {
  record(change: DiskEditChange): Promise<DiskEditOutcome>;
}

/** The catalog as it stands before the reload: what each id serves right now. */
export interface LiveResources {
  prompt(id: string): ConvertedPrompt | undefined;
  gate(id: string): GateGuide | undefined;
}

type ProjectionResult =
  { ok: true; snapshot: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Why the gate loader refuses this gate file, or `undefined` when it loads.
 *
 * Asked of a `GateDefinitionLoader` over the file's own root — the loader the server reloads the
 * gate with, guidance sidecar inlined and schema applied — and answered by its quarantine record,
 * so the reason is the one `status` will list once the gate reload has run.
 */
function gateRefusal(resourceId: string, entryPath: string): string | undefined {
  const loader = new GateDefinitionLoader({ gatesDir: dirname(dirname(entryPath)) });
  // Asked by PATH: when this file is refused the loader falls through to a lower root holding the
  // same id (the overlay contract), so whether `loadGate` answers says nothing about this file.
  loader.loadGate(resourceId);
  return loader
    .getQuarantine()
    .list()
    .find((record) => record.path === entryPath)?.error;
}

/**
 * Project the entry file the way the loader will read it, or say why the loader will refuse it.
 *
 * Every refusal is answered by code the loader itself runs: the YAML parser (whose message is the
 * reason a hand edit most often needs), the gate loader, and for a prompt the prompt loader and
 * converter (`projectPromptFromDisk`, which reports a prompt they do not serve).
 */
async function projectEntryFile(
  resourceType: TrackedResourceType,
  resourceId: string,
  entryPath: string
): Promise<ProjectionResult> {
  const loaded = loadYamlFileWithResult<unknown>(entryPath);
  if (!loaded.success) {
    return { ok: false, reason: `YAML parse error: ${loaded.error?.message ?? 'unreadable file'}` };
  }
  const data = loaded.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: `${entryPath} does not hold a YAML mapping` };
  }
  const declared = data as Record<string, unknown>;

  const refusal = resourceType === 'gate' ? gateRefusal(resourceId, entryPath) : undefined;
  if (refusal !== undefined) return { ok: false, reason: refusal };

  const projected = await projectResourceSnapshot(resourceType, resourceId, entryPath, declared);
  return projected.shared
    ? { ok: true, snapshot: projected.snapshot }
    : { ok: false, reason: projected.reason };
}

/** The live resource projected through the same contract a tool write projects it with. */
function projectLive(
  live: LiveResources,
  resourceType: TrackedResourceType,
  resourceId: string
): Record<string, unknown> | undefined {
  if (resourceType === 'prompt') {
    const prompt = live.prompt(resourceId);
    return prompt === undefined ? undefined : canonicalPromptSnapshot(resourceId, prompt);
  }
  const gate = live.gate(resourceId);
  return gate === undefined ? undefined : gateSnapshotContract.project(resourceId, gate);
}

export class DiskEditVersionRecorder implements DiskEditVersioning {
  constructor(
    private readonly versions: Pick<
      VersionHistoryService,
      'saveVersion' | 'commitEdit' | 'deleteHistory' | 'compareWithLatest'
    >,
    private readonly live: LiveResources
  ) {}

  /**
   * Record what this change did to the resource's history. Throws when the database refuses a
   * write — `saveVersion` and `deleteHistory` throw, and the caller's boundary decides.
   */
  async record(change: DiskEditChange): Promise<DiskEditOutcome> {
    const { resourceType, resourceId, entryPath } = change;

    // A removal event for a file that is there again is an editor's write-by-rename, not a delete.
    if (change.operation === 'removed' && !existsSync(entryPath)) {
      // What `resource_manager delete` records: the history of a deleted resource is purged.
      return {
        kind: 'purged',
        removed: await this.versions.deleteHistory(resourceType, resourceId),
      };
    }

    const produced = await projectEntryFile(resourceType, resourceId, entryPath);
    if (!produced.ok) {
      // The first line only: a YAML parser's message goes on to quote the offending source lines,
      // and a refused file's content is exactly what no surface may echo (`resource-quarantine.ts`).
      return { kind: 'refused', reason: produced.reason.split('\n')[0]?.trim() ?? '' };
    }

    // The catalog already serves exactly this state (a save with no edit, a touch, a comment).
    // Nothing changed, so nothing is recorded — not even the bridge `commitEdit` would write for
    // a resource with no history yet, which would read as an edit nobody made.
    const prior = projectLive(this.live, resourceType, resourceId);
    if (prior !== undefined && hashCanonical(prior) === hashCanonical(produced.snapshot)) {
      return { kind: 'unchanged' };
    }

    // A tool already recorded exactly this state: `cpm` writes its files and then its own row
    // (`Rollback to v1`, `Created via cpm`), and the catalog still serves the state before it, so
    // the check above cannot see that. One write is one version (R5) — recording here would add
    // a bridge of the stale catalog entry and a second row for the same bytes. Asked now, at
    // record time, not when the event arrived, so a row that landed during the debounce counts.
    const latest = await this.versions.compareWithLatest(
      resourceType,
      resourceId,
      produced.snapshot
    );
    if (latest === 'same') return { kind: 'unchanged' };

    const result =
      prior === undefined
        ? await this.versions.saveVersion(resourceType, resourceId, produced.snapshot, {
            // `added` with history already recorded is a file the catalog has not loaded yet
            // (a `cpm create` then a hand edit, inside one debounce): an update of that history.
            description:
              change.operation === 'added' && latest === 'none'
                ? createRowDescription('filesystem')
                : updateRowDescription('filesystem'),
          })
        : await this.versions.commitEdit(resourceType, resourceId, prior, produced.snapshot, {
            description: updateRowDescription('filesystem'),
          });

    return result.recorded
      ? { kind: 'recorded', version: result.version ?? 0 }
      : { kind: 'unchanged' };
  }
}
