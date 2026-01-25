// @lifecycle canonical - Single source of truth for gate enforcement decisions.

import {
  loadVerdictPatterns,
  isPatternRestrictedToSource,
  type VerdictPattern,
} from '../../../../gates/config/index.js';
import { DEFAULT_RETRY_LIMIT } from '../../../../gates/constants.js';

import type {
  ActionResult,
  CreateReviewOptions,
  EnforcementMode,
  GateAction,
  GateEnforcementDecision,
  GateEnforcementInput,
  ParsedVerdict,
  PendingGateReview,
  ReviewOutcome,
  RetryConfig,
  VerdictSource,
} from './gate-enforcement-types.js';
import type { ChainSessionService } from '../../../../chain-session/types.js';
import type { Logger } from '../../../../logging/index.js';

// VerdictPattern type is now imported from gates/config

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
export class GateEnforcementAuthority {
  private readonly logger: Logger;
  private readonly chainSessionManager: ChainSessionService;

  private enforcementDecision: GateEnforcementDecision | null = null;

  // Verdict patterns loaded from YAML configuration
  private verdictPatterns: VerdictPattern[] | null = null;

  constructor(chainSessionManager: ChainSessionService, logger: Logger) {
    this.chainSessionManager = chainSessionManager;
    this.logger = logger;
  }

  /**
   * Get verdict patterns, loading from YAML config on first access.
   */
  private getVerdictPatterns(): VerdictPattern[] {
    if (!this.verdictPatterns) {
      this.verdictPatterns = loadVerdictPatterns();
    }
    return this.verdictPatterns;
  }

  /**
   * Parse a raw string into a structured verdict.
   * Supports multiple formats for flexibility while maintaining security.
   * Patterns are loaded from YAML configuration for runtime customization.
   *
   * @param raw - Raw verdict string from user input
   * @param source - Where the verdict came from (affects security validation)
   * @returns Parsed verdict or null if no pattern matched
   */
  parseVerdict(raw: string | undefined, source: VerdictSource): ParsedVerdict | null {
    if (!raw) {
      return null;
    }

    const patterns = this.getVerdictPatterns();

    for (const pattern of patterns) {
      // Security: Skip patterns restricted to specific sources
      if (isPatternRestrictedToSource(pattern, source)) {
        continue;
      }

      const match = raw.match(pattern.regex);
      if (match) {
        const rationale = match[2]?.trim();

        // Validation: Require non-empty rationale
        if (!rationale) {
          this.logger.warn(
            `[GateEnforcementAuthority] Verdict detected but missing rationale: "${raw.substring(0, 50)}..."`
          );
          continue; // Try next pattern
        }

        const verdictValue = match[1];
        if (!verdictValue) {
          continue;
        }

        return {
          verdict: verdictValue.toUpperCase() as 'PASS' | 'FAIL',
          rationale,
          raw,
          source,
          detectedPattern: pattern.priority,
        };
      }
    }

    // No pattern matched
    return null;
  }

  /**
   * Resolve enforcement mode for a set of gates.
   * Currently returns the configured mode or defaults to 'blocking'.
   *
   * @param configuredMode - Mode from pipeline state or undefined
   * @returns Resolved enforcement mode
   */
  resolveEnforcementMode(configuredMode?: EnforcementMode): EnforcementMode {
    return configuredMode ?? 'blocking';
  }

  /**
   * Get retry configuration for a session.
   *
   * @param sessionId - Session to check
   * @returns Retry config with current state
   */
  getRetryConfig(sessionId: string): RetryConfig {
    const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
    const currentAttempt = pendingReview?.attemptCount ?? 0;
    const maxAttempts = pendingReview?.maxAttempts ?? DEFAULT_RETRY_LIMIT;

    return {
      maxAttempts,
      currentAttempt,
      isExhausted: currentAttempt >= maxAttempts,
    };
  }

  /**
   * Check if retry limit is exceeded for a session.
   * Delegates to session manager for persistent state.
   *
   * @param sessionId - Session to check
   * @returns True if retry limit exceeded
   */
  isRetryLimitExceeded(sessionId: string): boolean {
    return this.chainSessionManager.isRetryLimitExceeded(sessionId);
  }

  /**
   * Get pending gate review for a session.
   *
   * @param sessionId - Session to check
   * @returns Pending review or undefined
   */
  getPendingReview(sessionId: string): PendingGateReview | undefined {
    return this.chainSessionManager.getPendingGateReview(sessionId);
  }

  /**
   * Create a new pending gate review.
   *
   * @param options - Review creation options
   * @returns Created pending review
   */
  createPendingReview(options: CreateReviewOptions): PendingGateReview {
    const { gateIds, instructions, maxAttempts = DEFAULT_RETRY_LIMIT, metadata } = options;

    const pendingReview: PendingGateReview = {
      combinedPrompt: instructions,
      gateIds,
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts,
      retryHints: [],
      history: [],
    };

    if (metadata) {
      pendingReview.metadata = metadata;
    }

    return pendingReview;
  }

