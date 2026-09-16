// @lifecycle test - the refusal record the reload path reads, across a second sync
/**
 * Hot-Reload Resource Sync Integration Test
 *
 * ONE BLOCK NOW, AND THE HEADER USED TO CLAIM THIS ONE'S COVERAGE FOR A SECOND. Until 2026-09-15
 * this file said it tested "the fullServerRefresh() re-sync path added in application.ts" while
 * every case built its own indexer with no quarantine at all. It was a fair test of what the
 * indexer does with a tree that changed under it, and no test whatsoever of what the reload path
 * hands the indexer — so when that path passed the prompt view alone, under a comment claiming the
 * gate, framework and style views joined there, this file stayed green and every hot reload
 * re-indexed every refused gate, framework and style (P4.25). A test asserting coverage it does
 * not have is worse than an absent one: it answers the question nobody re-asks.
 *
 * `the refusal record survives a second sync` — the reload contract: ONE merged view, assembled
 * once at the composition root over all four loaders, read by the startup sync AND by the reload
 * sync. Each case carries the pre-fix shape as its own positive control, because "the broken file
 * is absent" is satisfied for free by an indexer that never saw the tree.
 *
 * A `re-sync semantics` block sat above this one until P4.36 and was retired whole: its four
 * cases were mutation-proven duplicates of `resource-indexer.test.ts` (`incremental sync`) and of
 * `startup-bootstrap.test.ts` case 3. A mutation opening the engine in memory — which breaks
 * persistence and leaves indexing untouched — reddened that startup case, so the fresh-engine read
 * this block also asserted is covered there.
 *
 * Which FILE does the wiring is not observable from here — a test can only be handed a view, not
 * asked where production got one. `validate:refusal-aware-consumers` owns that half and fails when
 * a call site is handed anything less than its walk's full coverage.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real loaders).
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

import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

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
