/**
 * A root that does not exist when the watcher arms is reconciled once it appears.
 *
 * WHY THIS TEST EXISTS
 * `FileObserver` polls once a second for a directory registered before it exists, then arms
 * chokidar on it and reports the files it finds. Nothing can report an entry written AND removed
 * inside that window, while the server may already hold it: `resource_manager` registers a created
 * framework or gate directly. Measured against a live server: a framework created, switched to and
 * removed at once stayed selected for 15s and past it, and a gate stayed listed. Shortening the
 * poll only narrows the window, so the fix is a reconciliation when a late watch arms — and this
 * file holds the class to it:
 *
 *   - the observer tells every overlapping registration to reconcile, and reloads prompts;
 *   - a directory that existed at registration is NOT reconciled;
 *   - the framework and gate registrations actually drop what the disk no longer holds;
 *   - overlay roots that do not exist yet are still read and watched (the other half of the row:
 *     one created after startup used to be filtered out for good).
 *
 * The window is reproduced deterministically rather than raced: the entry is registered, then its
 * whole folder is removed BEFORE the watch is set up, and the folder is recreated empty. That is
 * exactly the state a create-then-remove inside the poll interval leaves behind.
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createGenericGuide } from '../../../src/engine/frameworks/definitions/generic-framework-guide.js';
import { FrameworkRegistry } from '../../../src/engine/frameworks/definitions/registry.js';
import { RuntimeFrameworkLoader } from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { createGateManager } from '../../../src/engine/gates/gate-manager.js';
import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { StyleDefinitionLoader } from '../../../src/modules/formatting/core/style-definition-loader.js';
import { HotReloadObserver } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import { buildFrameworkAuxiliaryReloadConfig } from '../../../src/runtime/framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from '../../../src/runtime/gate-hot-reload.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { trackedResourceRoots } from '../../../src/runtime/resource-change-tracking.js';
import { resolveResourceRoots } from '../../../src/runtime/resource-roots.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { FrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import type { ConfigLoader } from '../../../src/infra/config/index.js';
import type { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { AuxiliaryReloadConfig } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import type { HotReloadEvent, Logger } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `done()` holds or `timeoutMs` passes; returns whether it held. */
async function waitFor(done: () => boolean, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) {
    await sleep(100);
  }
  return done();
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

