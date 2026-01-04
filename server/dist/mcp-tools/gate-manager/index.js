// @lifecycle canonical - Gate manager MCP tool for gate CRUD operations.
/**
 * Gate Manager MCP Tool
 *
 * Provides lifecycle management for quality gates:
 * - create: Generate new gate YAML + guidance files
 * - update: Modify existing gate configuration
 * - delete: Remove gate directory
 * - list: List all registered gates
 * - inspect: View gate details
 * - reload: Hot-reload specific gate
 */
export { ConsolidatedGateManager, createConsolidatedGateManager } from './core/manager.js';
//# sourceMappingURL=index.js.map