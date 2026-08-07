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
    dbManager.run(`DELETE FROM kv_state WHERE key = 'resource_hashes'`);
    // Unscoped delete, not `tenant_id = 'default'`: the scope-stamping cases below write rows
    // under a workspace tenant, and a filtered cleanup would leave them to leak into the next test.
    dbManager.run(`DELETE FROM resource_changes`);
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

  /**
   * Scope stamping (Tier 4.3).
   *
   * `resource_changes` declares `workspace_id` and `organization_id`, and until this tier no
   * writer bound either — every row landed NULL and a startup migration backfilled them on the
   * next boot, forever. These cases assert the writer now emits scope itself, which is the
   * precondition for deleting that migration in 4.5.
   *
   * They read the table directly rather than through `getChanges()`, because the projection
   * `getChanges()` returns does not carry the scope columns: asserting through it would pass
   * whatever the columns held.
   */
  describe('scope stamping', () => {
    interface ScopeRow {
      tenant_id: string;
      workspace_id: string | null;
      organization_id: string | null;
    }

    const readScopeRows = (): ScopeRow[] =>
      dbManager.query<ScopeRow>(
        `SELECT tenant_id, workspace_id, organization_id FROM resource_changes`
      );

    it('stamps the configured defaultScope onto rows it writes', async () => {
      const tracker = createResourceChangeTracker(logger as any, {
        maxEntries: 1000,
        serverRoot: TEST_DIR,
        defaultScope: { workspaceId: 'ws-alpha', organizationId: 'org-alpha' },
      });
      await tracker.initialize();

      const resource = await writeResource('prompt', 'scoped-prompt', 'name: scoped\n');
      await tracker.logChange({ ...resource, operation: 'added', source: 'mcp-tool' });

      const rows = readScopeRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.workspace_id).toBe('ws-alpha');
      expect(rows[0]?.organization_id).toBe('org-alpha');
      // tenant_id derives from the same scope rather than staying the literal 'default' that
      // made every project's rows indistinguishable in a shared state.db.
      expect(rows[0]?.tenant_id).toBe('ws-alpha');
    });

    it('falls back to the default tenant and NULL scope when no defaultScope is configured', async () => {
      const tracker = createResourceChangeTracker(logger as any, {
        maxEntries: 1000,
        serverRoot: TEST_DIR,
      });
      await tracker.initialize();

      const resource = await writeResource('gate', 'unscoped-gate', 'id: unscoped\n');
      await tracker.logChange({ ...resource, operation: 'added', source: 'mcp-tool' });

      const rows = readScopeRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe('default');
      // Documented, not aspirational: a tracker built without a workspace still writes NULLs.
      // 4.5 deletes the migration that repaired these, so this row shape becomes permanent —
      // the composition root supplying defaultScope is what keeps it from occurring in practice.
      expect(rows[0]?.workspace_id).toBeNull();
      expect(rows[0]?.organization_id).toBeNull();
    });

    it('stamps scope on removals, which take a different branch to the same insert', async () => {
      const tracker = createResourceChangeTracker(logger as any, {
        maxEntries: 1000,
        serverRoot: TEST_DIR,
        defaultScope: { workspaceId: 'ws-beta' },
      });
      await tracker.initialize();

      const resource = await writeResource('prompt', 'removed-prompt', 'name: removed\n');
      await tracker.compareBaseline([resource]);
      await fs.rm(resource.filePath, { force: true });
      await tracker.compareBaseline([]);

      const removalRows = dbManager.query<ScopeRow & { operation: string }>(
        `SELECT tenant_id, workspace_id, organization_id, operation FROM resource_changes WHERE operation = 'removed'`
      );

      expect(removalRows).toHaveLength(1);
      expect(removalRows[0]?.workspace_id).toBe('ws-beta');
      // organizationId was never supplied, so it stays NULL rather than echoing the workspace.
      expect(removalRows[0]?.organization_id).toBeNull();
      expect(removalRows[0]?.tenant_id).toBe('ws-beta');
    });
  });
});
