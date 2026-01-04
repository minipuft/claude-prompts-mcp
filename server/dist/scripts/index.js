// @lifecycle canonical - Public exports for the scripts subsystem.
/**
 * Script Tools Subsystem
 *
 * Provides prompt-scoped script tool functionality, enabling prompts to declare
 * and execute external scripts that enhance template rendering.
 *
 * ## Architecture Overview
 *
 * ```
 * prompts/{category}/{prompt_id}/
 * ├── prompt.yaml           # tools: [tool_id, ...]
 * └── tools/
 *     └── {tool_id}/
 *         ├── tool.yaml     # Script configuration
 *         ├── schema.json   # Input JSON Schema
 *         ├── description.md
 *         └── script.py     # Executable
 * ```
 *
 * ## Usage Flow
 *
 * 1. Prompt declares tools in prompt.yaml
 * 2. ScriptToolDefinitionLoader loads tool definitions alongside prompts
 * 3. ToolDetectionService matches user input to available tools
 * 4. ScriptExecutor runs matched scripts via subprocess
 * 5. Script output enriches template context as {{tool_X}}
 *
 * @see plans/script-tools-implementation.md for full implementation plan
 */
export { DEFAULT_EXECUTION_CONFIG } from './types.js';
// ============================================
// Core Exports (Phase 2)
// ============================================
// Schema and validation
export { ScriptToolYamlSchema, ScriptRuntimeSchema, ExecutionModeSchema, TriggerTypeSchema, ExecutionConfigSchema, validateScriptToolSchema, isValidScriptToolYaml, } from './core/script-schema.js';
// Definition loader
export { ScriptToolDefinitionLoader, createScriptToolDefinitionLoader, getDefaultScriptToolDefinitionLoader, resetDefaultScriptToolDefinitionLoader, } from './core/script-definition-loader.js';
// Workspace script loader (unified loader for prompt-local and workspace scripts)
export { WorkspaceScriptLoader, } from './core/workspace-script-loader.js';
// ============================================
// Execution Exports (Phase 3)
// ============================================
export { ScriptExecutor, createScriptExecutor, getDefaultScriptExecutor, resetDefaultScriptExecutor, } from './execution/script-executor.js';
// Execution mode service
export { ExecutionModeService, createExecutionModeService, getDefaultExecutionModeService, resetDefaultExecutionModeService, } from './execution/execution-mode-service.js';
// ============================================
// Detection Exports (Phase 4)
// ============================================
export { ToolDetectionService, createToolDetectionService, getDefaultToolDetectionService, resetDefaultToolDetectionService, } from './detection/tool-detection-service.js';
// ============================================
// Hot-Reload Exports (Phase 6)
// ============================================
export { createScriptHotReloadRegistration, isScriptToolFile, extractPromptDirFromPath, extractToolIdFromPath, } from './hot-reload/script-hot-reload.js';
//# sourceMappingURL=index.js.map