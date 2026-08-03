// @lifecycle canonical - Server startup orchestration using shared managers.
/**
 * Encapsulates server startup flow (transport manager + API manager + MCP server).
 * Reuses shared utilities and avoids duplicating transport detection.
 */

import { McpServer } from '@modelcontextprotocol/server';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { ServerLifecycle } from '#infra/http/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { ApiRouter } from '#mcp/http/api.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { PromptAssetManager } from '#modules/prompts/index.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { TransportMode } from '#shared/types/index.js';
import type { RuntimeLaunchOptions } from './options.js';
import type { McpServerFactory } from '@modelcontextprotocol/server';

import { createTransportRouter, startMcpServer, TransportRouter } from '#infra/http/index.js';
import { createApiRouter } from '#mcp/http/api.js';

export interface ServerStartupParams {
  logger: Logger;
  configManager: ConfigLoader;
  promptManager: PromptAssetManager;
  mcpToolsManager: McpToolRouter;
  mcpServer: McpServer;
  /** Builds a fresh server per HTTP request; see TransportRouter. */
  mcpServerFactory: McpServerFactory;
  runtimeOptions: RuntimeLaunchOptions;
  transportType?: TransportMode;
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
}

export interface ServerStartupResult {
  transportRouter: TransportRouter;
  apiRouter?: ApiRouter;
  serverLifecycle: ServerLifecycle;
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
    mcpServerFactory,
    runtimeOptions,
    transportType,
    promptsData,
    categories,
    convertedPrompts,
  } = params;

  const transport =
    transportType ?? TransportRouter.determineTransport(runtimeOptions.args, configManager);
  logger.debug(`[startup-server] Transport selected: ${transport}`);

  const transportRouter = createTransportRouter(logger, mcpServer, mcpServerFactory, transport);

  let apiRouter: ApiRouter | undefined;
  // Create ApiRouter for the HTTP transport
  if (transportRouter.isStreamableHttp()) {
    apiRouter = createApiRouter(logger, configManager, promptManager, mcpToolsManager);
    apiRouter.updateData(promptsData, categories, convertedPrompts);
  }

  const serverLifecycle = runtimeOptions.startupTest
    ? ({
        shutdown: () => logger.debug('[startup-server] Mock server shutdown'),
        getStatus: () => ({ running: true, transport }),
        isRunning: () => true,
      } as ServerLifecycle)
    : await startMcpServer(logger, configManager, transportRouter, apiRouter);

  logger.info('Server started successfully');

  const startupResult: ServerStartupResult = {
    transportRouter,
    serverLifecycle,
  };

  if (apiRouter) {
    startupResult.apiRouter = apiRouter;
  }

  return startupResult;
}
