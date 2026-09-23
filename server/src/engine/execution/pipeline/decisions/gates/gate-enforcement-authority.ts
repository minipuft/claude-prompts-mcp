// @lifecycle canonical - Single source of truth for gate enforcement decisions.

import {
  loadVerdictPatterns,
  isPatternRestrictedToSource,
  type VerdictPattern,
} from '../../../../gates/config/index.js';
import { DEFAULT_RETRY_LIMIT } from '../../../../gates/constants.js';
import { deriveGateTier } from '../../../../gates/core/gate-tier.js';
import { parseGateVerdictReminders } from '../../../../gates/core/gate-verdict-renderer.js';
import { resolveEnforcementMode } from './enforcement-mode.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateReview, GateReviewKind } from '#shared/types/chain-execution.js';
import type {
  ChainSessionService,
  GateReviewPrompt,
  GateVerdictSummary,
} from '#shared/types/index.js';
import type {
  CreateReviewOptions,
  EnforcementMode,
  ParsedVerdict,
  PendingGateReview,
  VerdictSource,
} from './gate-enforcement-types.js';
import type { GateDefinitionProvider } from '../../../../gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../gates/types.js';
import type { ExecutionContext, SessionContext } from '../../../context/index.js';

// VerdictPattern type is now imported from gates/config

/**
 * Single source of truth for gate enforcement decisions.
 *
 * All pipeline stages MUST consult this authority for:
 * - Verdict parsing (consistent pattern matching)
 * - Review creation, keyed by the node the review grades (`createReview`)
 * - A detached review's enforcement mode (`resolveReviewEnforcement`)
 *
 * How a review MOVES — a verdict, a replacement report, a `gate_action` — is decided by
 * `advanceReview` (`review-lifecycle.ts`), on the review `resolveReviewTarget` addresses; the
 * verdict processor is the one path that applies both.
 */
export class GateEnforcementAuthority {
  private readonly logger: Logger;
  private readonly chainSessionStore: ChainSessionService;
  private readonly gateLoader: GateDefinitionProvider | undefined;

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
   * Parse per-gate verdicts from a GATE_VERDICTS (or legacy CRITERION_VERDICTS) block into
   * the shared {@link GateVerdictSummary} record, keyed by gate id.
   *
   * Called alongside parseVerdict() — the overall verdict drives PASS/FAIL, these entries say
   * WHICH gate the reviewer failed, which is what `GateVerdictProcessor` puts on
   * `context.state.gates.perGateVerdicts` and what `ExecutionRecordStore` persists.
   *
   * **This is the only place `index` exists.** The submitted `[n]` is a position in the gate
   * list THIS review advertised, which is meaningless to anything that does not hold that list;
   * the id is not. Resolving here, where `review.gateIds` is in hand, means no downstream reader
   * ever has to carry the list around to interpret a verdict — the same key `GateCheckResult`
   * already uses, so the reviewer's opinion and the engine's ground truth are joinable.
   *
   * An index outside the advertised list is DROPPED with a diagnostic, never clamped and never
   * guessed: attributing a FAIL to the wrong gate is worse than not recording it, and a guess
   * would make the resulting record indistinguishable from a correct one.
   *
   * @param raw - Raw response containing a GATE_VERDICTS block
   * @param gateIds - The gate list this review advertised, in the order it advertised them
   * @param attempt - Review attempt this submission answers, recorded on each entry
   * @returns Gate-id-keyed summaries (empty if no block found or none resolved)
   */
  parseGateVerdicts(
    raw: string,
    gateIds: readonly string[],
    attempt?: number
  ): GateVerdictSummary[] {
    if (!raw) {
      return [];
    }

    const timestamp = Date.now();
    const summaries: GateVerdictSummary[] = [
      ...this.readReminderAttestation(raw, gateIds, timestamp, attempt),
    ];

    const block = raw.match(
      /(?:CRITERION_VERDICTS|GATE_VERDICTS):\s*\n((?:\[?\d+\]?\s*(?:PASS|FAIL).*\n?)*)/i
    );
    if (!block?.[1]) {
      return summaries;
    }

    for (const line of block[1].trim().split('\n')) {
      const match = line.match(/\[?(\d+)\]?\s*(PASS|FAIL)\s*[-–—:]\s*(.*)/i);
      if (!match) {
        continue;
      }

      const index = parseInt(match[1]!, 10);
      const gateId = gateIds[index - 1];
      if (gateId === undefined) {
        this.logger.warn(
          `[GateEnforcementAuthority] Per-gate verdict [${index}] names no advertised gate ` +
            `(the review advertised ${gateIds.length}); entry dropped.`
        );
        continue;
      }

      summaries.push({
        gateId,
        verdict: match[2]!.toUpperCase() === 'PASS' ? 'PASS' : 'FAIL',
        rationale: match[3]!.trim(),
        timestamp,
        ...(attempt !== undefined ? { attempt } : {}),
      });
    }

    return summaries;
  }

