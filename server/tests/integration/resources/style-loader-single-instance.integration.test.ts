// @lifecycle test - P4.31 falsifier: one style loader instance, and the hot reload refreshes it.
/**
 * A style broken AFTER startup leaves `resource_index`, and a style repaired after startup returns
 * to it — with no restart.
 *
 * WHAT WAS WRONG. There were two live `StyleDefinitionLoader` instances holding two separate
 * refusal collections. `runtime/module-initializer.ts` configured the singleton with the
 * `PathResolver`-resolved roots and merged ITS collection into the view the resource indexer reads;
 * `StyleManager.initialize()` called `createStyleDefinitionLoader(...)` and got a second one from a
 * second derivation of the same roots. Style hot reload registers against
 * `styleManager.getLoader()` — the second one. So every reload after startup refreshed the
 * collection the index does not read, and the indexed collection stayed frozen at whatever the
 * startup walk found. A style repaired after startup stayed withheld from `resource_index` until a
 * restart; one broken after startup stayed indexed until a restart. The two agreed at exactly one
 * moment — startup — which is why every existing test was green.
 *
 * WHY A REAL `PathResolver` AND A REAL TREE. The defect is a disagreement between two derivations
 * of the same root set, so a hand-built root list would assert the agreement this file is supposed
 * to measure. Here the roots come from a real `MCP_WORKSPACE`, the loader walks real directories,
 * and `resource_index` is a real SQLite table.
 *
 * WHY THE FIXTURES ARE SCHEMA-INVALID AND NOT MALFORMED YAML. The indexer's own walk already skips
 * a file it cannot parse, so malformed YAML satisfies every absence below without the quarantine
 * being consulted at all. A `style.yaml` missing the required `description` parses perfectly and
 * fails `validateStyleSchema` — the case the index used to keep.
 *
 * Classification: Integration (real PathResolver, real loader, real hot-reload wiring, real SQLite).
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import {
  createStyleManager,
  getDefaultStyleDefinitionLoader,
  resetDefaultStyleDefinitionLoader,
  StyleManager,
} from '../../../src/modules/formatting/index.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { indexerResourceRoots, resolveResourceRoots } from '../../../src/runtime/resource-roots.js';
import { buildStyleAuxiliaryReloadConfig } from '../../../src/runtime/style-hot-reload.js';
import { mergeQuarantineViews } from '../../../src/shared/utils/resource-quarantine.js';

import type { AuxiliaryReloadConfig } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import type { StyleDefinitionLoader } from '../../../src/modules/formatting/index.js';
import type { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { HotReloadEvent } from '../../../src/shared/types/index.js';

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
 * the maintainer's shell, where it becomes the resources base and every root below would resolve
 * into the owner's personal library instead of the temp tree — `PathResolver` reads the
 * environment before its own options, so this reaches in-process jest and not only spawned
 * servers. Saved and restored, because the process is shared with the rest of the run.
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

/** Loads cleanly. */
const validStyle = (id: string, name: string): string =>
  [
    `id: ${id}`,
    `name: ${name}`,
    `description: Fixture style ${id}.`,
    'guidance: Write it plainly.',
    '',
  ].join('\n');

/** Refused: `description` is required and absent. Parses; fails the schema. */
const refusedStyle = (id: string): string =>
  [`id: ${id}`, `name: ${id} style`, 'guidance: Write it plainly.', ''].join('\n');

function writeStyle(root: string, id: string, body: string): string {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'style.yaml');
  writeFileSync(file, body, 'utf-8');
  return file;
}

function eventFor(filePath: string): HotReloadEvent {
  return {
    type: 'config_changed',
    reason: `test edit of ${filePath}`,
    affectedFiles: [filePath],
    changeType: 'modified',
    timestamp: Date.now(),
    requiresFullReload: false,
  };
}

/** The narrow surface `buildStyleAuxiliaryReloadConfig` actually reads, cast once. */
const routerResolvingTo = (manager: StyleManager): McpToolRouter =>
  ({ resolveStyleManager: () => Promise.resolve(manager) }) as unknown as McpToolRouter;

