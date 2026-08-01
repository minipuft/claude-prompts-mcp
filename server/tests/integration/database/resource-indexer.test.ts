// @lifecycle test - Integration test for ResourceIndexer sync and query
/**
 * ResourceIndexer Integration Test
 *
 * Verifies that:
 * 1. syncAll() discovers and indexes file-based resources
 * 2. queryByType/queryByCategory/search return correct results
 * 3. getStats() reflects actual index counts
 * 4. Incremental sync detects modifications and removals
 * 5. Content hash comparison prevents unnecessary re-indexing
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import { SqliteEngine, ResourceIndexer } from '../../../src/infra/database/index.js';

// Mock logger
const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/indexer-test');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');

/**
 * Create a minimal YAML resource file on disk
 */
async function createResource(
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

describe('ResourceIndexer', () => {
  let dbManager: SqliteEngine;
  let indexer: ResourceIndexer;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    dbManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clean resources dir and index table between tests
    await fs.rm(RESOURCES_DIR, { recursive: true, force: true });
    await fs.mkdir(RESOURCES_DIR, { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();

    indexer = new ResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
  });

  describe('syncAll', () => {
    it('should index prompts from disk', async () => {
      await createResource('prompts', 'greeting', {
        id: 'greeting',
        name: 'Greeting Prompt',
        category: 'general',
        description: 'A simple greeting prompt',
      });
      await createResource('prompts', 'analysis', {
        id: 'analysis',
        name: 'Analysis Prompt',
        category: 'development',
        description: 'Code analysis prompt',
      });

      const result = await indexer.syncAll();

      expect(result.added).toBe(2);
      expect(result.modified).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('should index gates from disk', async () => {
      await createResource('gates', 'quality-check', {
        id: 'quality-check',
        name: 'Quality Check',
        description: 'Validates output quality',
      });

      const result = await indexer.syncAll();

      expect(result.added).toBe(1);
      const gate = indexer.getResource('gate', 'quality-check');
      expect(gate).not.toBeNull();
      expect(gate!.name).toBe('Quality Check');
      expect(gate!.type).toBe('gate');
    });

    it('should index frameworks from disk', async () => {
      await createResource('frameworks', 'cageerf', {
        id: 'cageerf',
        name: 'CAGEERF',
        description: 'Context-Analysis-Goals framework',
      });

      const result = await indexer.syncAll();

      expect(result.added).toBe(1);
      const meth = indexer.getResource('framework', 'cageerf');
      expect(meth).not.toBeNull();
      expect(meth!.name).toBe('CAGEERF');
    });

    it('should index styles from disk', async () => {
      await createResource('styles', 'analytical', {
        id: 'analytical',
        name: 'Analytical Style',
        description: 'Structured analytical output',
      });

      const result = await indexer.syncAll();

      expect(result.added).toBe(1);
      const style = indexer.getResource('style', 'analytical');
      expect(style).not.toBeNull();
      expect(style!.name).toBe('Analytical Style');
    });

    it('should index all resource types in a single syncAll call', async () => {
      await createResource('prompts', 'p1', { id: 'p1', name: 'Prompt 1' });
      await createResource('gates', 'g1', { id: 'g1', name: 'Gate 1' });
      await createResource('frameworks', 'm1', { id: 'm1', name: 'Method 1' });
      await createResource('styles', 's1', { id: 's1', name: 'Style 1' });

      const result = await indexer.syncAll();

      expect(result.added).toBe(4);
      expect(result.errors).toBe(0);

      const stats = indexer.getStats();
      expect(stats.prompt).toBe(1);
      expect(stats.gate).toBe(1);
      expect(stats.framework).toBe(1);
      expect(stats.style).toBe(1);
    });

    it('should handle empty resource directories gracefully', async () => {
      // No resources on disk — directories may not even exist
      const result = await indexer.syncAll();

      expect(result.added).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  describe('incremental sync', () => {
    it('should detect unchanged resources on re-sync', async () => {
      await createResource('prompts', 'stable', { id: 'stable', name: 'Stable Prompt' });

      const first = await indexer.syncAll();
      expect(first.added).toBe(1);

      // Re-sync without changes
      const second = await indexer.syncAll();
      expect(second.added).toBe(0);
      expect(second.modified).toBe(0);
      expect(second.unchanged).toBe(1);
    });

    it('should detect modified resources via content hash', async () => {
      await createResource('prompts', 'evolving', { id: 'evolving', name: 'Version 1' });
      await indexer.syncAll();

      // Modify the resource
      await createResource('prompts', 'evolving', {
        id: 'evolving',
        name: 'Version 2',
        description: 'Updated description',
      });

      const result = await indexer.syncAll();
      expect(result.modified).toBe(1);
      expect(result.added).toBe(0);

      const resource = indexer.getResource('prompt', 'evolving');
      expect(resource!.name).toBe('Version 2');
      expect(resource!.description).toBe('Updated description');
    });

    it('should detect removed resources', async () => {
      await createResource('prompts', 'temporary', { id: 'temporary', name: 'Temp' });
      await indexer.syncAll();

      // Remove the resource from disk
      await fs.rm(path.join(RESOURCES_DIR, 'prompts', 'temporary'), { recursive: true });

      const result = await indexer.syncAll();
      expect(result.removed).toBe(1);

      const resource = indexer.getResource('prompt', 'temporary');
      expect(resource).toBeNull();
    });

    it('should handle add + modify + remove in single sync', async () => {
      // Start with two resources
      await createResource('prompts', 'keep', { id: 'keep', name: 'Keep' });
      await createResource('prompts', 'remove-me', { id: 'remove-me', name: 'Remove' });
      await indexer.syncAll();

      // Modify one, remove one, add one
      await createResource('prompts', 'keep', { id: 'keep', name: 'Keep Updated' });
      await fs.rm(path.join(RESOURCES_DIR, 'prompts', 'remove-me'), { recursive: true });
      await createResource('prompts', 'new-one', { id: 'new-one', name: 'New' });

      const result = await indexer.syncAll();
      expect(result.added).toBe(1);
      expect(result.modified).toBe(1);
      expect(result.removed).toBe(1);
    });
  });

  describe('query methods', () => {
    beforeEach(async () => {
      await createResource('prompts', 'analysis', {
        id: 'analysis',
        name: 'Analysis Prompt',
        category: 'development',
        description: 'Deep code analysis',
      });
      await createResource('prompts', 'review', {
        id: 'review',
        name: 'Review Prompt',
        category: 'development',
        description: 'Code review checklist',
      });
      await createResource('prompts', 'greeting', {
        id: 'greeting',
        name: 'Greeting',
        category: 'general',
        description: 'Simple greeting',
      });
      await createResource('gates', 'quality', {
        id: 'quality',
        name: 'Quality Gate',
        description: 'Output quality check',
      });
      await indexer.syncAll();
    });

    it('queryByType returns resources of that type', () => {
      const prompts = indexer.queryByType('prompt');
      expect(prompts).toHaveLength(3);
      expect(prompts.map((p) => p.id).sort()).toEqual(['analysis', 'greeting', 'review']);

      const gates = indexer.queryByType('gate');
      expect(gates).toHaveLength(1);
      expect(gates[0].id).toBe('quality');
    });

    it('queryByCategory filters by type and category', () => {
      const devPrompts = indexer.queryByCategory('prompt', 'development');
      expect(devPrompts).toHaveLength(2);
      expect(devPrompts.map((p) => p.id).sort()).toEqual(['analysis', 'review']);

      const generalPrompts = indexer.queryByCategory('prompt', 'general');
      expect(generalPrompts).toHaveLength(1);
      expect(generalPrompts[0].id).toBe('greeting');
    });

    it('search matches by name, description, and id', () => {
      // Search by name
      const byName = indexer.search('Analysis');
      expect(byName.some((r) => r.id === 'analysis')).toBe(true);

      // Search by description
      const byDesc = indexer.search('checklist');
      expect(byDesc.some((r) => r.id === 'review')).toBe(true);

      // Search by id
      const byId = indexer.search('greeting');
      expect(byId.some((r) => r.id === 'greeting')).toBe(true);
    });

    it('search can filter by type', () => {
      const promptResults = indexer.search('quality', 'prompt');
      expect(promptResults).toHaveLength(0); // "quality" is a gate, not a prompt

      const gateResults = indexer.search('quality', 'gate');
      expect(gateResults).toHaveLength(1);
      expect(gateResults[0].id).toBe('quality');
    });

    it('getResource returns specific resource or null', () => {
      const found = indexer.getResource('prompt', 'analysis');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Analysis Prompt');
      expect(found!.category).toBe('development');

      const notFound = indexer.getResource('prompt', 'nonexistent');
      expect(notFound).toBeNull();
    });

    it('getStats returns per-type counts', () => {
      const stats = indexer.getStats();
      expect(stats.prompt).toBe(3);
      expect(stats.gate).toBe(1);
      expect(stats.framework).toBe(0);
      expect(stats.style).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all indexed resources', async () => {
      await createResource('prompts', 'p1', { id: 'p1', name: 'P1' });
      await createResource('gates', 'g1', { id: 'g1', name: 'G1' });
      await indexer.syncAll();

      const statsBefore = indexer.getStats();
      expect(statsBefore.prompt).toBe(1);
      expect(statsBefore.gate).toBe(1);

      indexer.clear();

      const statsAfter = indexer.getStats();
      expect(statsAfter.prompt).toBe(0);
      expect(statsAfter.gate).toBe(0);
    });
  });

  describe('config options', () => {
    it('should respect trackPrompts=false', async () => {
      const selectiveIndexer = new ResourceIndexer(dbManager, mockLogger as any, {
        resourcesDir: RESOURCES_DIR,
        trackPrompts: false,
      });

      await createResource('prompts', 'ignored', { id: 'ignored', name: 'Ignored' });
      await createResource('gates', 'indexed', { id: 'indexed', name: 'Indexed' });

      const result = await selectiveIndexer.syncAll();
      expect(result.added).toBe(1); // Only the gate

      const stats = selectiveIndexer.getStats();
      expect(stats.prompt).toBe(0);
      expect(stats.gate).toBe(1);
    });
  });
});
