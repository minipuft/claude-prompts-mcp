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
}

export interface RecordTreeInput {
  /** The value the OWNING `version_history` row carries. Never re-derived here (ruling R56). */
  tenantId: string;
  /** `version_history.id` of the row already inserted in this transaction. */
  versionRowId: number;
  /**
   * The files that ARE this resource, or `null` for a row that must stay projection-only.
   *
   * `null` is the BRIDGE row's answer and the distinction is structural, not textual (ruling R66).
   * A bridge row's snapshot is the state BEFORE the edit, while its record runs at commit time —
   * after the produced files are on disk — so any tree recorded against it would describe the
   * produced bytes under a row claiming the prior state. That is worse than no tree: a later
   * byte-exact rollback would restore the wrong state while reporting full fidelity. Matching the
   * bridge row's description string instead would be presentation deciding durability, and would
   * stop working the day someone rewords it.
   */
  files: ResourceFileSet | null;
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
export async function recordTree(
  db: ObjectStoreDatabase,
  input: RecordTreeInput
): Promise<RecordTreeOutcome> {
  const { tenantId, versionRowId, files } = input;
  if (files === null) {
    return { recorded: false, reason: 'projection-only by request (bridge row)' };
  }

  const contents = await readFileSet(files);
  if ('reason' in contents) return { recorded: false, reason: contents.reason };

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
    files.origin,
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
  // A `state.db` written by a pre-v29 server has no store at all, and `cpm` opens whatever file it
  // finds — the same reason this module's sibling asks whether `version_history` exists before
  // using it. Absent tables mean provably zero objects, so skipping loses nothing; throwing would
  // make `cpm delete` fail against a database an older server created. The check is here rather
  // than at the CLI call sites because both surfaces reach the sweep through one prune, and on the
  // server it costs one `sqlite_master` lookup that always answers yes.
  const present = db.queryOne<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'objects'`
  );
  if (present === null) {
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

/** One file's bytes, its digest and the path the manifest stores it under. */
interface LoadedFile {
  path: string;
  bytes: Uint8Array;
  hash: string;
}

/**
 * Read every file of the set, or say why the resource cannot be stored.
 *
 * Both limits are checked here, before any statement runs, so an over-limit resource costs no
 * partial write that the caller would then have to undo.
 */
async function readFileSet(
  files: ResourceFileSet
): Promise<{ entries: LoadedFile[] } | { reason: string }> {
  const entries: LoadedFile[] = [];
  let total = 0;

  for (const file of files.files) {
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
  return { entries };
}
