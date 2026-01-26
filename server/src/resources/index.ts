/**
 * MCP Resources Module
 *
 * Provides token-efficient read-only access to prompts, gates, methodologies,
 * and observability data via MCP Resources protocol (resources/list, resources/read).
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ registerResources()                                             │
 * │   │                                                             │
 * │   ├── registerPromptResources()      → resource://prompt/...    │
 * │   ├── registerGateResources()        → resource://gate/...      │
 * │   ├── registerMethodologyResources() → resource://methodology/..│
 * │   └── registerObservabilityResources()                          │
 * │       ├── Sessions                   → resource://session/...   │
 * │       └── Metrics                    → resource://metrics/...   │
 * │                                                                 │
 * │ Hot-reload: Handlers read from singleton registries at          │
 * │ request time, so changes are visible immediately.               │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * @module resources
 */

import { registerGateResources } from './handlers/gate-resources.js';
import { registerMethodologyResources } from './handlers/methodology-resources.js';
import { registerObservabilityResources } from './handlers/observability-resources.js';
import { registerPromptResources } from './handlers/prompt-resources.js';

import type { ResourceDependencies } from './types.js';
import type { Logger } from '../logging/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export { RESOURCE_URI_PATTERNS, ResourceNotFoundError } from './types.js';
export type {
  GateResourceMetadata,
  MethodologyResourceMetadata,
  PromptResourceMetadata,
  ResourceContent,
  ResourceDependencies,
  ResourceListItem,
  ResourceReadResult,
  ResourceRegistrationContext,
  SessionResourceMetadata,
} from './types.js';

/**
 * Register all MCP resources with the server.
 *
 * Resources are registered once at startup but read from singleton registries
 * at request time, ensuring hot-reload compatibility.
 *
 * Respects granular config flags in dependencies.resourcesConfig:
 * - prompts.enabled: Enable prompt resources
 * - gates.enabled: Enable gate resources
 * - methodologies.enabled: Enable methodology resources
 * - observability.enabled: Enable observability resources (sessions + metrics)
 * - logs.enabled: Enable logs resources
 *
 * @param server - The MCP server instance
 * @param dependencies - Singleton manager references for data access
 */
export function registerResources(server: McpServer, dependencies: ResourceDependencies): void {
  const { logger, resourcesConfig } = dependencies;
  const cfg = resourcesConfig ?? {};

  logger.info('[Resources] Registering MCP resources...');

  // Prompts
  const promptsEnabled = cfg.prompts?.enabled !== false;
  if (promptsEnabled && dependencies.promptManager !== undefined) {
    registerPromptResources(server, dependencies);
    logger.debug('[Resources] Prompt resources registered');
  } else if (!promptsEnabled) {
    logger.debug('[Resources] Prompt resources disabled by config');
  } else {
    logger.warn('[Resources] Prompt assets not available, skipping prompt resources');
  }

  // Gates
  const gatesEnabled = cfg.gates?.enabled !== false;
  if (gatesEnabled && dependencies.gateManager !== undefined) {
    registerGateResources(server, dependencies);
    logger.debug('[Resources] Gate resources registered');
  } else if (!gatesEnabled) {
    logger.debug('[Resources] Gate resources disabled by config');
  } else {
    logger.warn('[Resources] GateManager not available, skipping gate resources');
  }

  // Methodologies
  const methodologiesEnabled = cfg.methodologies?.enabled !== false;
  if (methodologiesEnabled && dependencies.frameworkManager !== undefined) {
    registerMethodologyResources(server, dependencies);
    logger.debug('[Resources] Methodology resources registered');
  } else if (!methodologiesEnabled) {
    logger.debug('[Resources] Methodology resources disabled by config');
  } else {
    logger.warn('[Resources] FrameworkManager not available, skipping methodology resources');
  }

  // Observability (sessions + metrics)
  const observabilityEnabled = cfg.observability?.enabled !== false;
  const hasObservabilityDeps =
    dependencies.chainSessionManager !== undefined || dependencies.metricsCollector !== undefined;

  if (observabilityEnabled && hasObservabilityDeps) {
    registerObservabilityResources(server, dependencies);
    logger.debug('[Resources] Observability resources registered');
  } else if (!observabilityEnabled) {
    logger.debug('[Resources] Observability resources disabled by config');
  } else {
    logger.warn(
      '[Resources] Session/Metrics managers not available, skipping observability resources'
    );
  }

  logger.info('[Resources] MCP resources registration complete');
}

/**
 * Notify connected clients that resources have changed.
 * Call this after hot-reload events to prompt clients to refresh.
 *
 * @param server - The MCP server instance
 * @param logger - Logger for diagnostics
 */
export function notifyResourcesChanged(server: McpServer, logger: Logger): void {
  try {
    server.sendResourceListChanged();
    logger.debug('[Resources] Sent resource list changed notification');
  } catch (error) {
    logger.warn('[Resources] Failed to send resource list changed notification:', error);
  }
}
