import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { createResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';

/**
 * Baseline comparison against the tracker's real surface.
 *
 * This file previously asserted a richer API than `compareBaseline` has ever exposed — `runId`,
 * `runTimestamp`, `totalChanges` and a `changes[]` array — and passed `contentHash` per resource
 * so that no file needed to exist on disk. None of that shipped: `git log -S runId` finds no
 * commit touching the tracker, `compareBaseline` returns `{added, modified, removed}`, and it
 * derives hashes by reading `filePath` itself. It also declared `methodology`, `style` and `tool`
 * resources, while `TrackedResourceType` is `'prompt' | 'gate'`.
 *
 * The two cases below therefore could never have passed. They are rewritten against the real
 * signature — real files on disk, real resource types — so the coverage is actual rather than
 * aspirational. If run metadata is wanted later, it is a feature to implement in the tracker
 * first, with the test following it.
 *
 * Classification: Integration (real SQLite engine, real filesystem, no mocked collaborators).
 */

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/resource-change-tracker-baseline');
const RESOURCE_DIR = path.join(TEST_DIR, 'resources');

/** Write a resource file and return the descriptor `compareBaseline` expects. */
async function writeResource(
  resourceType: 'prompt' | 'gate',
  resourceId: string,
  contents: string
): Promise<{ resourceType: 'prompt' | 'gate'; resourceId: string; filePath: string }> {
  const filePath = path.join(
    RESOURCE_DIR,
    `${resourceType}-${resourceId.replace(/\//g, '__')}.yaml`
  );
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf-8');
  return { resourceType, resourceId, filePath };
}

describe('ResourceChangeTracker baseline comparison', () => {
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(RESOURCE_DIR, { recursive: true });

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
    await fs.rm(RESOURCE_DIR, { recursive: true, force: true });
    await fs.mkdir(RESOURCE_DIR, { recursive: true });
  });

  it('counts every tracked resource as added on first run, and nothing on an unchanged rerun', async () => {
    const tracker = createResourceChangeTracker(logger as any, {
      maxEntries: 1000,
      serverRoot: TEST_DIR,
    });
    await tracker.initialize();

    const resources = [
      await writeResource('prompt', 'prompt-a', 'name: prompt-a\n'),
      await writeResource('gate', 'gate-a', 'id: gate-a\n'),
    ];

    const baseline = await tracker.compareBaseline(resources);

    expect(baseline.added).toBe(2);
    expect(baseline.modified).toBe(0);
    expect(baseline.removed).toBe(0);

    // Same content, same hashes — a rerun must be a no-op, which is what makes this usable at
    // startup on every boot rather than only the first.
    const secondRun = await tracker.compareBaseline(resources);

    expect(secondRun.added).toBe(0);
    expect(secondRun.modified).toBe(0);
    expect(secondRun.removed).toBe(0);
  });

  it('detects a modification when a tracked file changes between runs', async () => {
    const tracker = createResourceChangeTracker(logger as any, {
      maxEntries: 1000,
      serverRoot: TEST_DIR,
    });
    await tracker.initialize();

    const resource = await writeResource('prompt', 'prompt-a', 'name: prompt-a\n');
    await tracker.compareBaseline([resource]);

    await fs.writeFile(resource.filePath, 'name: prompt-a\ndescription: edited\n', 'utf-8');
    const rerun = await tracker.compareBaseline([resource]);

    expect(rerun.modified).toBe(1);
    expect(rerun.added).toBe(0);
    expect(rerun.removed).toBe(0);
  });

  it('preserves a full resource ID containing a slash when detecting removals', async () => {
    const tracker = createResourceChangeTracker(logger as any, {
      maxEntries: 1000,
      serverRoot: TEST_DIR,
    });
    await tracker.initialize();

    // The cache key is `${resourceType}/${resourceId}`, so an id that itself contains '/' is the
    // case where a naive split() truncates it. Categorised prompt ids have exactly this shape.
    const resource = await writeResource('prompt', 'examples/create_prompt', 'name: create\n');
    await tracker.compareBaseline([resource]);

    await fs.rm(resource.filePath, { force: true });
    const removalRun = await tracker.compareBaseline([]);

    expect(removalRun.removed).toBe(1);

    const changes = await tracker.getChanges({ limit: 10 });
    const removal = changes.find((change) => change.operation === 'removed');

    expect(removal).toBeDefined();
    expect(removal?.resourceType).toBe('prompt');
    expect(removal?.resourceId).toBe('examples/create_prompt');
  });
});
