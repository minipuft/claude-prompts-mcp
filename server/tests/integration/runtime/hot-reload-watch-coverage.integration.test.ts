/**
 * A hot-reload registration must watch every folder its own loader reads, not just the one it
 * happened to be pointed at first.
 *
 * WHY THIS TEST EXISTS
 * Styles had this defect (fixed earlier on this branch: `createStyleHotReloadRegistration`
 * watched only `loader.getStylesDir()`, dropping every overlay directory the style manager was
 * actually configured with). Framework had the identical shape (`framework-hot-reload.ts` used
 * `[runtimeLoader.getFrameworksDir()]` instead of `runtimeLoader.getWatchDirectories()`, despite
 * that method already existing). Script tools had a related but distinct gap: the workspace-tier
 * scripts folder (`configManager.getScriptsDirectory()`) was never watched
 * at all. A fix at one site is not a fix of the class — this table asserts the same invariant,
 * "watched directories ⊇ loader-read directories", across every registration that can express
 * it, so a future regression on any one of them fails here instead of shipping silently again.
 *
 * Gates already covered themselves (`GateDefinitionLoader.getWatchDirectories()` was already
 * wired) and are included as the row that was never broken, for contrast.
 *
 * PROMPTS IS THE SAME INVARIANT, REACHED DIFFERENTLY. Prompt hot reload is not one of the five
 * `AuxiliaryReloadConfig`-shaped builders the other rows exercise — it is the PRIMARY watch
 * target the others are layered onto (`modules/prompts/index.ts#startHotReload`) — but its loader
 * composes bundled + primary + every overlay at LOAD time
 * (`hot-reload-root-parity.integration.test.ts` covers that composition), so the same rule binds
 * it: every one of those roots has to be watched. It used to watch only the primary, and an edit
 * to a bundled-only or overlay-only prompt was never observed — measured against a live server,
 * held 20s, while the identical edit in the primary root reloaded in ~4s. The row below asserts
 * the composed set, not the single directory.
 *
 * A WATCHED DIRECTORY IS NOT ENOUGH ON ITS OWN. A registration also has to RECEIVE what its
 * handler needs, which is why the last two cases here assert on the event rather than the
 * directory list: the observer used to build auxiliary events without the framework id it had
 * already resolved, so every framework file change was watched, logged, and then refused with
 * "missing frameworkId, skipping" — the directories were right and the reload still never ran.
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFrameworkAuxiliaryReloadConfig } from '../../../src/runtime/framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from '../../../src/runtime/gate-hot-reload.js';
import { buildScriptAuxiliaryReloadConfig } from '../../../src/runtime/script-hot-reload.js';
import { buildStyleAuxiliaryReloadConfig } from '../../../src/runtime/style-hot-reload.js';
import { createGateManager } from '../../../src/engine/gates/gate-manager.js';
import { createGenericGuide } from '../../../src/engine/frameworks/definitions/generic-framework-guide.js';
import { FrameworkRegistry } from '../../../src/engine/frameworks/definitions/registry.js';
import { ScriptToolDefinitionLoader } from '../../../src/modules/automation/core/script-definition-loader.js';
import {
  createStyleDefinitionLoader,
  createStyleManager,
} from '../../../src/modules/formatting/index.js';
import { HotReloadObserver } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import { buildWatchTargets } from '../../../src/modules/prompts/prompt-watch-setup.js';

import type { FrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import type { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { FileChangeEvent } from '../../../src/modules/hot-reload/file-observer.js';
import type { HotReloadEvent, Logger } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** The narrow McpToolRouter surface each builder actually reads, cast once. */
function routerWith(fields: Partial<McpToolRouter>): McpToolRouter {
  return fields as unknown as McpToolRouter;
}

async function mkTemp(...segments: string[]): Promise<string> {
  const dir = path.join(...segments);
  await mkdir(dir, { recursive: true });
  return dir;
}

interface CoverageRow {
  name: string;
  expected: string[];
  directories: string[] | undefined;
}

