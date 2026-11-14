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
 * ahead of every reload (`hot-reload-auxiliaries.ts` orders it first): the prompt catalog, the gate
 * registry, and the framework registry's guide, which keeps the definition its loader read. A
 * bridge row carries no file tree for the reason `recordEditResult` states, so a rollback to it
 * restores through the resource's snapshot contract rather than byte for byte.
 *
 * A CATEGORY HAS NO REGISTRY THAT CAN ANSWER, so its prior state is the last bytes seen. The
 * catalog's `Category` substitutes a formatted name and a generated description for the ones a
 * `category.yaml` leaves out, and adds a category for a directory with no file at all, so a
 * projection of it records defaults as though an author had written them (the reason
 * `projectCategorySnapshot` reads the raw document). What still knows the authored state is the
 * file as it was: {@link DiskEditVersioning.rememberLoadedCategories} reads every served
 * `category.yaml` when the watcher starts, and each record keeps the bytes it projected.
 *
 * THE PRODUCED STATE COMES FROM THE DISK, through the projection `cpm` uses
 * (`cli-shared/resource-snapshot.ts`), which is the server's own projection fed from the files —
 * one projection, so an unchanged file records nothing and a later tool write bridges nothing.
 * The same identity decides that a file a tool already recorded records nothing either: the
 * newest row is asked at record time (`compareWithLatest`), because the catalog lags every write
 * made outside this process.
 *
 * Prompts, gates, frameworks and categories: every kind `version_history` records. A style records
 * nothing (`StoredResourceType` has no `style`), and a script tool is not loaded through a resource
 * loader. Only prompts and gates also reach the change log (`TrackedResourceType`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { GateGuide } from '#engine/gates/types.js';
import type { VersionHistoryService } from '#modules/versioning/index.js';
import type { FileChangeOperation, TrackedResourceType } from '#shared/types/index.js';

import { projectResourceSnapshot } from '#cli-shared/resource-snapshot.js';
import { RuntimeFrameworkLoader } from '#engine/frameworks/definitions/runtime-framework-loader.js';
import { GateDefinitionLoader } from '#engine/gates/core/gate-definition-loader.js';
import { gateSnapshotContract } from '#mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { projectCategorySnapshot } from '#modules/versioning/projections/category-snapshot.js';
import { projectFrameworkSnapshot } from '#modules/versioning/projections/framework-snapshot.js';
import { canonicalPromptSnapshot } from '#modules/versioning/projections/prompt-snapshot.js';
import {
  createRowDescription,
  updateRowDescription,
} from '#modules/versioning/snapshot-contract.js';
import { hashCanonical } from '#shared/utils/hash.js';
import { parseYaml } from '#shared/utils/yaml/yaml-parser.js';

/** The kinds a disk edit is versioned for: the change log's two, plus frameworks and categories. */
export type DiskEditResourceType = TrackedResourceType | 'framework' | 'category';

/** One served change, located by the change tracker: which resource, and its entry file. */
export interface DiskEditChange {
  resourceType: DiskEditResourceType;
  resourceId: string;
  operation: FileChangeOperation;
  /**
   * The resource's entry file (`prompt.yaml`, `{id}.yaml`, `gate.yaml`, `framework.yaml`,
   * `category.yaml`) — never a companion.
   */
  entryPath: string;
}

/** A `category.yaml` the catalog serves, by the category id it declares metadata for. */
export interface LoadedCategoryFile {
  resourceId: string;
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
  /**
   * Read the `category.yaml` files the catalog serves, so a later edit of one has a prior state.
   * Called when the watcher starts and when a root arms; a category already held keeps the bytes
   * it has, which are the ones last recorded or seen serving.
   */
  rememberLoadedCategories(files: readonly LoadedCategoryFile[]): void;
}

/** The catalog as it stands before the reload: what each id serves right now. */
export interface LiveResources {
  prompt(id: string): ConvertedPrompt | undefined;
  gate(id: string): GateGuide | undefined;
  /** The parsed `framework.yaml` the framework registry serves for this id. */
  framework(id: string): Readonly<Record<string, unknown>> | undefined;
}

type ProjectionResult =
  { ok: true; snapshot: Record<string, unknown>; text: string } | { ok: false; reason: string };

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

/** Why the framework loader refuses this file, or `undefined` — {@link gateRefusal}'s twin. */
function frameworkRefusal(resourceId: string, entryPath: string): string | undefined {
  const loader = new RuntimeFrameworkLoader({
    frameworksDir: dirname(dirname(entryPath)),
    enableCache: false,
  });
  loader.loadFramework(resourceId);
  return loader
    .getQuarantine()
    .list()
    .find((record) => record.path === entryPath)?.error;
}

/** The loader's refusal of this entry file, for the kinds whose loader can refuse one. */
function loaderRefusal(
  resourceType: DiskEditResourceType,
  resourceId: string,
  entryPath: string
): string | undefined {
  if (resourceType === 'gate') return gateRefusal(resourceId, entryPath);
  if (resourceType === 'framework') return frameworkRefusal(resourceId, entryPath);
  return undefined;
}

/** Parse YAML text into the mapping an entry file must hold, or say why it does not. */
function parseMapping(
  text: string,
  entryPath: string
): { ok: true; declared: Record<string, unknown> } | { ok: false; reason: string } {
  const parsed = parseYaml<unknown>(text, { filename: entryPath });
  if (!parsed.success) {
    return { ok: false, reason: `YAML parse error: ${parsed.error?.message ?? 'unreadable file'}` };
  }
  const data = parsed.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: `${entryPath} does not hold a YAML mapping` };
  }
  return { ok: true, declared: data as Record<string, unknown> };
}

