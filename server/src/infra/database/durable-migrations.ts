// @lifecycle canonical - Plans and applies durable-table migration steps as pure transforms over the snapshot rows
/**
 * Durable Migrations — what happens to the rows of a durable table when the schema moves on.
 *
 * `SqliteEngine` upgrades a database by snapshotting the durable tables, recreating the schema and
 * restoring the rows whose column NAMES still exist. A renamed column therefore loses its values
 * silently. A migration step is the declared alternative: a pure transform over the snapshot rows
 * (never SQL), run between the snapshot and the restore, so a rename is carried instead of dropped.
 *
 * This module decides three things and does no I/O: which steps apply to an upgrade
 * (`planDurableMigrations`), what the snapshot looks like after they ran
 * (`applyDurableMigrations`), and which snapshot columns would be lost without any step having
 * declared the loss (`undeclaredColumnLoss`).
 */

/**
 * One snapshot row. Values are `unknown` because that is what the engine's `SELECT *` yields and
 * what its restore binds, so snapshot rows pass through without a cast.
 */
export type DurableRow = Readonly<Record<string, unknown>>;

/** Rows of each durable table carried across a schema recreate, keyed by table name. */
export type DurableSnapshot = ReadonlyMap<string, readonly DurableRow[]>;

export interface DurableMigration {
  /** Runs when upgrading across `toVersion - 1` -> `toVersion`. */
  readonly toVersion: number;
  /** Durable tables this step rewrites. */
  readonly tables: readonly string[];
  /** Columns this step deliberately removes, per table; anything else missing is undeclared loss. */
  readonly droppedColumns?: Readonly<Record<string, readonly string[]>>;
  readonly summary: string;
  /** Must not mutate its input. */
  migrate(snapshot: DurableSnapshot): DurableSnapshot;
}

/** Oldest schema version a migration path exists from; older databases are recreated, not migrated. */
export const MIGRATION_FLOOR = 35;

export const DURABLE_MIGRATIONS: readonly DurableMigration[] = [];

export type MigrationPlan =
  | { kind: 'steps'; steps: readonly DurableMigration[] }
  | { kind: 'below-floor'; from: number; floor: number };

/**
 * Select the steps that carry a database at version `from` up to `to`, ascending by `toVersion`.
 *
 * A malformed registry (duplicate `toVersion`, or a step at or below the floor) throws: it is a
 * programmer error, and carrying on would run steps in an order nobody declared.
 */
export function planDurableMigrations(
  from: number,
  to: number,
  registry: readonly DurableMigration[] = DURABLE_MIGRATIONS
): MigrationPlan {
  if (from > to) {
    throw new Error(`Cannot plan a durable migration downward: from v${from} to v${to}.`);
  }
  assertRegistryWellFormed(registry);
  if (from < MIGRATION_FLOOR) {
    return { kind: 'below-floor', from, floor: MIGRATION_FLOOR };
  }
  const steps = registry
    .filter((step) => step.toVersion > from && step.toVersion <= to)
    .sort((left, right) => left.toVersion - right.toVersion);
  return { kind: 'steps', steps };
}

/** Fold the steps over the snapshot in the order given; the input snapshot is left untouched. */
export function applyDurableMigrations(
  snapshot: DurableSnapshot,
  steps: readonly DurableMigration[]
): DurableSnapshot {
  return steps.reduce<DurableSnapshot>((current, step) => step.migrate(current), snapshot);
}

/**
 * Snapshot columns of `table` that are absent from the new schema and that no step declared in
 * `droppedColumns[table]`. Sorted so the message an operator reads is stable.
 */
export function undeclaredColumnLoss(
  table: string,
  snapshotColumns: readonly string[],
  newColumns: ReadonlySet<string>,
  steps: readonly DurableMigration[]
): string[] {
  const declared = new Set(steps.flatMap((step) => step.droppedColumns?.[table] ?? []));
  return snapshotColumns
    .filter((column) => !newColumns.has(column) && !declared.has(column))
    .sort();
}

function assertRegistryWellFormed(registry: readonly DurableMigration[]): void {
  const seen = new Set<number>();
  for (const step of registry) {
    if (step.toVersion <= MIGRATION_FLOOR) {
      throw new Error(
        `Durable migration to v${step.toVersion} is at or below the floor v${MIGRATION_FLOOR}: ` +
          'databases that old are recreated, so the step could never run.'
      );
    }
    if (seen.has(step.toVersion)) {
      throw new Error(`Two durable migrations declare toVersion v${step.toVersion}.`);
    }
    seen.add(step.toVersion);
  }
}
