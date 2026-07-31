// @lifecycle canonical - Module initialization helper for runtime startup.
/**
 * Initializes framework state, MCP tools, tool descriptions, and prompt registration.
 * Reuses existing managers without duplicating orchestration inside Application.
 */

import * as path from 'node:path';

import {
  initializeResourceChangeTracker,
  compareResourceBaseline,
} from './resource-change-tracking.js';
import {
  createFrameworkStateStore,
  FrameworkStateStore,
} from '../engine/frameworks/framework-state-store.js';
import { getDefaultRuntimeLoader } from '../engine/frameworks/methodology/runtime-methodology-loader.js';
import { createGateManager, GateManager } from '../engine/gates/gate-manager.js';
import { createMetricsCollector } from '../infra/observability/metrics/index.js';
import { ResourceChangeTracker } from '../infra/observability/tracking/index.js';
import { createMcpToolsManager, McpToolRouter } from '../mcp/tools/index.js';
import {
  createToolDescriptionLoader,
  ToolDescriptionLoader,
} from '../mcp/tools/tool-description-loader.js';
import { getDefaultStyleDefinitionLoader } from '../modules/formatting/core/style-definition-loader.js';
import { isChainPrompt } from '../shared/utils/chainUtils.js';

import type { RuntimeLaunchOptions } from './options.js';
import type { PathResolver } from './paths.js';
import type { ConvertedPrompt } from '../engine/execution/types.js';
import type { ConfigLoader } from '../infra/config/index.js';
import type { Logger } from '../infra/logging/index.js';
import type { PromptAssetManager } from '../modules/prompts/index.js';
import type { Category, PromptData } from '../modules/prompts/types.js';
import type { ConversationStore } from '../modules/text-refs/conversation.js';
import type { TextReferenceStore } from '../modules/text-refs/index.js';
import type {
  ResolvedFrameworkConfig,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '../shared/types/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ModuleInitCallbacks {
  fullServerRefresh: () => Promise<void>;
  restartServer: (reason: string) => Promise<void>;
  handleFrameworkConfigChange: (
    config: ResolvedFrameworkConfig,
    previous?: ResolvedFrameworkConfig
  ) => void;
}

export interface ModuleInitParams {
  logger: Logger;
  configManager: ConfigLoader;
  runtimeOptions: RuntimeLaunchOptions;
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
  promptManager: PromptAssetManager;
  conversationStore: ConversationStore;
  textReferenceStore: TextReferenceStore;
  mcpServer: McpServer;
  callbacks: ModuleInitCallbacks;
  /** Server root for runtime state directories */
  serverRoot?: string;
  /** Path resolver for workspace-derived resource overlays */
  pathResolver?: PathResolver;
  /** Hook registry for pipeline event emissions */
  hookRegistry?: HookRegistryPort;
  /** Notification emitter for MCP client notifications */
  notificationEmitter?: McpNotificationEmitterPort;
}

export interface ModuleInitResult {
  frameworkStateStore: FrameworkStateStore;
  gateManager: GateManager;
  mcpToolsManager: McpToolRouter;
  toolDescriptionLoader: ToolDescriptionLoader;
  /** Resource change tracker for audit logging (undefined if serverRoot not provided) */
  resourceChangeTracker?: ResourceChangeTracker;
}

