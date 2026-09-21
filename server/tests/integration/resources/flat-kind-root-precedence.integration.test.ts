// @lifecycle test - P4.27 falsifier: an overlay outranks the primary for gates, frameworks, styles.
/**
 * A gate, a framework and a style each defined in BOTH the primary root and a workspace overlay are
 * served from the overlay — and the resource index names the overlay's file.
 *
 * WHAT WAS WRONG. Prompts have loaded bundle -> primary -> overlays with a later result winning
 * since P1.0a (`modules/prompts/prompt-root-loader.ts`, "same ID = custom wins"), and the resource
 * indexer accumulates in the same direction. The three flat-layout kinds resolved an id as
 * `primary ?? additional`, so the PRIMARY won, and the docstring on `resolveResourceRoots` called
 * that "workspace wins" — true only while the workspace WAS the primary. Two answers to one
 * question, in five kinds' worth of code.
 *
 * WHY REAL LOADERS AND A REAL TREE. Precedence is produced by `resolveResourceRoots`, consumed by
 * three separate loaders, and re-read by the indexer through `indexerResourceRoots`. A hand-built
 * root list would assert the order this file also wrote. Here `PathResolver` derives the roots from
 * a real `MCP_WORKSPACE`, the loaders walk real directories, and the index is a real SQLite table.
 *
 * WHY THE LEGACY `<workspace>/<type>/` CONVENTION IS THE OVERLAY. It is the only overlay a real
 * install can have that is distinct from the primary: `getOverlayResourceDirs` offers
 * `<ws>/<type>` and `<ws>/resources/<type>`, and the second IS what `getGatesPath()` resolves to,
 * so it is filtered out as the primary. Answering the row's first question read-only on
 * 2026-09-15: no real install on this machine carries a same-id pair across roots for these three
 * kinds — `~/.claude/resources` holds only `prompts/`, and the plugin's workspace
 * (`~/.claude/plugins/data/claude-prompts-inline`) holds only `logs/` and `runtime-state/`. This
 * change is latent-correctness, which is exactly why it needs a test rather than an observation.
 *
 * Classification: Integration (real PathResolver, real loaders, real filesystem, real SQLite).
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { RuntimeFrameworkLoader } from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { ResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import { StyleDefinitionLoader } from '../../../src/modules/formatting/core/style-definition-loader.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { indexerResourceRoots, resolveResourceRoots } from '../../../src/runtime/resource-roots.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

/**
 * Every path override `PathResolver` honors, neutralized for this file.
 *
 * `MCP_RESOURCES_PATH` in particular: the Claude Code plugin that runs this server exports it into
 * the maintainer's shell, where it silently becomes the resources base and every root below would
 * resolve into the owner's personal library instead of the temp tree. Saved and restored, because
 * the process is shared with the rest of the run. (Same reason, same list, as
 * `tests/unit/runtime/paths.runtime.test.ts`.)
 */
const PATH_ENV_KEYS = [
  'MCP_RUNTIME_ROOT',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_CONFIG_PATH',
] as const;
const originalPathEnv = new Map<string, string | undefined>(
  PATH_ENV_KEYS.map((key) => [key, process.env[key]])
);

const gateYaml = (id: string, name: string): string =>
  [
    `id: ${id}`,
    `name: ${name}`,
    'type: validation',
    'severity: medium',
    `description: Test gate ${id}`,
    'pass_criteria:',
    '  - type: inline_guidance',
    '',
  ].join('\n');

const frameworkYaml = (id: string, name: string): string =>
  [
    `id: ${id}`,
    `name: ${name}`,
    `type: ${id.toUpperCase()}`,
    'version: 1.0.0',
    'enabled: true',
    `description: Test framework ${id}`,
    'systemPromptGuidance: Follow the method.',
    '',
  ].join('\n');

const styleYaml = (id: string, name: string): string =>
  [
    `id: ${id}`,
    `name: ${name}`,
    `description: Test style ${id}`,
    'guidance: Write it plainly.',
    '',
  ].join('\n');

/**
 * A body no YAML parser accepts, for the kind-independent half of the P4.35 falsifier.
 *
 * Unparseable rather than merely schema-invalid because the three kinds have three schemas, and
 * this file needs one malformation that every loader refuses for the SAME stated reason — a
 * per-kind invalidity would make "it was refused" mean something different in each assertion. The
 * unterminated flow sequence is what the loader's `catch` reports as the record's `error`.
 */
