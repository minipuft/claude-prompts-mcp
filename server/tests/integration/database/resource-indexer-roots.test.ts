// @lifecycle test - Integration test for multi-root indexing, scan depth, and duplicate ids
/**
 * ResourceIndexer: roots, depth, and identity.
 *
 * The index is what every Python hook reads. When it describes a smaller catalog than the loaders
 * serve, a prompt is executable and simultaneously unknown to the prompt router — which is exactly
 * what happened (measured 2026-08-29): 119 prompts served, 78 indexed, and `>>strategicImplement`
 * answered "Unknown prompt".
 *
 * Three independent causes, one per describe block below. Each assertion here fails against the
 * single-root, two-level, silent-overwrite scan that shipped before.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import {
  SqliteEngine,
  ResourceIndexer,
  reportShadowedResources,
} from '../../../src/infra/database/index.js';

import type { ShadowedResource } from '../../../src/infra/database/resource-indexer.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/indexer-roots-test');
const BUNDLED = path.join(TEST_DIR, 'bundled', 'prompts');
const WORKSPACE = path.join(TEST_DIR, 'workspace', 'prompts');

/** Write `{root}/{...segments}/prompt.yaml` with the given fields. */
async function writePrompt(
  root: string,
  segments: string[],
  fields: Record<string, string>
): Promise<string> {
  const dir = path.join(root, ...segments);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'prompt.yaml');
  const lines = Object.entries(fields).map(([k, v]) => `${k}: "${v}"`);
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

describe('ResourceIndexer roots, depth, and identity', () => {
  let dbManager: SqliteEngine;
  let indexer: ResourceIndexer;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    dbManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) await dbManager.shutdown();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.rm(path.join(TEST_DIR, 'bundled'), { recursive: true, force: true });
    await fs.rm(path.join(TEST_DIR, 'workspace'), { recursive: true, force: true });
    await fs.mkdir(BUNDLED, { recursive: true });
    await fs.mkdir(WORKSPACE, { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();

    indexer = new ResourceIndexer(dbManager, mockLogger as any, {
      // Anchor only; every prompt root is named explicitly, bundled lowest precedence.
      resourcesDir: path.join(TEST_DIR, 'workspace'),
      resourceRoots: { prompt: [BUNDLED, WORKSPACE] },
      trackGates: false,
      trackFrameworks: false,
      trackStyles: false,
      trackTools: false,
    });
  });

  describe('every contributing root reaches the index', () => {
    it('indexes bundled prompts a workspace does not redefine', async () => {
      await writePrompt(BUNDLED, ['development', 'strategic_implement'], {
        id: 'strategic_implement',
        name: 'Strategic Implement',
        category: 'development',
      });
      await writePrompt(WORKSPACE, ['analysis', 'own_prompt'], {
        id: 'own_prompt',
        name: 'Own Prompt',
        category: 'analysis',
      });

      await indexer.syncAll();

      const ids = dbManager
        .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'prompt' ORDER BY id")
        .map((r) => r.id);
      // The whole defect in one assertion: a workspace root used to REPLACE the bundled tree.
      expect(ids).toEqual(['own_prompt', 'strategic_implement']);
    });

    it('lets a higher-precedence root override the same category/id', async () => {
      await writePrompt(BUNDLED, ['general', 'greeting'], {
        id: 'greeting',
        name: 'Bundled Greeting',
        category: 'general',
      });
      const workspacePath = await writePrompt(WORKSPACE, ['general', 'greeting'], {
        id: 'greeting',
        name: 'Workspace Greeting',
        category: 'general',
      });

      const result = await indexer.syncAll();

      const row = dbManager.query<{ name: string; file_path: string }>(
        "SELECT name, file_path FROM resource_index WHERE type = 'prompt' AND id = 'greeting'"
      )[0];
      expect(row?.name).toBe('Workspace Greeting');
      expect(row?.file_path).toBe(workspacePath);
      // Same category and id means one resource, so this is the overlay contract, not a collision.
      expect(result.shadowed).toHaveLength(1);
      const override: ShadowedResource | undefined = result.shadowed[0];
      expect(override?.sameCategory).toBe(true);
      expect(override?.shadowed).toContain('bundled');
    });
  });

  describe('scan depth follows the layout', () => {
    it('indexes a chain and the steps nested under it', async () => {
      await writePrompt(BUNDLED, ['examples', 'deep_analysis'], {
        id: 'deep_analysis',
        name: 'Deep Analysis',
        category: 'examples',
      });
      await writePrompt(BUNDLED, ['examples', 'deep_analysis', 'initial_scan'], {
        id: 'initial_scan',
        name: 'Initial Scan',
        category: 'examples',
      });

      await indexer.syncAll();

      const ids = dbManager
        .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'prompt' ORDER BY id")
        .map((r) => r.id);
      // A chain directory holds its own prompt.yaml AND step subdirectories; finding the first
      // is not a reason to stop descending. The two-level scan indexed only the chain.
      //
      // The step's id is path-qualified below the category, which is the id `prompt_engine`
      // answers to — the file's own `id: initial_scan` is overwritten by the loader and must not
      // be what the index records.
      expect(ids).toEqual(['deep_analysis', 'deep_analysis/initial_scan']);
    });

    it('indexes a step under the category its definition declares', async () => {
      await writePrompt(BUNDLED, ['examples', 'deep_analysis', 'synthesis'], {
        id: 'synthesis',
        name: 'Synthesis',
        category: 'examples',
      });

      await indexer.syncAll();

      const row = dbManager.query<{ category: string }>(
        "SELECT category FROM resource_index WHERE id = 'deep_analysis/synthesis'"
      )[0];
      expect(row?.category).toBe('examples');
    });
  });

  describe('a duplicated id is reported by path', () => {
    it('warns when one id is defined in two categories, naming both files', async () => {
      const first = await writePrompt(WORKSPACE, ['analysis', 'initial_scan'], {
        id: 'initial_scan',
        name: 'Analysis Initial Scan',
        category: 'analysis',
      });
      const second = await writePrompt(WORKSPACE, ['resume', 'initial_scan'], {
        id: 'initial_scan',
        name: 'Resume Initial Scan',
        category: 'resume',
      });

      const result = await indexer.syncAll();
      reportShadowedResources(result, mockLogger as any);

      expect(result.shadowed).toHaveLength(1);
      expect(result.shadowed[0]?.sameCategory).toBe(false);

      // Identity, not a count: a reader needs to know WHICH prompt they can no longer reach.
      const warning = mockLogger.warn.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes("duplicate prompt id 'initial_scan'"));
      expect(warning).toBeDefined();
      for (const namedPath of [first, second]) {
        expect(warning).toContain(namedPath);
      }
    });

    it('does not warn when nothing is duplicated', async () => {
      await writePrompt(WORKSPACE, ['analysis', 'alpha'], {
        id: 'alpha',
        name: 'Alpha',
        category: 'analysis',
      });

      const result = await indexer.syncAll();
      reportShadowedResources(result, mockLogger as any);

      // Positive control for the assertion above: the probe can distinguish quiet from broken.
      expect(result.shadowed).toEqual([]);
      const warnings = mockLogger.warn.mock.calls.map((c) => String(c[0]));
      expect(warnings.filter((m) => m.includes('duplicate prompt id'))).toEqual([]);
    });
  });
});