async function scratch(name: string): Promise<string> {
  const dir = testScratchPath(name);
  await mkdir(dir, { recursive: true });
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

async function startedObserver(
  onReload: (event: HotReloadEvent) => void
): Promise<HotReloadObserver> {
  const observer = new HotReloadObserver(logger, {
    batchChanges: false,
    reloadDelayMs: 0,
    debounceMs: 50,
  });
  observer.setReloadCallback(async (event) => {
    onReload(event);
  });
  cleanups.push(() => observer.stop());
  return observer;
}

async function writeFramework(root: string, id: string): Promise<void> {
  await mkdir(path.join(root, id), { recursive: true });
  await writeFile(
    path.join(root, id, 'framework.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      `type: ${id.toUpperCase()}`,
      'enabled: true',
      'systemPromptGuidance: late root probe',
      'version: 1.0.0',
      '',
    ].join('\n'),
    'utf8'
  );
}

async function writeGate(root: string, id: string): Promise<void> {
  await mkdir(path.join(root, id), { recursive: true });
  await writeFile(
    path.join(root, id, 'gate.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      'type: validation',
      'description: late root probe',
      'severity: medium',
      'guidance: late root probe',
      '',
    ].join('\n'),
    'utf8'
  );
}

describe('a directory created after the watch armed is reconciled', () => {
  it('tells each overlapping registration, and only those, and reloads prompts', async () => {
    const base = await scratch('late-root-dispatch');
    const late = path.join(base, 'late');
    const existing = path.join(base, 'existing');
    const elsewhere = path.join(base, 'elsewhere');
    await mkdir(existing);

    const reconciled: Array<{ id: string; root: string }> = [];
    const reloads: HotReloadEvent[] = [];
    const registration = (id: string, directories: string[]): AuxiliaryReloadConfig => ({
      id,
      directories,
      handler: async () => {},
      reconcile: async (root) => {
        reconciled.push({ id, root });
      },
    });
    const observer = await startedObserver((event) => reloads.push(event));
    observer.setAuxiliaryReloads([
      // Throws, so the sibling below proves one failure does not stop the others.
      {
        ...registration('throws', [late]),
        reconcile: async () => {
          throw new Error('reconcile failure');
        },
      },
      registration('late-owner', [late]),
      // A registration whose directory CONTAINS the late one also holds entries from it.
      registration('parent-owner', [base]),
      registration('unrelated', [elsewhere]),
      registration('existing-owner', [existing]),
    ]);
    await observer.start();
    await observer.watchDirectories([{ path: late }, { path: existing }]);

    // A directory that existed at registration: a file event, and no reconciliation.
    await sleep(1500);
    await writeFile(path.join(existing, 'note.yaml'), 'x: 1\n', 'utf8');

    await mkdir(late);
    expect(await waitFor(() => reconciled.some((r) => r.id === 'late-owner'))).toBe(true);
    expect(await waitFor(() => reloads.some((e) => e.affectedFiles.includes(late)))).toBe(true);

    expect(reconciled.map((r) => r.id).sort()).toEqual(['late-owner', 'parent-owner']);
    expect(reconciled.every((r) => r.root === late)).toBe(true);
    const reconcileReload = reloads.find((e) => e.affectedFiles.includes(late));
    expect(reconcileReload?.requiresFullReload).toBe(true);
    // The existing directory's edit did arrive — so its silence above is not a dead watcher.
    expect(await waitFor(() => reloads.some((e) => e.reason.includes('note.yaml')))).toBe(true);
    expect(reconciled.some((r) => r.id === 'existing-owner')).toBe(false);
  }, 30000);

  it('drops a framework and a gate the server registered but the new folder does not hold', async () => {
    const base = await scratch('late-root-prune');
    const frameworksDir = path.join(base, 'resources', 'frameworks');
    const gatesDir = path.join(base, 'resources', 'gates');

    // Register one framework and one gate from disk, the way a `resource_manager` create does.
    await writeFramework(frameworksDir, 'late_fw');
    await writeGate(gatesDir, 'late-gate');
    const registry = new FrameworkRegistry(logger, {
      autoLoadBuiltIn: false,
      validateOnRegistration: false,
      runtimeLoaderConfig: { frameworksDir, validateOnLoad: false },
    });
    await registry.initialize();
    expect(await registry.loadAndRegisterById('late_fw')).toBe(true);
    // A guide registered in code has no file anywhere and must survive reconciliation.
    const codeGuide = createGenericGuide({
      ...new RuntimeFrameworkLoader({ frameworksDir, validateOnLoad: false }).loadFramework(
        'late_fw'
      )!,
      id: 'code_fw',
    });
    await registry.registerGuide(codeGuide, false, 'custom');

    const gateManager = await createGateManager(logger, {
      registryConfig: {
        autoLoadBuiltIn: false,
        validateOnRegistration: false,
        loaderConfig: { gatesDir },
      },
    });
    expect(await gateManager.getGateRegistry().reloadGuide('late-gate')).toBe(true);

    const removedFrameworks: string[] = [];
    const frameworkAux = buildFrameworkAuxiliaryReloadConfig(logger, {
      getFrameworkManager: () =>
        ({
          getFrameworkRegistry: () => registry,
          reload: async () => {},
          removeFramework: async (id: string) => {
            removedFrameworks.push(id);
          },
        }) as unknown as FrameworkManager,
    } as unknown as McpToolRouter);
    const gateAux = buildGateAuxiliaryReloadConfig(logger, gateManager);
    expect(frameworkAux).toBeDefined();
    expect(gateAux).toBeDefined();

    // The window's end state: both folders gone before anything watched them...
    await rm(path.join(base, 'resources'), { recursive: true, force: true });

    const observer = await startedObserver(() => {});
    observer.setAuxiliaryReloads([frameworkAux!, gateAux!]);
    await observer.start();
    await observer.watchDirectories([{ path: frameworksDir }, { path: gatesDir }]);
    // Positive control for the assertion below: before the folders return, both are held.
    expect(registry.hasGuide('late_fw')).toBe(true);
    expect(gateManager.getGateRegistry().hasGuide('late-gate')).toBe(true);

    // ...and back, empty.
    await mkdir(frameworksDir, { recursive: true });
    await mkdir(gatesDir, { recursive: true });

    expect(await waitFor(() => !registry.hasGuide('late_fw'))).toBe(true);
    expect(await waitFor(() => !gateManager.getGateRegistry().hasGuide('late-gate'))).toBe(true);
    expect(removedFrameworks).toEqual(['late_fw']);
    expect(registry.hasGuide('code_fw')).toBe(true);
  }, 30000);
});

describe('an overlay that does not exist yet is still a root', () => {
  it('is in the lookup order, the loader watch list, and the change tracker roots — but no bundled tree is tracked', async () => {
    const packageRoot = await scratch('late-root-package');
    const workspace = await scratch('late-root-workspace');
    for (const type of ['prompts', 'gates', 'frameworks', 'styles']) {
      await mkdir(path.join(packageRoot, 'resources', type), { recursive: true });
      await mkdir(path.join(workspace, 'resources', type), { recursive: true });
    }
    await writeFile(path.join(packageRoot, 'config.json'), '{}', 'utf8');

    const previous = process.env['MCP_WORKSPACE'];
    const previousResources = process.env['MCP_RESOURCES_PATH'];
    process.env['MCP_WORKSPACE'] = workspace;
    delete process.env['MCP_RESOURCES_PATH'];
    cleanups.push(async () => {
      if (previous === undefined) delete process.env['MCP_WORKSPACE'];
      else process.env['MCP_WORKSPACE'] = previous;
      if (previousResources !== undefined) process.env['MCP_RESOURCES_PATH'] = previousResources;
    });
    const resolver = new PathResolver({ cli: {}, packageRoot });

    for (const type of ['prompts', 'gates', 'frameworks', 'styles']) {
      const overlay = path.join(workspace, type);
      expect(existsSync(overlay)).toBe(false);
      const roots = resolveResourceRoots(resolver, type, path.join(workspace, 'resources', type));
      expect(roots.overlays).toEqual([overlay]);
      expect(roots.lookupDirs[0]).toBe(overlay);
      // The present-tense reading still reports only what exists.
      expect(resolver.getOverlayResourceDirs(type, roots.primary)).toEqual([]);
    }

    const gateRoots = resolveResourceRoots(
      resolver,
      'gates',
      path.join(workspace, 'resources', 'gates')
    );
    const frameworkRoots = resolveResourceRoots(
      resolver,
      'frameworks',
      path.join(workspace, 'resources', 'frameworks')
    );
    const styleRoots = resolveResourceRoots(
      resolver,
      'styles',
      path.join(workspace, 'resources', 'styles')
    );
    const watched = [
      new GateDefinitionLoader({
        gatesDir: gateRoots.primary!,
        additionalGatesDirs: gateRoots.lookupDirs,
      }).getWatchDirectories(),
      new RuntimeFrameworkLoader({
        frameworksDir: frameworkRoots.primary!,
        additionalFrameworksDirs: frameworkRoots.lookupDirs,
      }).getWatchDirectories(),
      new StyleDefinitionLoader({
        stylesDir: styleRoots.primary!,
        additionalStylesDirs: styleRoots.lookupDirs,
      }).getWatchDirectories(),
    ];
    expect(watched[0]).toContain(path.join(workspace, 'gates'));
    expect(watched[1]).toContain(path.join(workspace, 'frameworks'));
    expect(watched[2]).toContain(path.join(workspace, 'styles'));

    const configManager = {
      getResolvedPromptsDirectory: () => path.join(workspace, 'resources', 'prompts'),
      getGatesDirectory: () => path.join(workspace, 'resources', 'gates'),
    } as unknown as ConfigLoader;
    expect(trackedResourceRoots(configManager, resolver)).toEqual({
      prompt: [path.join(workspace, 'prompts'), path.join(workspace, 'resources', 'prompts')],
      gate: [path.join(workspace, 'gates'), path.join(workspace, 'resources', 'gates')],
    });
  });
});
