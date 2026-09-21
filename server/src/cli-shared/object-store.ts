// @lifecycle canonical - Sole writer of the content-addressed object store backing checkpoints.
/**
 * Recording a version row's FILES, for both writers of `version_history`.
 *
 * WHAT IT IS FOR. `version_history.snapshot` holds a PROJECTION of a resource — the fields a
 * loader reassembled, re-serialised. A rollback from a projection re-renders the file, which loses
 * comments, key order and anything the loader never read. The object store records the bytes
 * themselves, keyed by content, so a later restore can be byte-exact. It is additive: `snapshot`
 * keeps being written and every reader keeps reading it, so losing every object degrades a
 * rollback to today's behaviour and never to data loss (owner ruling R55).
 *
 * WHY IT LIVES IN `cli-shared/`. Both writers must produce the SAME `tree_hash` for the same
 * files, which means one implementation. `cli-shared/` may not reach `runtime/`, `infra/` or
 * `mcp/` (`.dependency-cruiser.cjs`, `cli-shared-no-runtime`), and `modules/versioning/` already
 * sits above it — `version-history-rows.ts` imports from `modules/versioning/history-key.js`, so
 * the direction that works is cli-shared → modules, not the reverse. This is the only layer both
 * writers can share.
 *
 * WHAT IT DOES NOT DO. It does not enumerate — `resourceFileSet` is the sole enumerator and its
 * answer arrives as an argument, so the recorder and a later restorer cannot disagree about which
 * files ARE the resource. It does not open a transaction: every statement below runs inside the
 * caller's existing `BEGIN IMMEDIATE`, which is what makes invariant WRITE-1 hold — an object
 * insert is always in the same transaction as the reference that justifies it, so a crash between
 * them leaves neither.
 *
 * FAILING SOFT IS THE CONTRACT. An over-limit file, an unreadable one, or a resource the locator
 * could not find leaves the version row PROJECTION-ONLY (`tree_hash` NULL) with one warning. It is
 * never a failed save: the row is the durable thing nothing regenerates, and refusing to record it
 * because its bytes were too large would trade a degraded rollback for a lost version. A throw
 * from SQLite is a different matter and propagates — that rolls the caller's transaction back,
 * which is the behaviour the caller already has for every other statement in it.
 */

import { readFile } from 'node:fs/promises';

import type { ResourceFileSet } from '#shared/utils/resource-file-set.js';

import { hashBytes, hashFileSet } from '#shared/utils/hash.js';

/**
 * Per-file and per-resource byte ceilings (owner ruling, design Q5).
 *
 * A bound the write path enforces is what makes `objects`' `unbounded-justified` retention honest:
 * the table contract's size argument is (capped version rows × files per resource × THIS), so
 * raising either number without re-reading that rationale makes the contract a claim nobody
 * checked. Over either limit the resource is recorded projection-only, which is a degradation an
 * operator can see in the log rather than a write that silently truncates.
 */
export const MAX_OBJECT_BYTES = 1024 * 1024;
/**
 * Not exported, and that is a statement about coverage rather than about scope.
 *
 * ☐ (as of 2026-09-20 · flips when a fixture drives a resource past 8 MiB) the per-TREE branch
 * below has no test. The per-file limit is exercised by
 * `tests/integration/versioning/object-store-write-path.test.ts`; reaching the tree limit needs a
 * resource whose enumerated set exceeds 8 MiB without any single file exceeding 1 MiB, which
 * means nine or more files — a prompt with a `tools/` directory, not the two- to four-file gate
 * and framework shapes the suite builds today. Exporting it for a test that does not exist would
 * put a knip-visible export in front of an untested branch and read as coverage.
 */
const MAX_TREE_BYTES = 8 * 1024 * 1024;

/**
 * The two statements this module needs, and nothing else.
 *
 * Declared here rather than taking `DatabasePort`: the CLI writer holds a raw `node:sqlite`
 * `DatabaseSync` and the server holds a `DatabasePort`, and the narrowest shape both can satisfy
 * is what lets one implementation serve both. A wider port would force one side to grow an adapter
 * for methods this module never calls.
 */
