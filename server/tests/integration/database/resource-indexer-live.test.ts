// @lifecycle test - Integration test for ResourceIndexer against actual server resources
/**
 * ResourceIndexer Live Data Test
 *
 * Verifies the indexer works with real resource files from server/resources/.
 * Tests the actual production data path — prompts, gates, frameworks, styles.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import { SqliteEngine, ResourceIndexer } from '../../../src/infra/database/index.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

describe('ResourceIndexer — live server resources', () => {
  const testDir = path.join(process.cwd(), 'tests/tmp/indexer-live-test');
  const resourcesDir = path.join(process.cwd(), 'resources');
  let dbManager: SqliteEngine;
  let indexer: ResourceIndexer;

  beforeAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });

    dbManager = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await dbManager.initialize();

    indexer = new ResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir,
    });
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should sync all server resources without errors', async () => {
    const result = await indexer.syncAll();

    expect(result.errors).toBe(0);
    expect(result.added).toBeGreaterThan(0);
  });

  it('should index prompts from server/resources/prompts/', async () => {
    const prompts = indexer.queryByType('prompt');
    expect(prompts.length).toBeGreaterThan(0);

    // Every prompt should have an id and file_path
    for (const prompt of prompts) {
      expect(prompt.id).toBeTruthy();
      expect(prompt.type).toBe('prompt');
      expect(prompt.file_path).toBeTruthy();
    }
  });

  it('should index gates from server/resources/gates/', async () => {
    const gates = indexer.queryByType('gate');
    expect(gates.length).toBeGreaterThan(0);

    for (const gate of gates) {
      expect(gate.id).toBeTruthy();
      expect(gate.type).toBe('gate');
    }
  });

  it('should index frameworks from server/resources/frameworks/', async () => {
    const frameworks = indexer.queryByType('methodology');
    expect(frameworks.length).toBeGreaterThan(0);

    for (const m of frameworks) {
      expect(m.id).toBeTruthy();
      expect(m.type).toBe('methodology');
    }
  });

  it('should index styles from server/resources/styles/', async () => {
    const styles = indexer.queryByType('style');
    expect(styles.length).toBeGreaterThan(0);

    for (const s of styles) {
      expect(s.id).toBeTruthy();
      expect(s.type).toBe('style');
    }
  });

  it('should report accurate stats matching per-type query counts', () => {
    const stats = indexer.getStats();

    expect(stats.prompt).toBe(indexer.queryByType('prompt').length);
    expect(stats.gate).toBe(indexer.queryByType('gate').length);
    expect(stats.methodology).toBe(indexer.queryByType('methodology').length);
    expect(stats.style).toBe(indexer.queryByType('style').length);

    // Total should be positive
    const total = stats.prompt + stats.gate + stats.methodology + stats.style;
    expect(total).toBeGreaterThan(0);
  });

  it('should find known prompts via search', () => {
    // The prompts directory has categories like "analysis", "development", "general"
    // Search for something likely to exist
    const results = indexer.search('analysis');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should re-sync without changes (all unchanged)', async () => {
    const result = await indexer.syncAll();

    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.unchanged).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
  });
});
