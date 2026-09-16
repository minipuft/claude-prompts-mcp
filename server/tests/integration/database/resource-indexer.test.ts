// @lifecycle test - Integration test for ResourceIndexer sync
/**
 * ResourceIndexer Integration Test
 *
 * Verifies that:
 * 1. syncAll() discovers and indexes file-based resources into `resource_index`
 * 2. Incremental sync detects modifications and removals
 * 3. Content hash comparison prevents unnecessary re-indexing
 * 4. Tool sync reports refusal, removal, and failure as distinct dispositions
 *
 * `resource_index` has no in-process read API (P4.37 removed the last of it — `queryByType`,
 * `queryByCategory`, `search`, `getResource`, `getStats`, `queryTools`, `clear` — since nothing in
 * `src/` called any of them on a `ResourceIndexer` instance; every real reader queries the table
 * directly, which is what the assertions below do too).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import {
  SqliteEngine,
  ResourceIndexer,
  reportResourceSyncFailures,
} from '../../../src/infra/database/index.js';
import { reportRefusedResources } from '../../../src/infra/database/resource-indexer.js';

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

/**
 * Per-type row counts, read straight from `resource_index` — the test-side substitute for the
 * `getStats()` method removed in P4.37 (no production caller ever reached it).
 */
function countByType(
  db: SqliteEngine
): Record<'prompt' | 'gate' | 'framework' | 'style' | 'tool', number> {
  const stats = { prompt: 0, gate: 0, framework: 0, style: 0, tool: 0 };
  const rows = db.query<{ type: string; count: number }>(
    'SELECT type, COUNT(*) as count FROM resource_index GROUP BY type'
  );
  for (const row of rows) {
    if (row.type in stats) stats[row.type as keyof typeof stats] = row.count;
  }
  return stats;
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
      const gate = dbManager.queryOne<{ name: string; type: string }>(
        'SELECT * FROM resource_index WHERE type = ? AND id = ?',
        ['gate', 'quality-check']
      );
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
      const meth = dbManager.queryOne<{ name: string }>(
        'SELECT * FROM resource_index WHERE type = ? AND id = ?',
        ['framework', 'cageerf']
      );
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
      const style = dbManager.queryOne<{ name: string }>(
        'SELECT * FROM resource_index WHERE type = ? AND id = ?',
        ['style', 'analytical']
      );
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

      const stats = countByType(dbManager);
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

      const resource = dbManager.queryOne<{ name: string; description: string }>(
        'SELECT * FROM resource_index WHERE type = ? AND id = ?',
        ['prompt', 'evolving']
      );
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

      const resource = dbManager.queryOne(
        'SELECT * FROM resource_index WHERE type = ? AND id = ?',
        ['prompt', 'temporary']
      );
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

  // ── F6 / P4.17: a tool that fails to load is neither `removed` nor published ──
  //
  // The original defect (F6): `loadTool` returned undefined rather than throwing,
  // `loadToolsForPrompt` skipped it silently, and `syncTools` then DELETED its index
  // row counting `removed++`. Validation failure and disk deletion were the same
  // observable event, and `errors` stayed 0 for both.
  //
  // F6's remedy kept the row so the removal sweep would leave it alone, which fixed
  // the conflation and left a second one: every row in `resource_index` is what
  // `skills-sync` reads, so a tool the loader refused was still advertised as an
  // available tool. P4.17 gives it the `refused` disposition instead — no row, not
  // `removed`, and not a sync `failure` either, because the indexer did its job.
  describe('tool sync refusal reporting', () => {
    /**
     * A loader stub standing in for ScriptToolDefinitionLoader.
     *
     * Named `broken-parser` (not a substring of any prompt id or name used here)
     * so an assertion cannot pass by matching the fixture's own name.
     */
    function loaderReporting(
      tools: Array<{ id: string; name: string }>,
      failures: Array<{ toolId: string; reason: string }>
    ) {
      return (_dir: string, promptId: string) => ({
        tools: tools.map((t) => ({
          ...t,
          runtime: 'python' as const,
          inputSchema: {},
          // Mirrors the real loader, which always resolves an execution config.
          execution: { trigger: 'schema_match' as const, confirm: true, strict: false },
          description: '',
          scriptPath: 'script.py',
          toolDir: path.join(RESOURCES_DIR, 'prompts', promptId, 'tools', t.id),
          absoluteScriptPath: 'script.py',
          promptId,
          descriptionContent: '',
        })),
        failures,
      });
    }

    async function indexOnePromptWith(loader: ReturnType<typeof loaderReporting>) {
      await createResource('prompts', 'host_prompt', {
        id: 'host_prompt',
        name: 'Host Prompt',
        category: 'general',
        description: 'Owns the tools under test',
      });
      const withTools = new ResourceIndexer(dbManager, mockLogger as any, {
        resourcesDir: RESOURCES_DIR,
        toolLoader: loader as any,
      });
      return withTools;
    }

    it('reports a failing tool as refused by path, not as removed and not as a failure', async () => {
      // Index the tool successfully first, so there is a row that the removal
      // sweep could delete on the second pass.
      const warm = await indexOnePromptWith(
        loaderReporting([{ id: 'broken-parser', name: 'Broken Parser' }], [])
      );
      const first = await warm.syncAll();
      expect(first.errors).toBe(0);
      expect(first.failures).toEqual([]);
      expect(first.refused).toEqual([]);

      // Same tool, now failing validation — still present on disk.
      const cold = await indexOnePromptWith(
        loaderReporting(
          [],
          [{ toolId: 'broken-parser', reason: 'validation failed: missing script' }]
        )
      );
      const second = await cold.syncAll();

      expect(second.removed).toBe(0);
      // Not a sync failure: the indexer did exactly its job. One event, one disposition.
      expect(second.errors).toBe(0);
      expect(second.failures).toEqual([]);
      expect(second.refused).toEqual([
        {
          type: 'tool',
          id: 'host_prompt/broken-parser',
          filePath: path.join(RESOURCES_DIR, 'prompts', 'host_prompt', 'tools', 'broken-parser'),
          rowDeleted: true,
        },
      ]);
      // `rowDeleted: true` is a claim about the table; check the table, not the claim.
      expect(
        dbManager.query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'tool'")
      ).toEqual([]);
    });

    it('drops the failing tool from the index, keeping its valid sibling', async () => {
      // The published surface, which is the residual F6 left behind: every row in
      // `resource_index` is what `skills-sync` reads, so a row kept "so the sweep leaves it
      // alone" was still an offer.
      const warm = await indexOnePromptWith(
        loaderReporting(
          [
            { id: 'broken-parser', name: 'Broken Parser' },
            { id: 'good-parser', name: 'Good Parser' },
          ],
          []
        )
      );
      await warm.syncAll();
      // Positive control on the fixture: both tools really were indexed and published first, so
      // the absence below is a deletion and not a tool that never arrived.
      expect(
        dbManager
          .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'tool'")
          .map((r) => r.id)
          .sort()
      ).toEqual(['host_prompt/broken-parser', 'host_prompt/good-parser']);

      const cold = await indexOnePromptWith(
        loaderReporting(
          [{ id: 'good-parser', name: 'Good Parser' }],
          [{ toolId: 'broken-parser', reason: 'validation failed' }]
        )
      );
      const result = await cold.syncAll();

      const rows = dbManager.query<{ id: string }>(
        "SELECT id FROM resource_index WHERE type = 'tool'"
      );
      expect(rows.map((r) => r.id)).toEqual(['host_prompt/good-parser']);
      expect(result.removed).toBe(0);
    });

    it('reports refused without a row deletion when the tool never indexed cleanly', async () => {
      // `rowDeleted` distinguishes "a promise was withdrawn" from "one was never made"; a fixture
      // that only ever fails proves the flag is read from the index rather than hardcoded true.
      const cold = await indexOnePromptWith(
        loaderReporting([], [{ toolId: 'never-loaded', reason: 'tool.yaml not found' }])
      );
      const result = await cold.syncAll();

      expect(result.refused).toEqual([
        {
          type: 'tool',
          id: 'host_prompt/never-loaded',
          filePath: path.join(RESOURCES_DIR, 'prompts', 'host_prompt', 'tools', 'never-loaded'),
          rowDeleted: false,
        },
      ]);
      expect(result.removed).toBe(0);
    });

    it('still counts a genuinely deleted tool as removed', async () => {
      // The other side of the discrimination: an EMPTY failure list means the
      // tool is really gone, and `removed` must still fire. Without this case a
      // fix that simply never removes anything would pass the two above.
      const warm = await indexOnePromptWith(
        loaderReporting([{ id: 'broken-parser', name: 'Broken Parser' }], [])
      );
      await warm.syncAll();

      const gone = await indexOnePromptWith(loaderReporting([], []));
      const result = await gone.syncAll();

      expect(result.removed).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.failures).toEqual([]);
    });

    it('reportRefusedResources names the refused tool by id and path', async () => {
      // The runtime call sites report through `reportSyncFindings`, which fans out to all three
      // reporters. A refused tool belongs to the refusal line, whose operator action is "repair
      // this file" — not the failure line, which says the indexer could not do its job.
      const cold = await indexOnePromptWith(
        loaderReporting([], [{ toolId: 'broken-parser', reason: 'validation failed: no script' }])
      );
      const result = await cold.syncAll();

      mockLogger.warn.mockClear();
      reportRefusedResources(result, mockLogger as any);

      const warned = mockLogger.warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(warned).toContain('host_prompt/broken-parser');
      expect(warned).toContain(path.join('host_prompt', 'tools', 'broken-parser'));
    });

    it('the failure reporter stays silent about a refused tool, and the refusal reporter about a clean sync', async () => {
      const cold = await indexOnePromptWith(
        loaderReporting([], [{ toolId: 'broken-parser', reason: 'validation failed: no script' }])
      );
      const refusedResult = await cold.syncAll();

      mockLogger.warn.mockClear();
      reportResourceSyncFailures(refusedResult, mockLogger as any);
      expect(mockLogger.warn).not.toHaveBeenCalled();

      const clean = await indexOnePromptWith(
        loaderReporting([{ id: 'broken-parser', name: 'Broken Parser' }], [])
      );
      const cleanResult = await clean.syncAll();

      mockLogger.warn.mockClear();
      reportRefusedResources(cleanResult, mockLogger as any);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('keeps errors and failures.length in step when the loader itself throws', async () => {
      // The remaining producer of a tool `failure`: the loader threw, so this walk really could
      // not do its job for that prompt and there is no per-tool id to refuse. Re-pointed here
      // because refusals no longer inflate `errors` — a fixture that only refuses would assert
      // the invariant against 0 === 0 and prove nothing.
      const throwing = await indexOnePromptWith((() => {
        throw new Error('tools directory unreadable');
      }) as unknown as ReturnType<typeof loaderReporting>);
      const result = await throwing.syncAll();

      expect(result.errors).toBe(result.failures.length);
      expect(result.errors).toBe(1);
      expect(result.failures[0]?.id).toBe('host_prompt/<all tools>');
      expect(result.refused).toEqual([]);
    });

    it('does not inflate errors when several tools are refused at once', async () => {
      const cold = await indexOnePromptWith(
        loaderReporting(
          [],
          [
            { toolId: 'broken-parser', reason: 'validation failed' },
            { toolId: 'other-tool', reason: 'tool.yaml not found' },
          ]
        )
      );
      const result = await cold.syncAll();

      expect(result.errors).toBe(0);
      expect(result.failures).toEqual([]);
      expect(result.refused.map((entry) => entry.id)).toEqual([
        'host_prompt/broken-parser',
        'host_prompt/other-tool',
      ]);
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

      const stats = countByType(dbManager);
      expect(stats.prompt).toBe(0);
      expect(stats.gate).toBe(1);
    });
  });
});
