// @lifecycle test - Integration test for refusal-aware resource indexing (plan row P4.14)
/**
 * The index is a projection of the SERVED catalog, not of what parses as YAML.
 *
 * `ResourceIndexer` runs its own filesystem walk and, before P4.14, indexed any file whose YAML
 * loaded. The loaders refuse considerably more than that, so `resource_index` — which every Python
 * hook reads and whose ids those hooks hand to `prompt_engine` — could point at a file the server
 * cannot load. The tool then rejects the id the hook just offered.
 *
 * WHY THE REAL LOADER, NOT A STUB QUARANTINE. `QuarantineView.isRefused` is keyed by PATH, and the
 * whole change rests on the loader's path and the indexer's path being the same string. A hand-built
 * view would let this file assert a match it also constructed — green against a production wiring
 * that never matches. So every case below drives `PromptLoader.loadFromDirectories()` over a real
 * temp tree and hands the indexer the collection that walk produced.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real PromptLoader).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import { reportRefusedResources } from '../../../src/infra/database/resource-indexer.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { formatIndexReconciliation } from '../../../src/runtime/resource-inventory.js';

import type { RefusedResource } from '../../../src/infra/database/resource-indexer.js';
import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = testScratchPath('indexer-quarantine');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');
const PROMPTS_DIR = path.join(RESOURCES_DIR, 'prompts');
const CATEGORY = 'general';

/** A prompt file the loader accepts. `id` matching the directory is what makes it valid. */
const validPrompt = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly and should reach the index.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

/**
 * A prompt file the loader REFUSES.
 *
 * The declared `id` disagrees with the directory name, which `validatePromptYaml` rejects. Chosen
 * over malformed YAML deliberately: this file parses perfectly, so it is exactly the case the old
 * indexer indexed and the catalog dropped.
 */
