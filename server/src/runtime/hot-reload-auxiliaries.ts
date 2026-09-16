// @lifecycle canonical - Assembles the full options object prompt hot-reload starts with.
/**
 * Prompt hot reload wires five independent auxiliary reloads into `HotReloadObserver`:
 * framework, gate, script tools, resource-change tracking, and style. Each lives in its own
 * `runtime/*-hot-reload.ts` module and already resolves its own dependency, returning
 * `undefined` when that dependency never became available — this module holds the one place
 * that calls all five and filters the result, plus the sibling concern of resolving every extra
 * root the prompt catalog itself is composed from, so `Application` itself holds the managers
 * and one assembly call, not two.
 */

import { buildFrameworkAuxiliaryReloadConfig } from './framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from './gate-hot-reload.js';
import { buildResourceChangeTrackerAuxiliaryReloadConfig } from './resource-change-tracking.js';
import { resolveResourceRoots } from './resource-roots.js';
import { buildScriptAuxiliaryReloadConfig } from './script-hot-reload.js';
import { buildStyleAuxiliaryReloadConfig } from './style-hot-reload.js';

import type { GateManager } from '#engine/gates/gate-manager.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { ScriptToolDefinitionLoader } from '#modules/automation/core/script-definition-loader.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';
import type { PromptAssetManager } from '#modules/prompts/index.js';
import type { PathResolver } from './paths.js';

export interface HotReloadAuxiliaryContext {
  logger: Logger;
  mcpToolsManager?: McpToolRouter;
  gateManager?: GateManager;
  scriptLoader?: ScriptToolDefinitionLoader;
  promptsDir?: string;
  configManager: ConfigLoader;
  pathResolver: PathResolver;
}

/** Build every auxiliary reload config, in the order they were historically added. */
async function buildHotReloadAuxiliaryConfigs(
  context: HotReloadAuxiliaryContext
): Promise<AuxiliaryReloadConfig[]> {
  const { logger, mcpToolsManager, gateManager, scriptLoader, promptsDir, configManager } = context;

  const scriptAux =
    promptsDir !== undefined && scriptLoader !== undefined
      ? buildScriptAuxiliaryReloadConfig(logger, scriptLoader, promptsDir, {
          directory: configManager.getScriptsDirectory(),
          clearWorkspaceCache: () => mcpToolsManager?.clearScriptToolCache(),
        })
      : undefined;

  const configs = [
    buildFrameworkAuxiliaryReloadConfig(logger, mcpToolsManager),
    buildGateAuxiliaryReloadConfig(logger, gateManager),
    scriptAux,
    buildResourceChangeTrackerAuxiliaryReloadConfig(logger, configManager),
    await buildStyleAuxiliaryReloadConfig(logger, mcpToolsManager),
  ];

  return configs.filter((aux): aux is AuxiliaryReloadConfig => aux !== undefined);
}

/**
 * Build the full options object `PromptAssetManager#startHotReload` accepts: the five auxiliary
 * reload configs above, plus every extra root the prompt catalog is composed from, resolved by
 * the same helper the framework, gate and style loaders are configured from — one derivation of
 * "which directories contribute this resource type", not a second copy of it.
 */
export async function buildPromptHotReloadOptions(
  context: HotReloadAuxiliaryContext
): Promise<Parameters<PromptAssetManager['startHotReload']>[2]> {
  const auxiliaryReloads = await buildHotReloadAuxiliaryConfigs(context);
  const options: Parameters<PromptAssetManager['startHotReload']>[2] = {};

  if (auxiliaryReloads.length > 0) {
    options.auxiliaryReloads = auxiliaryReloads;
  }

  // `lookupDirs` is every contributing root INCLUDING the primary (P4.27 renamed `additional` to
  // state that). `startHotReload`'s own `promptRoots` option is documented as "every root besides
  // the primary" — `buildWatchTargets` already adds the primary as its own target — so the primary
  // is filtered back out here rather than passed through, keeping this call's contract unchanged
  // rather than relying on downstream Map-dedup to absorb a duplicate.
  const { primary, lookupDirs } = resolveResourceRoots(
    context.pathResolver,
    'prompts',
    context.promptsDir
  );
  const extraPromptRoots = lookupDirs.filter((dir) => dir !== primary);
  if (extraPromptRoots.length > 0) {
    options.promptRoots = extraPromptRoots;
  }

  return options;
}
