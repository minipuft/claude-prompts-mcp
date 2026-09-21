// @lifecycle canonical - The startup referential check over the v29 object store, as pure decisions
/**
 * Referential check A over `objects` / `version_entries`, and the repair it implies.
 *
 * THE FAILURE IT EXISTS FOR. `version_history.tree_hash` is non-NULL exactly when the row's file
 * bytes are recorded in the store. Two things can break that claim while every gate stays green:
 * a v28-era server opening a v29 database drops both new tables and keeps `version_history`
 * (§Downgrade in `docs/architecture/sqlite-persistence.md`); and an opener WITHOUT foreign key
 * constraints deletes a referenced object, or deletes entries without the row that owns them. In
 * both the row claims a tree that is not there, and the only symptom is a rollback that reads
 * bytes it cannot find.
 *
 * The second case is narrower than a reading of the DDL suggests, and narrower than this slice's
 * design assumed. `node:sqlite` enables foreign keys BY DEFAULT, so both writers of `state.db`
 * already refuse a delete of a referenced object — measured 2026-09-20, `PRAGMA foreign_keys`
 * reads 1 on a fresh `DatabaseSync`. What is left is that the guarantee is a per-CONNECTION driver
 * default this repository does not assert: another language, the `sqlite3` CLI, or a connection
 * that turns the pragma off writes into the same file. This check is what stands in that gap, so
 * it does not retire when the constraints are made explicit.
 *
 * THE REPAIR IS A DEGRADE, NOT A DELETION. An affected row's `tree_hash` goes back to NULL and its
 * entries are removed, which returns the row to exactly the behaviour it had at v28: it restores
 * through `version_history.snapshot` and the projection path. **History is never lost** — that is
 * what makes a repair at startup preferable to a refusal to start, which would convert a
 * recoverable degradation into an unbootable server.
 *
 * WHY THIS FILE IS PURE, AND WHERE THE SQL RUNS. `validate:arch` forbids `infra/` from importing
 * `engine/`, `modules/` or `mcp/` in any form, so the engine cannot reach a `modules/versioning/`
 * module at startup. The decision therefore lives here, next to the engine, and the engine runs
 * the two queries and the two writes — the same split `renumberDuplicateVersionHistory` already
 * uses for the v28 migration, and the reason the write sites stay inside the one file the
 * single-writer gate permits to touch every table.
 *
 * THE LOG LINE NAMES COUNTS AND NOTHING ELSE. Never a hash, never a path, never bytes: this runs
 * on every boot of a database shared across every project on the machine, and a repair report is
 * not a place to emit content.
 */

/** One row of the dangling-entry and empty-tree queries below. */
export interface VersionTreeRow {
  readonly version_row_id: number;
}

/**
 * Entries whose object is not in the store, per tenant.
 *
 * ONE indexed join: `idx_version_entries_object` is on `(tenant_id, object_hash)` and `objects` is
 * keyed on `(tenant_id, hash)`, so this is an index scan against an index probe. The tenant column
 * is part of the join and not a filter — the check is per workspace by construction rather than by
 * remembering to add a WHERE clause.
 */
export const DANGLING_ENTRY_SQL = `
  SELECT DISTINCT ve.version_row_id AS version_row_id
  FROM version_entries ve
  LEFT JOIN objects o ON o.tenant_id = ve.tenant_id AND o.hash = ve.object_hash
  WHERE o.hash IS NULL
`;

/**
 * Rows claiming a tree that has no entries at all.
 *
 * The downgrade round trip produces exactly this shape: a v28 server drops `version_entries`
 * wholesale, so the rows come back with `tree_hash` intact and nothing behind it. The dangling
 * query above cannot see it — there is no entry left to be dangling.
 */
export const EMPTY_TREE_SQL = `
  SELECT vh.id AS version_row_id
  FROM version_history vh
  LEFT JOIN version_entries ve ON ve.version_row_id = vh.id
  WHERE vh.tree_hash IS NOT NULL AND ve.version_row_id IS NULL
`;

export interface VersionTreeRepairPlan {
  /** Version rows whose `tree_hash` must go back to NULL. Sorted, de-duplicated. */
  readonly rowIds: readonly number[];
  /** How many of them were found by the dangling-object query. */
  readonly withMissingObject: number;
  /** How many of them were found by the empty-tree query. */
  readonly withNoEntries: number;
}

/**
 * Decide which version rows must degrade to the projection path. PURE.
 *
 * A row can appear in both inputs (every entry dangling is still an entry, so a row only reaches
 * the second query once nothing is left); the two counts are reported separately because they
 * name different causes, while `rowIds` is the de-duplicated union the repair acts on.
 */
export function planVersionTreeRepair(
  danglingEntries: readonly VersionTreeRow[],
  emptyTrees: readonly VersionTreeRow[]
): VersionTreeRepairPlan {
  const ids = new Set<number>();
  for (const row of danglingEntries) ids.add(Number(row.version_row_id));
  for (const row of emptyTrees) ids.add(Number(row.version_row_id));

  return {
    rowIds: [...ids].sort((left, right) => left - right),
    withMissingObject: danglingEntries.length,
    withNoEntries: emptyTrees.length,
  };
}

/** The single startup line. Counts only — no hash, no path, no content. */
export function describeVersionTreeRepair(plan: VersionTreeRepairPlan): string {
  return (
    `version trees: repaired ${plan.rowIds.length} version_history row(s) whose recorded file ` +
    `set is no longer reachable (${plan.withMissingObject} with a missing object, ` +
    `${plan.withNoEntries} with no entries). Their tree_hash is back to NULL and they restore ` +
    'from the stored snapshot, as they did before schema v29; no history was discarded.'
  );
}
