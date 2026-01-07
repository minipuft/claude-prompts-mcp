import type { PendingShellVerification, ShellVerifyResult } from '../../gates/shell/index.js';
import type { GateEnforcementMode } from '../../gates/types.js';
import type { ScriptExecutionResult, ConfirmationRequired } from '../../scripts/types.js';
import type { ToolResponse } from '../../types/index.js';
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
    /** Resources selected during judge phase for prompt guidance */
    selectedResources?: string[];
    /** Available guidance resources from judge selection stage */
    availableResources?: unknown[];
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
    /** Chain variables for template rendering (from ChainSessionManager) */
    chainContext?: Record<string, unknown>;
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
    /** Call-to-action string returned by gate review */
    reviewCallToAction?: string;
    /** IDs of methodology-specific gates registered for this execution */
    methodologyGateIds?: string[];
    /** IDs of canonical gates that were resolved from temporary inputs */
    canonicalGateIdsFromTemporary?: string[];
    /** IDs of inline gates registered during extraction */
    registeredInlineGateIds?: string[];
    /** Whether the gate retry limit has been exceeded */
    retryLimitExceeded?: boolean;
    /** Gate IDs that have exhausted their retry attempts */
    retryExhaustedGateIds?: string[];
    /** Advisory warnings from non-blocking gate failures */
    advisoryWarnings?: string[];
    /** Resolved enforcement mode for the current gate set (most restrictive wins) */
    enforcementMode?: GateEnforcementMode;
    /** Whether user choice is being awaited after retry exhaustion */
    awaitingUserChoice?: boolean;
    /** Accumulated gate IDs from enhancement stage for downstream use */
    accumulatedGateIds?: string[];
    /** Whether blocking gates are present that require review */
    hasBlockingGates?: boolean;
    /** Parsed verdict detection metadata from gate review processing */
    verdictDetection?: {
      verdict: 'PASS' | 'FAIL';
      source: 'gate_verdict' | 'user_response';
      rationale?: string;
      pattern?: string;
      outcome?: string;
    };
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
  };

  /**
   * State related to Script Tool Execution.
   * Holds results from script tools executed during pipeline processing.
   */
  scripts?: {
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
  };
}
