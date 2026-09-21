// @lifecycle test - Integration test for the merged refusal record reaching the index (P4.14 + P4.15)
/**
 * The property that exists only where P4.14 and P4.15 meet.
 *
 * P4.14 taught `ResourceIndexer` to withhold a file its loader refused, and proved it against the
 * PROMPT loader — the only one filling a quarantine at the time. P4.15 taught the gate and
 * framework loaders to fill one. Neither row could observe the thing an operator actually cares
 * about: that a broken GATE is absent from `resource_index`, which requires the loaders' three
 * separate collections to be joined and handed to the indexer at the composition root.
 *
 * That join is four tokens in `module-initializer.ts` and it is invisible to both rows' suites.
 * A merge that dropped the gate view would leave every test in both files green.
 *
 * WHY THE REAL LOADERS. `QuarantineView.isRefused` is path-keyed, so the whole mechanism rests on
 * the string the loader records equalling the string the indexer walks — and those are produced by
 * different code that resolves roots differently. A hand-built view would assert a match this file
 * also constructed. Both collections here come from a real loader over a real temp tree.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real PromptLoader and
 * GateDefinitionLoader).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import { createGateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { mergeQuarantineViews } from '../../../src/shared/utils/resource-quarantine.js';

import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = testScratchPath('merged-quarantine-indexing');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');
const PROMPTS_DIR = path.join(RESOURCES_DIR, 'prompts');
const GATES_DIR = path.join(RESOURCES_DIR, 'gates');

/** A gate the loader accepts. */
const validGate = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} gate`,
    'type: validation',
    `description: A gate that loads cleanly and should reach the index.`,
    'guidance: Check the thing.',
    '',
  ].join('\n');

/**
 * A gate the loader REFUSES.
 *
 * `type` is required and must be one of the declared kinds; `not-a-gate-type` parses as YAML
 * perfectly and fails schema validation — which is exactly the case the old indexer indexed and
 * the catalog dropped. Malformed YAML would have been the easier fixture and the wrong one: the
 * indexer's own walk skips a file it cannot parse, so that case never distinguished the fix.
 */
const refusedGate = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} gate`,
    'type: not-a-gate-type',
    'description: A gate whose type is not a declared kind.',
    'guidance: Check the thing.',
    '',
  ].join('\n');

const validPrompt = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

async function writeGate(id: string, body: string): Promise<void> {
  const dir = path.join(GATES_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'gate.yaml'), body, 'utf-8');
}

async function writePrompt(id: string, body: string): Promise<void> {
  const dir = path.join(PROMPTS_DIR, 'general', id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'prompt.yaml'), body, 'utf-8');
}

const indexedIds = (dbManager: SqliteEngine, type: string): string[] =>
  dbManager
    .query<{ id: string }>('SELECT id FROM resource_index WHERE type = ? ORDER BY id', [type])
    .map((row) => row.id);

describe('the merged refusal record reaches the index', () => {
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    dbManager = await SqliteEngine.getInstance(mockLogger as never, {
      dbPath: path.join(TEST_DIR, 'runtime-state', 'state.db'),
    });
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
    await fs.mkdir(PROMPTS_DIR, { recursive: true });
    await fs.mkdir(GATES_DIR, { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();
  });

  /**
   * Both loaders driven over the temp tree, merged the way the composition root merges them.
   *
   * Fresh loaders per call: both cache by path with no mtime check.
   */
  async function loadBothAndMerge(): Promise<{
    merged: QuarantineView;
    promptIds: string[];
    gateIds: string[];
  }> {
    const promptLoader = new PromptLoader(mockLogger as never, { enableCache: false });
    await promptLoader.loadFromDirectories(PROMPTS_DIR);

    const gateLoader = createGateDefinitionLoader({ gatesDir: GATES_DIR, enableCache: false });
    gateLoader.loadAllGates();

    const promptView = promptLoader.getQuarantine();
    const gateView = gateLoader.getQuarantine();
    return {
      merged: mergeQuarantineViews(promptView, gateView),
      promptIds: promptView.list().map((record) => record.id),
      gateIds: gateView.list().map((record) => record.id),
    };
  }

  const indexerWith = (quarantine: QuarantineView | undefined): ResourceIndexer =>
    new ResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: RESOURCES_DIR,
      trackTools: false,
      ...(quarantine !== undefined ? { quarantine } : {}),
    });

  it('withholds a refused gate while indexing its valid sibling', async () => {
    await writeGate('healthy_gate', validGate('healthy_gate'));
    await writeGate('broken_gate', refusedGate('broken_gate'));

    const { merged, gateIds } = await loadBothAndMerge();

    // Positive control on the FIXTURE, before anything is asserted about the index: the gate loader
    // really did refuse one file and accept the other. A tree where nothing was refused, or a merge
    // that silently dropped the gate view, would otherwise satisfy the absence below for free.
    expect(gateIds).toEqual(['broken_gate']);

    const result = await indexerWith(merged).syncAll();

    // The absence...
    expect(indexedIds(dbManager, 'gate')).not.toContain('broken_gate');
    // ...and the positive control for it, from the same probe over the same table.
    expect(indexedIds(dbManager, 'gate')).toContain('healthy_gate');

    // Reported as refused, not as removed — a file still on disk is not a deleted one.
    expect(result.refused.map((entry) => entry.id)).toEqual(['broken_gate']);
    expect(result.removed).toBe(0);
  });

  it('carries every loader through one merge, so no kind is silently uncovered', async () => {
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));
    await writePrompt('broken_prompt', validPrompt('id_that_disagrees_with_its_directory'));
    await writeGate('healthy_gate', validGate('healthy_gate'));
    await writeGate('broken_gate', refusedGate('broken_gate'));

    const { merged, promptIds, gateIds } = await loadBothAndMerge();
    expect(promptIds).toEqual(['broken_prompt']);
    expect(gateIds).toEqual(['broken_gate']);
    expect(merged.size).toBe(2);

    await indexerWith(merged).syncAll();

    expect(indexedIds(dbManager, 'prompt')).toEqual(['healthy_prompt']);
    expect(indexedIds(dbManager, 'gate')).toEqual(['healthy_gate']);
  });

  it('indexes the refused gate when the views are not merged, which is the defect', async () => {
    // The pre-change control, kept live. If the gate view is dropped from the merge — the exact
    // four-token mistake this file exists to catch — the indexer falls back to "anything that
    // parses", and a broken gate reaches the table the Python hooks read. This case FAILING is how
    // we know the two cases above are passing for the right reason.
    await writeGate('healthy_gate', validGate('healthy_gate'));
    await writeGate('broken_gate', refusedGate('broken_gate'));

    const promptLoader = new PromptLoader(mockLogger as never, { enableCache: false });
    await promptLoader.loadFromDirectories(PROMPTS_DIR);
    const promptsOnly = mergeQuarantineViews(promptLoader.getQuarantine());

    await indexerWith(promptsOnly).syncAll();

    expect(indexedIds(dbManager, 'gate')).toContain('broken_gate');
  });
});
