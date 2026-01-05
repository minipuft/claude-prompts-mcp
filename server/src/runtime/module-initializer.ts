// @lifecycle canonical - Module initialization helper for runtime startup.
/**
 * Initializes framework state, MCP tools, tool descriptions, and prompt registration.
 * Reuses existing managers without duplicating orchestration inside Application.
 */

import * as path from 'node:path';

import {
  createFrameworkStateManager,
  FrameworkStateManager,
} from '../frameworks/framework-state-manager.js';
import { createGateManager, GateManager } from '../gates/gate-manager.js';
import { createMcpToolsManager, McpToolsManager } from '../mcp-tools/index.js';
import {
  createToolDescriptionManager,
  ToolDescriptionManager,
} from '../mcp-tools/tool-description-manager.js';
import { isChainPrompt } from '../utils/chainUtils.js';

import type { RuntimeLaunchOptions } from './options.js';
import type { ConfigManager } from '../config/index.js';
import type { Logger } from '../logging/index.js';
import type { PromptAssetManager } from '../prompts/index.js';
import type { ConversationManager } from '../text-references/conversation.js';
import type { TextReferenceManager } from '../text-references/index.js';
import type { Category, ConvertedPrompt, PromptData, FrameworksConfig } from '../types/index.js';
import type { ServiceManager } from '../utils/service-manager.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ModuleInitCallbacks {
  fullServerRefresh: () => Promise<void>;
  restartServer: (reason: string) => Promise<void>;
  handleFrameworkConfigChange: (config: FrameworksConfig, previous?: FrameworksConfig) => void;
}

export interface ModuleInitParams {
  logger: Logger;
  configManager: ConfigManager;
  runtimeOptions: RuntimeLaunchOptions;
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
  promptManager: PromptAssetManager;
  conversationManager: ConversationManager;
  textReferenceManager: TextReferenceManager;
  mcpServer: McpServer;
  serviceManager: ServiceManager;
  callbacks: ModuleInitCallbacks;
}

export interface ModuleInitResult {
  frameworkStateManager: FrameworkStateManager;
  gateManager: GateManager;
  mcpToolsManager: McpToolsManager;
  toolDescriptionManager: ToolDescriptionManager;
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
    conversationManager,
    textReferenceManager,
    mcpServer,
    serviceManager,
    callbacks,
  } = params;

  const isVerbose = runtimeOptions.verbose;

  if (isVerbose) logger.info('🔄 Initializing Framework State Manager...');
  const frameworkStateRoot =
    typeof configManager.getServerRoot === 'function'
      ? configManager.getServerRoot()
      : path.dirname(configManager.getConfigPath());
  const frameworkStateManager = await createFrameworkStateManager(logger, frameworkStateRoot);
  if (isVerbose) logger.info('✅ FrameworkStateManager initialized successfully');

  const currentFrameworkConfig = configManager.getFrameworksConfig();
  callbacks.handleFrameworkConfigChange(currentFrameworkConfig);

  // Initialize Gate Manager (Phase 4 - registry-based gate system)
  if (isVerbose) logger.info('🔄 Initializing Gate Manager...');
  const gateManager = await createGateManager(logger);
  if (isVerbose) {
    const stats = gateManager.getStats();
    logger.info(`✅ GateManager initialized with ${stats.totalGates} gates`);
  }

  const chainCount = convertedPrompts.filter((p) => isChainPrompt(p)).length;
  if (isVerbose) {
    logger.info(
      `🔗 Chain prompts available: ${chainCount}/${convertedPrompts.length} total prompts`
    );
  }

  if (isVerbose) logger.info('🔄 Initializing MCP tools manager...');
  const mcpToolsManager = await createMcpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager,
    conversationManager,
    textReferenceManager,
    serviceManager,
    callbacks.fullServerRefresh,
    callbacks.restartServer,
    gateManager
  );

  if (isVerbose) logger.info('🔄 Updating MCP tools manager data...');
  mcpToolsManager.updateData(promptsData, convertedPrompts, categories);

  if (isVerbose) logger.info('🔄 Connecting Framework State Manager...');
  mcpToolsManager.setFrameworkStateManager(frameworkStateManager);

  if (isVerbose) logger.info('🔄 Initializing Framework Manager...');
  await mcpToolsManager.setFrameworkManager();

  if (isVerbose) logger.info('🔄 Initializing Tool Description Manager...');
  const toolDescriptionManager = createToolDescriptionManager(logger, configManager);
  toolDescriptionManager.setFrameworkStateManager(frameworkStateManager);
  await toolDescriptionManager.initialize();

  if (isVerbose) logger.info('🔄 Connecting Tool Description Manager to MCP Tools...');
  mcpToolsManager.setToolDescriptionManager(toolDescriptionManager);

  if (isVerbose) logger.info('🔄 Registering all MCP tools...');
  await mcpToolsManager.registerAllTools();

  return {
    frameworkStateManager,
    gateManager,
    mcpToolsManager,
    toolDescriptionManager,
  };
}
