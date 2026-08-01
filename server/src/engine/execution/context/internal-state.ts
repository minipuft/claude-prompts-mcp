// @lifecycle canonical - Defines internal execution context state contracts.
import type {
  ConfirmationRequired,
  RequestIdentityContext,
  ScriptExecutionResult,
  ToolResponse,
} from '#shared/types/index.js';
import type { RequestIdentitySource } from '#shared/types/request-identity.js';
import type { PendingShellVerification, ShellVerifyResult } from '../../gates/shell/index.js';
import type { GateEnforcementMode } from '../../gates/types.js';
import type { InjectionState } from '../pipeline/decisions/injection/index.js';

/**
 * Cleanup handler function type for lifecycle management.
 */
export type CleanupHandler = () => void | Promise<void>;

/**
 * Typed internal state for the execution pipeline.
 */
export interface PipelineInternalState {
  /**
   * State related to execution lifecycle management.
   */
  lifecycle: {
    /** Timestamp when pipeline execution started */
    startTimestamp?: number;
    /** Unique metric ID for this execution */
    metricId?: string;
    /** Cleanup handlers registered during execution */
    cleanupHandlers?: CleanupHandler[];
  };
  /**
   * State related to modular injection control.
   * Controls when system prompts, gate guidance, and style guidance are injected.
   * @see injection/types.ts for InjectionState definition
   */
  injection: InjectionState;

  /**
   * State related to the Two-Phase Judge Selection and Framework Resolution.
   */
  framework: {
    /** Explicit framework override selected by the client (Judge Phase) */
    clientOverride?: string;
    /** Gate IDs selected by the client (Judge Phase) */
    clientSelectedGates?: string[];
    /** Style ID selected by the client (Judge Phase) */
    clientSelectedStyle?: string;
    /** Whether the judge selection phase was triggered */
    judgePhaseTriggered: boolean;
    /** Whether style guidance has been applied */
    styleEnhancementApplied: boolean;
    /** Coordination flag to prevent duplicate system prompt injection */
    systemPromptApplied?: boolean;
    /** The specific style guidance text applied */
    selectedStyleGuidance?: string;
    /** Results from prompt guidance service, keyed by prompt ID */
    guidanceResults?: Record<string, unknown>;
  };

  /**
   * State related to Request Normalization and Command Canonicalization.
   */
  normalization: {
    /** Whether the normalization stage has completed successfully */
    completed: boolean;
    /** Whether this is a canonical pipeline execution */
    isCanonical: boolean;
    /** The final normalized command string */
    normalizedCommand?: string;
    /** Request-level options passed through */
    requestOptions?: Record<string, unknown>;
  };

  /**
   * State related to Session Lifecycle and Continuity.
   */
  session: {
    /** ID of the session being resumed */
    resumeSessionId?: string;
    /** ID of the chain being resumed */
    resumeChainId?: string;
    /** Whether a previous execution blueprint was restored */
    isBlueprintRestored: boolean;
    /** Whether this is an explicit chain resume operation */
    isExplicitChainResume: boolean;
    /** The decision made by the lifecycle manager (e.g., 'create-new', 'resume') */
    lifecycleDecision?: string;
    /** ID of the current execution scope */
    executionScopeId?: string;
    /** Whether the session/chain has been aborted by user choice */
    aborted?: boolean;
    /** Whether the chain has already advanced past the final step */
    chainComplete?: boolean;
    /** Chain variables for template rendering (from ChainSessionStore) */
    chainContext?: Record<string, unknown>;
  };

  /**
   * State related to Request Identity and Scope Resolution.
   * Populated by IdentityResolutionStage from MCP SDK extra payload.
   */
  identity: {
    /** Whether identity resolution has completed */
    resolved: boolean;
    /** Full identity context (workspace, organization, provenance) */
    context?: RequestIdentityContext;
    /** Composite scope ID for state store isolation (e.g., "org:ws" or "default") */
    continuityScopeId: string;
  };

  /**
   * State related to Continuity Scope (tenant isolation).
   * Populated by IdentityResolutionStage, consumed by state managers.
   */
  scope: {
    /** Resolved continuity scope ID (workspace → organization → 'default') */
    continuityScopeId: string;
    /** Source of the scope value */
    source: RequestIdentitySource | 'default';
  };