export interface ObjectStoreDatabase {
  run(sql: string, params?: unknown[]): void;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
  /** Needed only by {@link loadVersionTree}: a manifest is many rows, read as one statement. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
}

export interface RecordTreeInput {
  /** The value the OWNING `version_history` row carries. Never re-derived here (ruling R56). */
  tenantId: string;
  /** `version_history.id` of the row already inserted in this transaction. */
  versionRowId: number;
  /**
   * The bytes that ARE this resource, already read, or `null` for a projection-only row.
   *
   * **A row gets a tree exactly when the bytes on disk at record time ARE that row's state**, and
   * only its caller can know that — which is why the answer arrives as an argument rather than
   * being decided here from a description string, which is presentation deciding durability and
   * would stop working the day someone rewords it (ruling R66).
   *
   * On the SERVER the produced row qualifies and the bridge row does not: both records run at
   * commit time, after the produced files are on disk, so a tree on the bridge row would describe
   * the produced bytes under a row claiming the PRIOR state — worse than no tree, because a later
   * byte-exact rollback would restore the wrong state while reporting full fidelity. On `cpm
   * rollback` the ordering is inverted and so is the answer; see `rollbackVersion`.
   */
  tree: LoadedTree | null;
}

export type RecordTreeOutcome =
  { recorded: true; treeHash: string; fileCount: number } | { recorded: false; reason: string };

/**
 * Store one version row's files and point the row at them.
 *
 * Statement order is the FK order and is load-bearing: objects first (the manifest references
 * them), then the manifest rows (which reference the version row the caller already inserted),
 * then the row's own tree columns. Constraints are LIVE on both writers — `node:sqlite` enables
 * them by default, measured 2026-09-20 — so a different order does not merely read oddly, it
 * raises and takes the caller's whole transaction with it.
 */
/**
 * Whether this database HAS an object store.
 *
 * `cpm` opens whatever `state.db` it finds, and one written by a server older than v29 has
 * neither table — the same situation `version-history.ts` already handles by asking whether
 * `version_history` exists before using it. Both entry points below answer "nothing to do"
 * rather than throwing: a `cpm rollback` or `cpm delete` must not fail because a checkpoint
 * could not be taken, and an absent store means provably zero objects, so the sweep loses
 * nothing either. On the server the engine owns this DDL and asserts it at startup, so the check
 * is one `sqlite_master` lookup that always answers yes — and a NO there still surfaces, because
 * `recordTree` returns a reason its caller warns about rather than a silent skip.
 *
 * Exported as {@link hasObjectStore} for ONE caller outside this module: the `cpm` rollback path,
 * which must know the answer BEFORE it selects `version_history.tree_hash`. A schema that predates
 * v29 has neither the tables nor those columns, and a SELECT naming a column that does not exist
 * throws rather than returning nothing — measured 2026-09-21 against the CLI suite's hand-seeded
 * pre-v29 fixture, which failed three rollback cases. One `sqlite_master` lookup answers for both,
 * because the tables and the columns arrived in the same bump.
 */
export function hasObjectStore(db: ObjectStoreDatabase): boolean {
  return objectStoreExists(db);
}

function objectStoreExists(db: ObjectStoreDatabase): boolean {
  return (
    db.queryOne<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'objects'`
    ) !== null
  );
}

export function recordTree(db: ObjectStoreDatabase, input: RecordTreeInput): RecordTreeOutcome {
  const { tenantId, versionRowId, tree } = input;
  if (tree === null) {
    return { recorded: false, reason: 'projection-only by request (bridge row)' };
  }
  if (!objectStoreExists(db)) {
    return {
      recorded: false,
      reason: 'this state.db has no object store — its schema predates v29',
    };
  }

  const contents = tree;
  const treeHash = hashFileSet(
    contents.entries.map((entry) => ({ path: entry.path, content: entry.bytes }))
  );
  const createdAt = new Date().toISOString();

  for (const entry of contents.entries) {
    // INSERT OR IGNORE, not INSERT: the store is content-addressed, so a file byte-identical to
    // one already recorded IS the row already there. Ignoring the duplicate is what makes fifty
    // versions of a resource whose guidance never changed hold one copy of that guidance.
    db.run(
      `INSERT OR IGNORE INTO objects (tenant_id, hash, bytes, size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [tenantId, entry.hash, entry.bytes, entry.bytes.byteLength, createdAt]
    );
  }

  for (const entry of contents.entries) {
    db.run(
      `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
       VALUES (?, ?, ?, ?)`,
      [versionRowId, tenantId, entry.path, entry.hash]
    );
  }

  db.run(`UPDATE version_history SET tree_hash = ?, tree_origin = ? WHERE id = ?`, [
    treeHash,
    contents.origin,
    versionRowId,
  ]);

  return { recorded: true, treeHash, fileCount: contents.entries.length };
}

