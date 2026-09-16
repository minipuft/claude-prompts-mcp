// @lifecycle test - ResourceIndexer re-sync semantics, and the refusal record the reload path reads
/**
 * Hot-Reload Resource Sync Integration Test
 *
 * TWO BLOCKS, AND THE HEADER USED TO CLAIM THE SECOND ONE'S COVERAGE FOR THE FIRST. Until
 * 2026-09-15 this file said it tested "the fullServerRefresh() ResourceIndexer re-sync path added
 * in application.ts" while every case built its own indexer with no quarantine at all. It is a
 * fair test of what the indexer does with a tree that changed under it, and no test whatsoever of
 * what the reload path hands the indexer — so when that path passed the prompt view alone, under a
 * comment claiming the gate, framework and style views joined there, this file stayed green and
 * every hot reload re-indexed every refused gate, framework and style (P4.25). A test asserting
 * coverage it does not have is worse than an absent one: it answers the question nobody re-asks.
 *
 * `re-sync semantics` — an indexer built fresh over a tree that gained, lost, or changed a file
 * reports and persists exactly that. Nothing here observes wiring; the fixtures are files, not
 * loaders.
 *
 * `the refusal record survives a second sync` — the reload contract: ONE merged view, assembled
 * once at the composition root over all four loaders, read by the startup sync AND by the reload
 * sync. Each case carries the pre-fix shape as its own positive control, because "the broken file
 * is absent" is satisfied for free by an indexer that never saw the tree.
 *
 * Which FILE does the wiring is not observable from here — a test can only be handed a view, not
 * asked where production got one. `validate:refusal-aware-consumers` owns that half and fails when
 * a call site is handed anything less than its walk's full coverage.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real loaders in block two).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import { createGateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { RuntimeFrameworkLoader } from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { SqliteEngine, createResourceIndexer } from '../../../src/infra/database/index.js';
import { StyleDefinitionLoader } from '../../../src/modules/formatting/core/style-definition-loader.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { mergeQuarantineViews } from '../../../src/shared/utils/resource-quarantine.js';

import type { ResourceIndexer } from '../../../src/infra/database/index.js';
import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = path.join(process.cwd(), 'tests/tmp/hot-reload-sync-test');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');

/**
 * Create a minimal YAML resource file on disk for indexing
 */
async function createResourceFile(
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

describe('Hot-Reload Resource Sync: re-sync semantics', () => {
  let dbManager: SqliteEngine;
  let indexer: ResourceIndexer;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.mkdir(RESOURCES_DIR, { recursive: true });

    dbManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should detect new resources added after initial sync', async () => {
    // Initial state: one prompt
    await createResourceFile('prompts', 'alpha', {
      id: 'alpha',
      name: 'Alpha Prompt',
      description: 'First prompt',
    });

    indexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    await indexer.syncAll();

    let prompts = indexer.queryByType('prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe('alpha');

    // Simulate hot-reload: add a second prompt file on disk
    await createResourceFile('prompts', 'beta', {
      id: 'beta',
      name: 'Beta Prompt',
      description: 'Second prompt',
    });

    // Re-sync (simulates what fullServerRefresh does)
    const freshIndexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    await freshIndexer.syncAll();

    prompts = freshIndexer.queryByType('prompt');
    expect(prompts).toHaveLength(2);

    const ids = prompts.map((p) => p.id).sort();
    expect(ids).toEqual(['alpha', 'beta']);
  });

  it('should detect removed resources after re-sync', async () => {
    // Remove the beta prompt from disk
    await fs.rm(path.join(RESOURCES_DIR, 'prompts', 'beta'), { recursive: true, force: true });

    // Re-sync
    const freshIndexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    await freshIndexer.syncAll();

    const prompts = freshIndexer.queryByType('prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].id).toBe('alpha');
  });

  it('should detect modified resources after re-sync', async () => {
    // Modify the alpha prompt on disk
    await createResourceFile('prompts', 'alpha', {
      id: 'alpha',
      name: 'Alpha Prompt Updated',
      description: 'Modified description',
    });

    // Re-sync
    const freshIndexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RESOURCES_DIR,
    });
    const result = await freshIndexer.syncAll();

    expect(result.modified).toBeGreaterThanOrEqual(1);

    const prompts = freshIndexer.queryByType('prompt');
    expect(prompts).toHaveLength(1);
    // The name field should reflect the update
    expect(prompts[0].name).toBe('Alpha Prompt Updated');
  });

  it('should persist re-synced data to disk (readable by fresh manager)', async () => {
    // Shut down and reload from disk
    await dbManager.shutdown();

    const freshManager = await SqliteEngine.getInstance(TEST_DIR, mockLogger as any);
    await freshManager.initialize();

    // Raw SQL query like Python hooks would do
    const rows = freshManager.query<{ id: string; name: string }>(
      `SELECT id, name FROM resource_index WHERE type = 'prompt'`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('alpha');
    expect(rows[0].name).toBe('Alpha Prompt Updated');

    // Reassign for cleanup
    dbManager = freshManager;
  });
});

