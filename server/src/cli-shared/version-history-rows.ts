// @lifecycle canonical - Reading, appending to, and re-keying one resource's history rows.
/**
 * The SQL vocabulary of `version_history`, for the CLI.
 *
 * One responsibility: given an open connection and a tenant id, read a history, append to it, trim
 * it, and move it. Every function here takes the tenant id as a PARAMETER and resolves nothing —
 * the resolution lives in `version-history-scope.ts`, and keeping that seam explicit is what lets a
 * caller hand these functions a corrected tenant without touching them.
 *
 * Split out of `version-history.ts` when that file crossed the 1000-line gate; a pure move.
 */

import { recordTree, sweepUnreferencedObjects } from './object-store.js';
import { DEFAULT_MAX_VERSIONS } from './version-history-types.js';

import type { HistoryFile, VersionEntry } from '#modules/versioning/types.js';
import type { LoadedTree, ObjectStoreDatabase } from './object-store.js';
import type { HistoryResponse, HistoryRow, HistoryRowRequest } from './version-history-types.js';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import { RESOURCE_SUBTREE_MATCH } from '#modules/versioning/history-key.js';
import { hashCanonical } from '#shared/utils/hash.js';

const ENTRY_COLUMNS = 'version, snapshot, diff_summary, description, created_at';

/**
 * The identity of a snapshot, as the table stores it — the same rule the server writer applies.
 *
 * This module used to compare `JSON.stringify(JSON.parse(row.snapshot)) === JSON.stringify(live)`,
 * which is order-SENSITIVE: two records holding identical data whose keys were emitted in a
 * different order compared unequal, so every `cpm` edit of a resource the server had written
 * bridged. CHANGELOG 4.0.0 claims "version comparison now ignores JSON key order" for the system;
 * it was true of the server writer only. `hashCanonical` is that one rule, imported rather than
 * re-derived — two writers of one durable table cannot each own a copy of what "unchanged" means.
 */
function snapshotIdentity(persistedJson: string): string {
  return hashCanonical(JSON.parse(persistedJson));
}

/**
 * The description a prior-state row carries, on the CLI's one path that writes one.
 *
 * Exported rather than inlined in `recordCheckpointedWrite` because the server writes the same
 * sentence for the same event, and a bridge row an operator can recognise in `cpm history` but not
 * in `resource_manager history` would read as two different events.
 */
export const BRIDGE_DESCRIPTION = 'Bridge: prior live state (era transition or out-of-band edit)';

/** What one append did: the version that is now newest, and whether this call created it. */
export interface AppendOutcome {
  version: number;
  recorded: boolean;
}

/** Imported, not written here — `deleteHistory` matches the same set over MCP. */
const SUBTREE_MATCH = RESOURCE_SUBTREE_MATCH;

export function toEntry(row: HistoryRow): VersionEntry {
  return {
    version: Number(row.version),
    date: row.created_at,
    snapshot: JSON.parse(row.snapshot) as Record<string, unknown>,
    diff_summary: row.diff_summary ?? '',
    description: row.description ?? '',
  };
}

export function selectVersion(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest,
  version: number
): HistoryRow | undefined {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id, version) as HistoryRow | undefined;
}

