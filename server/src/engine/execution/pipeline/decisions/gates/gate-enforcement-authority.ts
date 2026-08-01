// @lifecycle canonical - Single source of truth for gate enforcement decisions.

import {
  loadVerdictPatterns,
  isPatternRestrictedToSource,
  type VerdictPattern,
} from '../../../../gates/config/index.js';
import { DEFAULT_RETRY_LIMIT } from '../../../../gates/constants.js';

import type { Logger } from '#infra/logging/index.js';
import type { ChainSessionService, GateReviewPrompt } from '#shared/types/index.js';
import type {
  ActionResult,
  CreateReviewOptions,
  GateVerdict,
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
import type { GateDefinitionProvider } from '../../../../gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../gates/types.js';

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
  private readonly chainSessionStore: ChainSessionService;
  private readonly gateLoader: GateDefinitionProvider | undefined;

  private enforcementDecision: GateEnforcementDecision | null = null;

  // Verdict patterns loaded from YAML configuration
  private verdictPatterns: VerdictPattern[] | null = null;

  constructor(
    chainSessionStore: ChainSessionService,
    logger: Logger,
    gateLoader?: GateDefinitionProvider
  ) {
    this.chainSessionStore = chainSessionStore;
    this.logger = logger;
    this.gateLoader = gateLoader;
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

    // Validate only the first non-empty line (per-gate verdicts may follow)
    const trimmed = raw.trim();
    const firstLine =
      trimmed
        .split('\n')
        .find((l) => l.trim().length > 0)
        ?.trim() ?? trimmed;

    const patterns = this.getVerdictPatterns();

    for (const pattern of patterns) {
      // Security: Skip patterns restricted to specific sources
      if (isPatternRestrictedToSource(pattern, source)) {
        continue;
      }

      const match = firstLine.match(pattern.regex);
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
   * Parse per-gate verdicts from a GATE_VERDICTS (or legacy CRITERION_VERDICTS) block.
   * Called alongside parseVerdict() — overall verdict drives PASS/FAIL,
   * gate verdicts provide granular delivery tracking.
   *
   * @param raw - Raw response containing GATE_VERDICTS block
   * @returns Array of parsed gate verdicts (empty if no block found)
   */
  parseGateVerdicts(raw: string): GateVerdict[] {
    if (!raw) {
      return [];
    }

    const block = raw.match(
      /(?:CRITERION_VERDICTS|GATE_VERDICTS):\s*\n((?:\[?\d+\]?\s*(?:PASS|FAIL).*\n?)*)/i
    );
    if (!block?.[1]) {
      return [];
    }

    return block[1]
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.match(/\[?(\d+)\]?\s*(PASS|FAIL)\s*[-–—:]\s*(.*)/i);
        if (!match) {
          return null;
        }
        return {
          index: parseInt(match[1]!, 10),
          passed: match[2]!.toUpperCase() === 'PASS',
          rationale: match[3]!.trim(),
        };
      })
      .filter((v): v is GateVerdict => v !== null);
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
    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
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
    return this.chainSessionStore.isRetryLimitExceeded(sessionId);
  }

  /**
   * Get pending gate review for a session.
   *
   * @param sessionId - Session to check
   * @returns Pending review or undefined
   */
  getPendingReview(sessionId: string): PendingGateReview | undefined {
    return this.chainSessionStore.getPendingGateReview(sessionId);
  }

  /**
   * Create a new pending gate review.
   * Loads gate definitions to populate review prompts with criteria summaries.
   *
   * @param options - Review creation options
   * @returns Created pending review with enriched gate prompts
   */
  async createPendingReview(options: CreateReviewOptions): Promise<PendingGateReview> {
    const { gateIds, instructions, maxAttempts = DEFAULT_RETRY_LIMIT, metadata } = options;

    const prompts = await this.buildReviewPrompts(gateIds);

    const pendingReview: PendingGateReview = {
      combinedPrompt: instructions,
      gateIds,
      prompts,
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
   * Build GateReviewPrompt objects from gate definitions.
   * Falls back to empty array if gate loader is unavailable or loading fails.
   */
  private async buildReviewPrompts(gateIds: string[]): Promise<GateReviewPrompt[]> {
    if (!this.gateLoader || gateIds.length === 0) {
      return [];
    }

    try {
      const definitions = await this.gateLoader.loadGates(gateIds);
      return definitions.map((def) => ({
        gateId: def.id,
        gateName: def.name,
        criteriaSummary: this.buildCriteriaSummary(def),
      }));
    } catch (error) {
      this.logger.warn('[GateEnforcementAuthority] Failed to load gate definitions for prompts', {
        error,
        gateIds,
      });
      return [];
    }
  }

  /**
   * Extract a human-readable criteria summary from a gate definition.
   * Prefers guidance text (human-readable) over description (brief).
   */
  private buildCriteriaSummary(def: LightweightGateDefinition): string {
    if (def.guidance) {
      const firstLine = def.guidance.trim().split('\n')[0]?.trim();
      if (firstLine && firstLine.length > 0) {
        return firstLine;
      }
    }

    return def.description;
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

    const pending = this.chainSessionStore.getPendingGateReview(sessionId);
    if (!pending) {
      if (verdict.verdict === 'PASS') {
        return {
          status: 'cleared',
          nextAction: 'continue',
        };
      }

      // Create a review on first FAIL
      const created = await this.createPendingReview({
        gateIds: [],
        instructions: 'Gate validation failed. Review and remediate.',
      });
      await this.setPendingReview(sessionId, created);
    }

    const result = await this.chainSessionStore.recordGateReviewOutcome(sessionId, {
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
          await this.chainSessionStore.clearPendingGateReview(sessionId);
          return {
            status: 'cleared',
            nextAction: 'continue',
          };

        case 'informational':
          // Log only, no user impact
          this.logger.debug(
            `[GateEnforcementAuthority] Gate FAIL in informational mode - logged only: ${verdict.rationale}`
          );
          await this.chainSessionStore.clearPendingGateReview(sessionId);
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
        await this.chainSessionStore.resetRetryCount(sessionId);
        this.logger.debug(`[GateEnforcementAuthority] User chose to retry after exhaustion`, {
          sessionId,
        });
        return {
          handled: true,
          retryReset: true,
        };

      case 'skip':
        await this.chainSessionStore.clearPendingGateReview(sessionId);
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
    await this.chainSessionStore.setPendingGateReview(sessionId, review);
  }

  /**
   * Clear pending gate review from a session.
   *
   * @param sessionId - Session to update
   */
  async clearPendingReview(sessionId: string): Promise<void> {
    await this.chainSessionStore.clearPendingGateReview(sessionId);
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
