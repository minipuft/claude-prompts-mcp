// @lifecycle test - Integration test for the walk rules at the prompts root and on ignored directories (plan row P4.47)
/**
 * Three prompts-tree walks agree about `tools` at the root and about `_`-prefixed directories.
 *
 * `reserved-tools-directory.test.ts` pins `tools/` INSIDE a prompt. This file pins the two corners
 * that rule left open, each of which the walks answered differently:
 *
 * - **`tools` at depth 0 is a category.** `tools/` is reserved where script tools live — inside a
 *   category. `discoverCategoryDirectories` takes every directory at the prompts root that is not
 *   `.`/`_`-prefixed or `backup`, so a category named `tools` is served. `ResourceIndexer` and
 *   `compareResourceBaseline` applied the reserved-name skip at the root too, so that whole
 *   category was absent from `resource_index` and never announced as a change.
 * - **`_drafts/` is skipped as a directory.** The loader skips a `_`/`.`-prefixed entry before it
 *   looks at anything else. `ResourceIndexer` applied that predicate to FILES only, so it descended
 *   into `_drafts/` and indexed prompts no MCP surface serves.
 *
 * WHY EACH SKIP HAS A TWIN. A skipped path is paired with a served one that differs only in the
 * identifier the rule keys on — `tools` one level down, `drafts` without the underscore — so an
 * absence cannot be satisfied by a walk that found nothing. Every skipped path sits at a depth
 * `ResourceIndexer`'s `MAX_SCAN_DEPTH` still reaches, so the bound cannot hide a missing rule.
 *
 * Classification: Integration (real filesystem, real SQLite engine, real PromptLoader,
 * real ResourceIndexer, real compareResourceBaseline).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import { createResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { compareResourceBaseline } from '../../../src/runtime/resource-change-tracking.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { ConfigLoader } from '../../../src/infra/config/index.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = testScratchPath('prompt-walk-agreement');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');
const PROMPTS_DIR = path.join(RESOURCES_DIR, 'prompts');
const GATES_DIR = path.join(RESOURCES_DIR, 'gates');

/** The two config accessors `compareResourceBaseline` reads, and nothing else. */
const configStub = {
  getResolvedPromptsDirectory: () => PROMPTS_DIR,
  getGatesDirectory: () => GATES_DIR,
} as unknown as ConfigLoader;

/** A body that loads cleanly; the declared `id` is the directory name, as the schema requires. */
const promptBody = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly wherever it sits.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

async function writeDirectoryForm(relativeDir: string): Promise<void> {
  const dir = path.join(PROMPTS_DIR, relativeDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'prompt.yaml'), promptBody(path.basename(dir)), 'utf-8');
}

/**
 * The fixture every case reads.
 *
 *   tools/leaf/prompt.yaml                 → leaf               (served — category `tools`)
 *   general/tools/leaf/prompt.yaml         → RESERVED           (the depth-1 twin)
 *   general/drafts/draft_one/prompt.yaml   → drafts/draft_one   (served)
 *   general/_drafts/draft_one/prompt.yaml  → IGNORED            (the underscore twin)
 */
async function writeFixture(): Promise<void> {
  await writeDirectoryForm(path.join('tools', 'leaf'));
  await writeDirectoryForm(path.join('general', 'tools', 'leaf'));
  await writeDirectoryForm(path.join('general', 'drafts', 'draft_one'));
  await writeDirectoryForm(path.join('general', '_drafts', 'draft_one'));
}

const SERVED_IDS = ['drafts/draft_one', 'leaf'];

describe('prompt walks agree about tools/ at the root and about _-prefixed directories', () => {
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    dbManager = await SqliteEngine.getInstance(TEST_DIR, logger as never);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await fs.rm(RESOURCES_DIR, { recursive: true, force: true });
    await fs.mkdir(PROMPTS_DIR, { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    dbManager.run(`DELETE FROM kv_state WHERE key = 'resource_hashes'`);
    dbManager.run('DELETE FROM resource_changes');
    await writeFixture();
  });

  it('the catalog serves the tools category and the undecorated twin, nothing else', async () => {
    const loader = new PromptLoader(logger as never, { enableCache: false });
    const loaded = await loader.loadFromDirectories(PROMPTS_DIR);

    expect(loaded.promptsData.map((prompt) => prompt.id).sort()).toEqual(SERVED_IDS);
    expect(loaded.categories.map((category) => category.id).sort()).toEqual(['general', 'tools']);
    // Absent because skipped, not because refused.
    expect(loader.getQuarantine().list()).toEqual([]);
  });

  it('resource_index holds exactly what the catalog serves', async () => {
    const indexer = new ResourceIndexer(dbManager, logger as never, {
      resourcesDir: RESOURCES_DIR,
      trackTools: false,
    });
    await indexer.syncAll();

    const indexed = dbManager
      .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'prompt' ORDER BY id")
      .map((row) => row.id);

    expect(indexed).toEqual(SERVED_IDS);
  });

  it('the startup baseline announces exactly what the catalog serves', async () => {
    const tracker = createResourceChangeTracker(logger as never, {
      maxEntries: 1000,
      serverRoot: TEST_DIR,
    });
    await tracker.initialize();

    const result = await compareResourceBaseline(tracker, configStub, logger as never);

    const announced = dbManager
      .query<{ resource_id: string }>(
        `SELECT resource_id FROM resource_changes WHERE resource_type = 'prompt' ORDER BY resource_id`
      )
      .map((row) => row.resource_id);

    expect(announced).toEqual(SERVED_IDS);
    expect(result.added).toBe(SERVED_IDS.length);
  });
});
