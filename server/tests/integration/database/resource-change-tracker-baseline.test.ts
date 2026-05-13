import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { createResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/resource-change-tracker-baseline');

describe('ResourceChangeTracker baseline comparison', () => {
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    dbManager = await SqliteEngine.getInstance(TEST_DIR, logger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
    logger.debug.mockClear();
    dbManager.run(`DELETE FROM kv_state WHERE tenant_id = 'default' AND key = 'resource_hashes'`);
    dbManager.run(`DELETE FROM resource_changes WHERE tenant_id = 'default'`);
  });

  it('captures startup net-delta with run metadata and timestamps for all tracked resource types', async () => {
    const tracker = createResourceChangeTracker(logger as any, { maxEntries: 1000 }, dbManager);
    await tracker.initialize();

    const baseline = await tracker.compareBaseline([
      {
        resourceType: 'prompt',
        resourceId: 'prompt-a',
        filePath: '/virtual/prompts/prompt-a/prompt.yaml',
        contentHash: 'hash-prompt-a',
      },
      {
        resourceType: 'gate',
        resourceId: 'gate-a',
        filePath: '/virtual/gates/gate-a/gate.yaml',
        contentHash: 'hash-gate-a',
      },
      {
        resourceType: 'methodology',
        resourceId: 'methodology-a',
        filePath: '/virtual/methodologies/methodology-a/methodology.yaml',
        contentHash: 'hash-methodology-a',
      },
      {
        resourceType: 'style',
        resourceId: 'style-a',
        filePath: '/virtual/styles/style-a/style.yaml',
        contentHash: 'hash-style-a',
      },
      {
        resourceType: 'tool',
        resourceId: 'prompt-a/tool-a',
        filePath: '/virtual/prompts/category/prompt-a/tools/tool-a/tool.yaml',
        contentHash: 'hash-tool-a',
      },
    ]);

    expect(baseline.runId).toMatch(/^baseline-/);
    expect(baseline.runTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(baseline.added).toBe(5);
    expect(baseline.modified).toBe(0);
    expect(baseline.removed).toBe(0);
    expect(baseline.totalChanges).toBe(5);
    expect(baseline.changes).toHaveLength(5);
    expect(baseline.changes.every((change) => change.timestamp !== '')).toBe(true);
    expect(baseline.changes.map((change) => change.resourceType)).toEqual([
      'gate',
      'methodology',
      'prompt',
      'style',
      'tool',
    ]);

    const secondRun = await tracker.compareBaseline([
      {
        resourceType: 'prompt',
        resourceId: 'prompt-a',
        filePath: '/virtual/prompts/prompt-a/prompt.yaml',
        contentHash: 'hash-prompt-a',
      },
      {
        resourceType: 'gate',
        resourceId: 'gate-a',
        filePath: '/virtual/gates/gate-a/gate.yaml',
        contentHash: 'hash-gate-a',
      },
      {
        resourceType: 'methodology',
        resourceId: 'methodology-a',
        filePath: '/virtual/methodologies/methodology-a/methodology.yaml',
        contentHash: 'hash-methodology-a',
      },
      {
        resourceType: 'style',
        resourceId: 'style-a',
        filePath: '/virtual/styles/style-a/style.yaml',
        contentHash: 'hash-style-a',
      },
      {
        resourceType: 'tool',
        resourceId: 'prompt-a/tool-a',
        filePath: '/virtual/prompts/category/prompt-a/tools/tool-a/tool.yaml',
        contentHash: 'hash-tool-a',
      },
    ]);

    expect(secondRun.totalChanges).toBe(0);
    expect(secondRun.changes).toHaveLength(0);
  });

  it('preserves full tool resource IDs when detecting removals from cached baseline', async () => {
    const tracker = createResourceChangeTracker(logger as any, { maxEntries: 1000 }, dbManager);
    await tracker.initialize();

    await tracker.compareBaseline([
      {
        resourceType: 'tool',
        resourceId: 'create_prompt/prompt_builder',
        filePath: '/virtual/prompts/examples/create_prompt/tools/prompt_builder/tool.yaml',
        contentHash: 'hash-tool-initial',
      },
    ]);

    const removalRun = await tracker.compareBaseline([]);

    expect(removalRun.removed).toBe(1);
    expect(removalRun.totalChanges).toBe(1);
    expect(removalRun.changes).toHaveLength(1);
    expect(removalRun.changes[0].operation).toBe('removed');
    expect(removalRun.changes[0].resourceType).toBe('tool');
    expect(removalRun.changes[0].resourceId).toBe('create_prompt/prompt_builder');
  });
});
