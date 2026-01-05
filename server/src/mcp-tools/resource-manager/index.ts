// @lifecycle canonical - Unified resource manager MCP tool.
/**
 * Resource Manager MCP Tool
 *
 * Unified CRUD operations for prompts, gates, and methodologies.
 * Routes requests based on resource_type parameter.
 */
export { ResourceManagerRouter, createResourceManagerRouter } from './core/router.js';
export type {
  ResourceType,
  ResourceAction,
  ResourceManagerInput,
  ResourceManagerDependencies,
} from './core/types.js';
