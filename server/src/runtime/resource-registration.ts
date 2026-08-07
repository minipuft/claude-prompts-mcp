// @lifecycle canonical - Projects runtime managers onto the resources module's dependency shape.
/**
 * MCP resource registration.
 *
 * `registerResources` takes a flat bag of narrow read functions. Building that
 * bag from the runtime's managers is a responsibility of its own: it is where
 * optional subsystems are probed and their absence becomes an omitted
 * capability rather than a crash. That belongs beside the resources module, not
 * inside the application lifecycle.
 *
 * Called once per serving unit -- once for the pinned STDIO instance, once per
 * HTTP request -- so it reads current state rather than capturing it.
 */

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import type { GateManager } from '#engine/gates/gate-manager.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { McpToolRouter } from '#mcp/tools/index.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { EnhancedLogger } from '#infra/logging/index.js';
import { registerResources } from '#modules/resources/index.js';

/** Collaborators the resource handlers read through. */
export interface ResourceRegistrationDeps {
  logger: Logger;
  configManager: ConfigLoader;
  frameworkStateStore: FrameworkStateStore;
  mcpToolsManager: McpToolRouter;
  gateManager?: GateManager;
  /** Read as a function so hot-reload replacements are picked up. */
  getConvertedPrompts: () => ConvertedPrompt[];
}

/**
 * Register MCP resources for prompts, gates, frameworks, and observability.
 * Resources provide more token-efficient discovery than tool-based list operations.
 */
export function registerMcpResources(target: McpServer, deps: ResourceRegistrationDeps): void {
  // Check if resources registration is enabled
  const resourcesConfig = deps.configManager.getResourcesConfig();
  if (resourcesConfig.registerWithMcp === false) {
    deps.logger.info('[Resources] MCP resources registration disabled by config');
    return;
  }

  // Get optional dependencies from managers (members are definite-assigned at this point)
  const fm = deps.frameworkStateStore.getFrameworkManager();
  const csm = deps.mcpToolsManager.getChainSessionStore();
  const mc = deps.mcpToolsManager.getMetricsCollector();

  registerResources(target, {
    logger: deps.logger,
    // Wrap convertedPrompts array as a getter function for hot-reload compatibility
    promptManager: {
      getConvertedPrompts: () => deps.getConvertedPrompts(),
    },
    // Gate manager uses BaseResourceHandler public methods: list() and get()
    gateManager: deps.gateManager
      ? {
          list: (enabledOnly?: boolean) => deps.gateManager!.list(enabledOnly),
          get: (id: string) => deps.gateManager!.get(id),
        }
      : undefined,
    // Phase 2: Framework resources
    frameworkManager:
      fm != null
        ? {
            listFrameworks: (enabledOnly?: boolean) => fm.listFrameworks(enabledOnly),
            getFramework: (id: string) => fm.getFramework(id),
          }
        : undefined,
    // Phase 2: Observability resources
    chainSessionStore:
      csm != null
        ? {
            listActiveSessions: (limit?: number) => csm.listActiveSessions(limit),
            getSession: (sessionId: string) => csm.getSession(sessionId),
            getSessionByChainIdentifier: (chainId: string) =>
              csm.getSessionByChainIdentifier(chainId),
            getSessionStats: () => csm.getSessionStats(),
          }
        : undefined,
    metricsCollector: {
      getAnalyticsSummary: () => mc.getAnalyticsSummary(),
    },
    // Phase 3: Log resources (only if logger is EnhancedLogger with ring buffer)
    logManager:
      deps.logger instanceof EnhancedLogger
        ? {
            getRecentLogs: (opts) => (deps.logger as EnhancedLogger).getRecentLogs(opts),
            getLogEntry: (id) => (deps.logger as EnhancedLogger).getLogEntry(id),
            getBufferStats: () => (deps.logger as EnhancedLogger).getBufferStats(),
          }
        : undefined,
    // Pass granular resource config for per-type enable/disable
    resourcesConfig: {
      prompts: resourcesConfig.prompts,
      gates: resourcesConfig.gates,
      frameworks: resourcesConfig.frameworks,
      observability: resourcesConfig.observability,
      logs: resourcesConfig.logs,
    },
  });
}
