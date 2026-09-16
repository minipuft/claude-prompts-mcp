// @lifecycle test - Verifies a syncAll over the bundled tree indexes every kind and survives a reopen
/**
 * Resource Index Bootstrap Integration Test
 *
 * Drives `SqliteEngine.getInstance()` → `createResourceIndexer(...).syncAll()` over the real
 * bundled `resources/` tree, then reads the rows back through a FRESH engine, the way a Python
 * hook reads them. Two claims, both observable from here: a single `syncAll()` indexes all four
 * directory-form kinds, and what it wrote is on disk for the next process.
 *
 * WHAT THIS FILE DOES NOT COVER, AND USED TO CLAIM. Until 2026-09-15 the header said it caught
 * the defect where the indexer was never called at startup. It cannot, and never could: it
 * constructs the indexer and calls `syncAll()` itself, and reaches no line of
 * `runtime/module-initializer.ts`. Mutation-proven — replacing the `syncAll()` result at the
 * module-initializer call site with a literal left this file 4/4 green, while
 * `tests/e2e/bundled-resource-fallback.e2e.test.ts`, which spawns a server and reads
 * `resource_index` out of its state.db, went 6 cases red. That e2e owns the wiring claim. The
 * header is restated rather than the test rewritten, because driving the composition root a
 * second time from an integration fixture would duplicate that e2e rather than close a gap.
 *
 * Case 1 seeds the shared `dbManager` that cases 2 and 3 read; they are ordered, not independent.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real bundled resources).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import { SqliteEngine, createResourceIndexer } from '../../../src/infra/database/index.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

describe('Resource index bootstrap — syncAll over the bundled tree', () => {
  const testDir = path.join(process.cwd(), 'tests/tmp/bootstrap-test');
  const resourcesDir = path.join(process.cwd(), 'resources');
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should populate resource_index with all resource types after syncAll + persist', async () => {
    // Seeds the shared `dbManager` the two cases below read.
    dbManager = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await dbManager.initialize();

    const indexer = createResourceIndexer(dbManager, mockLogger as any, { resourcesDir });
    await indexer.syncAll();

    // Verify all resource types are indexed
    const prompts = indexer.queryByType('prompt');
    const gates = indexer.queryByType('gate');
    const frameworks = indexer.queryByType('framework');
    const styles = indexer.queryByType('style');

    expect(prompts.length).toBeGreaterThan(0);
    expect(gates.length).toBeGreaterThan(0);
    expect(frameworks.length).toBeGreaterThan(0);
    expect(styles.length).toBeGreaterThan(0);
  });

  it('should persist data to disk file readable by external consumers', async () => {
    // Verify the state.db file exists on disk
    const dbPath = path.join(testDir, 'runtime-state', 'state.db');
    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('should have data readable from a fresh SqliteEngine (simulates Python hook read)', async () => {
    // Shut down the first manager to ensure everything is flushed
    await dbManager.shutdown();

    // Create a fresh SqliteEngine — simulates how Python hooks read state.db
    const freshManager = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await freshManager.initialize();

    // Query the raw resource_index table directly (like Python hooks do)
    const rows = freshManager.query<{ id: string; type: string }>(
      `SELECT id, type FROM resource_index WHERE type = 'prompt'`
    );

    expect(rows.length).toBeGreaterThan(0);

    // Verify we can also read gates
    const gateRows = freshManager.query<{ id: string; type: string }>(
      `SELECT id, type FROM resource_index WHERE type = 'gate'`
    );
    expect(gateRows.length).toBeGreaterThan(0);

    // Reassign for cleanup
    dbManager = freshManager;
  });

  it('should not have orphaned checkpoint_state table', () => {
    // Verify the orphaned table was removed from schema
    const tables = dbManager.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoint_state'`
    );
    expect(tables).toHaveLength(0);
  });
});
