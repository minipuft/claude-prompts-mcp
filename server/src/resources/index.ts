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
 * @param server - The MCP server instance
 * @param dependencies - Singleton manager references for data access
 */
export function registerResources(server: McpServer, dependencies: ResourceDependencies): void {
  const { logger } = dependencies;

  logger.info('[Resources] Registering MCP resources...');

  // Phase 1: Prompts and Gates
  if (dependencies.promptManager !== undefined) {
    registerPromptResources(server, dependencies);
    logger.debug('[Resources] Prompt resources registered');
  } else {
    logger.warn('[Resources] PromptManager not available, skipping prompt resources');
  }

  if (dependencies.gateManager !== undefined) {
    registerGateResources(server, dependencies);
    logger.debug('[Resources] Gate resources registered');
  } else {
    logger.warn('[Resources] GateManager not available, skipping gate resources');
  }

  // Phase 2: Methodologies and Observability
  if (dependencies.frameworkManager !== undefined) {
    registerMethodologyResources(server, dependencies);
    logger.debug('[Resources] Methodology resources registered');
  } else {
    logger.warn('[Resources] FrameworkManager not available, skipping methodology resources');
  }

  if (
    dependencies.chainSessionManager !== undefined ||
    dependencies.metricsCollector !== undefined
  ) {
    registerObservabilityResources(server, dependencies);
    logger.debug('[Resources] Observability resources registered');
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