function latestVersion(db: DatabaseSync, tenantId: string, request: HistoryRowRequest): number {
  const row = db
    .prepare(
      `SELECT MAX(version) AS latest FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id) as
    { latest: number | null } | undefined;
  return Number(row?.latest ?? 0);
}

/** The newest row's number and stored snapshot text, or `undefined` when there is no history. */
function latestRow(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest
): { version: number; snapshot: string } | undefined {
  return db
    .prepare(
      `SELECT version, snapshot FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
       ORDER BY version DESC LIMIT 1`
    )
    .get(tenantId, request.resource_type, request.resource_id) as
    { version: number; snapshot: string } | undefined;
}

/**
 * Insert a snapshot at the next version and trim to `max_versions`.
 *
 * `BEGIN IMMEDIATE` around the whole thing, mirroring `VersionHistoryService.saveVersion`: the
 * number `latestVersion` reads is the number the INSERT writes back, so a second writer committing
 * between the two makes this row land on a stale maximum. `state.db` is one file with two accepted
 * writers — this module and the server — so that connection exists. Since schema v28 the collision
 * is a UNIQUE violation rather than a silent duplicate, which is the better failure but still a
 * failure; only the lock removes the window. IMMEDIATE and not deferred, because a deferred
 * transaction takes no lock until the write, by which point both readers hold the same stale value.
 *
 * No retry: the second writer waits on the lock rather than colliding. Both connections to this
 * file set `busy_timeout` from `STATE_DB_BUSY_TIMEOUT_MS`, so the wait is the same on either side.
 *
 * **An unchanged write creates no row.** The equality test is inside the lock for the same reason
 * the numbering is: decided above the `BEGIN`, this process and the server could each compare
 * against a newest row the other was about to replace, and each conclude "unchanged" against a
 * stale maximum — so a real change would go unrecorded by both.
 */
export function appendVersion(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest,
  snapshot: Record<string, unknown>,
  row: AppendRowFacts
): AppendOutcome {
  db.exec('BEGIN IMMEDIATE');
  try {
    const outcome = appendVersionRow(db, tenantId, request, snapshot, row);
    db.exec('COMMIT');
    return outcome;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** What a row records beyond its snapshot: its prose, and the bytes it may claim. */
export interface AppendRowFacts {
  description: string;
  diffSummary: string;
  /** Non-null only when the bytes on disk RIGHT NOW are this row's state. */
  tree?: LoadedTree | null;
}

/** The body of `appendVersion`, which owns the transaction around it. */
function appendVersionRow(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest,
  snapshot: Record<string, unknown>,
  row: AppendRowFacts
): AppendOutcome {
  const { description, diffSummary } = row;
  const tree = row.tree ?? null;
  // Serialised once: the text the equality test measures is the text the INSERT binds.
  const payload = JSON.stringify(snapshot);
  const latest = latestRow(db, tenantId, request);
  if (latest !== undefined && snapshotIdentity(latest.snapshot) === snapshotIdentity(payload)) {
    return { version: Number(latest.version), recorded: false };
  }

  const version = latestVersion(db, tenantId, request) + 1;
  db.prepare(
    `INSERT INTO version_history
       (tenant_id, organization_id, workspace_id, resource_type, resource_id,
        version, snapshot, diff_summary, description, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tenantId,
    tenantId,
    request.resource_type,
    request.resource_id,
    version,
    payload,
    diffSummary,
    description,
    request.created_at ?? new Date().toISOString()
  );
  const store = asObjectStoreDatabase(db);
  // The SAME recorder the server calls, over bytes the caller read before this transaction
  // opened. One implementation is the whole point: a `cpm` write and a server write of identical
  // files must produce identical `tree_hash`, and two copies of the enumeration-plus-hashing
  // could only agree by inspection.
  if (tree !== null) {
    const row = db
      .prepare(
        `SELECT id FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`
      )
      .get(tenantId, request.resource_type, request.resource_id, version) as
      { id: number } | undefined;
    if (row !== undefined) {
      recordTree(store, { tenantId, versionRowId: Number(row.id), tree });
    }
  }
  pruneVersionHistory(store, {
    tenantId,
    resourceType: request.resource_type,
    resourceId: request.resource_id,
    maxVersions: request.max_versions ?? DEFAULT_MAX_VERSIONS,
  });
  return { version, recorded: true };
}

/**
 * Delete `request.resource_id` and every id below it, and sweep the objects that orphans.
 *
 * One transaction, IMMEDIATE, because the two statements depend on each other: the rows go, their
 * manifest rows go with them by cascade, and the objects nothing references any more go in the
 * same unit. Split across two, a crash between them leaves this tenant's bytes behind with
 * nothing that ever looks at them again — there is no maintenance pass to find them later.
 *
 * Lives here rather than inline in the dispatcher for the same reason `renameSubtree` does: this
 * module is the SQL vocabulary of `version_history`, and the dispatcher routes.
 */
export function deleteSubtree(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest
): HistoryResponse {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `DELETE FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND ${SUBTREE_MATCH}`
    ).run(tenantId, request.resource_type, request.resource_id, request.resource_id);
    sweepUnreferencedObjects(asObjectStoreDatabase(db), tenantId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { success: true };
}

/** What one prune acts on: one resource's rows under one tenant, and the bound they must fit. */
export interface PruneVersionHistoryInput {
  tenantId: string;
  resourceType: string;
  resourceId: string;
  /** The operator's `versioning.maxVersions`, already resolved. Never a default decided here. */
  maxVersions: number;
}

/**
 * Trim one resource's history to `maxVersions`, NEWEST kept — the one implementation, for both
 * writers of `version_history`.
 *
 * There were two, with different SQL and different bounds. The server counted before deleting and
 * used the configured `versioning.maxVersions`; the CLI deleted unconditionally and used a
 * hardcoded 50, because the configured value never reached its request. A workspace set to keep 3
 * therefore kept 3 after a `resource_manager` edit and 50 after a `cpm rollback`, on the same
 * resource in the same file — the operator's setting meant different things depending on which
 * process last wrote. Retention is a property of the TABLE, not of the surface that reached it, so
 * it is stated once here and both writers call it with a bound they resolved, never invented.
 *
 * Takes the two-method database shape `object-store.ts` declares rather than `DatabaseSync` or
 * `DatabasePort`: those are the CLI's and the server's own connection types, and a function both
 * must call can be written against neither. `asObjectStoreDatabase` adapts the CLI's.
 *
 * @returns how many rows the trim removed, so each caller can log its own count.
 */
export function pruneVersionHistory(
  db: ObjectStoreDatabase,
  input: PruneVersionHistoryInput
): number {
  const { tenantId, resourceType, resourceId, maxVersions } = input;
  const key = [tenantId, resourceType, resourceId];

  const counted = db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM version_history
     WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`,
    key
  );
  const total = Number(counted?.cnt ?? 0);
  if (total <= maxVersions) {
    return 0;
  }

  db.run(
    `DELETE FROM version_history
     WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
       AND id NOT IN (
         SELECT id FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY version DESC LIMIT ?
       )`,
    [...key, ...key, maxVersions]
  );
  // Their manifest rows went with them by cascade; their OBJECTS did not, and nothing else ever
  // looks at an object again. Same transaction as the delete that orphaned them.
  sweepUnreferencedObjects(db, tenantId);
  return total - maxVersions;
}

/**
 * The CLI's raw `DatabaseSync` as the two-method shape the shared history writes take.
 *
 * `node:sqlite` exposes `prepare`/`exec`, not `run(sql, params)`, so the adapter is unavoidable —
 * it is four lines here instead of a second copy of every shared statement over there.
 */
function asObjectStoreDatabase(db: DatabaseSync): ObjectStoreDatabase {
  return {
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as SQLInputValue[]));
    },
    queryOne: <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      (db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined) ?? null,
  };
}

export function loadRows(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest
): HistoryFile {
  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
       ORDER BY version DESC`
    )
    .all(tenantId, request.resource_type, request.resource_id) as unknown as HistoryRow[];
  const versions = rows.map(toEntry);
  return {
    resource_type: request.resource_type as HistoryFile['resource_type'],
    resource_id: request.resource_id,
    current_version: versions[0]?.version ?? 0,
    versions,
  };
}

