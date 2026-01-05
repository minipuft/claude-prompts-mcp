// @lifecycle canonical - Framework manager MCP tool for methodology CRUD operations.
/**
 * Framework Manager MCP Tool
 *
 * Provides lifecycle management for execution methodologies:
 * - create: Generate new methodology YAML + files
 * - update: Modify existing methodology configuration
 * - delete: Remove methodology directory
 * - list: List all available methodologies
 * - inspect: View methodology details
 * - reload: Hot-reload specific methodology
 * - switch: Change active framework
 */

export {
  ConsolidatedFrameworkManager,
  createConsolidatedFrameworkManager,
} from './core/manager.js';
export type {
  FrameworkManagerActionId,
  FrameworkManagerInput,
  FrameworkManagerDependencies,
} from './core/types.js';
export {
  MethodologyFileService,
  type MethodologyFileServiceDependencies,
  type ExistingMethodologyData,
  type MethodologyFileResult,
} from './services/index.js';
