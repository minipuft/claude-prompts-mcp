// @lifecycle canonical - Assembles every auxiliary reload config the prompt hot-reload service wires in.
/**
 * Prompt hot reload wires five independent auxiliary reloads into `HotReloadObserver`:
 * framework, gate, script tools, resource-change tracking, and style. Each lives in its own
 * `runtime/*-hot-reload.ts` module and already resolves its own dependency, returning
 * `undefined` when that dependency never became available — this module only holds the one
 * place that calls all five and filters the result, so `Application` itself holds the managers
 * and one assembly call, not five.
 */

import { buildFrameworkAuxiliaryReloadConfig } from './framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from './gate-hot-reload.js';
import { buildResourceChangeTrackerAuxiliaryReloadConfig } from './resource-change-tracking.js';
import { buildScriptAuxiliaryReloadConfig } from './script-hot-reload.js';
import { buildStyleAuxiliaryReloadConfig } from './style-hot-reload.js';

import type { GateManager } from '#engine/gates/gate-manager.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { ScriptToolDefinitionLoader } from '#modules/automation/core/script-definition-loader.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';

export interface HotReloadAuxiliaryContext {
  logger: Logger;
  mcpToolsManager?: McpToolRouter;
  gateManager?: GateManager;
  scriptLoader?: ScriptToolDefinitionLoader;
  promptsDir?: string;
  configManager: ConfigLoader;
}

/** Build every auxiliary reload config, in the order they were historically added. */
export async function buildHotReloadAuxiliaryConfigs(
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