let workspace: string;
let table: CoverageRow[];

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'hot-reload-coverage-'));

  const gatesPrimary = await mkTemp(workspace, 'gates-primary');
  const gatesAdditional = await mkTemp(workspace, 'gates-additional');
  const stylesPrimary = await mkTemp(workspace, 'styles-primary');
  const stylesAdditional = await mkTemp(workspace, 'styles-additional');
  const frameworksPrimary = await mkTemp(workspace, 'frameworks-primary');
  const frameworksAdditional = await mkTemp(workspace, 'frameworks-additional');
  const promptsDir = await mkTemp(workspace, 'prompts');
  const promptsBundled = await mkTemp(workspace, 'prompts-bundled');
  const promptsOverlay = await mkTemp(workspace, 'prompts-overlay');
  const workspaceScriptsDir = await mkTemp(workspace, 'scripts', 'workspace');

  const gateManager = await createGateManager(logger, {
    registryConfig: {
      autoLoadBuiltIn: false,
      validateOnRegistration: false,
      loaderConfig: { gatesDir: gatesPrimary, additionalGatesDirs: [gatesAdditional] },
    },
  });

  const styleManager = await createStyleManager(
    logger,
    createStyleDefinitionLoader({
      stylesDir: stylesPrimary,
      additionalStylesDirs: [stylesAdditional],
    })
  );

  // FrameworkManager exposes no way to pin its loader's directories, so the registry — the one
  // piece `buildFrameworkAuxiliaryReloadConfig` actually reads — is built directly and wrapped
  // in the same narrow-surface stub the router pattern uses for the other rows.
  const frameworkRegistry = new FrameworkRegistry(logger, {
    autoLoadBuiltIn: false,
    validateOnRegistration: false,
    runtimeLoaderConfig: {
      frameworksDir: frameworksPrimary,
      additionalFrameworksDirs: [frameworksAdditional],
    },
  });
  const frameworkManagerStub = {
    getFrameworkRegistry: () => frameworkRegistry,
  } as unknown as FrameworkManager;

  const scriptLoader = new ScriptToolDefinitionLoader();

  table = [
    {
      name: 'gates',
      expected: [gatesPrimary, gatesAdditional],
      directories: buildGateAuxiliaryReloadConfig(logger, gateManager)?.directories,
    },
    {
      name: 'styles',
      expected: [stylesPrimary, stylesAdditional],
      directories: (
        await buildStyleAuxiliaryReloadConfig(
          logger,
          routerWith({ resolveStyleManager: () => Promise.resolve(styleManager) })
        )
      )?.directories,
    },
    {
      name: 'frameworks',
      expected: [frameworksPrimary, frameworksAdditional],
      directories: buildFrameworkAuxiliaryReloadConfig(
        logger,
        routerWith({ getFrameworkManager: () => frameworkManagerStub })
      )?.directories,
    },
    {
      name: 'script tools',
      expected: [promptsDir, workspaceScriptsDir],
      directories: buildScriptAuxiliaryReloadConfig(logger, scriptLoader, promptsDir, {
        directory: workspaceScriptsDir,
        clearWorkspaceCache: jest.fn(),
      })?.directories,
    },
    {
      name: 'prompts',
      expected: [promptsDir, promptsBundled, promptsOverlay],
      directories: buildWatchTargets(promptsDir, [], {
        promptRoots: [promptsBundled, promptsOverlay],
      }).map((target) => target.path),
    },
  ];
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
});

describe('every hot-reload registration watches what its loader reads', () => {
  it.each(['gates', 'styles', 'frameworks', 'script tools', 'prompts'])('%s', (name) => {
    const row = table.find((candidate) => candidate.name === name);
    if (!row) {
      throw new Error(`no table row named ${name}`);
    }
    expect(row.directories).toBeDefined();
    for (const dir of row.expected) {
      expect(row.directories).toContain(dir);
    }
  });
});

