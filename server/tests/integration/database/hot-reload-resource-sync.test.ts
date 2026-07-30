// @lifecycle test - Verifies ResourceIndexer re-sync after simulated hot-reload
/**
 * Hot-Reload Resource Sync Integration Test
 *
 * Simulates the hot-reload path: initial sync → add/remove resource files → re-sync
 * → verify resource_index reflects changes → verify persist writes to disk.
 *
 * This tests the fullServerRefresh() ResourceIndexer re-sync path added in application.ts.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import { SqliteEngine, createResourceIndexer } from '../../../src/infra/database/index.js';

import type { ResourceIndexer } from '../../../src/infra/database/index.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/hot-reload-sync-test');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');

/**
 * Create a minimal YAML resource file on disk for indexing
 */
async function createResourceFile(
  type: 'prompts' | 'gates' | 'frameworks' | 'styles',
  id: string,
  fields: Record<string, string>
): Promise<void> {
  const yamlFileName =
    type === 'prompts'
      ? 'prompt.yaml'
      : type === 'gates'
        ? 'gate.yaml'
        : type === 'frameworks'
          ? 'framework.yaml'
          : 'style.yaml';

  const dir = path.join(RESOURCES_DIR, type, id);
  await fs.mkdir(dir, { recursive: true });

  const lines = Object.entries(fields).map(([k, v]) => `${k}: "${v}"`);
  await fs.writeFile(path.join(dir, yamlFileName), lines.join('\n'), 'utf-8');
}

describe('Hot-Reload Resource Sync', () => {
  let dbManager: SqliteEngine;
  let indexer: ResourceIndexer;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.mkdir(RESOURCES_DIR, { recursive: true });

    dbManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should detect new resources added after initial sync', async () => {
    // Initial state: one prompt
    await createResourceFile('prompts', 'alpha', {
      id: 'alpha',
      name: 'Alpha Prompt',
      description: 'First prompt',
    });

    indexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    await indexer.syncAll();

    let prompts = indexer.queryByType('prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe('alpha');

    // Simulate hot-reload: add a second prompt file on disk
    await createResourceFile('prompts', 'beta', {
      id: 'beta',
      name: 'Beta Prompt',
      description: 'Second prompt',
    });

    // Re-sync (simulates what fullServerRefresh does)
    const freshIndexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    await freshIndexer.syncAll();

    prompts = freshIndexer.queryByType('prompt');
    expect(prompts).toHaveLength(2);

    const ids = prompts.map((p) => p.id).sort();
    expect(ids).toEqual(['alpha', 'beta']);
  });

  it('should detect removed resources after re-sync', async () => {
    // Remove the beta prompt from disk
    await fs.rm(path.join(RESOURCES_DIR, 'prompts', 'beta'), { recursive: true, force: true });

    // Re-sync
    const freshIndexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    await freshIndexer.syncAll();

    const prompts = freshIndexer.queryByType('prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe('alpha');
  });

  it('should detect modified resources after re-sync', async () => {
    // Modify the alpha prompt on disk
    await createResourceFile('prompts', 'alpha', {
      id: 'alpha',
      name: 'Alpha Prompt Updated',
      description: 'Modified description',
    });

    // Re-sync
    const freshIndexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    const result = await freshIndexer.syncAll();

    expect(result.modified).toBeGreaterThanOrEqual(1);

    const prompts = freshIndexer.queryByType('prompt');
    expect(prompts).toHaveLength(1);
    // The name field should reflect the update
    expect(prompts[0].name).toBe('Alpha Prompt Updated');
  });

  it('should persist re-synced data to disk (readable by fresh manager)', async () => {
    // Shut down and reload from disk
    await dbManager.shutdown();

    const freshManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await freshManager.initialize();

    // Raw SQL query like Python hooks would do
    const rows = freshManager.query<{ id: string; name: string }>(
      `SELECT id, name FROM resource_index WHERE type = 'prompt'`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('alpha');
    expect(rows[0].name).toBe('Alpha Prompt Updated');

    // Reassign for cleanup
    dbManager = freshManager;
  });
});
