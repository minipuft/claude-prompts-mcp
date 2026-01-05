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

// ============================================
// Type Exports
// ============================================

export type {
  // Core definitions
  ScriptToolDefinition,
  LoadedScriptTool,
  ScriptRuntime,
  JSONSchemaDefinition,
  // Execution configuration types
  TriggerType,
  ExecutionConfig,
  /**
   * @deprecated ExecutionMode is deprecated.
   * Use `trigger: explicit` instead of `mode: manual`,
   * and `confirm: true` instead of `mode: confirm`.
   */
  ExecutionMode,
  // Execution types
  ScriptExecutionRequest,
  ScriptExecutionResult,
  // Detection types
  ToolDetectionMatch,
  ToolMatchReason,
  // Configuration types
  ScriptExecutorConfig,
  ScriptToolLoaderConfig,
  ScriptToolLoaderStats,
  // Validation types
  ScriptInputValidationResult,
  // Execution mode service types
  ToolPendingConfirmation,
  ExecutionModeFilterResult,
  ConfirmationRequired,
} from './types.js';

export { DEFAULT_EXECUTION_CONFIG } from './types.js';

// ============================================
// Core Exports (Phase 2)
// ============================================

// Schema and validation
export {
  ScriptToolYamlSchema,
  ScriptRuntimeSchema,
  ExecutionModeSchema,
  TriggerTypeSchema,
  ExecutionConfigSchema,
  validateScriptToolSchema,
  isValidScriptToolYaml,
  type ScriptToolYaml,
  type ScriptRuntimeYaml,
  type ExecutionModeYaml,
  type TriggerTypeYaml,
  type ExecutionConfigYaml,
  type ScriptToolSchemaValidationResult,
} from './core/script-schema.js';

// Definition loader
export {
  ScriptToolDefinitionLoader,
  createScriptToolDefinitionLoader,
  getDefaultScriptToolDefinitionLoader,
  resetDefaultScriptToolDefinitionLoader,
} from './core/script-definition-loader.js';

// Workspace script loader (unified loader for prompt-local and workspace scripts)
export {
  WorkspaceScriptLoader,
  type WorkspaceScriptLoaderConfig,
} from './core/workspace-script-loader.js';

// ============================================
// Execution Exports (Phase 3)
// ============================================

export {
  ScriptExecutor,
  createScriptExecutor,
  getDefaultScriptExecutor,
  resetDefaultScriptExecutor,
} from './execution/script-executor.js';

// Execution mode service
export {
  ExecutionModeService,
  createExecutionModeService,
  getDefaultExecutionModeService,
  resetDefaultExecutionModeService,
  type ExecutionModeServiceConfig,
} from './execution/execution-mode-service.js';

// ============================================
// Detection Exports (Phase 4)
// ============================================

export {
  ToolDetectionService,
  createToolDetectionService,
  getDefaultToolDetectionService,
  resetDefaultToolDetectionService,
  type ToolDetectionConfig,
} from './detection/tool-detection-service.js';

// ============================================
// Hot-Reload Exports (Phase 6)
// ============================================

export {
  createScriptHotReloadRegistration,
  isScriptToolFile,
  extractPromptDirFromPath,
  extractToolIdFromPath,
  type ScriptHotReloadRegistration,
} from './hot-reload/script-hot-reload.js';
