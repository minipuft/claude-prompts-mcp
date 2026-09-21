// @lifecycle canonical - Sole planner of what a byte-exact restore writes, and what it leaves alone.
/**
 * What a rollback to a recorded file tree would do, decided once for both surfaces.
 *
 * WHAT THIS DECIDES. A version row with a tree (`version_history.tree_hash IS NOT NULL`) carries
 * the actual bytes of every file that WAS the resource, in `version_entries` + `objects`. Restoring
 * it is a three-way answer per path — write it, leave it because it already matches, or leave it
 * because the target version never recorded it — and that answer must be identical whether a
 * caller asked for a preview or for the apply. One function, called twice, is the only arrangement
 * in which a preview cannot describe a different action than the one that runs. Compare the two
 * results as ONE value and a divergence is a test failure rather than an operator's surprise.
 *
 * A RESTORE NEVER DELETES A FILE (owner ruling R57). The obvious third bucket — "on disk, absent
 * from the target tree, therefore remove it" — is deliberately absent. An operator's file is not
 * this code's to remove on the strength of a version row, and the cost is stated rather than
 * hidden: after a restore that left files in place, the resource is NOT byte-identical to the
 * target version. {@link RestorePlan.leftInPlace} names every such path so the reply can say so,
 * and `compare` against the target still shows them.
 *
 * WHY IT IS PURE. It reads no file and opens no database. The bytes and digests arrive already
 * gathered — the target's from `version_entries`, the current ones from the same `resourceFileSet`
 * enumerator the recorder used — so the decision is a function of its inputs and can be unit-tested
 * over hand-built trees without a disk. The I/O belongs to the callers, which already own a
 * transaction each.
 *
 * WHERE IT LIVES, AND WHY HERE. `modules/versioning/` is the highest layer BOTH surfaces can
 * import: `cli-shared/` may not reach `runtime/`, `infra/` or `mcp/` (`cli-shared-no-runtime`) but
 * it already imports `modules/versioning/history-key.js`, and the `mcp/` tool layer imports this
 * module freely. `shared/` would also work and is worse: this is versioning domain logic keyed on
 * `ResourceType`, not a general-purpose utility.
 */

import * as path from 'node:path';

import type { ResourceRootOrigin } from '#shared/utils/resource-file-set.js';
import type { ResourceType } from './types.js';

import { isPathInside } from '#shared/utils/path-containment.js';

/** One file as some tree records it: where it sits, and the digest of its bytes. */
export interface RecordedFile {
  /** POSIX, relative to the resource's own root. Exactly what `version_entries.path` holds. */
  path: string;
  /** `sha256:<hex>` from `hashBytes`. */
  hash: string;
}

/**
 * Why a path is being written. Both reasons overwrite nothing the target did not record.
 *
 * Not exported, along with {@link RestoreWrite}: they are the shape of `RestorePlan.write`, and a
 * consumer that iterates it already has them structurally. Exporting a name nothing imports is a
 * knip-visible export standing in front of no consumer.
 */
type RestoreWriteReason = 'differs' | 'missing-on-disk';

/** One file the restore will write, with the digest whose object supplies its bytes. */
interface RestoreWrite {
  path: string;
  /** Resolved under the destination root, and proven inside it before the plan was returned. */
  absolutePath: string;
  hash: string;
  reason: RestoreWriteReason;
}

/**
 * Everything one restore would do — the value a preview prints and an apply executes.
 *
 * Three buckets that partition the union of both trees: `write` ∪ `unchanged` is exactly the target
 * tree, and `leftInPlace` is exactly what is on disk and not in it.
 */
export interface RestorePlan {
  resourceType: ResourceType;
  resourceId: string;
  /** The version being restored TO. Carried so a reply never has to be handed it separately. */
  version: number;
  /** Absolute directory every `write.absolutePath` sits under. */
  destinationRoot: string;
  /** `tree_origin` of the recorded row — where the bytes were READ from, not where they go. */
  recordedOrigin: ResourceRootOrigin;
  write: RestoreWrite[];
  /** Paths whose bytes already match the target. Not written, so they keep their exact bytes. */
  unchanged: string[];
  /** On disk, not in the target tree. Kept (R57) — and therefore named. */
  leftInPlace: string[];
}

