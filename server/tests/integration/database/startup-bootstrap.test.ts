// @lifecycle test - Verifies ResourceIndexer is populated during startup wiring
/**
 * Startup Bootstrap Integration Test
 *
 * Simulates the server startup path: SqliteEngine.getInstance() → ResourceIndexer.syncAll()
 * → data readable from a fresh SqliteEngine instance (node:sqlite writes directly to disk).
 *
 * This test catches the bug where ResourceIndexer was never called at startup,
 * leaving the resource_index table empty for Python hooks.
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

describe('Startup Bootstrap — ResourceIndexer wiring', () => {
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
    // Simulate the startup path from module-initializer.ts
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
