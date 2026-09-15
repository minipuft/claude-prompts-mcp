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
 * PROMPTS IS A DELIBERATELY NARROWER ROW. Prompt hot reload is not one of the five
 * `AuxiliaryReloadConfig`-shaped builders the other four rows exercise — it is the PRIMARY watch
 * target the other four are layered onto (`modules/prompts/index.ts#startHotReload`), and its
 * loader composes bundled + primary + every overlay at LOAD time
 * (`hot-reload-root-parity.integration.test.ts` covers that composition) while its WATCH target
 * is a single resolved directory (`discoverPromptDirectories`/`buildWatchTargets`, both called
 * with one `promptsDir`). Whether an edit to a bundled-only or overlay-only prompt is ever
 * observed by the file watcher in the first place is consequently a real, separate, larger
 * question than this table answers — closing it would mean teaching `FileObserver`'s prompt/aux
 * file classification about multiple prompt roots, not adding an entry to a `directories` array.
 * This row asserts only what is true today and load-bearing for the other four rows' contrast:
 * the primary directory a `promptsDir` argument names is what gets watched.
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildFrameworkAuxiliaryReloadConfig } from '../../../src/runtime/framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from '../../../src/runtime/gate-hot-reload.js';
import { buildScriptAuxiliaryReloadConfig } from '../../../src/runtime/script-hot-reload.js';
import { buildStyleAuxiliaryReloadConfig } from '../../../src/runtime/style-hot-reload.js';
import { createGateManager } from '../../../src/engine/gates/gate-manager.js';
import { createGenericGuide } from '../../../src/engine/frameworks/definitions/generic-framework-guide.js';
import { FrameworkRegistry } from '../../../src/engine/frameworks/definitions/registry.js';
import { ScriptToolDefinitionLoader } from '../../../src/modules/automation/core/script-definition-loader.js';
import { createStyleManager } from '../../../src/modules/formatting/index.js';
import { buildWatchTargets } from '../../../src/modules/prompts/prompt-watch-setup.js';

import type { FrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import type { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { Logger } from '../../../src/shared/types/index.js';

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
  const workspaceScriptsDir = await mkTemp(workspace, 'scripts', 'workspace');

  const gateManager = await createGateManager(logger, {
    registryConfig: {
      autoLoadBuiltIn: false,
      validateOnRegistration: false,
      loaderConfig: { gatesDir: gatesPrimary, additionalGatesDirs: [gatesAdditional] },
    },
  });

  const styleManager = await createStyleManager(logger, {
    loaderConfig: { stylesDir: stylesPrimary, additionalStylesDirs: [stylesAdditional] },
  });

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
      name: 'prompts (primary directory only — see file header)',
      expected: [promptsDir],
      directories: buildWatchTargets(promptsDir, [], {}).map((target) => target.path),
    },
  ];
});

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
});

describe('every hot-reload registration watches what its loader reads', () => {
  it.each([
    'gates',
    'styles',
    'frameworks',
    'script tools',
    'prompts (primary directory only — see file header)',
  ])('%s', (name) => {
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
