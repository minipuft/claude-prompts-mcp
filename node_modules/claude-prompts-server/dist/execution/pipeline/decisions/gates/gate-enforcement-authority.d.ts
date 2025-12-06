import type { Logger } from '../../../../logging/index.js';
import type { ChainSessionService } from '../../../../chain-session/types.js';
import type { ActionResult, CreateReviewOptions, EnforcementMode, GateAction, GateEnforcementDecision, GateEnforcementInput, ParsedVerdict, PendingGateReview, ReviewOutcome, RetryConfig, VerdictSource } from './gate-enforcement-types.js';
/**
 * Single source of truth for gate enforcement decisions.
 *
 * All pipeline stages MUST consult this authority for:
 * - Verdict parsing (consistent pattern matching)
 * - Enforcement mode resolution
 * - Retry limit tracking
 * - Gate action handling (retry/skip/abort)
 *
 * The authority bridges ephemeral pipeline state and persistent session state,
 * ensuring consistent behavior across request boundaries.
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * const verdict = gateEnforcement.parseVerdict(raw, 'gate_verdict');
 * if (verdict) {
 *   const outcome = await gateEnforcement.recordOutcome(sessionId, verdict);
 *   // Handle outcome.nextAction
 * }
 * ```
 */
export declare class GateEnforcementAuthority {
    private readonly logger;
    private readonly chainSessionManager;
    private enforcementDecision;
    private static readonly VERDICT_PATTERNS;
    constructor(chainSessionManager: ChainSessionService, logger: Logger);
    /**
     * Parse a raw string into a structured verdict.
     * Supports multiple formats for flexibility while maintaining security.
     *
     * @param raw - Raw verdict string from user input
     * @param source - Where the verdict came from (affects security validation)
     * @returns Parsed verdict or null if no pattern matched
     */
    parseVerdict(raw: string | undefined, source: VerdictSource): ParsedVerdict | null;
    /**
     * Resolve enforcement mode for a set of gates.
     * Currently returns the configured mode or defaults to 'blocking'.
     *
     * @param configuredMode - Mode from pipeline state or undefined
     * @returns Resolved enforcement mode
     */
    resolveEnforcementMode(configuredMode?: EnforcementMode): EnforcementMode;
    /**
     * Get retry configuration for a session.
     *
     * @param sessionId - Session to check
     * @returns Retry config with current state
     */
    getRetryConfig(sessionId: string): RetryConfig;
    /**
     * Check if retry limit is exceeded for a session.
     * Delegates to session manager for persistent state.
     *
     * @param sessionId - Session to check
     * @returns True if retry limit exceeded
     */
    isRetryLimitExceeded(sessionId: string): boolean;
    /**
     * Get pending gate review for a session.
     *
     * @param sessionId - Session to check
     * @returns Pending review or undefined
     */
    getPendingReview(sessionId: string): PendingGateReview | undefined;
    /**
     * Create a new pending gate review.
     *
     * @param options - Review creation options
     * @returns Created pending review
     */
    createPendingReview(options: CreateReviewOptions): PendingGateReview;
    /**
     * Record a gate review outcome and return the next action.
     *
     * @param sessionId - Session to update
     * @param verdict - Parsed verdict to record
     * @param enforcementMode - Current enforcement mode
     * @returns Outcome indicating next action
     */
    recordOutcome(sessionId: string, verdict: ParsedVerdict, enforcementMode?: EnforcementMode): Promise<ReviewOutcome>;
    /**
     * Resolve a gate action (retry/skip/abort) when retry limit is exceeded.
     *
     * @param sessionId - Session to update
     * @param action - User's chosen action
     * @returns Result of the action
     */
    resolveAction(sessionId: string, action: GateAction): Promise<ActionResult>;
    /**
     * Set a pending gate review on a session.
     *
     * @param sessionId - Session to update
     * @param review - Pending review to set
     */
    setPendingReview(sessionId: string, review: PendingGateReview): Promise<void>;
    /**
     * Clear pending gate review from a session.
     *
     * @param sessionId - Session to update
     */
    clearPendingReview(sessionId: string): Promise<void>;
    /**
     * Get the enforcement decision. Computes on first call, returns cached thereafter.
     */
    decide(input: GateEnforcementInput): GateEnforcementDecision;
    /**
     * Check if decision has been made.
     */
    hasDecided(): boolean;
    /**
     * Get the cached decision without computing (returns null if not decided).
     */
    getCachedDecision(): GateEnforcementDecision | null;
    /**
     * Reset the authority (for testing or request reprocessing).
     */
    reset(): void;
    private computeDecision;
}
