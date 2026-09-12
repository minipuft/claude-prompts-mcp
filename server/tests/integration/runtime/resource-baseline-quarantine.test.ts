// @lifecycle test - Integration test for refusal-aware baseline comparison (plan row P4.14)
/**
 * `resource_changes` means "a resource entered, changed, or left the catalog".
 *
 * `compareResourceBaseline` runs its OWN filesystem walk at startup and, before P4.14, logged an
 * external `added` for any YAML file it could read — including files the prompt loader had refused,
 * which never entered the catalog at all. The audit log then announced a prompt that
 * `prompt_engine` rejects.
 *
 * THE THIRD DISPOSITION. A refused file must not log `added`, and must equally not log `removed`:
 * the file is still on disk. Its cache key stays live so the removal sweep does not fire, and its
 * hash is deliberately NOT cached — which is what makes the change event fire at the moment the
 * resource actually joins the catalog. The two repair directions below are that property.
 *
 * Driven through `compareResourceBaseline` (the runtime walk) rather than `compareBaseline` (the
 * tracker method) on purpose: `isRefused` is keyed by PATH, so the evidence that matters is that
 * the walk's path and the loader's path are the same string. Calling the tracker directly with a
 * hand-built descriptor would assert a match this file also constructed.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real PromptLoader; only the
 * config accessors naming the roots are stubbed).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { createResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { compareResourceBaseline } from '../../../src/runtime/resource-change-tracking.js';

import type { ConfigLoader } from '../../../src/infra/config/index.js';
import type { ResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';
import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/resource-baseline-quarantine');
const PROMPTS_DIR = path.join(TEST_DIR, 'resources', 'prompts');
const GATES_DIR = path.join(TEST_DIR, 'resources', 'gates');
const CATEGORY = 'general';

/**
 * The two config accessors `compareResourceBaseline` reads, and nothing else.
 *
 * Both resolve through `PathResolver` in production, which is the same resolver the prompt loader
 * reads — the reason the two walks agree on a path at all. Naming one directory here preserves
 * that relationship rather than papering over it.
 */
const configStub = {
  getResolvedPromptsDirectory: () => PROMPTS_DIR,
  getGatesDirectory: () => GATES_DIR,
} as unknown as ConfigLoader;

const validPrompt = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly and should reach the catalog.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

/** Declared `id` disagrees with the directory name — valid YAML, refused by the loader. */
const refusedPrompt = (dirName: string): string =>
  [
    `id: ${dirName}_mismatched`,
    `name: ${dirName} prompt`,
    'description: A prompt whose declared id does not match its directory.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

async function writePrompt(dirName: string, body: string): Promise<void> {
  const dir = path.join(PROMPTS_DIR, CATEGORY, dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'prompt.yaml'), body, 'utf-8');
}

/** Fresh loader per call: `PromptLoader` caches by path with no mtime check. */
async function loadAndQuarantine(): Promise<QuarantineView> {
  const loader = new PromptLoader(logger as never, { enableCache: false });
  await loader.loadFromDirectories(PROMPTS_DIR);
  return loader.getQuarantine();
}