/**
 * Delete every object of `tenantId` that no manifest row of that tenant references.
 *
 * **Runs inside the caller's transaction, in the SAME one as the delete that orphaned them.** A
 * sweep in a later transaction would be a second pass over a table whose contents another writer
 * may have changed in between; in the same transaction, the set of orphans is exactly the set this
 * delete created, and a rollback takes both halves with it.
 *
 * **Re-derived, never counted.** A refcount column would be a second derivation of a fact
 * `version_entries` already holds, and a crash between "delete the row" and "decrement" drifts it
 * silently, in the direction that deletes live content. `NOT EXISTS` asks the authoritative table
 * every time, so the answer is self-healing by construction.
 *
 * **The `NOT EXISTS` is load-bearing twice.** It is what stops a still-referenced object being
 * deleted, and — because foreign keys are live on both writers (`STATE_DB_WRITER_PRAGMAS`) and
 * `version_entries.object_hash` references `objects` — it is also what stops the statement raising
 * `FOREIGN KEY constraint failed` and aborting the caller's whole transaction, taking the
 * `version_history` deletes with it. The constraint is the backstop, not the guard.
 *
 * **Scoped to one tenant** (ruling R56): objects are keyed `(tenant_id, hash)`, so two workspaces
 * holding byte-identical files hold two rows, and neither's sweep can read or reach the other's.
 *
 * @returns how many objects were removed.
 */
