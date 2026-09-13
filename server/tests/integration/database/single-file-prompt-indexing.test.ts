// @lifecycle test - Integration test for single-file prompt indexing (plan row P4.21)
/**
 * A prompt written as `{category}/{id}.yaml` had never reached a `resource_index` row.
 *
 * `ResourceIndexer.scanResources` skipped every non-directory entry outright, so the only layout it
 * could see was `{category}/{id}/prompt.yaml`. The prompt loader has supported both since the
 * beginning (`discoverYamlPrompts` calls the second one the "file pattern"), so such a prompt
 * loaded, served, and was invisible to every Python hook that reads the index — while
 * `compareResourceBaseline`, the other consumer that re-derives the catalog from disk, handled the
 * layout explicitly. Two derivations of "what is in the catalog" that did not walk the same files.
 *
 * WHY THE REAL LOADER DECIDES WHAT IS EXPECTED. Every case below drives `PromptLoader` over the
 * same temp tree and asserts the index against the ids the loader actually serves. That is the
 * whole property: not "the indexer indexes files" but "the indexer and the catalog agree". An
 * expectation written by hand could be wrong in exactly the way the two walks were wrong.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real PromptLoader).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/single-file-prompt-indexing');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');
const PROMPTS_DIR = path.join(RESOURCES_DIR, 'prompts');
const CATEGORY = 'general';

const promptBody = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

/** `{category}/{sub…}/{id}.yaml` — the single-file layout. */
async function writeSingleFile(relativePath: string, body: string): Promise<void> {
  const full = path.join(PROMPTS_DIR, CATEGORY, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf-8');
}

/** `{category}/{id}/prompt.yaml` — the directory layout. */
async function writeDirectoryForm(id: string, body: string): Promise<void> {
  const dir = path.join(PROMPTS_DIR, CATEGORY, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'prompt.yaml'), body, 'utf-8');
}

describe('single-file prompts reach resource_index', () => {
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    dbManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as never);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.rm(RESOURCES_DIR, { recursive: true, force: true });
    await fs.mkdir(path.join(PROMPTS_DIR, CATEGORY), { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();
  });

  const indexer = (): ResourceIndexer =>
    new ResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: RESOURCES_DIR,
      trackTools: false,
    });

  const indexedPromptIds = (): string[] =>
    dbManager
      .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'prompt' ORDER BY id")
      .map((row) => row.id);

  /** The ids the catalog actually serves from this tree, sorted. */
  async function servedPromptIds(): Promise<string[]> {
    const loader = new PromptLoader(mockLogger as never, { enableCache: false });
    const loaded = await loader.loadFromDirectories(PROMPTS_DIR);
    return loaded.promptsData.map((prompt) => prompt.id).sort();
  }

  it('indexes a single-file prompt alongside a directory-form sibling', async () => {
    await writeSingleFile('inline_prompt.yaml', promptBody('inline_prompt'));
    await writeDirectoryForm('directory_prompt', promptBody('directory_prompt'));

    // Positive control on the fixture, and the expectation's source: the loader serves BOTH, so an
    // index holding only one of them is a disagreement rather than a matter of taste.
    expect(await servedPromptIds()).toEqual(['directory_prompt', 'inline_prompt']);

    await indexer().syncAll();

    expect(indexedPromptIds()).toEqual(['directory_prompt', 'inline_prompt']);
  });

  it('writes a usable row for a single-file prompt, not just an id', async () => {
    // An id-only assertion would pass for a row whose every other column was null, which is not a
    // row a hook can use: `prompt-suggest` reads name and description, and `syncTools` derives a
    // prompt's tool directory from `file_path`.
    await writeSingleFile('inline_prompt.yaml', promptBody('inline_prompt'));

    await indexer().syncAll();

    const row = dbManager.query<{
      id: string;
      name: string | null;
      category: string | null;
      file_path: string | null;
      content_hash: string | null;
    }>(
      "SELECT id, name, category, file_path, content_hash FROM resource_index WHERE type = 'prompt'"
    );
    expect(row).toHaveLength(1);
    expect(row[0]?.name).toBe('inline_prompt prompt');
    expect(row[0]?.file_path).toBe(path.join(PROMPTS_DIR, CATEGORY, 'inline_prompt.yaml'));
    expect(row[0]?.content_hash).not.toBeNull();
  });

  it('produces no row for category.yaml, a script tool manifest, or a root-level file', async () => {
    await writeDirectoryForm('directory_prompt', promptBody('directory_prompt'));
    await fs.writeFile(
      path.join(PROMPTS_DIR, CATEGORY, 'category.yaml'),
      'name: General\ndescription: The general category\n',
      'utf-8'
    );
    await writeSingleFile(
      path.join('tools', 'word_count', 'tool.yaml'),
      'id: word_count\nname: Word Count\n'
    );
    await fs.writeFile(path.join(PROMPTS_DIR, 'stray.yaml'), promptBody('stray'), 'utf-8');

    // Same control, same source of truth: none of the three is served, so none may be indexed.
    expect(await servedPromptIds()).toEqual(['directory_prompt']);

    await indexer().syncAll();

    expect(indexedPromptIds()).toEqual(['directory_prompt']);
  });

  it('qualifies a nested single-file prompt with its folder, the way the loader does', async () => {
    // The id the index publishes is the id a hook hands to `prompt_engine`. A nested step served as
    // `chain/step` and indexed as `step` is an offer the tool rejects.
    await writeSingleFile(path.join('chain', 'step_one.yaml'), promptBody('step_one'));

    expect(await servedPromptIds()).toEqual(['chain/step_one']);

    await indexer().syncAll();

    expect(indexedPromptIds()).toEqual(['chain/step_one']);
  });

  it('lets the directory form win when both spellings of one id are present', async () => {
    // `discoverYamlPrompts` prefers the directory ("Only add if no directory version exists"), so
    // the index must name the file the loader reads. Bodies differ so the winner is identifiable.
    await writeDirectoryForm('twinned', promptBody('twinned'));
    await writeSingleFile('twinned.yaml', `${promptBody('twinned')}# the file form\n`);

    expect(await servedPromptIds()).toEqual(['twinned']);

    await indexer().syncAll();

    const rows = dbManager.query<{ id: string; file_path: string | null }>(
      "SELECT id, file_path FROM resource_index WHERE type = 'prompt'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.file_path).toBe(path.join(PROMPTS_DIR, CATEGORY, 'twinned', 'prompt.yaml'));
  });

  it('does not index a bare gate, framework or style file, which no loader would find', async () => {
    // Only prompts have a single-file layout. The three flat kinds are `{root}/{id}/{kind}.yaml`
    // and nothing else, so a bare file among them is not a resource.
    for (const kind of ['gates', 'frameworks', 'styles']) {
      const dir = path.join(RESOURCES_DIR, kind, 'grouping');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'loose.yaml'), 'id: loose\nname: Loose\n', 'utf-8');
    }

    await indexer().syncAll();

    for (const type of ['gate', 'framework', 'style']) {
      expect(
        dbManager.query<{ id: string }>('SELECT id FROM resource_index WHERE type = ?', [type])
      ).toEqual([]);
    }
  });
});