export async function initializeModules(params: ModuleInitParams): Promise<ModuleInitResult> {
  const {
    logger,
    configManager,
    runtimeOptions,
    promptsData,
    categories,
    convertedPrompts,
    promptManager,
    conversationStore,
    textReferenceStore,
    mcpServer,
    callbacks,
    serverRoot,
    pathResolver,
    hookRegistry,
    notificationEmitter,
  } = params;

  const isVerbose = runtimeOptions.verbose;

  // Initialize Resource Change Tracker early (for audit logging)
  let resourceChangeTracker: ResourceChangeTracker | undefined;
  if (serverRoot !== undefined && serverRoot !== '') {
    if (isVerbose) logger.info('🔄 Initializing Resource Change Tracker...');
    try {
      resourceChangeTracker = await initializeResourceChangeTracker(logger, serverRoot);
      // Compare baseline to detect external changes
      const baselineResult = await compareResourceBaseline(
        resourceChangeTracker,
        configManager,
        logger
      );
      if (isVerbose) {
        const { added, modified, removed } = baselineResult;
        if (added > 0 || modified > 0 || removed > 0) {
          logger.info(
            `📊 External changes detected: ${added} added, ${modified} modified, ${removed} removed`
          );
        } else {
          logger.info('✅ ResourceChangeTracker initialized (no external changes detected)');
        }
      }
    } catch (error) {
      logger.warn('Failed to initialize ResourceChangeTracker:', error);
    }
  }

  if (isVerbose) logger.info('🔄 Initializing Framework State Manager...');
  const frameworkStateRoot =
    typeof configManager.getServerRoot === 'function'
      ? configManager.getServerRoot()
      : path.dirname(configManager.getConfigPath());
  const frameworkStateStore = await createFrameworkStateStore(logger, frameworkStateRoot);
  if (isVerbose) logger.info('✅ FrameworkStateStore initialized successfully');

  const currentFrameworkConfig = configManager.getFrameworksConfig();
  callbacks.handleFrameworkConfigChange(currentFrameworkConfig);

  // Initialize Gate Manager (Phase 4 - registry-based gate system)
  if (isVerbose) logger.info('🔄 Initializing Gate Manager...');
  const additionalGatesDirs = pathResolver?.getOverlayResourceDirs('gates') ?? [];
  const gateManager = await createGateManager(
    logger,
    additionalGatesDirs.length > 0
      ? { registryConfig: { loaderConfig: { additionalGatesDirs } } }
      : undefined
  );
  if (isVerbose) {
    const stats = gateManager.getStats();
    logger.info(`✅ GateManager initialized with ${stats.totalGates} gates`);
    if (additionalGatesDirs.length > 0) {
      logger.info(`  📂 Additional gate directories: ${additionalGatesDirs.join(', ')}`);
    }
  }

  // Initialize framework + style loaders with PathResolver-resolved dirs
  // This ensures PathResolver is the SSOT for directory resolution and enables overlays.
  // Must happen before any pipeline/tool code calls getDefaultRuntimeLoader().
  const frameworksDir = pathResolver?.getFrameworksPath();
  const additionalFrameworksDirs = pathResolver?.getOverlayResourceDirs('frameworks') ?? [];
  getDefaultRuntimeLoader({
    ...(frameworksDir !== undefined ? { frameworksDir } : {}),
    ...(additionalFrameworksDirs.length > 0 ? { additionalFrameworksDirs } : {}),
  });
  if (isVerbose && additionalFrameworksDirs.length > 0) {
    logger.info(`  📂 Additional methodology directories: ${additionalFrameworksDirs.join(', ')}`);
  }

  const stylesDir = pathResolver?.getStylesPath();
  const additionalStylesDirs = pathResolver?.getOverlayResourceDirs('styles') ?? [];
  getDefaultStyleDefinitionLoader({
    ...(stylesDir !== undefined ? { stylesDir } : {}),
    ...(additionalStylesDirs.length > 0 ? { additionalStylesDirs } : {}),
  });
  if (isVerbose && additionalStylesDirs.length > 0) {
    logger.info(`  📂 Additional style directories: ${additionalStylesDirs.join(', ')}`);
  }

  const chainCount = convertedPrompts.filter((p) => isChainPrompt(p)).length;
  if (isVerbose) {
    logger.info(
      `🔗 Chain prompts available: ${chainCount}/${convertedPrompts.length} total prompts`
    );
  }

  if (isVerbose) logger.info('🔄 Initializing MCP tools manager...');
  const metricsCollector = createMetricsCollector(logger);
  const mcpToolsManager = await createMcpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager,
    conversationStore,
    textReferenceStore,
    callbacks.fullServerRefresh,
    callbacks.restartServer,
    gateManager,
    metricsCollector
  );

  if (isVerbose) logger.info('🔄 Updating MCP tools manager data...');
  mcpToolsManager.updateData(promptsData, convertedPrompts, categories);

  // Wire DatabasePort early so sub-handlers have it before first use
  if (serverRoot !== undefined && serverRoot !== '') {
    try {
      const { SqliteEngine } = await import('../infra/database/sqlite-engine.js');
      const dbManager = await SqliteEngine.getInstance(serverRoot, logger);
      await dbManager.initialize();
      mcpToolsManager.setDatabasePort(dbManager);
    } catch (error) {
      logger.warn(
        `Failed to wire DatabasePort to MCP tools: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (isVerbose) logger.info('🔄 Connecting Framework State Manager...');
  mcpToolsManager.setFrameworkStateStore(frameworkStateStore);

  if (isVerbose) logger.info('🔄 Initializing Framework Manager...');
  await mcpToolsManager.setFrameworkManager();

  if (isVerbose) logger.info('🔄 Initializing Tool Description Manager...');
  const toolDescriptionLoader = createToolDescriptionLoader(logger, configManager);
  toolDescriptionLoader.setFrameworkStateStore(frameworkStateStore);
  await toolDescriptionLoader.initialize();

  if (isVerbose) logger.info('🔄 Connecting Tool Description Manager to MCP Tools...');
  mcpToolsManager.setToolDescriptionLoader(toolDescriptionLoader);

  // Wire up hook registry and notification emitter for pipeline events
  if (hookRegistry) {
    mcpToolsManager.setHookRegistry(hookRegistry);
  }
  if (notificationEmitter) {
    mcpToolsManager.setNotificationEmitter(notificationEmitter);
  }

  if (isVerbose) logger.info('🔄 Registering all MCP tools...');
  await mcpToolsManager.registerAllTools();

  // Index resources to SQLite for hook consumption (prompt-suggest, etc.)
  if (serverRoot !== undefined && serverRoot !== '') {
    try {
      const { SqliteEngine } = await import('../infra/database/sqlite-engine.js');
      const { createResourceIndexer } = await import('../infra/database/resource-indexer.js');
      const { ScriptToolDefinitionLoader } =
        await import('../modules/automation/core/script-definition-loader.js');
      const dbManager = await SqliteEngine.getInstance(serverRoot, logger);
      await dbManager.initialize();
      const resourcesDir = pathResolver?.getResourcesPath() ?? path.join(serverRoot, 'resources');
      const scriptLoader = new ScriptToolDefinitionLoader({ validateOnLoad: true });
      const indexer = createResourceIndexer(dbManager, logger, {
        resourcesDir,
        toolLoader: (dir, id) => scriptLoader.loadAllToolsForPrompt(dir, id),
      });
      await indexer.syncAll();
      if (isVerbose) logger.info('✅ ResourceIndexer synced to SQLite');
    } catch (error) {
      logger.warn('Failed to sync resource index:', error);
    }
  }

  return {
    frameworkStateStore,
    gateManager,
    mcpToolsManager,
    toolDescriptionLoader,
    resourceChangeTracker,
  };
}
