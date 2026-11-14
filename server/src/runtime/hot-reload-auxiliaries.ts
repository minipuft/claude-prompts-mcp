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

import { DiskEditVersionRecorder } from './disk-edit-versioning.js';
import { buildFrameworkAuxiliaryReloadConfig } from './framework-hot-reload.js';
import { buildGateAuxiliaryReloadConfig } from './gate-hot-reload.js';
import { buildResourceChangeTrackerAuxiliaryReloadConfig } from './resource-change-tracking.js';
import { createResourceFileLocator, resolveResourceRoots } from './resource-roots.js';
import { buildScriptAuxiliaryReloadConfig } from './script-hot-reload.js';
import { buildStyleAuxiliaryReloadConfig } from './style-hot-reload.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { GateManager } from '#engine/gates/gate-manager.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { ScriptToolDefinitionLoader } from '#modules/automation/core/script-definition-loader.js';
import type { AuxiliaryReloadConfig } from '#modules/hot-reload/hot-reload-observer.js';
import type { PromptAssetManager } from '#modules/prompts/index.js';
import type { PathResolver } from './paths.js';

import { GenericFrameworkGuide } from '#engine/frameworks/definitions/generic-framework-guide.js';
import { SqliteEngine } from '#infra/database/sqlite-engine.js';
import { VersionHistoryService } from '#modules/versioning/index.js';

export interface HotReloadAuxiliaryContext {
  logger: Logger;
  mcpToolsManager?: McpToolRouter;
  gateManager?: GateManager;
  scriptLoader?: ScriptToolDefinitionLoader;
  promptsDir?: string;
  configManager: ConfigLoader;
  pathResolver: PathResolver;
  /**
   * The prompts the catalog serves right now. Read when a disk edit is recorded, which is before
   * the reload replaces them — the state the edit changed (`disk-edit-versioning.ts`).
   */
  livePrompts: () => readonly ConvertedPrompt[];
}

/**
 * The recorder the change tracker versions disk edits through: a `VersionHistoryService` over the
 * same state database, launch workspace and file locator the `resource_manager` handlers use, and
 * the live catalog — prompts, gates and the framework registry — as the prior state.
 *
 * Built here, beside the registration that uses it, because only the hot-reload path records
 * versions for edits nobody made through a tool. The database is the process singleton the
 * composition root already claimed and initialized (`module-initializer.ts`).
 */
async function createDiskEditVersioning(
  context: HotReloadAuxiliaryContext
): Promise<DiskEditVersionRecorder> {
  const { logger, configManager, pathResolver, gateManager, mcpToolsManager, livePrompts } =
    context;
  const workspaceId = configManager.getConfig().identity.launchDefaults.workspaceId;
  const versionHistory = new VersionHistoryService({
    logger,
    configManager,
    resourceFileLocator: createResourceFileLocator(pathResolver),
  });
  const db = await SqliteEngine.getInstance(logger, {
    dbPath: pathResolver.getStateDatabasePath(),
  });
  versionHistory.setDatabasePort(db, workspaceId != null ? { workspaceId } : undefined);
  return new DiskEditVersionRecorder(versionHistory, {
    prompt: (id) => livePrompts().find((prompt) => prompt.id === id),
    gate: (id) => gateManager?.getGateRegistry().getGuide(id),
    // The registry's guide, not its loader's cache: a framework reload clears that cache for
    // every id (`loadAndRegisterById`), while the guide holds the definition until it is replaced.
    framework: (id) => {
      const registry = mcpToolsManager?.getFrameworkManager()?.getFrameworkRegistry();
      const guide = registry
        ?.getGuideEntries(false)
        .find((entry) => entry.guide.frameworkId.toLowerCase() === id.toLowerCase())?.guide;
      return guide instanceof GenericFrameworkGuide ? guide.getDefinition() : undefined;
    },
  });
}

/** Build every auxiliary reload config, in the order the observer runs them. */
async function buildHotReloadAuxiliaryConfigs(
  context: HotReloadAuxiliaryContext
): Promise<AuxiliaryReloadConfig[]> {
  const { logger, mcpToolsManager, gateManager, scriptLoader, promptsDir, configManager } = context;
  const { pathResolver } = context;

  const scriptAux =
    promptsDir !== undefined && scriptLoader !== undefined
      ? buildScriptAuxiliaryReloadConfig(logger, scriptLoader, promptsDir, {
          directory: configManager.getScriptsDirectory(),
          clearWorkspaceCache: () => mcpToolsManager?.clearScriptToolCache(),
        })
      : undefined;

  // The change tracker runs FIRST. The observer runs auxiliary handlers in this order, one after
  // another, and the tracker records a disk edit's version with the catalog's current definition
  // as the prior state — which the gate and framework handlers below replace when they reload.
  const configs = [
    buildResourceChangeTrackerAuxiliaryReloadConfig(
      logger,
      configManager,
      pathResolver,
      await createDiskEditVersioning(context)
    ),
    buildFrameworkAuxiliaryReloadConfig(logger, mcpToolsManager),
    buildGateAuxiliaryReloadConfig(logger, gateManager),
    scriptAux,
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
