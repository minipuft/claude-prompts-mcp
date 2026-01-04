// @lifecycle canonical - Types for unified resource manager.
/**
 * Unified Resource Manager Types
 *
 * Defines the types for the unified resource_manager MCP tool
 * that routes to prompt, gate, and methodology handlers.
 */
/**
 * Actions specific to certain resource types
 */
export const PROMPT_ONLY_ACTIONS = ['analyze_type', 'analyze_gates', 'guide'];
export const METHODOLOGY_ONLY_ACTIONS = ['switch'];
export const VERSIONING_ACTIONS = ['history', 'rollback', 'compare'];
export const COMMON_ACTIONS = [
    'create',
    'update',
    'delete',
    'list',
    'inspect',
    'reload',
    'history',
    'rollback',
    'compare',
];
//# sourceMappingURL=types.js.map