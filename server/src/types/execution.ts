// @lifecycle canonical - Execution pipeline and MCP tool request type definitions.
/**
 * Execution System Types
 *
 * Centralized type definitions for the execution pipeline, including
 * MCP tool requests, validation, and execution context types.
 */

/** Scope for gate validation application */
export type GateScope = 'execution' | 'session' | 'chain' | 'step';

/** Custom validation check definition */
export interface CustomCheck {
  /** Unique name for validation check */
  readonly name: string;
  /** Human-readable description of what this check validates */
  readonly description: string;
}

/** Temporary gate payload accepted from MCP clients */
export type TemporaryGateInput =
  | string
  | {
      /** Optional identifier for referencing canonical gates */
      readonly id?: string;
      /** Inline criteria array */
      readonly criteria?: readonly string[];
      /** Alternate pass criteria wording */
      readonly pass_criteria?: readonly string[];
      /** Friendly name (defaults applied server-side) */
      readonly name?: string;
      /**
       * Gate type: 'validation' runs checks, 'guidance' only provides instructional text.
       */
      readonly type?: 'validation' | 'guidance';
      /** Desired scope for inline gate */
      readonly scope?: GateScope;
      /** Inline guidance or description */
      readonly guidance?: string;
      readonly description?: string;
      /**
       * Declared severity level for this gate.
       * @remarks Currently metadata-only. Used for logging, telemetry, and documentation.
       * Does NOT affect execution flow or enforcement behavior. Enforcement planned for future semantic layer.
       */
      readonly severity?: 'critical' | 'high' | 'medium' | 'low';
      /** Inline metadata */
      readonly context?: Record<string, unknown>;
      /** Source attribution */
      readonly source?: 'manual' | 'automatic' | 'analysis';
      /** Target specific step number in chain execution */
      readonly target_step_number?: number;
      /** Apply to multiple steps in chain execution */
      readonly apply_to_steps?: readonly number[];
    };

/**
 * Unified gate specification - accepts gate ID references, simple checks, or full definitions.
 *
 * This is the canonical parameter for specifying all types of gates (v3.0.0+).
 *
 * @example
 * // Reference existing gates by ID
 * gates: ["toxicity", "traceability"]
 *
 * @example
 * // Simple inline validation
 * gates: [{name: "production-ready", description: "Include tests and error handling"}]
 *
 * @example
 * // Full gate definition with criteria
 * gates: [{
 *   id: "security-review",
 *   type: "validation",
 *   criteria: ["No hardcoded secrets", "Input validation present"],
 *   severity: "high"
 * }]
 *
 * @example
 * // Mixed usage
 * gates: [
 *   "toxicity",  // Reference canonical gate
 *   {name: "custom-check", description: "Verify edge cases"},  // Simple check
 *   {template: "security-awareness", severity: "critical"}  // Template reference with override
 * ]
 *
 * @since 2.0.0 (Unified parameter introduced)
 * @since 3.0.0 (Became the only parameter for gate specification)
 */
export type GateSpecification =
  | string // Simple gate ID reference (e.g., "toxicity")
  | CustomCheck // Simple inline check with name and description
  | TemporaryGateInput; // Full gate definition with all options

/**
 * MCP Tool Request interface for prompt execution.
 *
 * This interface defines the structure for all requests to MCP tools,
 * ensuring type safety and validation across the execution pipeline.
 */
export interface McpToolRequest {
  /** Primary command to execute. Optional when providing chain-only responses. */
  readonly command?: string;

  /** Chain identifier (chain-{promptId} or chain-{promptId}#runNumber) for resuming executions */
  readonly chain_id?: string;

  /** Gate review verdict for resuming from pending validation */
  readonly gate_verdict?: string;

  /**
   * User action when retry limit is exceeded.
   * - 'retry': Reset attempt count and try again
   * - 'skip': Skip the gate check and continue chain
   * - 'abort': Stop chain execution entirely
   * @since 2.1.0
   */
  readonly gate_action?: 'retry' | 'skip' | 'abort';

  /** User response to previous chain step for advancing execution */
  readonly user_response?: string;

  /** Force chain restart from beginning, clearing existing state */
  readonly force_restart?: boolean;

  /**
   * Unified gate specifications.
   *
   * Accepts mixed array of:
   * - Gate ID strings (e.g., "toxicity")
   * - Simple checks ({name, description})
   * - Full gate definitions (with criteria, severity, etc.)
   *
   * @example
   * gates: ["toxicity", {name: "test-coverage", description: "Include unit tests"}]
   */
  readonly gates?: readonly GateSpecification[];

  /** Additional execution options forwarded to downstream stages */
  readonly options?: Record<string, unknown>;
}
