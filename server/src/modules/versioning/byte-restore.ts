// @lifecycle canonical - Assembles and applies a byte-exact restore from a recorded file tree.
/**
 * Turning a recorded file tree back into files on disk.
 *
 * WHERE THIS SITS. `restore-plan.ts` decides WHAT a restore does, over `{path, hash}` lists and
 * nothing else. `cli-shared/object-store.ts` owns the store and hands the bytes back. This module
 * is the seam between them: it gathers the two trees (the recorded one from the store, the current
 * one from the same `resourceFileSet` enumerator that recorded it), asks the planner, and — when a
 * caller applies the plan — writes the bytes inside a `ResourceMutationTransaction` so a failed
 * version record puts every file back byte-identical.
 *
 * THE BYTES ARE WRITTEN VERBATIM, AND THAT IS THE WHOLE POINT. Not through
 * `yaml-document-writer.ts`. That writer exists to apply a FIELD-level change to a file whose
 * other bytes must not move, which is exactly right for a projection-based restore, where a
 * field-level merge is all the record supports. A restore to recorded bytes is maximal fidelity by
 * definition — routing it through a CST round-trip can only lose bytes, and would quietly undo the
 * comment, key-order, CRLF and BOM preservation this whole route exists to buy.
 *
 * THREE ANSWERS, NOT TWO. `ready` restores byte-exactly. `projection-only` means the row never
 * carried a tree (a bridge row, a row written before schema v29, a row degraded by an over-limit
 * file) and the caller falls back to today's `SnapshotContract.restore` path, unchanged. `refused`
 * means the database contradicts itself or a recorded path is not a path — those write nothing and
 * fail loudly, because falling back there would restore a state whose byte-exactness the row
 * advertises while silently delivering something else.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { planRestore } from './restore-plan.js';

import type { ObjectStoreDatabase } from '#cli-shared/object-store.js';
import type { ResourceMutationTarget } from '#modules/resources/services/resource-mutation-transaction.js';
import type {
  ResourceFileSet,
  ResourceLocationResult,
  ResourceRootClassification,
  ResourceRootOrigin,
} from '#shared/utils/resource-file-set.js';
import type { RecordedFile, RestorePlan } from './restore-plan.js';
import type { ResourceType } from './types.js';

import { loadVersionTree, readResourceTree } from '#cli-shared/object-store.js';
import { ResourceMutationTransaction } from '#modules/resources/services/resource-mutation-transaction.js';
import { resourceFileSet } from '#shared/utils/resource-file-set.js';

/** Whether a version's files can be put back byte for byte, and if so, what doing it would do. */
export type ByteRestoreAvailability =
  | { status: 'ready'; plan: RestorePlan; bytes: ReadonlyMap<string, Uint8Array> }
  | { status: 'projection-only'; reason: string }
  | { status: 'refused'; reason: string };

/** What {@link resolveByteRestore} needs. Every value comes from the caller's own row read. */
export interface ByteRestoreQuery {
  db: ObjectStoreDatabase;
  /** The value the target `version_history` row carries. Never re-derived (ruling R56). */
  tenantId: string;
  resourceType: ResourceType;
  resourceId: string;
  version: number;
  /** `version_history.id` of the target row. */
  versionRowId: number;
  /** `version_history.tree_origin` of the target row. Reported; never used to pick a path. */
  recordedOrigin: ResourceRootOrigin;
  /** Where the resource's files are now, from the service's injected locator. */
  location: ResourceLocationResult;
}

/**
 * The directory a restore writes into, which is NOT always where the resource is served from.
 *
 * A resource served from the bundled package tree is copied into the workspace on its first write
 * — that is what `resource_manager` already does (`gate-file-writer.ts`'s `isFreshDirectory` force
 * and the same force in prompts' `file-operations.ts`), and the byte path matches it rather than
 * inventing a second rule. The workspace path is derived by re-rooting: the resource's position
 * RELATIVE to the bundled root, joined onto the primary root. That is layout-agnostic, so it holds
 * for a single-file prompt (whose resource root is its category directory) without restating the
 * layout here.
 */
function destinationFor(
  files: ResourceFileSet,
  roots: ResourceRootClassification
): { root: string; origin: ResourceRootOrigin } | { reason: string } {
  if (files.origin !== 'bundled') {
    return { root: files.resourceRoot, origin: files.origin };
  }
  if (roots.primary === undefined || roots.bundled === undefined) {
    return {
      reason:
        `this ${files.resourceType} is served from the bundled tree and this process resolved no ` +
        `workspace root to copy it into`,
    };
  }
  return {
    root: path.join(roots.primary, path.relative(roots.bundled, files.resourceRoot)),
    origin: 'primary',
  };
}