export function sweepUnreferencedObjects(db: ObjectStoreDatabase, tenantId: string): number {
  if (!objectStoreExists(db)) {
    return 0;
  }

  const UNREFERENCED = `tenant_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM version_entries
         WHERE version_entries.tenant_id = objects.tenant_id
           AND version_entries.object_hash = objects.hash
       )`;

  const counted = db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM objects WHERE ${UNREFERENCED}`,
    [tenantId]
  );
  const orphans = Number(counted?.cnt ?? 0);
  if (orphans === 0) {
    return 0;
  }

  db.run(`DELETE FROM objects WHERE ${UNREFERENCED}`, [tenantId]);
  return orphans;
}

/**
 * One recorded file, read back out of the store: where it sat, and exactly what was in it.
 *
 * Not exported: it is the shape of `LoadedVersionTree.files`, and a consumer iterating that array
 * already has it structurally. An exported name nothing imports reads as a surface.
 */
interface StoredFile {
  path: string;
  hash: string;
  bytes: Uint8Array;
}

/**
 * A recorded tree, read back — or the precise reason it cannot be.
 *
 * Three answers, not two, because the two failures mean opposite things to a caller. `absent` is a
 * row that never had a tree — a bridge row, a row written before schema v29, or one degraded by an
 * over-limit file — and the honest response is today's projection-based restore. `incomplete` is a
 * row that CLAIMS a tree whose objects are not there, which the startup referential repair
 * (`SqliteEngine.repairVersionTrees`) normally prevents by NULLing such rows; reaching it means the
 * database disagrees with itself, and the response is to refuse by name and write nothing. Falling
 * back to the projection there would silently restore a different state than the one whose
 * byte-exactness the row advertises.
 */
export type LoadedVersionTree =
  | { status: 'loaded'; files: StoredFile[] }
  | { status: 'absent' }
  | { status: 'incomplete'; reason: string };

/**
 * Read back every file of one version row, bytes included.
 *
 * Scoped by `tenantId` on BOTH tables (ruling R56): objects are keyed `(tenant_id, hash)`, so a
 * read that joined on hash alone could reach another workspace's bytes for a colliding digest. The
 * tenant arrives from the owning `version_history` row — never re-derived here, for the same
 * reason `recordTree` does not re-derive it.
 *
 * Ordered by path so two reads of one row produce the same list, which is what lets a preview and
 * an apply be compared as ONE value.
 */
export function loadVersionTree(
  db: ObjectStoreDatabase,
  input: { tenantId: string; versionRowId: number }
): LoadedVersionTree {
  if (!objectStoreExists(db)) {
    return { status: 'absent' };
  }
  const { tenantId, versionRowId } = input;

  const manifest = db.query<{ path: string; object_hash: string }>(
    `SELECT path, object_hash FROM version_entries
     WHERE version_row_id = ? AND tenant_id = ?
     ORDER BY path`,
    [versionRowId, tenantId]
  );
  if (manifest.length === 0) {
    return { status: 'absent' };
  }

  const files: StoredFile[] = [];
  for (const entry of manifest) {
    const object = db.queryOne<{ bytes: Uint8Array }>(
      `SELECT bytes FROM objects WHERE tenant_id = ? AND hash = ?`,
      [tenantId, entry.object_hash]
    );
    if (object === null) {
      return {
        status: 'incomplete',
        reason:
          `the recorded bytes of '${entry.path}' (${entry.object_hash}) are missing from the ` +
          `object store`,
      };
    }
    files.push({
      path: entry.path,
      hash: entry.object_hash,
      // `node:sqlite` hands a BLOB back as a `Uint8Array`; normalised anyway, because a driver
      // that handed back a `Buffer` view over a larger pool would write the pool's tail if the
      // view were passed to `writeFile` unexamined.
      bytes: Uint8Array.from(object.bytes),
    });
  }
  return { status: 'loaded', files };
}

/** One file's bytes, its digest and the path the manifest stores it under. */
interface LoadedFile {
  path: string;
  bytes: Uint8Array;
  hash: string;
}

/** One resource's bytes, read and hashed, ready for `recordTree` to store under a row. */
export interface LoadedTree {
  entries: LoadedFile[];
  /** The enumerator's own `origin`, carried through so `tree_origin` is never re-derived. */
  origin: string;
}

/**
 * Read every file of the set, or say why the resource cannot be stored.
 *
 * **Called BEFORE the caller's `BEGIN IMMEDIATE`, deliberately.** File I/O under the write lock
 * blocks the other writer of this one file for as long as the disk takes, and nothing read here
 * needs the lock: the bytes are hashed by content, so a file that changes between this read and
 * the commit produces a different tree, not a wrong one. It also makes `recordTree` synchronous,
 * which is what lets the `cpm` writer — a fully synchronous `DatabaseSync` path — share it.
 *
 * Both limits are checked here, before any statement runs, so an over-limit resource costs no
 * partial write that the caller would then have to undo.
 */
export async function readResourceTree(
  files: ResourceFileSet
): Promise<{ tree: LoadedTree } | { reason: string }> {
  return await readFileTree(files.files, files.origin);
}

/** One file to read, as {@link readFileTree} addresses it. Structural subset of a file-set entry. */
export interface TreeFileRef {
  /** POSIX, relative to whatever root the caller records under. Becomes `version_entries.path`. */
  relativePath: string;
  absolutePath: string;
}

/**
 * The body of {@link readResourceTree}, over a bare list of files rather than a `ResourceFileSet`.
 *
 * Exists because ONE checkpointed thing is not a resource: the workspace config file has no
 * resource root, no entry-filename rule and no loader, so `resourceFileSet` cannot enumerate it and
 * widening that enumerator's `ResourceType` would publish a capability that does not exist
 * (`config-checkpoint.ts` states the full argument). What config does need is identical — the same
 * per-file and per-tree ceilings, the same `hashBytes`, the same `LoadedTree` shape — and a second
 * copy of those could only agree with this one by inspection. So the limits live here, once, and
 * `readResourceTree` is the enumerator-shaped caller rather than the owner.
 */
export async function readFileTree(
  files: readonly TreeFileRef[],
  origin: string
): Promise<{ tree: LoadedTree } | { reason: string }> {
  const entries: LoadedFile[] = [];
  let total = 0;

  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(file.absolutePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { reason: `${file.relativePath} could not be read (${message})` };
    }
    if (bytes.byteLength > MAX_OBJECT_BYTES) {
      return {
        reason: `${file.relativePath} is ${bytes.byteLength} bytes, over the ${MAX_OBJECT_BYTES}-byte per-file limit`,
      };
    }
    total += bytes.byteLength;
    if (total > MAX_TREE_BYTES) {
      return {
        reason: `the file set exceeds the ${MAX_TREE_BYTES}-byte per-resource limit at ${file.relativePath}`,
      };
    }
    // The size is re-read from the bytes rather than taken from the enumerator's `size`: the
    // enumerator `stat`ed the file earlier, and what must agree with `length(bytes)` in the
    // column is what was actually read.
    entries.push({ path: file.relativePath, bytes, hash: hashBytes(bytes) });
  }

  if (entries.length === 0) {
    return { reason: 'the enumerator reported no files' };
  }
  return { tree: { entries, origin } };
}
