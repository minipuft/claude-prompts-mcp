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
export { ConsolidatedFrameworkManager, createConsolidatedFrameworkManager, } from './core/manager.js';
export { MethodologyFileService, } from './services/index.js';
//# sourceMappingURL=index.js.map