const refusedPrompt = (dirName: string): string =>
  [
    `id: ${dirName}_mismatched`,
    `name: ${dirName} prompt`,
    'description: A prompt whose declared id does not match its directory.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

async function writePrompt(dirName: string, body: string): Promise<string> {
  const dir = path.join(PROMPTS_DIR, CATEGORY, dirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'prompt.yaml');
  await fs.writeFile(filePath, body, 'utf-8');
  return filePath;
}

/**
 * Load the tree with the real loader and return the quarantine it produced.
 *
 * A fresh loader per call, because `PromptLoader` caches parsed files by path with no mtime check —
 * reusing one would make the repair cases below re-read the broken body and pass for the wrong
 * reason.
 */
async function loadAndQuarantine(): Promise<QuarantineView> {
  const loader = new PromptLoader(mockLogger as never, { enableCache: false });
  await loader.loadFromDirectories(PROMPTS_DIR);
  return loader.getQuarantine();
}

const indexedIds = (dbManager: SqliteEngine): string[] =>
  dbManager
    .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'prompt' ORDER BY id")
    .map((row) => row.id);

describe('ResourceIndexer refusal awareness', () => {
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
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();
  });

  /** An indexer wired the way `module-initializer` wires it, minus the script tool loader. */
  const indexerWith = (quarantine: QuarantineView | undefined): ResourceIndexer =>
    new ResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: RESOURCES_DIR,
      trackTools: false,
      ...(quarantine !== undefined ? { quarantine } : {}),
    });

  it('withholds a refused prompt while indexing its valid sibling', async () => {
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));
    await writePrompt('broken_prompt', refusedPrompt('broken_prompt'));

    const quarantine = await loadAndQuarantine();
    // Positive control on the FIXTURE: the loader really did refuse one file and accept the other.
    // Without this, a tree where nothing was refused would satisfy every assertion below.
    expect(quarantine.list().map((record) => record.id)).toEqual(['broken_prompt']);

    const result = await indexerWith(quarantine).syncAll();

    // The absence...
    expect(indexedIds(dbManager)).not.toContain('broken_prompt');
    // ...and the positive control that the same probe finds a sibling it SHOULD see. One
    // assertion is worthless without the other: a probe reading an empty table passes the first.
    expect(indexedIds(dbManager)).toContain('healthy_prompt');

    expect(result.added).toBe(1);
    const expected: RefusedResource[] = [
      {
        type: 'prompt',
        id: 'broken_prompt',
        filePath: path.join(PROMPTS_DIR, CATEGORY, 'broken_prompt', 'prompt.yaml'),
        rowDeleted: false,
      },
    ];
    expect(result.refused).toEqual(expected);
  });

  it('indexes the refused file when no quarantine is supplied, which is the defect', async () => {
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));
    await writePrompt('broken_prompt', refusedPrompt('broken_prompt'));

    // The pre-P4.14 behaviour, kept as a live control rather than described in prose: the file
    // parses as YAML, so a walk that asks nothing else indexes it. If this ever stops indexing
    // `broken_prompt`, the case above is passing for a reason other than the quarantine.
    const result = await indexerWith(undefined).syncAll();

    expect(indexedIds(dbManager)).toEqual(['broken_prompt', 'healthy_prompt']);
    expect(result.refused).toEqual([]);
  });

  it('deletes the index row of a prompt that has since become refused, without calling it removed', async () => {
    await writePrompt('drifting_prompt', validPrompt('drifting_prompt'));
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));

    const firstSync = await indexerWith(await loadAndQuarantine()).syncAll();
    expect(firstSync.added).toBe(2);
    expect(indexedIds(dbManager)).toContain('drifting_prompt');

    // The operator breaks the file in place. It is still on disk.
    await writePrompt('drifting_prompt', refusedPrompt('drifting_prompt'));
    const secondSync = await indexerWith(await loadAndQuarantine()).syncAll();

    expect(indexedIds(dbManager)).not.toContain('drifting_prompt');
    expect(indexedIds(dbManager)).toContain('healthy_prompt');
    // `removed` would be the claim that a validation failure and a deleted directory are the same
    // event. They are not: one is repaired by editing a file, the other by restoring it.
    expect(secondSync.removed).toBe(0);
    expect(secondSync.refused).toHaveLength(1);
    expect(secondSync.refused[0]?.id).toBe('drifting_prompt');
    expect(secondSync.refused[0]?.rowDeleted).toBe(true);
  });

  it('indexes a repaired prompt as added, not modified', async () => {
    await writePrompt('repairable', refusedPrompt('repairable'));

    const brokenSync = await indexerWith(await loadAndQuarantine()).syncAll();
    expect(brokenSync.added).toBe(0);
    expect(brokenSync.refused).toHaveLength(1);

    await writePrompt('repairable', validPrompt('repairable'));
    const repairedSync = await indexerWith(await loadAndQuarantine()).syncAll();

    // `added`, because the resource is entering the index for the first time — it never held a
    // row to modify. This is what makes a repair observable as the moment it joined the catalog.
    expect(repairedSync.added).toBe(1);
    expect(repairedSync.modified).toBe(0);
    expect(repairedSync.refused).toEqual([]);
    expect(indexedIds(dbManager)).toEqual(['repairable']);
  });

  it('leaves a lower-precedence definition serving the id when the winning file is refused', async () => {
    // Two roots holding the same id, the way a workspace overlays the bundled tree. The indexer
    // accumulates lowest-precedence-first, so `workspace` would normally win.
    const bundledPrompts = path.join(TEST_DIR, 'bundled', 'prompts');
    const bundledDir = path.join(bundledPrompts, CATEGORY, 'shared_prompt');
    await fs.mkdir(bundledDir, { recursive: true });
    await fs.writeFile(path.join(bundledDir, 'prompt.yaml'), validPrompt('shared_prompt'), 'utf-8');

    await writePrompt('shared_prompt', refusedPrompt('shared_prompt'));

    const quarantine = await loadAndQuarantine();
    const indexer = new ResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: RESOURCES_DIR,
      resourceRoots: { prompt: [bundledPrompts, PROMPTS_DIR] },
      trackTools: false,
      quarantine,
    });
    const result = await indexer.syncAll();

    // The id stays indexed, pointing at the definition the loaders actually serve. Filtering the
    // refusal out AFTER the id-keyed merge would have deleted the row instead, leaving the hooks
    // blind to a prompt `prompt_engine` still answers to.
    const row = dbManager.queryOne<{ file_path: string }>(
      "SELECT file_path FROM resource_index WHERE id = 'shared_prompt' AND type = 'prompt'"
    );
    expect(row?.file_path).toBe(path.join(bundledDir, 'prompt.yaml'));
    expect(result.refused).toHaveLength(1);
    // A refused file hides nothing, so it is not reported as shadowing the definition that wins.
    expect(result.shadowed).toEqual([]);

    await fs.rm(path.join(TEST_DIR, 'bundled'), { recursive: true, force: true });
  });

  it('leaves the startup index reconciliation quiet, and does not disarm it', async () => {
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));
    await writePrompt('broken_prompt', refusedPrompt('broken_prompt'));

    const loader = new PromptLoader(mockLogger as never, { enableCache: false });
    const loaded = await loader.loadFromDirectories(PROMPTS_DIR);
    await indexerWith(loader.getQuarantine()).syncAll();

    const servedIds = loaded.promptsData.map((prompt) => prompt.id);
    // The refused prompt is now absent from BOTH derivations, so the guard that compares them has
    // nothing to say. Before this change it was indexed but not served, and the reconciliation
    // warned on every boot — a real disagreement, reported at the wrong layer.
    expect(servedIds).toEqual(['healthy_prompt']);
    expect(formatIndexReconciliation(servedIds, indexedIds(dbManager))).toEqual([]);

    // Positive control for the guard itself: silence above must mean agreement, not a reconciler
    // this change quietly defeated. A genuine divergence still reports.
    expect(
      formatIndexReconciliation(servedIds, [...indexedIds(dbManager), 'ghost_prompt'])
    ).toEqual([expect.stringContaining('ghost_prompt')]);
  });

  it('reportRefusedResources names each refused file and says nothing on a clean sync', async () => {
    await writePrompt('broken_prompt', refusedPrompt('broken_prompt'));
    const dirty = await indexerWith(await loadAndQuarantine()).syncAll();

    mockLogger.warn.mockClear();
    reportRefusedResources(dirty, mockLogger as never);
    const warned = mockLogger.warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(warned).toContain('broken_prompt');
    expect(warned).toContain('refused by their loader');

    await fs.rm(path.join(PROMPTS_DIR, CATEGORY, 'broken_prompt'), {
      recursive: true,
      force: true,
    });
    await writePrompt('healthy_prompt', validPrompt('healthy_prompt'));
    const clean = await indexerWith(await loadAndQuarantine()).syncAll();

    mockLogger.warn.mockClear();
    reportRefusedResources(clean, mockLogger as never);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