export type RestorePlanResult = { ok: true; plan: RestorePlan } | { ok: false; refusal: string };

export interface RestorePlanInput {
  resourceType: ResourceType;
  resourceId: string;
  version: number;
  /**
   * Absolute directory the restore writes into — the WORKSPACE root for this resource, always.
   *
   * Not derived from `recordedOrigin`. `resource_manager rollback` already copy-on-writes a
   * bundled resource into the workspace today (`gate-file-writer.ts` `isFreshDirectory`, and the
   * same force in `file-operations.ts` for prompts): the writer resolves the workspace directory
   * and creates the files there rather than editing the package's own tree. The byte path matches
   * that rather than inventing a second rule, so a rollback of a bundled resource materialises a
   * workspace override exactly as it does today — it simply carries the recorded bytes instead of
   * a re-rendered projection.
   */
  destinationRoot: string;
  /**
   * The class of root `destinationRoot` belongs to. `bundled` is refused; see {@link planRestore}.
   */
  destinationOrigin: ResourceRootOrigin;
  /** `version_history.tree_origin` of the row being restored. Reported, never used to route. */
  recordedOrigin: ResourceRootOrigin;
  /** The target version's manifest: `version_entries` for that row. */
  target: readonly RecordedFile[];
  /** The resource as it exists under `destinationRoot` right now, hashed the same way. */
  current: readonly RecordedFile[];
}

/**
 * Refuse a recorded path that does not name a file beneath the destination root.
 *
 * `version_entries.path` is written by this repo and read back by this repo, so in the ordinary
 * case it is already a plain relative path. This check is not for the ordinary case: `state.db` is
 * a file on disk that any process may open, and a tampered or corrupted `path` is the one input on
 * this whole route that decides WHERE bytes land. `../../../.ssh/authorized_keys` is a valid TEXT
 * column value; making it a valid write target is a different thing entirely.
 *
 * Refuses by NAME and refuses the WHOLE restore — not the one entry. A restore that skipped the bad
 * path and wrote the rest would leave the resource in a state no version ever held, under a reply
 * announcing a successful rollback.
 */
function containmentRefusal(destinationRoot: string, entry: RecordedFile): string | undefined {
  if (entry.path.length === 0) {
    return `the recorded tree carries an empty path, which names no file`;
  }
  if (path.posix.isAbsolute(entry.path) || path.win32.isAbsolute(entry.path)) {
    return (
      `the recorded path '${entry.path}' is absolute. Recorded paths are relative to the ` +
      `resource's own directory`
    );
  }
  const absolute = path.resolve(destinationRoot, entry.path);
  if (!isPathInside(destinationRoot, absolute) || absolute === path.resolve(destinationRoot)) {
    return (
      `the recorded path '${entry.path}' resolves to ${absolute}, outside the resource root ` +
      `${destinationRoot}`
    );
  }
  return undefined;
}

/**
 * Index a tree by path.
 *
 * No duplicate check, and that is a statement about the inputs rather than an omission: the target
 * arrives from `version_entries`, whose PRIMARY KEY is `(version_row_id, path)`, and the current
 * set from `resourceFileSet`, which accumulates into a `Map` keyed by relative path. Neither can
 * present one path twice, so a check here would be a guard nothing could trip.
 */
function indexByPath(files: readonly RecordedFile[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    index.set(file.path, file.hash);
  }
  return index;
}

/** Path order, so two runs over the same trees produce the same value, byte for byte. */
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * What restoring `target` over `current` would write, keep, and leave alone.
 *
 * Refuses, writing NOTHING, when the destination is the bundled tree or when any recorded path
 * escapes the destination root. Both refusals are total by design (see {@link containmentRefusal}):
 * a partially-applied restore is a state no version ever held.
 */
