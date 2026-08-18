// @lifecycle canonical - Re-exports from shared/types/automation.ts (cross-layer contract types).
/**
 * Script Tools Type Definitions
 *
 * Canonical definitions live in shared/types/automation.ts.
 * This barrel re-exports so modules/automation/ consumers can continue importing from here.
 * Direction: modules/ → shared/ (legal downward dependency).
 */
export {
  DEFAULT_EXECUTION_CONFIG,
  type ConfirmationRequired,
  type ExecutionConfig,
  type ToolTriggerFilterResult,
  type JSONSchemaDefinition,
  type LoadedScriptTool,
  type ScriptExecutionRequest,
  type ScriptExecutionResult,
  type ScriptExecutorConfig,
  type ScriptInputValidationResult,
  type ScriptRuntime,
  type ScriptToolDefinition,
  type ScriptToolLoaderConfig,
  type ScriptToolLoadFailure,
  type ScriptToolLoadReport,
  type ScriptToolLoaderStats,
  type ToolDetectionMatch,
  type ToolMatchReason,
  type ToolPendingConfirmation,
  type TriggerType,
} from '#shared/types/automation.js';
