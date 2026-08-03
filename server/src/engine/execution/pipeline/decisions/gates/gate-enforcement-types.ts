// @lifecycle canonical - Type definitions for gate enforcement authority.

import type { PendingGateReview } from '#shared/types/chain-execution.js';
import type { GateVerdictSource } from '../../../../gates/core/gate-verdict-contract.js';

export type {
  GateVerdictSource as VerdictSource,
  ParsedGateVerdict as ParsedVerdict,
} from '../../../../gates/core/gate-verdict-contract.js';

/**
 * Gate enforcement modes that determine behavior on failure.
 */
export type EnforcementMode = 'blocking' | 'advisory' | 'informational';

/**
 * User action choices when retry limit is exceeded.
 */
export type GateAction = 'retry' | 'skip' | 'abort';

/**
 * Retry configuration for gate reviews.
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly currentAttempt: number;
  readonly isExhausted: boolean;
}

/**
 * Outcome of processing a gate verdict.
 */
export interface ReviewOutcome {
  readonly status: 'cleared' | 'pending' | 'exhausted';
  readonly nextAction?: 'continue' | 'await_verdict' | 'await_user_choice';
  readonly attemptCount?: number;
  readonly maxAttempts?: number;
}

/**
 * Result of processing a gate_action parameter.
 */
export interface ActionResult {
  readonly handled: boolean;
  readonly sessionAborted?: boolean;
  readonly reviewCleared?: boolean;
  readonly retryReset?: boolean;
}

/**
 * Input for verdict parsing decisions.
 */
export interface VerdictParseInput {
  readonly raw: string | undefined;
  readonly source: GateVerdictSource;
}

/**
 * Input for enforcement decision.
 * Decouples authority from ExecutionContext.
 */
export interface GateEnforcementInput {
  readonly sessionId: string;
  readonly gateIds: string[];
  readonly gateInstructions?: string;
  readonly enforcementMode?: EnforcementMode;
}

/**
 * Gate enforcement decision result.
 */
export interface GateEnforcementDecision {
  readonly shouldEnforce: boolean;
  readonly enforcementMode: EnforcementMode;
  readonly gateIds: string[];
  readonly reason: string;
  readonly decidedAt: number;
}

/**
 * Per-gate verdict from a gate review response.
 * Parsed from GATE_VERDICTS blocks for granular delivery tracking.
 */
export interface GateVerdict {
  readonly index: number;
  readonly passed: boolean;
  readonly rationale: string;
}

/**
 * Factory options for creating pending reviews.
 */
export interface CreateReviewOptions {
  readonly gateIds: string[];
  readonly instructions: string;
  readonly maxAttempts?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * One gate's shell-verification result, reduced to what the coverage decision reads.
 *
 * Structurally a subset of `GateShellVerifyResult` from the shell-verify runner, declared
 * here so the authority does not depend on the gates/shell module to answer a question
 * about its own domain.
 */
export interface ShellVerificationOutcome {
  readonly gateId: string;
  readonly passed: boolean;
}

/**
 * Inputs to the shell-verification coverage decision.
 */
export interface ShellVerificationCoverageInput {
  /** Gate ids the pending review is still waiting on. */
  readonly requiredGateIds: readonly string[];
  /** Results produced by running this request's `shell_verify` criteria. */
  readonly results: readonly ShellVerificationOutcome[];
  /** Gate ids an earlier stage in this same request already shell-verified. */
  readonly priorVerifiedGateIds?: readonly string[];
}

/**
 * Whether shell verification alone clears a pending gate review.
 */
export interface ShellVerificationCoverage {
  /** True when every required gate is covered by a passing verification. */
  readonly satisfied: boolean;
  /** This request's and earlier stages' verified gate ids, deduplicated. */
  readonly verifiedGateIds: readonly string[];
  /** Why the review was or was not cleared, for diagnostics. */
  readonly reason: string;
}

/**
 * Re-export PendingGateReview for convenience.
 */
export type { PendingGateReview };
