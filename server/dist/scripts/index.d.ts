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
export type { ScriptToolDefinition, LoadedScriptTool, ScriptRuntime, JSONSchemaDefinition, TriggerType, ExecutionConfig, 
/**
 * @deprecated ExecutionMode is deprecated.
 * Use `trigger: explicit` instead of `mode: manual`,
 * and `confirm: true` instead of `mode: confirm`.
 */
ExecutionMode, ScriptExecutionRequest, ScriptExecutionResult, ToolDetectionMatch, ToolMatchReason, ScriptExecutorConfig, ScriptToolLoaderConfig, ScriptToolLoaderStats, ScriptInputValidationResult, ToolPendingConfirmation, ExecutionModeFilterResult, ConfirmationRequired, } from './types.js';
export { DEFAULT_EXECUTION_CONFIG } from './types.js';
export { ScriptToolYamlSchema, ScriptRuntimeSchema, ExecutionModeSchema, TriggerTypeSchema, ExecutionConfigSchema, validateScriptToolSchema, isValidScriptToolYaml, type ScriptToolYaml, type ScriptRuntimeYaml, type ExecutionModeYaml, type TriggerTypeYaml, type ExecutionConfigYaml, type ScriptToolSchemaValidationResult, } from './core/script-schema.js';
export { ScriptToolDefinitionLoader, createScriptToolDefinitionLoader, getDefaultScriptToolDefinitionLoader, resetDefaultScriptToolDefinitionLoader, } from './core/script-definition-loader.js';
export { WorkspaceScriptLoader, type WorkspaceScriptLoaderConfig, } from './core/workspace-script-loader.js';
export { ScriptExecutor, createScriptExecutor, getDefaultScriptExecutor, resetDefaultScriptExecutor, } from './execution/script-executor.js';
export { ExecutionModeService, createExecutionModeService, getDefaultExecutionModeService, resetDefaultExecutionModeService, type ExecutionModeServiceConfig, } from './execution/execution-mode-service.js';
export { ToolDetectionService, createToolDetectionService, getDefaultToolDetectionService, resetDefaultToolDetectionService, type ToolDetectionConfig, } from './detection/tool-detection-service.js';
export { createScriptHotReloadRegistration, isScriptToolFile, extractPromptDirFromPath, extractToolIdFromPath, type ScriptHotReloadRegistration, } from './hot-reload/script-hot-reload.js';
