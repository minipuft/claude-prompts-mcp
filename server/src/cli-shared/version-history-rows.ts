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

import { DEFAULT_MAX_VERSIONS } from './version-history-types.js';

import type { HistoryFile, VersionEntry } from '#modules/versioning/types.js';
import type { HistoryRequest, HistoryResponse, HistoryRow } from './version-history-types.js';
import type { DatabaseSync } from 'node:sqlite';

import { RESOURCE_SUBTREE_MATCH } from '#modules/versioning/history-key.js';

const ENTRY_COLUMNS = 'version, snapshot, diff_summary, description, created_at';

/** Imported, not written here — `deleteHistory` matches the same set over MCP. */
export const SUBTREE_MATCH = RESOURCE_SUBTREE_MATCH;

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
  request: HistoryRequest,
  version: number
): HistoryRow | undefined {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id, version) as HistoryRow | undefined;
}

function latestVersion(db: DatabaseSync, tenantId: string, request: HistoryRequest): number {
  const row = db
    .prepare(
      `SELECT MAX(version) AS latest FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id) as
    { latest: number | null } | undefined;
  return Number(row?.latest ?? 0);
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
 */
export function appendVersion(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  snapshot: Record<string, unknown>,
  description: string,
  diffSummary: string
): number {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = appendVersionRow(db, tenantId, request, snapshot, description, diffSummary);
    db.exec('COMMIT');
    return version;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** The body of `appendVersion`, which owns the transaction around it. */
function appendVersionRow(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  snapshot: Record<string, unknown>,
  description: string,
  diffSummary: string
): number {
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
    JSON.stringify(snapshot),
    diffSummary,
    description,
    request.created_at ?? new Date().toISOString()
  );
  prune(db, tenantId, request, request.max_versions ?? DEFAULT_MAX_VERSIONS);
  return version;
}

/** True when the newest recorded snapshot structurally equals the given live state. */
function latestSnapshotMatches(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  live: Record<string, unknown>
): boolean {
  const latest = latestVersion(db, tenantId, request);
  if (latest === 0) return false;
  const row = selectVersion(db, tenantId, request, latest);
  if (row === undefined) return false;
  return JSON.stringify(JSON.parse(row.snapshot)) === JSON.stringify(live);
}

/**
 * Record the state PRODUCED by an edit, bridging any unrecorded prior state first.
 *
 * Mirrors `VersionHistoryService.recordEditResult` exactly (P7 go-forward numbering): version N
 * always holds the state edit N produced. Whenever the latest recorded snapshot differs from the
 * live pre-edit state (first update of a never-before-recorded resource, or an out-of-band edit),
 * that live state is bridged in first so it stays rollback-reachable; steady state records exactly
 * one row per edit. Both writers of `version_history` must agree on this, or a resource's "newest
 * version" means something different depending on which process wrote it.
 */
export function recordEditResultRow(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  edit: {
    priorLiveSnapshot: Record<string, unknown>;
    producedSnapshot: Record<string, unknown>;
    description: string;
    diffSummary: string;
  }
): { version: number; bridged: boolean } {
  const { priorLiveSnapshot, producedSnapshot, description, diffSummary } = edit;
  const bridged = !latestSnapshotMatches(db, tenantId, request, priorLiveSnapshot);
  if (bridged) {
    appendVersion(
      db,
      tenantId,
      request,
      priorLiveSnapshot,
      'Bridge: prior live state (era transition or out-of-band edit)',
      ''
    );
  }
  const version = appendVersion(db, tenantId, request, producedSnapshot, description, diffSummary);
  return { version, bridged };
}

function prune(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  maxVersions: number
): void {
  db.prepare(
    `DELETE FROM version_history
     WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
       AND id NOT IN (
         SELECT id FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY version DESC LIMIT ?
       )`
  ).run(
    tenantId,
    request.resource_type,
    request.resource_id,
    tenantId,
    request.resource_type,
    request.resource_id,
    maxVersions
  );
}

export function loadRows(db: DatabaseSync, tenantId: string, request: HistoryRequest): HistoryFile {
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
  request: HistoryRequest,
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