export function planRestore(input: RestorePlanInput): RestorePlanResult {
  const { destinationRoot, destinationOrigin, target, current } = input;

  if (destinationOrigin === 'bundled') {
    return {
      ok: false,
      refusal:
        `refusing to restore into the bundled resource tree at ${destinationRoot}. The package's ` +
        `own resources are not writable state; a rollback of a bundled resource writes a ` +
        `workspace override instead`,
    };
  }
  if (target.length === 0) {
    return {
      ok: false,
      refusal: `version ${input.version} records a file tree with no files in it`,
    };
  }

  for (const entry of target) {
    const refusal = containmentRefusal(destinationRoot, entry);
    if (refusal !== undefined) {
      return { ok: false, refusal };
    }
  }

  const currentByPath = indexByPath(current);
  const write: RestoreWrite[] = [];
  const unchanged: string[] = [];

  for (const entry of target) {
    const onDisk = currentByPath.get(entry.path);
    if (onDisk === entry.hash) {
      unchanged.push(entry.path);
      continue;
    }
    write.push({
      path: entry.path,
      absolutePath: path.resolve(destinationRoot, entry.path),
      hash: entry.hash,
      reason: onDisk === undefined ? 'missing-on-disk' : 'differs',
    });
  }

  const targetPaths = new Set(target.map((entry) => entry.path));
  const leftInPlace = current
    .filter((entry) => !targetPaths.has(entry.path))
    .map((entry) => entry.path)
    .sort();

  return {
    ok: true,
    plan: {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      version: input.version,
      destinationRoot,
      recordedOrigin: input.recordedOrigin,
      write: write.sort(byPath),
      unchanged: unchanged.sort(),
      leftInPlace,
    },
  };
}

/**
 * True when the plan would touch no file.
 *
 * The honest name for "nothing differs": `unchanged` may be long and `leftInPlace` non-empty, and
 * neither is a write. A caller that reported "restored" on the strength of a non-empty plan value
 * would announce a rollback that changed nothing.
 */
export function restoreWritesNothing(plan: RestorePlan): boolean {
  return plan.write.length === 0;
}

/**
 * The operator-facing account of one plan, in the order an operator asks the questions.
 *
 * Lives here rather than in `snapshot-contract.ts` because it reads the plan's own fields, and a
 * second renderer beside the value it renders is how a preview and a reply come to describe the
 * same plan differently. `snapshot-contract.ts` owns the sentences that are NOT about files.
 */
export function describeRestorePlan(plan: RestorePlan): string {
  const lines: string[] = [];
  lines.push(
    plan.write.length === 0
      ? `📄 No file differs from version ${plan.version} — nothing to write.`
      : `📄 ${plan.write.length} file(s) restored byte for byte from version ${plan.version}:`
  );
  for (const file of plan.write) {
    lines.push(`   • ${file.path}${file.reason === 'missing-on-disk' ? ' (was missing)' : ''}`);
  }
  if (plan.unchanged.length > 0) {
    lines.push(`   ${plan.unchanged.length} file(s) already matched and were not touched.`);
  }
  if (plan.leftInPlace.length > 0) {
    lines.push(
      `⚠️ Left in place (not in version ${plan.version}, and a rollback never deletes a file):`
    );
    for (const file of plan.leftInPlace) {
      lines.push(`   • ${file}`);
    }
    lines.push(
      `   The ${plan.resourceType} therefore still differs from version ${plan.version} by those ` +
        `file(s). Delete them yourself if that is what you meant.`
    );
  }
  if (plan.recordedOrigin === 'bundled') {
    lines.push(
      `ℹ️ Version ${plan.version} recorded the bundled copy of this ${plan.resourceType}; ` +
        `restoring it writes a workspace override.`
    );
  }
  return lines.join('\n');
}