describe('one style loader instance, and the hot reload refreshes it (P4.31)', () => {
  let tmpRoot: string;
  let packageRoot: string;
  let workspace: string;
  let bundledRoot: string;
  let primaryRoot: string;
  let overlayRoot: string;
  let hotStyleFile: string;
  let dbManager: SqliteEngine;
  let pathResolver: PathResolver;
  let styleLoader: StyleDefinitionLoader;
  let styleManager: StyleManager;
  let reloadConfig: AuxiliaryReloadConfig | undefined;

  beforeAll(async () => {
    for (const key of PATH_ENV_KEYS) delete process.env[key];
    resetDefaultStyleDefinitionLoader();

    tmpRoot = mkdtempSync(path.join(tmpdir(), 'style-single-instance-'));
    packageRoot = path.join(tmpRoot, 'package');
    workspace = path.join(tmpRoot, 'workspace');
    bundledRoot = path.join(packageRoot, 'resources', 'styles');
    primaryRoot = path.join(workspace, 'resources', 'styles');
    overlayRoot = path.join(workspace, 'styles');
    for (const dir of [bundledRoot, primaryRoot, overlayRoot]) mkdirSync(dir, { recursive: true });

    // Never touched: distinguishes "the broken one was dropped" from "everything was dropped".
    writeStyle(primaryRoot, 'steady', validStyle('steady', 'STEADY'));
    // Broken from the first walk. This is the POSITIVE CONTROL for every emptiness claim below —
    // the quarantine probe is shown observing a record before it is asked to observe an absence.
    writeStyle(primaryRoot, 'alwaysbroken', refusedStyle('alwaysbroken'));
    // Healthy at startup; broken and then repaired mid-run. The subject.
    hotStyleFile = writeStyle(primaryRoot, 'hotstyle', validStyle('hotstyle', 'HOT'));
    // Same id in the overlay and the primary, for the `sourceRoot` stamp: the overlay outranks the
    // primary (`shared/utils/resource-root-lookup.ts` §resourceRootPrecedence), so the stamp must
    // name the overlay and not the root the loader was configured with.
    writeStyle(overlayRoot, 'shadowed', validStyle('shadowed', 'FROM OVERLAY'));
    writeStyle(primaryRoot, 'shadowed', validStyle('shadowed', 'FROM PRIMARY'));

    process.env['MCP_WORKSPACE'] = workspace;
    pathResolver = new PathResolver({ cli: {}, packageRoot });

    // Exactly what `runtime/module-initializer.ts` wires: the roots resolved once through
    // `PathResolver`, handed to the SINGLETON under the two `loaderDirsConfig` keys.
    const styleRoots = resolveResourceRoots(pathResolver, 'styles', pathResolver.getStylesPath());
    styleLoader = getDefaultStyleDefinitionLoader({
      ...(styleRoots.primary !== undefined ? { stylesDir: styleRoots.primary } : {}),
      additionalStylesDirs: styleRoots.lookupDirs,
    });

    // And exactly what `PromptExecutor.initializeStyleManager()` now does: no config, no second
    // derivation, no second instance.
    styleManager = await createStyleManager(mockLogger as never, getDefaultStyleDefinitionLoader());
    reloadConfig = await buildStyleAuxiliaryReloadConfig(
      mockLogger as never,
      routerResolvingTo(styleManager)
    );

    dbManager = await SqliteEngine.getInstance(path.join(tmpRoot, 'state'), mockLogger as never);
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) await dbManager.shutdown();
    resetDefaultStyleDefinitionLoader();
    rmSync(tmpRoot, { recursive: true, force: true });
    for (const [key, value] of originalPathEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** The startup walk: reading every style is what FILLS the refusal record. */
  const loadEveryStyle = (): void => {
    styleLoader.loadAllStyles();
  };

  const refusedIds = (): string[] =>
    styleLoader
      .getQuarantine()
      .list()
      .map((record) => record.id)
      .sort();

  const syncIndex = async (): Promise<void> => {
    const indexer = createResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: path.join(workspace, 'resources'),
      resourceRoots: indexerResourceRoots(pathResolver),
      trackTools: false,
      // The single merged view the composition root assembles. Only the style leg matters here.
      quarantine: mergeQuarantineViews(styleLoader.getQuarantine()),
    });
    await indexer.syncAll();
  };

  const indexedStyleIds = (): string[] =>
    dbManager
      .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'style' ORDER BY id")
      .map((row) => row.id);

  it('resolves three distinct style roots, and the manager holds the configured singleton', () => {
    // FIXTURE CONTROL first: a tree whose overlay collapsed into the primary, or a resolver that
    // reached into the maintainer's real library, would satisfy everything below for free.
    const roots = resolveResourceRoots(pathResolver, 'styles', pathResolver.getStylesPath());
    expect(roots.primary).toBe(primaryRoot);
    expect(roots.overlays).toEqual([overlayRoot]);
    expect(roots.lookupDirs).toEqual([overlayRoot, primaryRoot, bundledRoot]);

    // RULING R22, asserted as identity rather than as behaviour. This is the line that fails the
    // instant anything reintroduces a manager-owned loader, whatever its config happens to be.
    expect(styleManager.getLoader()).toBe(styleLoader);
    expect(styleManager.getLoader()).toBe(getDefaultStyleDefinitionLoader());

    // And the hot-reload registration is built over that same instance, which is the half that
    // made the two collections diverge.
    expect(reloadConfig).toBeDefined();
    expect(reloadConfig?.directories).toEqual(expect.arrayContaining([primaryRoot, overlayRoot]));
  });

  it('stamps sourceRoot with the root that served, not the root it was configured with', () => {
    loadEveryStyle();

    // The id defined in both roots is served from the overlay, and says so.
    expect(styleLoader.loadStyle('shadowed')?.name).toBe('FROM OVERLAY');
    expect(styleLoader.loadStyle('shadowed')?.sourceRoot).toBe(overlayRoot);

    // POSITIVE CONTROL for the line above: an id only the primary defines stamps the primary, so
    // the assertion is measuring provenance rather than a constant.
    expect(styleLoader.loadStyle('steady')?.sourceRoot).toBe(primaryRoot);
  });

  it('drops a style broken after startup and re-indexes it on repair, with no restart', async () => {
    // ---- startup ----
    loadEveryStyle();

    // POSITIVE CONTROL for every absence in this case: the probe is shown observing a record
    // before it is trusted to report one missing.
    expect(refusedIds()).toEqual(['alwaysbroken']);

    await syncIndex();
    expect(indexedStyleIds()).toEqual(['hotstyle', 'shadowed', 'steady']);

    // ---- broken after startup ----
    writeStyleAndReport(primaryRoot, 'hotstyle', refusedStyle('hotstyle'));

    // The real reload path, over the real registration. It rejects because the definition no
    // longer loads — that rejection IS the coordinator reporting the failure, and swallowing it
    // here would hide whether the reload ran at all.
    await expect(reloadConfig!.handler(eventFor(hotStyleFile))).rejects.toThrow(/hotstyle/);

    // The load-bearing assertion: the record landed in the collection the INDEX reads. Under two
    // instances this collection is untouched and still reports only `alwaysbroken`.
    expect(refusedIds()).toEqual(['alwaysbroken', 'hotstyle']);

    await syncIndex();
    expect(indexedStyleIds()).toEqual(['shadowed', 'steady']);

    // ---- repaired after startup ----
    writeStyleAndReport(primaryRoot, 'hotstyle', validStyle('hotstyle', 'HOT AGAIN'));
    await reloadConfig!.handler(eventFor(hotStyleFile));

    expect(refusedIds()).toEqual(['alwaysbroken']);
    expect(styleManager.getStyle('hotstyle')?.name).toBe('HOT AGAIN');

    await syncIndex();
    expect(indexedStyleIds()).toEqual(['hotstyle', 'shadowed', 'steady']);
  });

  /** Write and return the path, so a mid-case edit reads as one statement. */
  function writeStyleAndReport(root: string, id: string, body: string): string {
    return writeStyle(root, id, body);
  }
});
