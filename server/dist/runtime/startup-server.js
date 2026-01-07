// @lifecycle canonical - Server startup orchestration using shared managers.
/**
 * Encapsulates server startup flow (transport manager + API manager + MCP server).
 * Reuses shared utilities and avoids duplicating transport detection.
 */
import { createApiManager } from '../api/index.js';
import { createTransportManager, startMcpServer, TransportManager } from '../server/index.js';
export async function startServerWithManagers(params) {
    const { logger, configManager, promptManager, mcpToolsManager, mcpServer, runtimeOptions, transportType, promptsData, categories, convertedPrompts, } = params;
    const transport = transportType ?? TransportManager.determineTransport(runtimeOptions.args, configManager);
    logger.debug(`[startup-server] Transport selected: ${transport}`);
    const transportManager = createTransportManager(logger, configManager, mcpServer, transport);
    let apiManager;
    // Create ApiManager for any HTTP-based transport (SSE or Streamable HTTP)
    if (transportManager.isSse() || transportManager.isStreamableHttp()) {
        apiManager = createApiManager(logger, configManager, promptManager, mcpToolsManager);
        apiManager.updateData(promptsData, categories, convertedPrompts);
    }
    const serverManager = runtimeOptions.startupTest
        ? {
            shutdown: () => logger.debug('[startup-server] Mock server shutdown'),
            getStatus: () => ({ running: true, transport }),
            isRunning: () => true,
        }
        : await startMcpServer(logger, configManager, transportManager, apiManager);
    logger.info('Server started successfully');
    const startupResult = {
        transportManager,
        serverManager,
    };
    if (apiManager) {
        startupResult.apiManager = apiManager;
    }
    return startupResult;
}
//# sourceMappingURL=startup-server.js.map