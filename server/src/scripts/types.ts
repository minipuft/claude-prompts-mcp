// @lifecycle canonical - Type definitions for prompt-scoped script tools.
/**
 * Script Tools Type Definitions
 *
 * Contains all types related to prompt-scoped script tool execution.
 * Script tools allow prompts to declare external executable scripts that
 * enhance template rendering with computed results.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */

/**
 * JSON Schema type reference for script input/output validation.
 * Using a simplified representation - full JSON Schema Draft-07 support.
 */
export interface JSONSchemaDefinition {
  $schema?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchemaDefinition>;
  items?: JSONSchemaDefinition | JSONSchemaDefinition[];
  required?: string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchemaDefinition;
  oneOf?: JSONSchemaDefinition[];
  anyOf?: JSONSchemaDefinition[];
  allOf?: JSONSchemaDefinition[];
  $ref?: string;
  definitions?: Record<string, JSONSchemaDefinition>;
  $defs?: Record<string, JSONSchemaDefinition>;
}

/**
 * Runtime environment for script execution.
 * - python: Execute with python3 interpreter
 * - node: Execute with Node.js runtime
 * - shell: Execute as shell script (bash/sh)
 * - auto: Auto-detect from file extension
 */
export type ScriptRuntime = 'python' | 'node' | 'shell' | 'auto';

/**
 * @deprecated ExecutionMode is deprecated. Use `trigger: explicit` instead of
 * `mode: manual`, and `confirm: true` instead of `mode: confirm`.
 * This type alias is preserved only for backwards compatibility during migration.
 */
export type ExecutionMode = 'auto' | 'manual' | 'confirm';

/**
 * Trigger type for tool execution (deterministic, not probabilistic).
 *
 * Modern automation systems use deterministic triggers, not confidence scores.
 * - schema_match: Execute when user args validate against schema (default)
 * - explicit: Execute only when user writes tool:<id>
 * - always: Execute on every prompt run regardless of args
 * - never: Tool is defined but intentionally disabled
 *
 * @deprecated 'parameter_match' is deprecated, use 'schema_match' instead.
 */
export type TriggerType = 'schema_match' | 'explicit' | 'always' | 'never';

/**
 * Execution configuration for script tools.
 *
 * Controls when and how a script tool executes during prompt processing.
 * Uses deterministic trigger types (not probabilistic confidence scores).
 *
 * @example
 * ```yaml
 * execution:
 *   trigger: schema_match
 *   confirm: true
 *   confirmMessage: "Run expensive analysis on the dataset?"
 * ```
 */
export interface ExecutionConfig {
  /** Trigger type (default: 'schema_match') */
  trigger: TriggerType;
  /**
   * Require confirmation before execution (default: true)
   * When true, tool detection returns a confirmation prompt before executing.
   * User can bypass confirmation with explicit tool:<id> arg.
   * Set to false explicitly for tools with no side effects.
   */
  confirm?: boolean;
  /**
   * Strict matching mode (default: false)
   * - false: Match if ANY required param is present and valid
   * - true: Match only if ALL required params are present and valid
   */
  strict?: boolean;
  /** Custom confirmation message (shown when confirm: true) */
  confirmMessage?: string;
  /**
   * Auto-approve execution when script validation passes (default: false)
   *
   * When true, the script is executed for validation first. If the script
   * returns `valid: true` with no warnings, confirmation is bypassed and
   * auto_execute proceeds automatically.
   *
   * Behavior based on script output:
   * - valid: true + no warnings → auto-approve, proceed to auto_execute
   * - valid: true + warnings → show warnings, still proceed to auto_execute
   * - valid: false → show errors, block execution
   *
   * This is ideal for resource creation tools where the user has already
   * provided all required data and the script performs comprehensive validation.
   */
  autoApproveOnValid?: boolean;
}

/**
 * Script tool definition as stored in tool.yaml files.
 *
 * Defines the metadata and configuration for an executable script
 * that can be invoked by a prompt during execution.
 *
 * @example
 * ```yaml
 * # tools/analyze_csv/tool.yaml
 * id: analyze_csv
 * name: CSV Analyzer
 * runtime: python
 * script: script.py
 * timeout: 30000
 * ```
 */
export interface ScriptToolDefinition {
  /** Unique tool ID (must match directory name) */
  id: string;
  /** Human-readable name for the tool */
  name: string;
  /** Description of what this tool does (loaded from description.md) */
  description: string;
  /** Path to executable script (relative to tool directory) */
  scriptPath: string;
  /** Runtime to use for execution (default: 'auto') */
  runtime?: ScriptRuntime;
  /** JSON Schema defining input parameters */
  inputSchema: JSONSchemaDefinition;
  /** JSON Schema for output validation (optional) */
  outputSchema?: JSONSchemaDefinition;
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Environment variables to pass to the script */
  env?: Record<string, string>;
  /** Working directory relative to tool directory */
  workingDir?: string;
  /** Whether this tool is enabled (default: true) */
  enabled?: boolean;
  /** Execution control configuration (mode, trigger, strict) */
  execution?: ExecutionConfig;
}

/**
 * Loaded script tool with resolved paths and cached content.
 *
 * Extends ScriptToolDefinition with runtime-resolved information
 * after loading from disk.
 */
export interface LoadedScriptTool extends ScriptToolDefinition {
  /** Absolute path to the tool directory */
  toolDir: string;
  /** Absolute path to the executable script */
  absoluteScriptPath: string;
  /** ID of the parent prompt that owns this tool */
  promptId: string;
  /** Inlined description content from description.md */
  descriptionContent: string;
}