/** One row about to be re-keyed by a rename, before its new id and version are decided. */
interface MovingRow {
  id: number;
  resource_id: string;
  version: number;
}

/**
 * Re-key `request.resource_id` and everything below it onto `newResourceId`, renumbering.
 *
 * **The renumbering is the point.** A resource's `version_history` rows survive its deletion by
 * design — every delete path says so — so an id can carry history while nothing serves it, and
 * renaming another resource onto that id merges two sequences. Until schema v28 the merge was a
 * bare `UPDATE ... SET resource_id`, which left two rows claiming to be v1: `getVersion`,
 * `compareVersions` and `rollback` all select by version, so they restored whichever row SQLite
 * reached first. The incoming rows now continue after the target's newest version, keeping their
 * own order, and a target with no history is re-keyed untouched — "continue after the max" must
 * stay distinguishable from "always renumber from 1", or a plain rename silently rewrites numbers
 * the operator has seen.
 *
 * One transaction: a partially re-keyed history is a resource whose past is split across two ids.
 */
export function renameSubtree(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest,
  newResourceId: string
): HistoryResponse {
  const oldResourceId = request.resource_id;
  if (newResourceId === oldResourceId) {
    return { success: true };
  }
  if (newResourceId.startsWith(`${oldResourceId}/`)) {
    // Renaming a chain into its own subtree would move rows underneath themselves; the caller's
    // file rename cannot express it either. Refuse rather than produce an arbitrary re-key.
    return {
      success: false,
      error: `Cannot rename ${oldResourceId} onto ${newResourceId}, which is below it`,
    };
  }

  const movingRows = db.prepare(
    `SELECT id, resource_id, version FROM version_history
     WHERE tenant_id = ? AND resource_type = ? AND ${SUBTREE_MATCH}
     ORDER BY resource_id, version, id`
  );
  const maxVersionAt = db.prepare(
    `SELECT MAX(version) AS latest FROM version_history
     WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`
  );
  const rekey = db.prepare(`UPDATE version_history SET resource_id = ?, version = ? WHERE id = ?`);

  // Every read is INSIDE the lock, including the one that decides WHICH rows move. It used to sit
  // above the BEGIN, where a row saved between the select and the lock would have been left behind
  // under the old id — the whole point of taking the lock up front is that the set this acts on
  // cannot change under it.
  db.exec('BEGIN IMMEDIATE');
  try {
    const moving = movingRows.all(
      tenantId,
      request.resource_type,
      oldResourceId,
      oldResourceId
    ) as unknown as MovingRow[];

    // Per target id: `null` while the target had no history (the rows keep their own numbers), or
    // the last version handed out (each further row continues after it).
    const continueAfter = new Map<string, number | null>();
    for (const row of moving) {
      const targetId = newResourceId + row.resource_id.slice(oldResourceId.length);
      if (!continueAfter.has(targetId)) {
        const existing = maxVersionAt.get(tenantId, request.resource_type, targetId) as
          { latest: number | null } | undefined;
        const latest = Number(existing?.latest ?? 0);
        continueAfter.set(targetId, latest === 0 ? null : latest);
      }
      const previous = continueAfter.get(targetId) ?? null;
      const version = previous === null ? row.version : previous + 1;
      rekey.run(targetId, version, row.id);
      if (previous !== null) {
        continueAfter.set(targetId, version);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { success: true };
}