  /**
   * State related to Gates and Validation.
   */
  gates: {
    /** Gate overrides requested in the input payload */
    requestedOverrides?: {
      llmValidation?: boolean;
      gates?: unknown[];
      [key: string]: unknown;
    };
    /** IDs of temporary gates created for this execution */
    temporaryGateIds: string[];
    /** Scopes for temporary gates */
    temporaryGateScopes?: Array<{ scope: string; scopeId: string }>;
    /** Validation results from the gate system */
    validationResults?: unknown[];
    /** IDs of framework-specific gates registered for this execution */
    frameworkGateIds: string[];
    /** IDs of canonical gates that were resolved from temporary inputs */
    canonicalGateIdsFromTemporary: string[];
    /** IDs of inline gates registered during extraction */
    registeredInlineGateIds: string[];
    /** Whether the gate retry limit has been exceeded */
    retryLimitExceeded?: boolean;
    /** Gate IDs that have exhausted their retry attempts */
    retryExhaustedGateIds?: string[];
    /**
     * Advisory warnings from non-blocking failures (pipeline-level display bucket).
     * Writers: GateVerdictProcessor (advisory-mode failures), PhaseGuardVerificationStage (warn-mode).
     * Reader: ResponseAssembler (formatting layer).
     */
    advisoryWarnings: string[];
    /** Resolved enforcement mode for the current gate set (most restrictive wins) */
    enforcementMode?: GateEnforcementMode;
    /** Whether user choice is being awaited after retry exhaustion */
    awaitingUserChoice?: boolean;
    /** Which subsystem triggered the escalation (retry exhaustion). */
    escalationSource?: 'gate-review' | 'shell-verify';
    /** Accumulated gate IDs from enhancement stage for downstream use */
    accumulatedGateIds?: string[];
    /** Whether blocking gates are present that require review */
    hasBlockingGates?: boolean;
    /**
     * Whether response content should be blocked due to gate failure.
     * Set when a gate with blockResponseOnFail: true receives a FAIL verdict.
     */
    responseBlocked?: boolean;
    /**
     * Gate IDs that triggered response blocking.
     * These are gates with blockResponseOnFail: true that received FAIL verdicts.
     */
    blockedGateIds?: string[];
    /** Parsed verdict detection metadata from gate review processing */
    verdictDetection?: {
      verdict: 'PASS' | 'FAIL';
      source: 'gate_verdict' | 'user_response';
      rationale?: string;
      pattern?: string;
      outcome?: string;
    };
    /**
     * Set by Stage 08 when a verdict clears a phase-guard-created review.
     * Stage 09b checks this to skip re-evaluation on the same request turn.
     */
    phaseGuardReviewCleared?: boolean;
    /**
     * Pending shell verification gate for Ralph Wiggum loop execution.
     * Tracks command, attempt count, and previous results across iterations.
     */
    pendingShellVerification?: PendingShellVerification;
    /**
     * Results from shell verification command executions.
     * Accumulated across multiple attempts for diagnostic display.
     */
    shellVerifyResults?: ShellVerifyResult[];
    /**
     * Formatted feedback from shell verification for downstream stages.
     * Includes bounce-back messages and escalation prompts.
     */
    shellVerifyFeedback?: {
      type: 'bounce_back' | 'escalation';
      message: string;
    };
    /**
     * Gate IDs whose shell_verify criteria passed (exit 0) during Stage 08b.
     * Downstream stages (10) use this to auto-clear gate reviews for these gates.
     */
    shellVerifyPassedForGates?: string[];
    /**
     * Per-gate verdicts parsed from the GATE_VERDICTS block in gate_verdict.
     * Extracted alongside the overall verdict for granular delivery tracking.
     */
    perGateVerdicts?: Array<{ index: number; passed: boolean; rationale: string }>;
  };

  /**
   * State related to Script Tool Execution.
   * Holds results from script tools executed during pipeline processing.
   */
  scripts?: ScriptState;
}

/**
 * Full script state with optional fields.
 * Use InitializedScriptState when accessing via ensureScriptState().
 */
export interface ScriptState {
  /** Results from executed script tools, keyed by tool ID */
  results?: Map<string, ScriptExecutionResult>;
  /** Results from auto-executed MCP tools, keyed by script tool ID */
  autoExecuteResults?: Map<string, ToolResponse>;
  /** Tool IDs skipped due to mode: manual (without explicit request) */
  toolsSkipped?: string[];
  /** Tool IDs awaiting user confirmation (mode: confirm) */
  toolsPendingConfirmation?: string[];
  /** Structured confirmation response when tools require user approval */
  confirmationRequired?: ConfirmationRequired;
  /**
   * Validation errors from script tools with autoApproveOnValid: true.
   * When validation fails (valid: false), these errors are captured
   * and the auto_execute is blocked.
   */
  validationErrors?: string[];
  /**
   * Validation warnings from script tools with autoApproveOnValid: true.
   * When validation passes with warnings, these are captured and shown
   * to the user while still proceeding with auto_execute.
   */
  validationWarnings?: string[];
  /**
   * Tool IDs that were auto-approved via autoApproveOnValid mechanism.
   * Tracked for diagnostics and logging purposes.
   */
  autoApprovedTools?: string[];
}

/**
 * Script state after initialization via ensureScriptState().
 * Guarantees results and autoExecuteResults Maps exist.
 */
export interface InitializedScriptState extends ScriptState {
  results: Map<string, ScriptExecutionResult>;
  autoExecuteResults: Map<string, ToolResponse>;
}