/** Enumerate and hash whatever is under `root` right now, or report an empty resource. */
async function currentFilesUnder(
  resourceType: ResourceType,
  entryPath: string,
  roots: ResourceRootClassification
): Promise<RecordedFile[] | { reason: string }> {
  if (!existsSync(entryPath)) {
    return [];
  }
  let files: ResourceFileSet;
  try {
    files = await resourceFileSet({ resourceType, entryPath, roots });
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  const loaded = await readResourceTree(files);
  if (!('tree' in loaded)) {
    return { reason: loaded.reason };
  }
  return loaded.tree.entries.map((entry) => ({ path: entry.path, hash: entry.hash }));
}

/**
 * What a rollback to `version` would put back, and the bytes to put back with.
 *
 * Reads only. Nothing on disk and nothing in the database moves here, which is what lets a preview
 * call this and print the result with the guarantee that nothing was written.
 */
export async function resolveByteRestore(
  query: ByteRestoreQuery
): Promise<ByteRestoreAvailability> {
  const tree = loadVersionTree(query.db, {
    tenantId: query.tenantId,
    versionRowId: query.versionRowId,
  });
  if (tree.status === 'incomplete') {
    return { status: 'refused', reason: tree.reason };
  }
  if (tree.status === 'absent') {
    return {
      status: 'projection-only',
      reason: `version ${query.version} recorded no file tree`,
    };
  }
  if (!query.location.located) {
    return { status: 'projection-only', reason: query.location.reason };
  }

  const { entryPath, roots } = query.location;
  let served: ResourceFileSet;
  try {
    served = await resourceFileSet({ resourceType: query.resourceType, entryPath, roots });
  } catch (error) {
    return {
      status: 'projection-only',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const destination = destinationFor(served, roots);
  if ('reason' in destination) {
    return { status: 'projection-only', reason: destination.reason };
  }

  const destinationEntry = path.join(destination.root, path.basename(entryPath));
  const current = await currentFilesUnder(query.resourceType, destinationEntry, roots);
  if (!Array.isArray(current)) {
    return { status: 'projection-only', reason: current.reason };
  }

  const planned = planRestore({
    resourceType: query.resourceType,
    resourceId: query.resourceId,
    version: query.version,
    destinationRoot: destination.root,
    destinationOrigin: destination.origin,
    recordedOrigin: query.recordedOrigin,
    target: tree.files.map((file) => ({ path: file.path, hash: file.hash })),
    current,
  });
  if (!planned.ok) {
    return { status: 'refused', reason: planned.refusal };
  }

  return {
    status: 'ready',
    plan: planned.plan,
    bytes: new Map(tree.files.map((file) => [file.hash, file.bytes])),
  };
}

/** One byte-exact restore, ready to run: the plan, its bytes, and the record that follows it. */
export interface ByteRestoreRun {
  plan: RestorePlan;
  bytes: ReadonlyMap<string, Uint8Array>;
  /**
   * Durable bookkeeping — the version record — run LAST, inside the transaction.
   *
   * Handed straight to `ResourceMutationTransaction`, so a throw here restores every file this
   * restore wrote. Its call site stays in the processor, inside a literal `commit:` property, which
   * is what `validate:mutation-atomicity` reads.
   */
  commit: () => Promise<void>;
}

export type ByteRestoreOutcome =
  { applied: true } | { applied: false; error: string; rolledBack: boolean };

/**
 * Write the planned bytes, then record, as ONE transaction.
 *
 * Targets are exactly the paths the plan writes — not the resource's directory. Snapshotting the
 * directory would be wrong twice over: a single-file prompt's directory is its CATEGORY, so a
 * failed record would roll back every sibling prompt, and a restore that never deletes (R57) has
 * no business capturing files it will not touch.
 */
export async function applyByteRestore(run: ByteRestoreRun): Promise<ByteRestoreOutcome> {
  const targets: ResourceMutationTarget[] = run.plan.write.map((file) => ({
    path: file.absolutePath,
    kind: 'file',
  }));

  const transaction = new ResourceMutationTransaction();
  const result = await transaction.run<void, void>({
    targets,
    mutate: async () => {
      for (const file of run.plan.write) {
        const bytes = run.bytes.get(file.hash);
        if (bytes === undefined) {
          // Unreachable from `resolveByteRestore`, which refuses an incomplete tree before it
          // plans. A throw rather than a skip: a restore that quietly omitted one file would
          // report a byte-exact rollback of a state the files do not hold.
          throw new Error(`Restore aborted: no recorded bytes for ${file.path} (${file.hash})`);
        }
        await mkdir(path.dirname(file.absolutePath), { recursive: true });
        await writeFile(file.absolutePath, bytes);
      }
    },
    commit: run.commit,
  });

  return result.success
    ? { applied: true }
    : {
        applied: false,
        error: result.error ?? 'The restore failed and no version was recorded.',
        rolledBack: result.rolledBack,
      };
}