  /**
   * Record a gate review outcome and return the next action.
   *
   * @param sessionId - Session to update
   * @param verdict - Parsed verdict to record
   * @param enforcementMode - Current enforcement mode
   * @returns Outcome indicating next action
   */
  async recordOutcome(
    sessionId: string,
    verdict: ParsedVerdict,
    enforcementMode: EnforcementMode = 'blocking'
  ): Promise<ReviewOutcome> {
    // Deferred review semantics:
    // - PASS without a pending review: advance immediately, no review UI.
    // - FAIL without a pending review: create review and await remediation.
    // - With a pending review: record as before.

    const pending = this.chainSessionManager.getPendingGateReview(sessionId);
    if (!pending) {
      if (verdict.verdict === 'PASS') {
        return {
          status: 'cleared',
          nextAction: 'continue',
        };
      }

      // Create a review on first FAIL
      const created = this.createPendingReview({
        gateIds: [],
        instructions: 'Gate validation failed. Review and remediate.',
      });
      await this.setPendingReview(sessionId, created);
    }

    const result = await this.chainSessionManager.recordGateReviewOutcome(sessionId, {
      verdict: verdict.verdict,
      rationale: verdict.rationale,
      rawVerdict: verdict.raw,
      reviewer: verdict.source,
    });

    if (result === 'cleared') {
      return {
        status: 'cleared',
        nextAction: 'continue',
      };
    }

    // Still pending - check enforcement mode for FAIL verdicts
    if (verdict.verdict === 'FAIL') {
      const retryConfig = this.getRetryConfig(sessionId);

      switch (enforcementMode) {
        case 'blocking':
          if (retryConfig.isExhausted) {
            return {
              status: 'exhausted',
              nextAction: 'await_user_choice',
              attemptCount: retryConfig.currentAttempt,
              maxAttempts: retryConfig.maxAttempts,
            };
          }
          return {
            status: 'pending',
            nextAction: 'await_verdict',
            attemptCount: retryConfig.currentAttempt,
            maxAttempts: retryConfig.maxAttempts,
          };

        case 'advisory':
          // Log warning but allow advancement
          this.logger.warn(
            `[GateEnforcementAuthority] Gate FAIL in advisory mode - continuing: ${verdict.rationale}`
          );
          await this.chainSessionManager.clearPendingGateReview(sessionId);
          return {
            status: 'cleared',
            nextAction: 'continue',
          };

        case 'informational':
          // Log only, no user impact
          this.logger.debug(
            `[GateEnforcementAuthority] Gate FAIL in informational mode - logged only: ${verdict.rationale}`
          );
          await this.chainSessionManager.clearPendingGateReview(sessionId);
          return {
            status: 'cleared',
            nextAction: 'continue',
          };
      }
    }

    // PASS verdict but still pending (edge case)
    return {
      status: 'pending',
      nextAction: 'await_verdict',
    };
  }

  /**
   * Resolve a gate action (retry/skip/abort) when retry limit is exceeded.
   *
   * @param sessionId - Session to update
   * @param action - User's chosen action
   * @returns Result of the action
   */
  async resolveAction(sessionId: string, action: GateAction): Promise<ActionResult> {
    switch (action) {
      case 'retry':
        await this.chainSessionManager.resetRetryCount(sessionId);
        this.logger.debug(`[GateEnforcementAuthority] User chose to retry after exhaustion`, {
          sessionId,
        });
        return {
          handled: true,
          retryReset: true,
        };

      case 'skip':
        await this.chainSessionManager.clearPendingGateReview(sessionId);
        this.logger.warn(`[GateEnforcementAuthority] User chose to skip failed gate`, {
          sessionId,
        });
        return {
          handled: true,
          reviewCleared: true,
        };

      case 'abort':
        this.logger.debug(
          `[GateEnforcementAuthority] User chose to abort chain after gate failure`,
          {
            sessionId,
          }
        );
        return {
          handled: true,
          sessionAborted: true,
        };

      default:
        this.logger.warn(`[GateEnforcementAuthority] Unknown gate action: ${action}`);
        return {
          handled: false,
        };
    }
  }

  /**
   * Set a pending gate review on a session.
   *
   * @param sessionId - Session to update
   * @param review - Pending review to set
   */
  async setPendingReview(sessionId: string, review: PendingGateReview): Promise<void> {
    await this.chainSessionManager.setPendingGateReview(sessionId, review);
  }

  /**
   * Clear pending gate review from a session.
   *
   * @param sessionId - Session to update
   */
  async clearPendingReview(sessionId: string): Promise<void> {
    await this.chainSessionManager.clearPendingGateReview(sessionId);
  }

  /**
   * Get the enforcement decision. Computes on first call, returns cached thereafter.
   */
  decide(input: GateEnforcementInput): GateEnforcementDecision {
    if (this.enforcementDecision !== null) {
      return this.enforcementDecision;
    }

    this.enforcementDecision = this.computeDecision(input);

    this.logger.debug('[GateEnforcementAuthority] Decision made', {
      shouldEnforce: this.enforcementDecision.shouldEnforce,
      enforcementMode: this.enforcementDecision.enforcementMode,
      gateCount: this.enforcementDecision.gateIds.length,
    });

    return this.enforcementDecision;
  }

  /**
   * Check if decision has been made.
   */
  hasDecided(): boolean {
    return this.enforcementDecision !== null;
  }

  /**
   * Get the cached decision without computing (returns null if not decided).
   */
  getCachedDecision(): GateEnforcementDecision | null {
    return this.enforcementDecision;
  }

  /**
   * Reset the authority (for testing or request reprocessing).
   */
  reset(): void {
    this.enforcementDecision = null;
  }

  private computeDecision(input: GateEnforcementInput): GateEnforcementDecision {
    const timestamp = Date.now();

    if (input.gateIds.length === 0) {
      return {
        shouldEnforce: false,
        enforcementMode: 'blocking',
        gateIds: [],
        reason: 'No gates to enforce',
        decidedAt: timestamp,
      };
    }

    return {
      shouldEnforce: true,
      enforcementMode: this.resolveEnforcementMode(input.enforcementMode),
      gateIds: input.gateIds,
      reason: `Enforcing ${input.gateIds.length} gates`,
      decidedAt: timestamp,
    };
  }
}