/**
 * Request to execute a script tool.
 *
 * Passed to the ScriptExecutor service for execution.
 */
export interface ScriptExecutionRequest {
  /** ID of the tool to execute */
  toolId: string;
  /** ID of the parent prompt */
  promptId: string;
  /** Input parameters matching the tool's inputSchema */
  inputs: Record<string, unknown>;
  /** Optional timeout override in milliseconds */
  timeout?: number;
  /** Optional environment variable overrides */
  env?: Record<string, string>;
}

/**
 * Result of script tool execution.
 *
 * Contains the execution outcome including output, timing, and error info.
 */
export interface ScriptExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Parsed output from the script (JSON if parseable, string otherwise) */
  output: unknown;
  /** Raw stdout from the process */
  stdout: string;
  /** Raw stderr from the process */
  stderr: string;
  /** Process exit code */
  exitCode: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Detection match reason types.
 * - name_match: Tool ID found in user input or explicit tool:<id> arg
 * - schema_match: User args validate against tool's required schema parameters
 * - always_match: Tool has trigger: 'always' configuration
 */
export type ToolMatchReason = 'name_match' | 'schema_match' | 'always_match';

/**
 * Result of tool detection matching.
 *
 * Returned by ToolDetectionService when analyzing user input
 * to determine which tools should be invoked.
 *
 * Note: Uses deterministic binary matching. The `priority` field
 * is for sorting (1.0 = explicit/always, 0.9 = full schema match,
 * 0.8 = partial schema match), NOT a fuzzy probability score.
 */
export interface ToolDetectionMatch {
  /** ID of the matched tool */
  toolId: string;
  /** ID of the parent prompt */
  promptId: string;
  /**
   * Match priority for sorting (1.0 = highest priority).
   * This is deterministic priority, not probabilistic confidence.
   * - 1.0: Explicit request (tool:<id>) or trigger: 'always'
   * - 0.9: Full schema match (all required params present)
   * - 0.8: Partial schema match (strict: false, some params present)
   */
  priority: number;
  /** Reason for the match */
  matchReason: ToolMatchReason;
  /** Extracted input parameters for the tool */
  extractedInputs: Record<string, unknown>;
  /** Which schema parameters were matched */
  matchedParams?: string[];
  /** Which required parameters are missing (for diagnostics) */
  missingParams?: string[];
  /** Whether this tool requires confirmation before execution */
  requiresConfirmation?: boolean;
  /** Whether this match was from explicit user request (tool:<id> arg) */
  explicitRequest?: boolean;
}

/**
 * Configuration for the ScriptExecutor service.
 */
export interface ScriptExecutorConfig {
  /** Default timeout in milliseconds (default: 30000) */
  defaultTimeout?: number;
  /** Maximum allowed timeout in milliseconds (default: 300000 = 5min) */
  maxTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Base environment variables for all scripts */
  baseEnv?: Record<string, string>;
}

/**
 * Configuration for the ScriptToolDefinitionLoader.
 */
export interface ScriptToolLoaderConfig {
  /** Enable caching of loaded definitions (default: true) */
  enableCache?: boolean;
  /** Validate definitions on load (default: true) */
  validateOnLoad?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Statistics from the script tool loader.
 */
export interface ScriptToolLoaderStats {
  /** Number of cached definitions */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
}

/**
 * Validation result for script tool inputs.
 */
export interface ScriptInputValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Coerced/normalized inputs */
  normalizedInputs?: Record<string, unknown>;
}

// ============================================================================
// Execution Mode Service Types
// ============================================================================

/**
 * Tool pending confirmation before execution.
 */
export interface ToolPendingConfirmation {
  /** Tool ID */
  toolId: string;
  /** Tool name for display */
  toolName: string;
  /** Confirmation message */
  message: string;
  /** Command to resume with explicit execution */
  resumeCommand: string;
  /** Parameters that were detected/matched */
  matchedParams?: string[];
  /** Extracted input values for display */
  extractedInputs?: Record<string, unknown>;
}

/**
 * Result of execution mode filtering.
 *
 * Returned by ExecutionModeService when filtering tool matches by execution mode.
 */
export interface ExecutionModeFilterResult {
  /** Tools ready for immediate execution (mode: auto, matched successfully) */
  readyForExecution: ToolDetectionMatch[];
  /** Tools skipped due to mode: manual (without explicit request) */
  skippedManual: string[];
  /** Tools requiring user confirmation (mode: confirm) */
  pendingConfirmation: ToolPendingConfirmation[];
  /** Whether pipeline should return early for confirmation */
  requiresConfirmation: boolean;
}

/**
 * Confirmation response structure for confirm mode tools.
 *
 * Returned when tools require user confirmation before execution.
 */
export interface ConfirmationRequired {
  /** Response type identifier */
  type: 'confirmation_required';
  /** Tools awaiting confirmation */
  tools: ToolPendingConfirmation[];
  /** Command example to proceed with execution */
  resumeCommand: string;
  /** Human-readable message */
  message: string;
}

/**
 * Default execution configuration values.
 * Applied when tool.yaml doesn't specify execution block.
 *
 * Uses deterministic trigger system (not probabilistic confidence).
 * Confirmation is required by default (secure by default).
 */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  trigger: 'schema_match',
  confirm: true,
  strict: false,
};
