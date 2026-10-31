/**
 * Durable migrations are planned and applied as pure functions over the snapshot rows.
 *
 * Drives the exported functions with hand-built registries (the shipped registry is empty): step
 * selection across a sparse registry, the malformed-registry refusals, in-order folding without
 * mutating the input, and undeclared column loss.
 */

import { describe, expect, it } from '@jest/globals';

import {
  applyDurableMigrations,
  DURABLE_MIGRATIONS,
  MIGRATION_FLOOR,
  planDurableMigrations,
  undeclaredColumnLoss,
  type DurableMigration,
  type DurableSnapshot,
} from '../../../../src/infra/database/durable-migrations.js';

function step(toVersion: number, overrides: Partial<DurableMigration> = {}): DurableMigration {
  return {
    toVersion,
    tables: ['version_history'],
    summary: `step ${toVersion}`,
    migrate: (snapshot) => snapshot,
    ...overrides,
  };
}

function versionsOf(plan: ReturnType<typeof planDurableMigrations>): number[] {
  if (plan.kind !== 'steps') {
    throw new Error(`expected steps, got ${plan.kind}`);
  }
  return plan.steps.map((planned) => planned.toVersion);
}

describe('planDurableMigrations', () => {
  it('ships an empty registry above a floor of 35', () => {
    expect(DURABLE_MIGRATIONS).toEqual([]);
    expect(MIGRATION_FLOOR).toBe(35);
  });

  it('reports a database below the floor instead of planning steps', () => {
    const plan = planDurableMigrations(MIGRATION_FLOOR - 1, 40, [step(36)]);
    expect(plan).toEqual({
      kind: 'below-floor',
      from: MIGRATION_FLOOR - 1,
      floor: MIGRATION_FLOOR,
    });
  });

  it('plans no steps when the versions are equal', () => {
    expect(planDurableMigrations(36, 36, [step(36)])).toEqual({ kind: 'steps', steps: [] });
  });

  it('selects the steps in (from, to] ascending across a sparse registry', () => {
    const registry = [step(38), step(36), step(40)];
    expect(versionsOf(planDurableMigrations(35, 38, registry))).toEqual([36, 38]);
    expect(versionsOf(planDurableMigrations(36, 38, registry))).toEqual([38]);
    expect(versionsOf(planDurableMigrations(38, 40, registry))).toEqual([40]);
  });

  it('throws when two steps declare the same toVersion', () => {
    expect(() => planDurableMigrations(35, 38, [step(36), step(36)])).toThrow(/v36/);
  });

  it('throws for a step at or below the floor', () => {
    expect(() => planDurableMigrations(35, 38, [step(MIGRATION_FLOOR)])).toThrow(/floor/);
    expect(() => planDurableMigrations(35, 38, [step(MIGRATION_FLOOR - 1)])).toThrow(/floor/);
  });

  it('throws when asked to plan downward', () => {
    expect(() => planDurableMigrations(38, 36, [])).toThrow(/downward/);
  });
});

describe('applyDurableMigrations', () => {
  const rename = (toVersion: number, from: string, to: string): DurableMigration =>
    step(toVersion, {
      migrate: (snapshot) => {
        const next = new Map(snapshot);
        next.set(
          'version_history',
          (snapshot.get('version_history') ?? []).map((row) => {
            const { [from]: value, ...rest } = row;
            return { ...rest, [to]: value };
          })
        );
        return next;
      },
    });

  it('folds the steps in order and leaves the input snapshot unchanged', () => {
    const rows = Object.freeze([Object.freeze({ id: 1, old_name: 'a' })]);
    const input: DurableSnapshot = new Map([['version_history', rows]]);

    const result = applyDurableMigrations(input, [
      rename(36, 'old_name', 'mid_name'),
      rename(37, 'mid_name', 'new_name'),
    ]);

    expect(result.get('version_history')).toEqual([{ id: 1, new_name: 'a' }]);
    expect(input.get('version_history')).toEqual([{ id: 1, old_name: 'a' }]);
    expect(input.get('version_history')).toBe(rows);
  });

  it('returns the snapshot as given when there are no steps', () => {
    const input: DurableSnapshot = new Map([['version_history', [{ id: 1 }]]]);
    expect(applyDurableMigrations(input, [])).toBe(input);
  });
});

describe('undeclaredColumnLoss', () => {
  const newColumns = new Set(['id']);

  it('returns every missing column, sorted, when no step declares a drop', () => {
    expect(
      undeclaredColumnLoss('version_history', ['id', 'zeta', 'alpha'], newColumns, [])
    ).toEqual(['alpha', 'zeta']);
  });

  it('omits a column a step declares dropped for that table', () => {
    const steps = [step(36, { droppedColumns: { version_history: ['alpha'] } })];
    expect(
      undeclaredColumnLoss('version_history', ['id', 'zeta', 'alpha'], newColumns, steps)
    ).toEqual(['zeta']);
  });

  it('does not accept a drop declared for another table', () => {
    const steps = [step(36, { droppedColumns: { objects: ['alpha'] } })];
    expect(undeclaredColumnLoss('version_history', ['id', 'alpha'], newColumns, steps)).toEqual([
      'alpha',
    ]);
  });

  it('returns nothing when every snapshot column survives', () => {
    expect(undeclaredColumnLoss('version_history', ['id'], newColumns, [])).toEqual([]);
  });
});
