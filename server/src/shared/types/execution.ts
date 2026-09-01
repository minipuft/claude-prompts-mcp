// @lifecycle canonical - Execution pipeline and MCP tool request type definitions.
/**
 * Execution System Types
 *
 * Centralized type definitions for the execution pipeline, including
 * MCP tool requests, validation, and execution context types.
 */

import type { RemainderSubmission, WorkflowIR } from '#modules/workflow-ir/types.js';
import type { UnknownObservation } from './chain-session.js';

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
      /**
       * Target a specific step by its stable node id (kebab-case, or `nK` for symbolic chains).
       * Sibling of `target_step_number`, not a replacement — a gate may carry either, and the
       * registrar fills in whichever was not supplied.
       */
      readonly target_step_id?: string;
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

  /** Chain identifier for resuming executions. Format owned by `shared/utils/chain-id-codec`. */
  readonly chain_id?: string;

  /** Gate review verdict for resuming from pending validation */
  readonly gate_verdict?: string;

  /**
   * The verb a caller uses to resolve a run that is holding. Two disjoint vocabularies share one
   * parameter, and which one applies is decided by WHAT the run is holding on:
   *
   * - retry-limit exhaustion (`GateAction`): 'retry' resets the attempt count, 'skip' passes the
   *   failed gate, 'abort' stops the run.
   * - a mid-chain blocking-unknown interrupt ({@link InterruptResolutionAction}): 'resume'
   *   acknowledges the unknown and issues the investigation step, 'accept_alternative' takes the
   *   `remainder` submitted in the SAME call. Both are refused by name anywhere else — on an
   *   ordinary gate review and on a run with nothing pending — so the union never becomes a
   *   grab-bag whose members mean whatever the current state allows.
   *
   * 'abort' belongs to both, deliberately: stopping the run means the same thing either way, and
   * a second spelling of it would be a synonym a client has to choose between.
   *
   * @since 2.1.0
   */
  readonly gate_action?: 'retry' | 'skip' | 'abort' | 'resume' | 'accept_alternative';

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

  /**
   * Typed prompt arguments supplied outside the command-string grammar.
   * Inline command arguments take precedence when the same key is present.
   */
  readonly inputs?: Record<string, unknown>;

  /**
   * Typed unknowns discovered/resolved by the current step, feeding the
   * per-run unknowns ledger. Tier 1/2: threaded through unchanged; not yet
   * consumed by the pipeline (lands in Tier 3).
   */
  readonly observations?: readonly UnknownObservation[];

  /**
   * A planner-submitted Workflow IR (P6 Tier 5) — the third command source, beside a command
   * string and a chain resume. Mutually exclusive with `command` and `chain_id`: a request
   * carrying more than one is a typed rejection, not a precedence puzzle.
   *
   * Typed by direct reference to `modules/workflow-ir/` rather than restated structurally here.
   * The restatement would be a fifth hand-maintained copy of a shape that already has four
   * (P6-F8), and the shape is the Zod schema's SSOT — a divergent copy in `shared/` would be
   * invisible to `tsc` on the one path that matters. The import is type-only, so it lands under
   * `shared-cross-layer-type-only` (warn, tracked) and not the value-import error.
   */
  readonly workflow?: WorkflowIR;

  /**
   * A model-authored rewrite of the rest of a RUNNING chain (OQ-3), accepted only alongside
   * `chain_id` and only while a blocking unknown is open on the run's ledger (or the synthetic
   * `__unknown_interrupt__` review is pending). Applied by `RemainderProcessor` in stage 16.
   *
   * Typed by direct reference for the reason `workflow` above is, and it is the SAME vocabulary:
   * a remainder's nodes are IR nodes, so a caller can copy `chain_interrupt.remaining_nodes`
   * straight back into one. Type-only import, `shared-cross-layer-type-only` (warn, tracked).
   */
  readonly remainder?: RemainderSubmission;

  /** Raw MCP SDK extra payload (authInfo, headers, sessionId) captured at tool boundary */
  readonly _extra?: Record<string, unknown>;
}