const RELOAD_DIR = path.join(process.cwd(), 'tests/tmp/hot-reload-quarantine-test');
const RELOAD_RESOURCES = path.join(RELOAD_DIR, 'resources');
const RELOAD_PROMPTS = path.join(RELOAD_RESOURCES, 'prompts');
const RELOAD_GATES = path.join(RELOAD_RESOURCES, 'gates');
const RELOAD_FRAMEWORKS = path.join(RELOAD_RESOURCES, 'frameworks');
const RELOAD_STYLES = path.join(RELOAD_RESOURCES, 'styles');

/**
 * One healthy and one refused fixture per kind the indexer walks as a directory.
 *
 * Every refused body is SCHEMA-INVALID, never malformed YAML: the indexer's own walk already skips
 * a file it cannot parse, so malformed YAML would satisfy every absence below without the
 * quarantine being consulted at all.
 */
const validPrompt = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} prompt`,
    'description: A prompt that loads cleanly.',
    'userMessageTemplate: "Do the thing."',
    '',
  ].join('\n');

/** Refused: `type` is required and must be one of the declared kinds. */
const gateBody = (id: string, type: string): string =>
  [
    `id: ${id}`,
    `name: ${id} gate`,
    `type: ${type}`,
    'description: A gate fixture.',
    'guidance: Check the thing.',
    '',
  ].join('\n');

/** Refused: `enabled` must be a boolean. */
const frameworkBody = (id: string, enabled: string): string =>
  [
    `id: ${id}`,
    `name: ${id} framework`,
    `type: ${id.toUpperCase()}`,
    'version: 1.0.0',
    `enabled: ${enabled}`,
    'description: A framework fixture.',
    `systemPromptGuidance: GUIDANCE_${id}`,
    '',
  ].join('\n');

/** Refused: `description` is required and absent. */
const styleBody = (id: string, withDescription: boolean): string =>
  [
    `id: ${id}`,
    `name: ${id} style`,
    ...(withDescription ? ['description: A style that loads cleanly.'] : []),
    'guidance: Write it plainly.',
    '',
  ].join('\n');

async function writeResource(dir: string, fileName: string, body: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), body, 'utf-8');
}

describe('Hot-Reload Resource Sync: the refusal record survives a second sync', () => {
  let dbManager: SqliteEngine;
  let promptLoader: PromptLoader;
  let gateLoader: ReturnType<typeof createGateDefinitionLoader>;
  let frameworkLoader: RuntimeFrameworkLoader;
  let styleLoader: StyleDefinitionLoader;

  beforeAll(async () => {
    await fs.rm(RELOAD_DIR, { recursive: true, force: true });
    await fs.mkdir(RELOAD_DIR, { recursive: true });
    dbManager = await SqliteEngine.getInstance(RELOAD_DIR, mockLogger as any);
    await dbManager.initialize();
  });

  afterAll(async () => {
    await fs.rm(RELOAD_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.rm(RELOAD_RESOURCES, { recursive: true, force: true });
    await writeResource(
      path.join(RELOAD_PROMPTS, 'general', 'healthy_prompt'),
      'prompt.yaml',
      validPrompt('healthy_prompt')
    );
    await writeResource(
      path.join(RELOAD_PROMPTS, 'general', 'broken_prompt'),
      'prompt.yaml',
      validPrompt('id_that_disagrees_with_its_directory')
    );
    await writeResource(
      path.join(RELOAD_GATES, 'healthy_gate'),
      'gate.yaml',
      gateBody('healthy_gate', 'validation')
    );
    await writeResource(
      path.join(RELOAD_GATES, 'broken_gate'),
      'gate.yaml',
      gateBody('broken_gate', 'not-a-gate-type')
    );
    await writeResource(
      path.join(RELOAD_FRAMEWORKS, 'healthyfw'),
      'framework.yaml',
      frameworkBody('healthyfw', 'true')
    );
    await writeResource(
      path.join(RELOAD_FRAMEWORKS, 'brokenfw'),
      'framework.yaml',
      frameworkBody('brokenfw', '"definitely"')
    );
    await writeResource(
      path.join(RELOAD_STYLES, 'healthy_style'),
      'style.yaml',
      styleBody('healthy_style', true)
    );
    await writeResource(
      path.join(RELOAD_STYLES, 'broken_style'),
      'style.yaml',
      styleBody('broken_style', false)
    );
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();
  });

  /**
   * Drive all four real loaders once, and keep the instances.
   *
   * Kept rather than rebuilt because the property under test is that the merged view READS THROUGH
   * to live collections: a reload re-walks these same loaders, and the view the reload sync holds
   * has to show the new records without anything re-registering. Rebuilding the loaders per sync
   * would hand the second sync a different object and prove nothing about the reference.
   */
  async function loadEveryKind(): Promise<void> {
    promptLoader = new PromptLoader(mockLogger as any, { enableCache: false });
    await promptLoader.loadFromDirectories(RELOAD_PROMPTS);
    gateLoader = createGateDefinitionLoader({ gatesDir: RELOAD_GATES, enableCache: false });
    gateLoader.loadAllGates();
    frameworkLoader = new RuntimeFrameworkLoader({ frameworksDir: RELOAD_FRAMEWORKS });
    frameworkLoader.loadAllFrameworks();
    styleLoader = new StyleDefinitionLoader({ stylesDir: RELOAD_STYLES, enableCache: false });
    styleLoader.loadAllStyles();
  }

  /** The merge `module-initializer.ts` assembles and hands to both syncs. */
  const mergeEveryView = (): QuarantineView =>
    mergeQuarantineViews(
      promptLoader.getQuarantine(),
      gateLoader.getQuarantine(),
      frameworkLoader.getQuarantine(),
      styleLoader.getQuarantine()
    );

  const syncWith = async (quarantine: QuarantineView | undefined): Promise<void> => {
    const indexer = createResourceIndexer(dbManager, mockLogger as any, {
      resourcesDir: RELOAD_RESOURCES,
      trackTools: false,
      ...(quarantine !== undefined ? { quarantine } : {}),
    });
    await indexer.syncAll();
  };

  const indexedIds = (type: string): string[] =>
    dbManager
      .query<{ id: string }>('SELECT id FROM resource_index WHERE type = ? ORDER BY id', [type])
      .map((row) => row.id);

  it('withholds every kind’s refused file on the reload sync, not only the first', async () => {
    await loadEveryKind();

    // Positive control on the FIXTURE, before anything is asserted about the index: each loader
    // really did refuse one file and accept the other. A tree where nothing was refused would
    // satisfy every absence below for free.
    expect(
      promptLoader
        .getQuarantine()
        .list()
        .map((r) => r.id)
    ).toEqual(['broken_prompt']);
    expect(
      gateLoader
        .getQuarantine()
        .list()
        .map((r) => r.id)
    ).toEqual(['broken_gate']);
    expect(
      frameworkLoader
        .getQuarantine()
        .list()
        .map((r) => r.id)
    ).toEqual(['brokenfw']);
    expect(
      styleLoader
        .getQuarantine()
        .list()
        .map((r) => r.id)
    ).toEqual(['broken_style']);

    const indexQuarantine = mergeEveryView();
    await syncWith(indexQuarantine); // startup
    await syncWith(indexQuarantine); // the reload path, reading the SAME view

    expect(indexedIds('prompt')).toEqual(['healthy_prompt']);
    expect(indexedIds('gate')).toEqual(['healthy_gate']);
    expect(indexedIds('framework')).toEqual(['healthyfw']);
    expect(indexedIds('style')).toEqual(['healthy_style']);
  });

  it('re-indexes three kinds’ refused files when the reload sync gets the prompt view alone', async () => {
    // P4.25 itself, kept live as this file's positive control. The second sync is handed exactly
    // what `application.ts` used to build — `promptManager.getQuarantine()` and nothing else — and
    // the broken gate, framework and style come back into the table the Python hooks read. This
    // case FAILING is how we know the case above passes for the right reason.
    await loadEveryKind();

    await syncWith(mergeEveryView());
    await syncWith(mergeQuarantineViews(promptLoader.getQuarantine()));

    expect(indexedIds('prompt')).toEqual(['healthy_prompt']);
    expect(indexedIds('gate')).toContain('broken_gate');
    expect(indexedIds('framework')).toContain('brokenfw');
    expect(indexedIds('style')).toContain('broken_style');
  });

  it('shows a repair made between the two syncs, because the view is read by reference', async () => {
    await loadEveryKind();
    const indexQuarantine = mergeEveryView();
    await syncWith(indexQuarantine);
    expect(indexedIds('gate')).toEqual(['healthy_gate']);

    // Repair on disk and re-walk the SAME loader, the way a hot reload does. Nothing re-registers
    // the view; a snapshot taken at wiring time would keep reporting the file as refused and the
    // repaired gate would stay out of the index until the next restart.
    await writeResource(
      path.join(RELOAD_GATES, 'broken_gate'),
      'gate.yaml',
      gateBody('broken_gate', 'validation')
    );
    gateLoader.loadAllGates();
    expect(indexQuarantine.size).toBe(3);

    await syncWith(indexQuarantine);

    expect(indexedIds('gate')).toEqual(['broken_gate', 'healthy_gate']);
  });
});
