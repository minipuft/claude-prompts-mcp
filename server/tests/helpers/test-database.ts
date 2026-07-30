// @lifecycle test - Shared database helpers for SQLite-backed tests
/**
 * Test Database Helpers
 *
 * Reduces boilerplate for tests that need a real SqliteEngine + ResourceIndexer.
 * Each helper creates isolated temp directories with automatic cleanup.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest } from '@jest/globals';

import { SqliteEngine, createResourceIndexer } from '../../src/infra/database/index.js';

import type { ResourceIndexer } from '../../src/infra/database/index.js';
import type { Logger } from '../../src/shared/types/index.js';

/**
 * Create a mock logger with jest.fn() spies.
 */
export function createMockLogger(): Logger {
  return {
    info: jest.fn() as jest.Mock,
    warn: jest.fn() as jest.Mock,
    error: jest.fn() as jest.Mock,
    debug: jest.fn() as jest.Mock,
  } as unknown as Logger;
}

export interface TestDatabaseContext {
  dbManager: SqliteEngine;
  testDir: string;
  logger: Logger;
  /** Shut down the SqliteEngine and remove the temp directory */
  cleanup: () => Promise<void>;
}

/**
 * Create a SqliteEngine backed by a temp directory.
 * Call `cleanup()` in afterAll/afterEach to tear down.
 *
 * @param suffix - Optional suffix for the temp dir name (avoids collisions in parallel tests)
 */
export async function createTestDatabaseManager(
  suffix: string = 'default'
): Promise<TestDatabaseContext> {
  const testDir = path.join(process.cwd(), `tests/tmp/db-test-${suffix}-${Date.now()}`);
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(testDir, { recursive: true });

  const logger = createMockLogger();
  const dbManager = await SqliteEngine.getInstance(testDir, logger);
  await dbManager.initialize();

  return {
    dbManager,
    testDir,
    logger,
    cleanup: async () => {
      try {
        await dbManager.shutdown();
      } catch {
        // Ignore shutdown errors in cleanup
      }
      await fs.rm(testDir, { recursive: true, force: true });
    },
  };
}

export interface TestResourceIndexerContext extends TestDatabaseContext {
  indexer: ResourceIndexer;
  resourcesDir: string;
  /** Create a minimal YAML resource file on disk for indexing */
  createResource: (
    type: 'prompts' | 'gates' | 'frameworks' | 'styles',
    id: string,
    fields: Record<string, string>
  ) => Promise<void>;
}

/**
 * Create a ResourceIndexer backed by a temp directory with helper to create resource files.
 * Call `cleanup()` in afterAll/afterEach to tear down.
 */
export async function createTestResourceIndexer(
  suffix: string = 'default'
): Promise<TestResourceIndexerContext> {
  const ctx = await createTestDatabaseManager(suffix);
  const resourcesDir = path.join(ctx.testDir, 'resources');
  await fs.mkdir(resourcesDir, { recursive: true });

  const indexer = createResourceIndexer(ctx.dbManager, ctx.logger, { resourcesDir });

  const createResource = async (
    type: 'prompts' | 'gates' | 'frameworks' | 'styles',
    id: string,
    fields: Record<string, string>
  ): Promise<void> => {
    const yamlFileName =
      type === 'prompts'
        ? 'prompt.yaml'
        : type === 'gates'
          ? 'gate.yaml'
          : type === 'frameworks'
            ? 'framework.yaml'
            : 'style.yaml';

    const dir = path.join(resourcesDir, type, id);
    await fs.mkdir(dir, { recursive: true });

    const lines = Object.entries(fields).map(([k, v]) => `${k}: "${v}"`);
    await fs.writeFile(path.join(dir, yamlFileName), lines.join('\n'), 'utf-8');
  };

  return {
    ...ctx,
    indexer,
    resourcesDir,
    createResource,
  };
}
