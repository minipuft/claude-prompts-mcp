// @lifecycle canonical - Enforces the row caps declared in table-contracts.ts
/**
 * Retention enforcement.
 *
 * Every table in `TABLE_CONTRACTS` declares a `retention`. Until Tier 6.4 that declaration was
 * inert: `resource_changes` trimmed itself with its own inlined SQL, `version_history` pruned at
 * its write site, and `execution_records` — which declared `unbounded-justified` with a rationale
 * whose text was the word PLACEHOLDER — had no DELETE anywhere. `state.db` is shared across every
 * project on the machine, so "unbounded in fact" is not a posture, it is a leak.
 *
 * This module makes the declaration executable. It is a pure function over (database, contracts):
 * no state, no lifecycle, no owned connection — hence a module of functions rather than a class.
 *
 * **Scope, stated so a green run is not over-read**: only `{ maxRows }` is enforced here.
 * `{ maxRowsPerResource }` needs partition columns that differ per table, and `version_history` —
 * its only holder — already prunes correctly at both of its write sites. A second, generic pass
 * over the same rows would add a way to be wrong without adding coverage. `maxAgeDays` has no
 * declarer today and is deliberately unimplemented rather than speculatively written.
 */

import { TABLE_CONTRACTS } from './table-contracts.js';

import type { DatabasePort } from '#shared/types/persistence.js';
import type { Logger } from '../logging/index.js';

/** One table's trim outcome. */
export interface RetentionResult {
  table: string;
  cap: number;
  deleted: number;
}

/**
 * Trim one table to its declared row cap, newest-first.
 *
 * Orders by `rowid` rather than by any declared column: it exists on every rowid table, is
 * monotonic in insertion order, and needs no per-table knowledge. `resource_changes` (INTEGER
 * PRIMARY KEY AUTOINCREMENT) and `execution_records` (ULID TEXT primary key) both order the same
 * way under it, which is what lets one statement serve both.
 */
function trimToCap(db: DatabasePort, table: string, cap: number): number {
  const before = db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  const rows = before?.count ?? 0;
  if (rows <= cap) {
    return 0;
  }

  db.run(
    `DELETE FROM ${table} WHERE rowid NOT IN (
       SELECT rowid FROM ${table} ORDER BY rowid DESC LIMIT ?
     )`,
    [cap]
  );
  return rows - cap;
}

/**
 * Enforce every declared `{ maxRows }` cap.
 *
 * Table names are interpolated into SQL, which is safe here for a reason worth stating rather than
 * assuming: they come from `TABLE_CONTRACTS`, a compile-time constant in this repository, never
 * from a request. Caps are bound as parameters.
 *
 * @param only - Restrict to one table. Used by writers that trim after their own inserts, so the
 *   shared implementation runs at both the startup pass and the write site instead of a second
 *   hand-rolled DELETE drifting from this one.
 */
export function enforceRetention(
  db: DatabasePort,
  logger: Logger,
  only?: string
): RetentionResult[] {
  const results: RetentionResult[] = [];

  for (const contract of TABLE_CONTRACTS) {
    if (only !== undefined && contract.table !== only) {
      continue;
    }
    const retention = contract.retention;
    if (typeof retention === 'string' || !('maxRows' in retention)) {
      continue;
    }

    try {
      const deleted = trimToCap(db, contract.table, retention.maxRows);
      if (deleted > 0) {
        results.push({ table: contract.table, cap: retention.maxRows, deleted });
      }
    } catch (error) {
      // A trim failure must not take the server down: the rows are still there, the cap is
      // enforced again on the next pass, and the alternative is a database that cannot start
      // because one table is over its limit.
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Retention pass skipped ${contract.table}: ${msg}`);
    }
  }

  if (results.length > 0) {
    const summary = results.map((r) => `${r.table} -${r.deleted} (cap ${r.cap})`).join(', ');
    logger.info(`Retention enforced: ${summary}`);
  }
  return results;
}