const unparseableYaml = (id: string): string => `id: ${id}\nname: [unterminated\n`;

/** `{root}/{id}/{entryFile}` — the flat layout all three kinds use. */
function writeResource(root: string, id: string, entryFile: string, body: string): string {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, entryFile);
  writeFileSync(file, body, 'utf-8');
  return file;
}

describe('an overlay outranks the primary root for gates, frameworks and styles (P4.27)', () => {
  let tmpRoot: string;
  let packageRoot: string;
  let workspace: string;
  let dbManager: SqliteEngine;
  let pathResolver: PathResolver;
  /** `{ kind: { overlay, primary, bundled } }` — the entry-point path written in each root. */
  const written: Record<string, Record<string, string>> = {};

  beforeAll(async () => {
    for (const key of PATH_ENV_KEYS) delete process.env[key];

    tmpRoot = mkdtempSync(path.join(tmpdir(), 'flat-kind-precedence-'));
    packageRoot = path.join(tmpRoot, 'package');
    workspace = path.join(tmpRoot, 'workspace');

    const kinds = [
      { type: 'gates', entry: 'gate.yaml', body: gateYaml },
      { type: 'frameworks', entry: 'framework.yaml', body: frameworkYaml },
      { type: 'styles', entry: 'style.yaml', body: styleYaml },
    ] as const;

    for (const { type, entry, body } of kinds) {
      const bundled = path.join(packageRoot, 'resources', type);
      const primary = path.join(workspace, 'resources', type);
      const overlay = path.join(workspace, type);
      mkdirSync(bundled, { recursive: true });
      mkdirSync(primary, { recursive: true });
      mkdirSync(overlay, { recursive: true });

      written[type] = {
        // The same id in all three roots. `bundled` is here so the assertions distinguish
        // "the overlay wins" from "anything but the primary wins".
        bundled: writeResource(bundled, 'shadowed', entry, body('shadowed', 'FROM BUNDLED')),
        primary: writeResource(primary, 'shadowed', entry, body('shadowed', 'FROM PRIMARY')),
        overlay: writeResource(overlay, 'shadowed', entry, body('shadowed', 'FROM OVERLAY')),
        // POSITIVE CONTROLS: an id each root alone defines. Without these, an implementation that
        // simply stopped reading the primary, or read only the overlay, would pass the line above.
        primaryOnly: writeResource(
          primary,
          'primaryonly',
          entry,
          body('primaryonly', 'PRIMARY ONLY')
        ),
        bundledOnly: writeResource(
          bundled,
          'bundledonly',
          entry,
          body('bundledonly', 'BUNDLED ONLY')
        ),
        // P4.35 — the same id valid in the OVERLAY and malformed in the PRIMARY, which is the
        // writable root an operator edits. Before the fix the overlay served and the primary was
        // never opened, so this file produced no warning, no quarantine record and no repair
        // target. `belowwinner` names the position, not the directory: what made it silent was
        // being below whatever served, and since P4.27 that is where the writable root sits.
        belowWinnerOverlay: writeResource(
          overlay,
          'belowwinner',
          entry,
          body('belowwinner', 'FROM OVERLAY')
        ),
        belowWinnerPrimary: writeResource(
          primary,
          'belowwinner',
          entry,
          unparseableYaml('belowwinner')
        ),
      };
    }

    process.env['MCP_WORKSPACE'] = workspace;
    pathResolver = new PathResolver({ cli: {}, packageRoot });

    dbManager = await SqliteEngine.getInstance(mockLogger as never, {
      dbPath: path.join(path.join(tmpRoot, 'state'), 'runtime-state', 'state.db'),
    });
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) await dbManager.shutdown();
    rmSync(tmpRoot, { recursive: true, force: true });
    for (const [key, value] of originalPathEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /**
   * The loader config the composition root builds — `{primary, lookupDirs}` under the two keys
   * `loaderDirsConfig` (runtime/module-initializer.ts) maps them to.
   */
  const rootsFor = (
    type: string
  ): { primary: string | undefined; lookupDirs: string[]; overlays: string[] } =>
    resolveResourceRoots(pathResolver, type, primaryPathFor(type));

  function primaryPathFor(type: string): string {
    if (type === 'gates') return pathResolver.getGatesPath();
    if (type === 'frameworks') return pathResolver.getFrameworksPath();
    return pathResolver.getStylesPath();
  }

  it('resolves the primary and the legacy overlay as two distinct roots', () => {
    // FIXTURE CONTROL, before any precedence claim: the tree really does present three roots per
    // kind, and the primary really is the workspace's `resources/<type>/`. A tree where the overlay
    // collapsed into the primary would satisfy every assertion below for free.
    for (const type of ['gates', 'frameworks', 'styles']) {
      const roots = rootsFor(type);
      expect(roots.primary).toBe(path.join(workspace, 'resources', type));
      expect(roots.overlays).toEqual([path.join(workspace, type)]);
      expect(roots.lookupDirs).toEqual([
        path.join(workspace, type),
        path.join(workspace, 'resources', type),
        path.join(packageRoot, 'resources', type),
      ]);
    }
  });

  it('serves a gate from the overlay, not the primary', () => {
    const roots = rootsFor('gates');
    const loader = new GateDefinitionLoader({
      gatesDir: roots.primary as string,
      additionalGatesDirs: roots.lookupDirs,
    });

    expect(loader.loadGate('shadowed')?.name).toBe('FROM OVERLAY');
    expect(loader.loadGate('shadowed')?.sourceRoot).toBe(path.join(workspace, 'gates'));

    // POSITIVE CONTROLS: the two lower roots are still read for the ids only they define.
    expect(loader.loadGate('primaryonly')?.name).toBe('PRIMARY ONLY');
    expect(loader.loadGate('bundledonly')?.name).toBe('BUNDLED ONLY');
  });

  it('serves a framework from the overlay, not the primary', () => {
    const roots = rootsFor('frameworks');
    const loader = new RuntimeFrameworkLoader({
      frameworksDir: roots.primary as string,
      additionalFrameworksDirs: roots.lookupDirs,
    });

    expect(loader.loadFramework('shadowed')?.name).toBe('FROM OVERLAY');
    expect(loader.loadFramework('shadowed')?.sourceRoot).toBe(path.join(workspace, 'frameworks'));

    expect(loader.loadFramework('primaryonly')?.name).toBe('PRIMARY ONLY');
    expect(loader.loadFramework('bundledonly')?.name).toBe('BUNDLED ONLY');
  });

  it('serves a style from the overlay, not the primary', () => {
    const roots = rootsFor('styles');
    const loader = new StyleDefinitionLoader({
      stylesDir: roots.primary as string,
      additionalStylesDirs: roots.lookupDirs,
    });

    expect(loader.loadStyle('shadowed')?.name).toBe('FROM OVERLAY');

    expect(loader.loadStyle('primaryonly')?.name).toBe('PRIMARY ONLY');
    expect(loader.loadStyle('bundledonly')?.name).toBe('BUNDLED ONLY');
  });

  it('indexes all three kinds from the overlay, so the index agrees with what is served', async () => {
    const indexer = new ResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: path.join(workspace, 'resources'),
      resourceRoots: indexerResourceRoots(pathResolver),
      trackTools: false,
      trackPrompts: false,
    });
    await indexer.syncAll();

    const indexedPath = (type: string, id: string): string | undefined =>
      dbManager.query<{ file_path: string }>(
        'SELECT file_path FROM resource_index WHERE type = ? AND id = ?',
        [type, id]
      )[0]?.file_path;

    for (const [type, kind] of [
      ['gate', 'gates'],
      ['framework', 'frameworks'],
      ['style', 'styles'],
    ] as const) {
      expect(indexedPath(type, 'shadowed')).toBe(written[kind]?.['overlay']);
      // POSITIVE CONTROL from the same table: an id only the primary holds is indexed from it, so
      // the line above is not passing because the walk skipped the primary entirely.
      expect(indexedPath(type, 'primaryonly')).toBe(written[kind]?.['primaryOnly']);
    }
  });

  /**
   * P4.35 — a malformed file BELOW the root that serves is still recorded and still repairable.
   *
   * First-hit-wins opened a root only when the roots above it had not served, so a broken file in
   * a lower root was never read and never quarantined. That was symmetric with the pre-P4.27
   * behaviour, which silenced a broken OVERLAY — but P4.27 moved the writable root down the order,
   * so the silent root became the one an operator edits. An operator whose own
   * `<ws>/resources/gates/foo` is malformed while `<ws>/gates/foo` serves the id saw nothing at
   * all: no warning, no `list` entry, no repair target. Ruling R17: serving stops at the first
   * hit, recording does not.
   *
   * EACH CASE CARRIES BOTH CONTROLS. A loader that quarantined everything would satisfy "the
   * broken file is recorded" for free, so every case first loads a healthy three-root id and
   * asserts the quarantine is EMPTY — the probe is shown to observe absence before an absence is
   * relied on. And a loader that recorded the refusal by refusing to serve the id would satisfy it
   * too, so every case asserts the served definition is unchanged: the id still resolves, from the
   * root that legitimately won.
   */
  describe('a refusal below the serving root is recorded, not silenced (P4.35)', () => {
    it('records the gate refused in the writable root while the overlay serves', () => {
      const roots = rootsFor('gates');
      const loader = new GateDefinitionLoader({
        gatesDir: roots.primary as string,
        additionalGatesDirs: roots.lookupDirs,
      });

      // CONTROL — a healthy id in all three roots leaves the collection empty, so the record
      // below is this file's refusal and not a walk that quarantines whatever it touches.
      expect(loader.loadGate('shadowed')?.name).toBe('FROM OVERLAY');
      expect(loader.getQuarantine().list()).toEqual([]);

      // CONTROL — the served definition is unaffected: the id resolves, from the overlay.
      expect(loader.loadGate('belowwinner')?.name).toBe('FROM OVERLAY');
      expect(loader.loadGate('belowwinner')?.sourceRoot).toBe(path.join(workspace, 'gates'));

      // …and THIS file — the one in the writable root — is the one recorded.
      const records = loader.getQuarantine().byId('belowwinner');
      expect(records).toHaveLength(1);
      expect(records[0]?.path).toBe(written['gates']?.['belowWinnerPrimary']);
      expect(records[0]?.root).toBe(path.join(workspace, 'resources', 'gates'));
      expect(records[0]?.type).toBe('gate');
      expect(records[0]?.error).not.toBe('');
    });

    it('records the framework refused in the writable root while the overlay serves', () => {
      const roots = rootsFor('frameworks');
      const loader = new RuntimeFrameworkLoader({
        frameworksDir: roots.primary as string,
        additionalFrameworksDirs: roots.lookupDirs,
      });

      expect(loader.loadFramework('shadowed')?.name).toBe('FROM OVERLAY');
      expect(loader.getQuarantine().list()).toEqual([]);

      expect(loader.loadFramework('belowwinner')?.name).toBe('FROM OVERLAY');
      expect(loader.loadFramework('belowwinner')?.sourceRoot).toBe(
        path.join(workspace, 'frameworks')
      );

      const records = loader.getQuarantine().byId('belowwinner');
      expect(records).toHaveLength(1);
      expect(records[0]?.path).toBe(written['frameworks']?.['belowWinnerPrimary']);
      expect(records[0]?.root).toBe(path.join(workspace, 'resources', 'frameworks'));
      expect(records[0]?.type).toBe('framework');
      expect(records[0]?.error).not.toBe('');
    });

    it('records the style refused in the writable root while the overlay serves', () => {
      const roots = rootsFor('styles');
      const loader = new StyleDefinitionLoader({
        stylesDir: roots.primary as string,
        additionalStylesDirs: roots.lookupDirs,
      });

      expect(loader.loadStyle('shadowed')?.name).toBe('FROM OVERLAY');
      expect(loader.getQuarantine().list()).toEqual([]);

      expect(loader.loadStyle('belowwinner')?.name).toBe('FROM OVERLAY');

      const records = loader.getQuarantine().byId('belowwinner');
      expect(records).toHaveLength(1);
      expect(records[0]?.path).toBe(written['styles']?.['belowWinnerPrimary']);
      expect(records[0]?.root).toBe(path.join(workspace, 'resources', 'styles'));
      expect(records[0]?.type).toBe('style');
      expect(records[0]?.error).not.toBe('');
    });
  });
});
