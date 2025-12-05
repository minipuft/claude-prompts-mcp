// @lifecycle canonical - Type definitions for gate enforcement authority.

import type { PendingGateReview } from '../../../../mcp-tools/prompt-engine/core/types.js';

/**
 * Source of a gate verdict for audit/debugging.
 */
export type VerdictSource = 'gate_verdict' | 'user_response';

/**
 * Gate enforcement modes that determine behavior on failure.
 */
export type EnforcementMode = 'blocking' | 'advisory' | 'informational';

/**
 * User action choices when retry limit is exceeded.
 */
export type GateAction = 'retry' | 'skip' | 'abort';

/**
 * Parsed verdict from user input.
 */
export interface ParsedVerdict {
  readonly verdict: 'PASS' | 'FAIL';
  readonly rationale: string;
  readonly raw: string;
  readonly source: VerdictSource;
  readonly detectedPattern?: string;
}

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
  readonly source: VerdictSource;
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
 * Factory options for creating pending reviews.
 */
export interface CreateReviewOptions {
  readonly gateIds: string[];
  readonly instructions: string;
  readonly maxAttempts?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Re-export PendingGateReview for convenience.
 */
export type { PendingGateReview };
