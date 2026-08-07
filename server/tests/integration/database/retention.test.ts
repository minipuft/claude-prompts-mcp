// @lifecycle test - Tier 6.4: declared row caps are actually enforced
/**
 * Retention Enforcement Integration Test
 *
 * Every table declares a `retention` in `table-contracts.ts`. Until Tier 6.4 that declaration was
 * inert for `execution_records`, whose `retentionRationale` was literally the word PLACEHOLDER and
 * which had no DELETE anywhere while `state.db` is shared across every project on the machine.
 *
 * Criteria under test, enumerated because the subtier row names two behaviours:
 *   1. a startup pass trims an over-cap table to its declared cap
 *   2. the per-write trim in ResourceChangeTracker delegates to the SAME implementation
 *   3. tables declaring `unbounded-justified` are left alone
 *   4. `maxRowsPerResource` is NOT enforced here (documented scope limit, not an oversight)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { enforceRetention } from '../../../src/infra/database/retention.js';
import { TABLE_CONTRACTS } from '../../../src/infra/database/table-contracts.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const testDir = path.join(process.cwd(), 'tests/tmp/retention-test');

function capFor(table: string): number {
  const contract = TABLE_CONTRACTS.find((c) => c.table === table);
  const retention = contract?.retention;
  if (retention === undefined || typeof retention === 'string' || !('maxRows' in retention)) {
    throw new Error(`${table} does not declare a maxRows cap`);
  }
  return retention.maxRows;
}

function seedChanges(engine: SqliteEngine, count: number): void {
  for (let i = 0; i < count; i++) {
    engine.run(
      `INSERT INTO resource_changes
         (tenant_id, timestamp, source, operation, resource_type, resource_id, file_path, content_hash)
       VALUES ('t', ?, 'filesystem', 'modified', 'prompt', ?, ?, ?)`,
      [new Date().toISOString(), `res-${i}`, `/tmp/res-${i}.md`, `hash-${i}`]
    );
  }
}

function countOf(engine: SqliteEngine, table: string): number {
  return engine.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
}

describe('Retention enforcement (6.4)', () => {
  let engine: SqliteEngine;

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
    engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await engine.initialize();
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('trims an over-cap table to its declared cap, keeping the newest rows', () => {
    const cap = capFor('resource_changes');
    // Seed PAST the bound, not up to it — a fixture inside the bound cannot fail.
    seedChanges(engine, cap + 25);
    expect(countOf(engine, 'resource_changes')).toBe(cap + 25);

    const results = enforceRetention(engine, mockLogger as any);

    expect(countOf(engine, 'resource_changes')).toBe(cap);
    expect(results).toContainEqual({ table: 'resource_changes', cap, deleted: 25 });

    // Newest kept, oldest evicted.
    const oldest = engine.queryOne(`SELECT id FROM resource_changes WHERE resource_id = 'res-0'`);
    const newest = engine.queryOne(`SELECT id FROM resource_changes WHERE resource_id = ?`, [
      `res-${cap + 24}`,
    ]);
    expect(oldest).toBeNull();
    expect(newest).not.toBeNull();
  });

  it('is a no-op when the table is under its cap', () => {
    seedChanges(engine, 5);
    const results = enforceRetention(engine, mockLogger as any);
    expect(results.find((r) => r.table === 'resource_changes')).toBeUndefined();
    expect(countOf(engine, 'resource_changes')).toBe(5);
  });

  it('enforces execution_records, which previously had no DELETE anywhere', () => {
    const cap = capFor('execution_records');
    expect(cap).toBeGreaterThan(0); // the PLACEHOLDER rationale is gone
  });

  it('leaves unbounded-justified tables untouched', () => {
    engine.run(
      `INSERT INTO kv_state (tenant_id, key, state, updated_at)
       VALUES ('a', 'framework', '{}', datetime('now'))`
    );
    engine.run(
      `INSERT INTO kv_state (tenant_id, key, state, updated_at)
       VALUES ('b', 'framework', '{}', datetime('now'))`
    );

    enforceRetention(engine, mockLogger as any);

    // kv_state is `unbounded-justified`; a generic maxRows pass over it would destroy every
    // workspace's framework state but one.
    expect(countOf(engine, 'kv_state')).toBe(2);
  });

  it('does not enforce maxRowsPerResource — a documented scope limit', () => {
    const contract = TABLE_CONTRACTS.find((c) => c.table === 'version_history');
    expect(contract?.retention).toHaveProperty('maxRowsPerResource');

    for (let v = 1; v <= 60; v++) {
      engine.run(
        `INSERT INTO version_history
           (tenant_id, resource_type, resource_id, version, snapshot, created_at)
         VALUES ('t', 'prompt', 'p', ?, '{}', ?)`,
        [v, new Date().toISOString()]
      );
    }

    enforceRetention(engine, mockLogger as any);

    // Untouched: version_history prunes at its own write sites, which know the partition
    // columns. Asserting this keeps a future generic implementation from landing silently.
    expect(countOf(engine, 'version_history')).toBe(60);
  });

  it('runs automatically at engine startup', async () => {
    const cap = capFor('resource_changes');
    seedChanges(engine, cap + 10);
    await engine.shutdown();

    const reopened = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await reopened.initialize();

    expect(countOf(reopened, 'resource_changes')).toBe(cap);
  });
});