  /**
   * Fold the `REMINDERS:` line into the same gate-id-keyed record as the per-gate block.
   *
   * `parseGateVerdictReminders` was the render half's reader and had none of its own: the line
   * was produced, round-trip tested, and consumed by nothing (P4.78). This is where it earns a
   * reader, and the reason it can share `GateVerdictSummary` without lying is `tier` — a
   * reminder is self-declared, so it is recorded as an attestation and counted separately from
   * an evaluated check, never averaged into the same pass rate.
   *
   * A `not_applicable` entry is still `PASS`: the reviewer is asserting the gate does not bind,
   * which is not a failure, and the reason it gave is the rationale. The PASS/FAIL union is
   * deliberately not widened for it — a third member would reach every reader of the record for
   * a distinction only this branch makes, and the `tier` + rationale already carry it.
   *
   * An id the review never advertised is dropped with a diagnostic, exactly as an out-of-range
   * index is: an attestation about a gate that was not under review is not a fact about it.
   */
  private readReminderAttestation(
    raw: string,
    gateIds: readonly string[],
    timestamp: number,
    attempt?: number
  ): GateVerdictSummary[] {
    const reminders = parseGateVerdictReminders(raw);
    if (reminders === undefined) {
      return [];
    }

    const advertised = new Set(gateIds);
    const entries: GateVerdictSummary[] = [];

    const record = (gateId: string, rationale: string): void => {
      if (!advertised.has(gateId)) {
        this.logger.warn(
          `[GateEnforcementAuthority] Reminder attestation names "${gateId}", which this ` +
            'review did not advertise; entry dropped.'
        );
        return;
      }
      entries.push({
        gateId,
        verdict: 'PASS',
        rationale,
        timestamp,
        tier: 'reminder',
        ...(attempt !== undefined ? { attempt } : {}),
      });
    };

    for (const gateId of reminders.satisfied) {
      record(gateId, 'attested satisfied');
    }
    for (const exemption of reminders.not_applicable) {
      record(exemption.id, `not applicable: ${exemption.reason}`);
    }

    return entries;
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
   * Create and persist a review of `kind` on `nodeId` — the one creation path (row 3.3). Every
   * review is keyed by the node it grades from the moment it exists: the step review at render
   * ({@link createReviewForStep}), a detached node's on its late report ({@link openDetachedReview}),
   * and the review a verdict opens when none was open (the verdict processor's deferred entry).
   * The store never derives the key from where the run stands (R8).
   */
  async createReview(
    sessionId: string,
    kind: GateReviewKind,
    nodeId: string,
    options: CreateReviewOptions & Pick<GateReview, 'reviewedOutput' | 'gateTiers'>
  ): Promise<GateReview> {
    const { reviewedOutput, gateTiers, ...reviewOptions } = options;
    const review: GateReview = {
      ...(await this.createPendingReview(reviewOptions)),
      nodeId,
      kind,
      phase: 'awaiting-verdict',
      ...(reviewedOutput !== undefined ? { reviewedOutput } : {}),
      ...(gateTiers !== undefined ? { gateTiers } : {}),
    };
    await this.chainSessionStore.setReview(sessionId, review);
    return review;
  }

  /**
   * Create the review of the step `sessionContext` stands on, scoped to `gateIds`. Shared by the
   * pre-advance call (`SessionManagementStage`, the step a request STARTED on) and the
   * post-advance call (`GateEnhancementService.ensurePostAdvanceReview`, the step a request just
   * ADVANCED onto), so both resolve `maxAttempts` and the reviewed node identically (P5-F6).
   *
   * Mutates `sessionContext.pendingReview` in place (the contract both callers rely on) and also
   * returns the created review — callers read the return value, since a guard earlier in the
   * same function typically narrows that property to `undefined` for TypeScript.
   *
   * @returns null without side effects when `gateIds` is empty.
   * @throws when the step has no node id: a review is keyed by its node (R8), never by position.
   */
  async createReviewForStep(
    context: ExecutionContext,
    sessionContext: SessionContext,
    gateIds: string[]
  ): Promise<GateReview | null> {
    if (gateIds.length === 0) {
      return null;
    }

    // The step definition is addressed by its node id; position is the fallback for a context
    // with no node id — mirrors the resolution `GateEnhancementService` and stage 18 use.
    const currentStepNumber = sessionContext.currentStep ?? 1;
    const steps = context.parsedCommand?.steps;
    const currentNodeId = sessionContext.currentNodeId ?? undefined;
    const currentStep =
      (currentNodeId !== undefined ? steps?.find((s) => s.nodeId === currentNodeId) : undefined) ??
      steps?.find((s) => s.stepNumber === currentStepNumber);
    const nodeId = currentNodeId ?? currentStep?.nodeId;
    if (nodeId === undefined) {
      throw new Error(
        `A gate review of step ${currentStepNumber} was opened on a run that names no node for it`
      );
    }

    // maxAttempts priority: step-level > gate-level > default.
    const maxAttempts = currentStep?.retries ?? context.gates.getMaxRetryLimit();
    const pendingReview = await this.createReview(sessionContext.sessionId, 'gate', nodeId, {
      gateIds,
      instructions: context.gateInstructions ?? '',
      ...(maxAttempts !== undefined ? { maxAttempts } : {}),
      metadata: { sessionId: sessionContext.sessionId, stepNumber: currentStepNumber },
    });
    sessionContext.pendingReview = pendingReview;

    this.logger.debug('[GateEnforcementAuthority] Created PendingGateReview for step gates', {
      sessionId: sessionContext.sessionId,
      nodeId,
      gateIds,
      maxAttempts: pendingReview.maxAttempts,
    });

    return pendingReview;
  }

  /**
   * Open the gate review of a detached node's late result (row 4.8) on that node, the way
   * {@link createReviewForStep} opens a step's (same prompts, same `maxAttempts` precedence, step
   * retries first), plus the gate tiers the verdict template needs. It awaits a verdict graded
   * against `reviewedOutput`. A replacement report after a FAIL does not come here: it is an
   * event on the open review, which the verdict processor applies.
   *
   * @returns null without side effects when no gate applies to the node.
   */
  async openDetachedReview(
    context: ExecutionContext,
    sessionId: string,
    node: { readonly nodeId: string; readonly stepNumber: number },
    gateIds: string[],
    reviewedOutput: string
  ): Promise<GateReview | null> {
    if (gateIds.length === 0) {
      return null;
    }
    const stepRetries = context.parsedCommand?.steps?.find(
      (step) => step.nodeId === node.nodeId
    )?.retries;
    const maxAttempts = stepRetries ?? context.gates.getMaxRetryLimit();
    return this.createReview(sessionId, 'detached', node.nodeId, {
      gateIds,
      instructions: '',
      ...(maxAttempts !== undefined ? { maxAttempts } : {}),
      metadata: { ...node, sessionId, phase: 'awaiting-verdict' },
      reviewedOutput,
      gateTiers: await this.deriveGateTiers(gateIds),
    });
  }

  /**
   * What a FAIL on a detached node's review does (R10): the mode its OWN gates declare, through
   * `resolveEnforcementMode` — the failed gates when the verdict named them, else every gate of
   * the review. The run's current step is another node, so its published mode says nothing here.
   */
  async resolveReviewEnforcement(
    review: Pick<GateReview, 'gateIds'>,
    failedGateIds: readonly string[]
  ): Promise<EnforcementMode> {
    const definitions = this.gateLoader ? await this.gateLoader.loadGates(review.gateIds) : [];
    const gateSet = {
      declared: new Map(definitions.map((def) => [def.id, def.enforcementMode] as const)),
      undeclared: 'blocking' as const,
    };
    return resolveEnforcementMode(
      undefined,
      gateSet,
      failedGateIds.length > 0 ? failedGateIds : review.gateIds
    );
  }

  /** Tier per gate (`deriveGateTier`); a gate the loader cannot load contributes no entry. */
  private async deriveGateTiers(gateIds: string[]): Promise<Record<string, 'check' | 'reminder'>> {
    const definitions = this.gateLoader ? await this.gateLoader.loadGates(gateIds) : [];
    return Object.fromEntries(definitions.map((def) => [def.id, deriveGateTier(def)]));
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
}