describe('compareResourceBaseline refusal awareness', () => {
  let dbManager: SqliteEngine;
  let tracker: ResourceChangeTracker;

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
    dbManager.run(`DELETE FROM kv_state WHERE key = 'resource_hashes'`);
    dbManager.run(`DELETE FROM resource_changes`);
    await fs.rm(path.join(TEST_DIR, 'resources'), { recursive: true, force: true });
    await fs.mkdir(PROMPTS_DIR, { recursive: true });

    // A tracker per test, each loading its hash cache from the table just cleared above. Sharing
    // one across cases would carry the previous case's cache into this one's first comparison.
    tracker = createResourceChangeTracker(logger as never, {
      maxEntries: 1000,
      serverRoot: TEST_DIR,
    });
    await tracker.initialize();
  });

  /** Every `resource_changes` row for one id, oldest first. */
  const operationsFor = (resourceId: string): string[] =>
    dbManager
      .query<{ operation: string }>(
        `SELECT operation FROM resource_changes WHERE resource_id = ? ORDER BY id ASC`,
        [resourceId]
      )
      .map((row) => row.operation);

  it('logs no change for a refused file while logging the addition of its valid sibling', async () => {
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));
    await writePrompt('broken_prompt', refusedPrompt('broken_prompt'));

    const quarantine = await loadAndQuarantine();
    // Fixture control: the loader really refused exactly one of the two files.
    expect(quarantine.list().map((record) => record.id)).toEqual(['broken_prompt']);

    const result = await compareResourceBaseline(tracker, configStub, logger as never, quarantine);

    expect(result.refused).toBe(1);
    // The absence...
    expect(operationsFor('broken_prompt')).toEqual([]);
    // ...and its positive control: the same query over the same table finds the sibling that DID
    // enter the catalog. Without this, an empty `resource_changes` satisfies the line above.
    expect(operationsFor('healthy_prompt')).toEqual(['added']);
    expect(result.added).toBe(1);
  });

  it('logs the refused file as added when no quarantine is supplied, which is the defect', async () => {
    await writePrompt('broken_prompt', refusedPrompt('broken_prompt'));

    // Pre-P4.14 behaviour as a live control: the walk reads the file, so it reports an addition
    // for a prompt the catalog never accepted.
    const result = await compareResourceBaseline(tracker, configStub, logger as never);

    expect(result.added).toBe(1);
    expect(result.refused).toBe(0);
    expect(operationsFor('broken_prompt')).toEqual(['added']);
  });

  it('does not report a refused file as removed — it is still on disk', async () => {
    await writePrompt('drifting_prompt', validPrompt('drifting_prompt'));
    const first = await compareResourceBaseline(
      tracker,
      configStub,
      logger as never,
      await loadAndQuarantine()
    );
    expect(first.added).toBe(1);

    await writePrompt('drifting_prompt', refusedPrompt('drifting_prompt'));
    const second = await compareResourceBaseline(
      tracker,
      configStub,
      logger as never,
      await loadAndQuarantine()
    );

    expect(second.refused).toBe(1);
    expect(second.removed).toBe(0);
    expect(second.modified).toBe(0);
    // Still just the original addition. The cache key stayed in `currentKeys`, so the removal
    // sweep never saw it as gone.
    expect(operationsFor('drifting_prompt')).toEqual(['added']);
  });

  it('logs added when a never-valid file is repaired, because it was never cached', async () => {
    await writePrompt('repairable', refusedPrompt('repairable'));
    await compareResourceBaseline(tracker, configStub, logger as never, await loadAndQuarantine());
    expect(operationsFor('repairable')).toEqual([]);

    await writePrompt('repairable', validPrompt('repairable'));
    const repaired = await compareResourceBaseline(
      tracker,
      configStub,
      logger as never,
      await loadAndQuarantine()
    );

    expect(repaired.added).toBe(1);
    expect(repaired.modified).toBe(0);
    expect(operationsFor('repairable')).toEqual(['added']);
  });

  it('logs modified when a previously-valid file is broken and then repaired', async () => {
    await writePrompt('round_trip', validPrompt('round_trip'));
    await compareResourceBaseline(tracker, configStub, logger as never, await loadAndQuarantine());

    await writePrompt('round_trip', refusedPrompt('round_trip'));
    await compareResourceBaseline(tracker, configStub, logger as never, await loadAndQuarantine());

    await writePrompt('round_trip', `${validPrompt('round_trip')}# repaired\n`);
    const repaired = await compareResourceBaseline(
      tracker,
      configStub,
      logger as never,
      await loadAndQuarantine()
    );

    // `modified`, not `added`: the broken pass left the ORIGINAL hash in the cache rather than
    // overwriting it with the broken file's, so the repair is measured against the last body that
    // was actually served.
    expect(repaired.modified).toBe(1);
    expect(repaired.added).toBe(0);
    expect(operationsFor('round_trip')).toEqual(['added', 'modified']);
  });
});
