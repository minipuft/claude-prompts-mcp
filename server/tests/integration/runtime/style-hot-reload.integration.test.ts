/**
 * Style hot reload must watch every directory the style manager reads, refresh the same
 * instance the pipeline serves guidance from, and do both without racing that instance's
 * background startup load.
 *
 * WHY THIS TEST EXISTS
 * `buildStyleAuxiliaryReloadConfig` had no caller: `application.ts` wired a framework, a gate,
 * script tools, and resource-change tracking into hot reload, and never style. Separately, the
 * registration it builds watched only the primary styles directory
 * (`[loader.getStylesDir()]`), dropping every additional overlay directory the style manager
 * was actually configured with — the gate and framework loaders already expose
 * `getWatchDirectories()` for exactly this, and the style builder was the one that never called
 * it. And the style manager the pipeline serves from is created asynchronously in the
 * background (`PromptExecutor.initializeStyleManager()`), so a caller that read it
 * synchronously at startup could observe `undefined` even though the load was about to
 * succeed — `resolveStyleManager()` exists so a caller awaits that load instead of racing it.
 *
 * Each case below reads style GUIDANCE TEXT after simulating a file event, never a directory
 * list alone: a test that only inspected `config.directories` could pass even if the handler
 * never actually reloaded anything.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildStyleAuxiliaryReloadConfig } from '../../../src/runtime/style-hot-reload.js';
import { createStyleManager, StyleManager } from '../../../src/modules/formatting/index.js';

import type { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { HotReloadEvent } from '../../../src/shared/types/index.js';
import type { Logger } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** The narrow surface `buildStyleAuxiliaryReloadConfig` actually reads, cast once. */
function routerResolvingTo(manager: StyleManager | undefined, delayMs = 0): McpToolRouter {
  return {
    resolveStyleManager: () =>
      delayMs > 0
        ? new Promise((resolve) => setTimeout(() => resolve(manager), delayMs))
        : Promise.resolve(manager),
  } as unknown as McpToolRouter;
}

async function writeStyle(root: string, id: string, guidance: string): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'style.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      `description: Fixture style ${id}.`,
      'guidanceFile: guidance.md',
      'priority: 0',
      'enabled: true',
      'enhancementMode: prepend',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(dir, 'guidance.md'), `${guidance}\n`, 'utf8');
}

function eventFor(
  filePath: string,
  changeType: 'modified' | 'removed' = 'modified'
): HotReloadEvent {
  return {
    type: 'config_changed',
    reason: `test edit of ${filePath}`,
    affectedFiles: [filePath],
    changeType,
    timestamp: Date.now(),
    requiresFullReload: false,
  };
}

describe('style hot reload wires the pipeline instance and every folder it reads', () => {
  let workspace: string;
  let primary: string;
  let additional: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'style-hot-reload-'));
    // `extractStyleIdFromPath` in `runtime/style-hot-reload.ts` reads the style id off a
    // `/styles/{id}/…` segment, so the fixture paths mirror the real
    // `<root>/resources/styles/<id>/` shape rather than an arbitrary temp layout.
    primary = path.join(workspace, 'workspace', 'resources', 'styles');
    additional = path.join(workspace, 'bundled', 'resources', 'styles');

    await writeStyle(primary, 'primary_style', 'PRIMARY ORIGINAL');
    await writeStyle(additional, 'additional_style', 'ADDITIONAL ORIGINAL');
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  it('resolves undefined, not a config, when the style manager never became available', async () => {
    const config = await buildStyleAuxiliaryReloadConfig(logger, routerResolvingTo(undefined));
    expect(config).toBeUndefined();
  });

  it('resolves undefined when no McpToolRouter is supplied at all', async () => {
    const config = await buildStyleAuxiliaryReloadConfig(logger, undefined);
    expect(config).toBeUndefined();
  });

  it('awaits a style manager that becomes ready after this call starts — the ordering fix', async () => {
    const manager = await createStyleManager(logger, {
      loaderConfig: { stylesDir: primary, additionalStylesDirs: [additional] },
    });

    // Simulates `PromptExecutor.initializeStyleManager()` still running in the background: the
    // manager is not ready the instant `buildStyleAuxiliaryReloadConfig` is called. A caller
    // reading a synchronous getter at this point would see nothing; awaiting the resolver must
    // not.
    const config = await buildStyleAuxiliaryReloadConfig(logger, routerResolvingTo(manager, 15));

    expect(config).toBeDefined();
    expect(config?.id).toBe('style');
  });

  it('watches the primary directory AND every additional directory the manager was configured with', async () => {
    const manager = await createStyleManager(logger, {
      loaderConfig: { stylesDir: primary, additionalStylesDirs: [additional] },
    });

    const config = await buildStyleAuxiliaryReloadConfig(logger, routerResolvingTo(manager));

    expect(config?.directories).toContain(primary);
    expect(config?.directories).toContain(additional);
  });

  it('reloads a style edited in the PRIMARY directory — the positive control', async () => {
    const manager = await createStyleManager(logger, {
      loaderConfig: { stylesDir: primary, additionalStylesDirs: [additional] },
    });
    const config = await buildStyleAuxiliaryReloadConfig(logger, routerResolvingTo(manager));
    expect(config).toBeDefined();

    await writeFile(path.join(primary, 'primary_style', 'guidance.md'), 'PRIMARY EDITED\n', 'utf8');
    await config!.handler(eventFor(path.join(primary, 'primary_style', 'guidance.md')));

    expect(manager.getStyleGuidance('primary_style')).toBe('PRIMARY EDITED');
  });

  it('reloads a style edited in an ADDITIONAL directory — the reported defect', async () => {
    const manager = await createStyleManager(logger, {
      loaderConfig: { stylesDir: primary, additionalStylesDirs: [additional] },
    });
    const config = await buildStyleAuxiliaryReloadConfig(logger, routerResolvingTo(manager));
    expect(config).toBeDefined();

    await writeFile(
      path.join(additional, 'additional_style', 'guidance.md'),
      'ADDITIONAL EDITED\n',
      'utf8'
    );
    await config!.handler(eventFor(path.join(additional, 'additional_style', 'guidance.md')));

    expect(manager.getStyleGuidance('additional_style')).toBe('ADDITIONAL EDITED');
  });

  it('clears a deleted style from cache instead of continuing to serve it', async () => {
    const manager = await createStyleManager(logger, {
      loaderConfig: { stylesDir: primary, additionalStylesDirs: [additional] },
    });
    const config = await buildStyleAuxiliaryReloadConfig(logger, routerResolvingTo(manager));
    expect(config).toBeDefined();

    // Prime the cache before deleting, so the assertion can tell a real cache clear apart from
    // a style that was simply never loaded.
    expect(manager.getStyleGuidance('primary_style')).toBe('PRIMARY ORIGINAL');

    // `styleExists` checks for `style.yaml`, so a full deletion removes the whole style
    // directory, not just `guidance.md` — matching how a style resource is actually removed.
    const guidancePath = path.join(primary, 'primary_style', 'guidance.md');
    await rm(path.join(primary, 'primary_style'), { recursive: true, force: true });
    await config!.handler(eventFor(guidancePath, 'removed'));

    expect(manager.hasStyle('primary_style')).toBe(false);
  });
});
