// @lifecycle canonical - Execution pipeline and MCP tool request type definitions.
/**
 * Execution System Types
 *
 * Centralized type definitions for the execution pipeline, including
 * MCP tool requests, validation, and execution context types.
 */

/** Execution mode for prompt processing */
export type ExecutionMode = 'auto' | 'prompt' | 'template' | 'chain';

/** Scope for gate validation application */
export type GateScope = 'execution' | 'session' | 'chain' | 'step';

/** Custom validation check definition */
export interface CustomCheck {
  /** Unique name for validation check */
  readonly name: string;
  /** Human-readable description of what this check validates */
  readonly description: string;
}

/** Temporary gate definition for inline validation */
export interface TemporaryGateDefinition {
  /** Gate identifier */
  readonly id: string;
  /** Validation criteria */
  readonly criteria: readonly string[];
  /** Severity level */
  readonly severity?: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * MCP Tool Request interface for prompt execution.
 *
 * This interface defines the structure for all requests to MCP tools,
 * ensuring type safety and validation across the execution pipeline.
 */
export interface McpToolRequest {
  /** Primary command to execute. Optional when providing session-only responses. */
  readonly command?: string;

  /** @deprecated Session IDs are archival only and rejected by prompt_engine requests */
  readonly session_id?: never;

/** Chain identifier (chain-{promptId} or chain-{promptId}#runNumber) for resuming executions */
  readonly chain_id?: string;

  /** Gate review verdict for resuming from pending validation */
  readonly gate_verdict?: string;

  /** User response to previous chain step for advancing execution */
  readonly user_response?: string;

  /** Force chain restart from beginning, clearing existing state */
  readonly force_restart?: boolean;

  /** Execution mode override for intelligent auto-detection */
  readonly execution_mode?: ExecutionMode;

  /** Enable API-driven validation hand-off (defaults to disabled) */
  readonly api_validation?: boolean;

  /** Specific quality gates to apply by ID */
  readonly quality_gates?: readonly string[];

  /** Custom validation checks to apply */
  readonly custom_checks?: readonly CustomCheck[];

  /** Temporary gate definitions for inline validation */
  readonly temporary_gates?: readonly TemporaryGateDefinition[];

  /** Scope for gate validation application */
  readonly gate_scope?: GateScope;

  /** Execution timeout override in milliseconds */
  readonly timeout?: number;

  /** Additional execution options forwarded to downstream stages */
  readonly options?: Record<string, unknown>;
}
