// @lifecycle test - Integration test for the reserved `tools/` directory rule (plan rows P4.33, P4.32)
/**
 * A prompt's `tools/` directory is RESERVED, and all three prompts-tree walks must say so.
 *
 * `{promptId}/tools/{toolId}/` is where a script tool lives, and a script tool is already served
 * under a COMPOSITE id — `{promptId}/{toolId}`. Admitting a prompt below that directory gives one
 * place on disk two id schemes: a `prompt.yaml` at `{category}/{prompt}/tools/{x}/` was served as
 * `{prompt}/tools/{x}`, overlapping the namespace the tool loader already owns.
 *
 * ONE RULE, THREE WALKS, AND ONLY ONE OF THEM ENFORCED IT. `ResourceIndexer.scanResources` skipped
 * the directory by name. `PromptLoader.discoverYamlPrompts` — which DEFINES what is served — and
 * `compareResourceBaseline` — which announces external edits — both recursed straight in, so a
 * prompt planted under any `tools/` was served by the catalog and announced in `resource_changes`.
 * `#shared/utils/prompt-layout.js` had documented `tools/` as reserved in prose the whole time
 * (P4.32): the rule was written in one module and implemented in another.
 *
 * WHY THE FIXTURE CARRIES A TWIN. `my_chain/helpers/prompt.yaml` and `my_chain/tools/prompt.yaml`
 * hold the same body at the same depth under the same parent; the only difference is the directory
 * NAME. Without it, "nothing under `tools/` was found" is satisfied by a walk that found nothing
 * anywhere — the positive control is what makes the absence evidence.
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

const TEST_DIR = testScratchPath('reserved-tools-directory');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');
const PROMPTS_DIR = path.join(RESOURCES_DIR, 'prompts');
const GATES_DIR = path.join(RESOURCES_DIR, 'gates');
const CATEGORY = 'general';

/** The two config accessors `compareResourceBaseline` reads, and nothing else. */
const configStub = {
  getResolvedPromptsDirectory: () => PROMPTS_DIR,
  getGatesDirectory: () => GATES_DIR,
} as unknown as ConfigLoader;

/**
 * A body that loads cleanly wherever it is placed.
 *
 * `validatePromptYaml` compares the declared `id` against the LAST segment of the path-derived id,
 * so every file below declares its own directory name and none of them is refused for a mismatch.
 * That matters: a fixture the loader refuses would go missing for the wrong reason.
 */
const promptBody = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly wherever it sits.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

/** `{category}/{relative…}/prompt.yaml` — the directory layout, at any depth. */
async function writeDirectoryForm(relativeDir: string, id: string): Promise<void> {
  const dir = path.join(PROMPTS_DIR, CATEGORY, relativeDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'prompt.yaml'), promptBody(id), 'utf-8');
}

/**
 * The fixture every case below reads.
 *
 *   general/my_chain/prompt.yaml                    → my_chain            (served)
 *   general/my_chain/step_one/prompt.yaml           → my_chain/step_one   (served)
 *   general/my_chain/helpers/prompt.yaml            → my_chain/helpers    (served — the twin)
 *   general/my_chain/tools/prompt.yaml              → RESERVED
 *   general/my_chain/tools/word_count/prompt.yaml   → RESERVED
 */
async function writeFixture(): Promise<void> {
  await writeDirectoryForm('my_chain', 'my_chain');
  await writeDirectoryForm(path.join('my_chain', 'step_one'), 'step_one');
  await writeDirectoryForm(path.join('my_chain', 'helpers'), 'helpers');
  await writeDirectoryForm(path.join('my_chain', 'tools'), 'tools');
  await writeDirectoryForm(path.join('my_chain', 'tools', 'word_count'), 'word_count');
}

/** Ids the loader reaches at any depth; `my_chain/helpers` sits below `ResourceIndexer`'s bound. */
const SERVED_IDS = ['my_chain', 'my_chain/helpers', 'my_chain/step_one'];

/** What a walk must never produce for this fixture. */
const RESERVED_IDS = ['my_chain/tools', 'my_chain/tools/word_count'];

describe('a prompt directory’s tools/ is reserved in every walk', () => {
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
    await fs.mkdir(path.join(PROMPTS_DIR, CATEGORY), { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    dbManager.run(`DELETE FROM kv_state WHERE key = 'resource_hashes'`);
    dbManager.run('DELETE FROM resource_changes');
    await writeFixture();
  });

  it('the catalog serves the twin beside tools/ and nothing inside it', async () => {
    const loader = new PromptLoader(logger as never, { enableCache: false });
    const loaded = await loader.loadFromDirectories(PROMPTS_DIR);
    const ids = loaded.promptsData.map((prompt) => prompt.id).sort();

    // The positive control and the absence in one assertion: `my_chain/helpers` holds the same
    // body one directory over, so an empty catalog cannot satisfy this line.
    expect(ids).toEqual(SERVED_IDS);

    // And nothing was quietly refused instead of skipped — a refusal would be a different reason
    // for the same absence, and would leave a record `prompt_engine` reports to an operator.
    expect(loader.getQuarantine().list()).toEqual([]);
  });

  it('resource_index holds the twin beside tools/ and nothing inside it', async () => {
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

  it('the startup baseline announces the twin beside tools/ and nothing inside it', async () => {
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

  it('names the ids a walk must not produce, so a regression is legible', async () => {
    const loader = new PromptLoader(logger as never, { enableCache: false });
    const loaded = await loader.loadFromDirectories(PROMPTS_DIR);
    const ids = loaded.promptsData.map((prompt) => prompt.id);

    for (const reserved of RESERVED_IDS) {
      expect(ids).not.toContain(reserved);
    }

    // The probe itself, shown to fire: the same membership check over an id the fixture DOES
    // serve, one directory name away from the reserved ones above.
    expect(ids).toContain('my_chain/helpers');
  });
});