/**
 * Project the entry file the way the loader will read it, or say why the loader will refuse it.
 *
 * Every refusal is answered by code the loader itself runs: the YAML parser (whose message is the
 * reason a hand edit most often needs), the gate and framework loaders, and for a prompt the
 * prompt loader and converter (`projectPromptFromDisk`, which reports a prompt they do not serve).
 * The file is read ONCE, and the text comes back with the snapshot: a category keeps exactly the
 * bytes it projected as its next prior state.
 */
async function projectEntryFile(
  resourceType: DiskEditResourceType,
  resourceId: string,
  entryPath: string
): Promise<ProjectionResult> {
  let text: string;
  try {
    text = readFileSync(entryPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      reason: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = parseMapping(text, entryPath);
  if (!parsed.ok) return parsed;
  const { declared } = parsed;

  const refusal = loaderRefusal(resourceType, resourceId, entryPath);
  if (refusal !== undefined) return { ok: false, reason: refusal };

  if (resourceType === 'category') {
    return { ok: true, snapshot: projectCategorySnapshot(resourceId, declared), text };
  }
  const projected = await projectResourceSnapshot(resourceType, resourceId, entryPath, declared);
  return projected.shared
    ? { ok: true, snapshot: projected.snapshot, text }
    : { ok: false, reason: projected.reason };
}

/** The live resource projected through the same contract a tool write projects it with. */
function projectLive(
  live: LiveResources,
  lastSeenCategories: ReadonlyMap<string, string>,
  resourceType: DiskEditResourceType,
  resourceId: string
): Record<string, unknown> | undefined {
  switch (resourceType) {
    case 'prompt': {
      const prompt = live.prompt(resourceId);
      return prompt === undefined ? undefined : canonicalPromptSnapshot(resourceId, prompt);
    }
    case 'gate': {
      const gate = live.gate(resourceId);
      return gate === undefined ? undefined : gateSnapshotContract.project(resourceId, gate);
    }
    case 'framework': {
      const framework = live.framework(resourceId);
      return framework === undefined
        ? undefined
        : projectFrameworkSnapshot(resourceId, { framework: { ...framework } });
    }
    case 'category': {
      const text = lastSeenCategories.get(resourceId);
      if (text === undefined) return undefined;
      // Bytes the loader would not read leave no prior state: there is no authored one to bridge.
      const parsed = parseMapping(text, resourceId);
      return parsed.ok ? projectCategorySnapshot(resourceId, parsed.declared) : undefined;
    }
  }
}

/** The bytes of a file, or `undefined` when it cannot be read. */
function readIfPresent(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

export class DiskEditVersionRecorder implements DiskEditVersioning {
  /** The last `category.yaml` bytes seen serving each category id — its prior state. */
  private readonly lastSeenCategories = new Map<string, string>();

  constructor(
    private readonly versions: Pick<
      VersionHistoryService,
      'saveVersion' | 'commitEdit' | 'deleteHistory' | 'compareWithLatest'
    >,
    private readonly live: LiveResources
  ) {}

  rememberLoadedCategories(files: readonly LoadedCategoryFile[]): void {
    for (const { resourceId, entryPath } of files) {
      if (this.lastSeenCategories.has(resourceId)) continue;
      const text = readIfPresent(entryPath);
      if (text !== undefined) this.lastSeenCategories.set(resourceId, text);
    }
  }

  /**
   * Record what this change did to the resource's history. Throws when the database refuses a
   * write — `saveVersion` and `deleteHistory` throw, and the caller's boundary decides.
   */
  async record(change: DiskEditChange): Promise<DiskEditOutcome> {
    const { resourceType, resourceId, entryPath } = change;

    // A removal event for a file that is there again is an editor's write-by-rename, not a delete.
    if (change.operation === 'removed' && !existsSync(entryPath)) {
      if (resourceType === 'category') this.lastSeenCategories.delete(resourceId);
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
    const prior = projectLive(this.live, this.lastSeenCategories, resourceType, resourceId);
    // From here on the file is served: a category's next prior state is these bytes, whatever
    // this call records. Kept before the writes, so a write the database refuses still leaves the
    // category's prior state at what is serving.
    if (resourceType === 'category') this.lastSeenCategories.set(resourceId, produced.text);
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