describe('a workspace script edit clears the pipeline cache, not just the watch list', () => {
  it('routes a workspace-tier file to clearWorkspaceCache, and a prompt-local file to the registration handler', async () => {
    const promptsRow = table.find((candidate) => candidate.name === 'script tools');
    if (!promptsRow) {
      throw new Error('no script tools row in the coverage table');
    }
    const workspaceScriptsDir = promptsRow.expected[1];
    if (workspaceScriptsDir === undefined) {
      throw new Error('script tools row has no workspace directory to test against');
    }

    const clearWorkspaceCache = jest.fn();
    const scriptLoader = new ScriptToolDefinitionLoader();
    const promptsDirForThisCheck = promptsRow.expected[0]!;
    const config = buildScriptAuxiliaryReloadConfig(logger, scriptLoader, promptsDirForThisCheck, {
      directory: workspaceScriptsDir,
      clearWorkspaceCache,
    });
    expect(config).toBeDefined();

    await config!.handler({
      type: 'config_changed',
      reason: 'test edit',
      affectedFiles: [path.join(workspaceScriptsDir, 'probe_script', 'tool.yaml')],
      changeType: 'modified',
      timestamp: Date.now(),
      requiresFullReload: false,
    });
    expect(clearWorkspaceCache).toHaveBeenCalledTimes(1);

    // A prompt-local tool file (no `/tools/{id}/` match here since nothing was created under
    // `promptsDirForThisCheck`) must NOT also route to the workspace cache clear.
    await config!.handler({
      type: 'config_changed',
      reason: 'test edit',
      affectedFiles: [path.join(promptsDirForThisCheck, 'some_prompt', 'tools', 'x', 'tool.yaml')],
      changeType: 'modified',
      timestamp: Date.now(),
      requiresFullReload: false,
    });
    expect(clearWorkspaceCache).toHaveBeenCalledTimes(1);
  });
});

