// @lifecycle canonical - Server startup orchestration using shared managers.
/**
 * Encapsulates server startup flow (transport manager + API manager + MCP server).
 * Reuses shared utilities and avoids duplicating transport detection.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createApiManager } from '../api/index.js';
import { createTransportManager, startMcpServer, TransportManager } from '../server/index.js';

import type { RuntimeLaunchOptions } from './options.js';
import type { ApiManager } from '../api/index.js';
import type { ConfigManager } from '../config/index.js';
import type { Logger } from '../logging/index.js';
import type { McpToolsManager } from '../mcp-tools/index.js';
import type { PromptAssetManager } from '../prompts/index.js';
import type { ServerManager } from '../server/index.js';
import type { Category, ConvertedPrompt, PromptData, TransportMode } from '../types/index.js';

export interface ServerStartupParams {
  logger: Logger;
  configManager: ConfigManager;
  promptManager: PromptAssetManager;
  mcpToolsManager: McpToolsManager;
  mcpServer: McpServer;
  runtimeOptions: RuntimeLaunchOptions;
  transportType?: TransportMode;
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
}

export interface ServerStartupResult {
  transportManager: TransportManager;
  apiManager?: ApiManager;
  serverManager: ServerManager;
}

export async function startServerWithManagers(
  params: ServerStartupParams
): Promise<ServerStartupResult> {
  const {
    logger,
    configManager,
    promptManager,
    mcpToolsManager,
    mcpServer,
    runtimeOptions,
    transportType,
    promptsData,
    categories,
    convertedPrompts,
  } = params;

  const transport =
    transportType ?? TransportManager.determineTransport(runtimeOptions.args, configManager);
  logger.debug(`[startup-server] Transport selected: ${transport}`);

  const transportManager = createTransportManager(logger, configManager, mcpServer, transport);

  let apiManager: ApiManager | undefined;
  // Create ApiManager for any HTTP-based transport (SSE or Streamable HTTP)
  if (transportManager.isSse() || transportManager.isStreamableHttp()) {
    apiManager = createApiManager(logger, configManager, promptManager, mcpToolsManager);
    apiManager.updateData(promptsData, categories, convertedPrompts);
  }

  const serverManager = runtimeOptions.startupTest
    ? ({
        shutdown: () => logger.debug('[startup-server] Mock server shutdown'),
        getStatus: () => ({ running: true, transport }),
        isRunning: () => true,
      } as ServerManager)
    : await startMcpServer(logger, configManager, transportManager, apiManager);

  logger.info('Server started successfully');

  const startupResult: ServerStartupResult = {
    transportManager,
    serverManager,
  };

  if (apiManager) {
    startupResult.apiManager = apiManager;
  }

  return startupResult;
}