describe('a workspace framework reloads its guidance without a restart', () => {
  it('serves edited systemPromptGuidance after the registration handler fires', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'framework-content-reload-'));
    try {
      const frameworksDir = await mkTemp(dir, 'frameworks');
      const frameworkDir = await mkTemp(frameworksDir, 'probe_framework');
      const entryPath = path.join(frameworkDir, 'framework.yaml');
      const writeGuidance = (guidance: string) =>
        writeFile(
          entryPath,
          [
            'id: probe_framework',
            'name: Probe Framework',
            'type: PROBE_FRAMEWORK',
            'description: Content reload probe',
            'enabled: true',
            `systemPromptGuidance: ${guidance}`,
            'version: 1.0.0',
            '',
          ].join('\n'),
          'utf8'
        );
      await writeGuidance('PROBE-GUIDANCE-ORIGINAL');

      // `validateOnLoad: false` keeps this fixture to the one field under test — schema
      // strictness for framework.yaml is covered elsewhere and isn't what this test verifies.
      const registry = new FrameworkRegistry(logger, {
        autoLoadBuiltIn: false,
        validateOnRegistration: false,
        runtimeLoaderConfig: { frameworksDir, validateOnLoad: false },
      });
      await registry.initialize();
      const registration = buildFrameworkAuxiliaryReloadConfig(
        logger,
        routerWith({
          getFrameworkManager: () =>
            ({
              getFrameworkRegistry: () => registry,
              // Only the registry's own state is under test; `reload()` is the
              // FrameworkManager-level cache the real coordinator also refreshes, orthogonal to
              // whether the registry itself picked up the edit.
              reload: async () => {},
            }) as unknown as FrameworkManager,
        })
      );
      expect(registration).toBeDefined();

      const loaded = registry.getRuntimeLoader().loadFramework('probe_framework');
      expect(loaded?.systemPromptGuidance).toBe('PROBE-GUIDANCE-ORIGINAL');
      // Simulates the live registration `resource_manager(action:"create")` performs — the same
      // step `FrameworkHotReloadCoordinator.handleFrameworkReload` repeats on every edit.
      await registry.registerGuide(createGenericGuide(loaded!), true, 'yaml-runtime');
      expect(registry.getGuide('probe_framework')?.getSystemPromptGuidance({})).toBe(
        'PROBE-GUIDANCE-ORIGINAL'
      );

      await writeGuidance('PROBE-GUIDANCE-EDITED');
      await registration!.handler({
        type: 'framework_changed',
        reason: 'test edit',
        affectedFiles: [entryPath],
        frameworkId: 'probe_framework',
        changeType: 'modified',
        timestamp: Date.now(),
        requiresFullReload: false,
      });

      expect(registry.getGuide('probe_framework')?.getSystemPromptGuidance({})).toBe(
        'PROBE-GUIDANCE-EDITED'
      );
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

describe('an auxiliary event carries what its handler needs', () => {
  /** `triggerAuxiliaryReloads` is the dispatch under test; it is private to the observer. */
  const dispatch = (observer: HotReloadObserver, event: FileChangeEvent): Promise<void> =>
    (
      observer as unknown as {
        triggerAuxiliaryReloads(fileEvent: FileChangeEvent): Promise<void>;
      }
    ).triggerAuxiliaryReloads(event);

  const frameworkFileEvent = (filePath: string, frameworkId?: string): FileChangeEvent => ({
    type: 'modified',
    filePath,
    filename: path.basename(filePath),
    timestamp: Date.now(),
    isPromptFile: false,
    isConfigFile: false,
    isFrameworkFile: true,
    isAuxiliaryFile: true,
    ...(frameworkId !== undefined ? { frameworkId } : {}),
  });

  /**
   * The framework id the observer resolved has to reach the handler.
   *
   * This asserts on the OBSERVER's event, not on the framework registration, deliberately: the
   * registration also recovers an id from the path, so a test routed through it would keep
   * passing if the observer went back to dropping the field. Every auxiliary handler that reads
   * `frameworkId` depends on this one dispatch.
   */
  it('the observer forwards the resolved framework id into the auxiliary event', async () => {
    const seen: HotReloadEvent[] = [];
    const observer = new HotReloadObserver(logger, { autoReload: false, batchChanges: false });
    observer.setAuxiliaryReloads([
      {
        id: 'framework',
        directories: [path.join(path.sep, 'tmp', 'aux', 'frameworks')],
        handler: async (event) => {
          seen.push(event);
        },
      },
    ]);

    await dispatch(
      observer,
      frameworkFileEvent(
        path.join(path.sep, 'tmp', 'aux', 'frameworks', 'probe_framework', 'framework.yaml'),
        'probe_framework'
      )
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.frameworkId).toBe('probe_framework');
    expect(seen[0]?.changeType).toBe('modified');
  });

  /**
   * A framework directory holds files the observer does not classify as framework files —
   * `system-prompt.md` among them — so those arrive with no id at all. The registration resolves
   * one from the path rather than refusing the event.
   */
  it('the framework registration resolves an id for a non-YAML file the observer left untagged', async () => {
    const reloaded: string[] = [];
    const registry = new FrameworkRegistry(logger, {
      autoLoadBuiltIn: false,
      validateOnRegistration: false,
      runtimeLoaderConfig: { frameworksDir: path.join(path.sep, 'tmp', 'aux', 'frameworks') },
    });
    await registry.initialize();
    const config = buildFrameworkAuxiliaryReloadConfig(
      logger,
      routerWith({
        getFrameworkManager: () =>
          ({
            getFrameworkRegistry: () => registry,
            reload: async (id: string) => {
              reloaded.push(id);
            },
            removeFramework: async (id: string) => {
              reloaded.push(`removed:${id}`);
            },
          }) as unknown as FrameworkManager,
      })
    );
    expect(config).toBeDefined();

    // No `frameworkId` on the event — exactly what the observer produces for a `.md` file.
    await config!.handler({
      type: 'reload_required',
      reason: 'framework file modified: system-prompt.md',
      affectedFiles: [
        path.join(path.sep, 'tmp', 'aux', 'frameworks', 'probe_framework', 'system-prompt.md'),
      ],
      changeType: 'removed',
      timestamp: Date.now(),
      requiresFullReload: false,
    });

    // `removed` routes to the deletion path, which is observable without a definition on disk.
    expect(reloaded).toContain('removed:probe_framework');
  });
});

describe('every loader that composes more than one root is represented above', () => {
  /**
   * A mechanical enumeration, so a NEW multi-root loader fails here instead of shipping with no
   * watch coverage. `getWatchDirectories()` is the shape a loader uses to say "I read more than
   * one directory"; each one that exists must have a row in the table at the top of this file.
   *
   * Prompts is deliberately absent from this list: it composes its roots through
   * `resolveResourceRoots` rather than owning a loader method, and its row covers it.
   */
  const COVERED = [
    'engine/frameworks/definitions/runtime-framework-loader.ts',
    'engine/gates/core/gate-definition-loader.ts',
    'modules/formatting/core/style-definition-loader.ts',
  ];

  it('finds no getWatchDirectories() outside the covered set', async () => {
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
    const entries = await readdir(srcRoot, { recursive: true, withFileTypes: true });

    const definers: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const full = path.join(entry.parentPath ?? srcRoot, entry.name);
      const source = await readFile(full, 'utf8');
      if (/^\s*getWatchDirectories\s*\(\s*\)\s*:/m.test(source)) {
        definers.push(path.relative(srcRoot, full).split(path.sep).join('/'));
      }
    }

    // A positive control for the scan itself: if this ever finds nothing, the pattern stopped
    // matching and the check would pass vacuously.
    expect(definers.length).toBeGreaterThan(0);
    expect(definers.sort()).toEqual(COVERED);
  });
});
