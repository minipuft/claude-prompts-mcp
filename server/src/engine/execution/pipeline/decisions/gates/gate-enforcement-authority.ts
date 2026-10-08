// @lifecycle canonical - Single source of truth for gate enforcement decisions.

import { randomUUID } from 'node:crypto';

import { resolveEnforcementMode } from './enforcement-mode.js';
import { physicalReviewDefinitionIndex } from './frozen-review-definitions.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
  renewSemanticReviewAttempt,
} from './semantic-review-context.js';
import {
  loadVerdictPatterns,
  isPatternRestrictedToSource,
  type VerdictPattern,
} from '../../../../gates/config/index.js';
import { DEFAULT_RETRY_LIMIT } from '../../../../gates/constants.js';
import { deriveGateTier } from '../../../../gates/core/gate-tier.js';
import { parseGateVerdict } from '../../../../gates/core/gate-verdict-contract.js';
import { parseGateVerdictReminders } from '../../../../gates/core/gate-verdict-renderer.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateReview, GateReviewKind } from '#shared/types/chain-execution.js';
import type { GateVerdictSubmission } from '#shared/types/gate-evaluation.js';
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
import type { JudgeEvaluationDefaults } from '../../../../gates/judge/types.js';
import type { LightweightGateDefinition } from '../../../../gates/types.js';
import type { ExecutionContext, SessionContext } from '../../../context/index.js';

import { acceptsVerdictlessJoin } from '#shared/types/chain-session.js';
import { parseStepForNode } from '#shared/utils/node-order.js';

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
  private readonly gatesConfigProvider:
    (() => { evaluation?: Partial<JudgeEvaluationDefaults> } | undefined) | undefined;

  // Verdict patterns loaded from YAML configuration
  private verdictPatterns: VerdictPattern[] | null = null;

  constructor(
    chainSessionStore: ChainSessionService,
    logger: Logger,
    gateLoader?: GateDefinitionProvider,
    gatesConfigProvider?: () => { evaluation?: Partial<JudgeEvaluationDefaults> } | undefined
  ) {
    this.chainSessionStore = chainSessionStore;
    this.logger = logger;
    this.gateLoader = gateLoader;
    this.gatesConfigProvider = gatesConfigProvider;
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
   * Parse typed submissions directly, or match legacy text against cached verdict patterns.
   * Supports multiple formats for flexibility while maintaining security.
   * Patterns are loaded from YAML configuration for runtime customization.
   *
   * @param raw - Validated structured submission or legacy verdict text
   * @param source - Where the verdict came from (affects security validation)
   * @returns Parsed verdict or null if no pattern matched
   */
  parseVerdict(
    raw: string | GateVerdictSubmission | undefined,
    source: VerdictSource
  ): ParsedVerdict | null {
    if (typeof raw !== 'string') return parseGateVerdict(raw, source);
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
   * Structured entries resolve directly from the original submission, preserving reports.
   * An unknown or duplicate structured index refuses the whole submission before any summaries
   * return. Legacy strings keep their diagnostic-and-drop behavior for out-of-range indexes.
   *
   * @param raw - Validated typed submission or text containing a GATE_VERDICTS block
   * @param gateIds - The gate list this review advertised, in the order it advertised them
   * @param attempt - Review attempt this submission answers, recorded on each entry
   * @returns Gate-id-keyed summaries (empty if no block found or none resolved)
   */
  parseGateVerdicts(
    raw: string | GateVerdictSubmission,
    gateIds: readonly string[],
    attempt?: number
  ): GateVerdictSummary[] {
    if (!raw) {
      return [];
    }

    const timestamp = Date.now();
    if (typeof raw !== 'string') {
      return this.readStructuredVerdicts(raw, gateIds, timestamp, attempt);
    }
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

  /** Resolve structured indexes once, then project reminders after every index has passed. */
  private readStructuredVerdicts(
    submission: GateVerdictSubmission,
    gateIds: readonly string[],
    timestamp: number,
    attempt?: number
  ): GateVerdictSummary[] {
    const seen = new Set<number>();
    const entries = (submission.per_gate ?? []).map((entry): GateVerdictSummary => {
      const gateId = gateIds[entry.index - 1];
      if (gateId === undefined || !Number.isInteger(entry.index) || entry.index < 1) {
        throw new Error(
          `Structured gate verdict refused: index [${entry.index}] names no advertised gate ` +
            `(the review advertised ${gateIds.length}).`
        );
      }
      if (seen.has(entry.index)) {
        throw new Error(`Structured gate verdict refused: duplicate index [${entry.index}].`);
      }
      seen.add(entry.index);
      return {
        gateId,
        verdict: entry.passed ? 'PASS' : 'FAIL',
        rationale: entry.rationale,
        timestamp,
        ...(attempt !== undefined ? { attempt } : {}),
        ...(entry.evaluation !== undefined ? { evaluation: entry.evaluation } : {}),
      };
    });
    return [...this.readReminderAttestation(submission, gateIds, timestamp, attempt), ...entries];
  }

  /**
   * Fold typed reminders or a legacy `REMINDERS:` line into the same gate-id-keyed record.
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
    raw: string | GateVerdictSubmission,
    gateIds: readonly string[],
    timestamp: number,
    attempt?: number
  ): GateVerdictSummary[] {
    const reminders = typeof raw === 'string' ? parseGateVerdictReminders(raw) : raw.reminders;
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

  private buildPendingReview(
    options: CreateReviewOptions,
    definitions: readonly LightweightGateDefinition[]
  ): PendingGateReview {
    const { gateIds, instructions, maxAttempts = DEFAULT_RETRY_LIMIT, metadata } = options;

    const prompts = this.buildReviewPrompts(definitions);

    const pendingReview: PendingGateReview = {
      combinedPrompt: instructions,
      gateIds: [...gateIds],
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
   * Tiers are populated here before any renderer sees the review, including stepless runs
   * that never reach stage 20. Caller-supplied classifications retain priority.
   */
  async createReview(
    sessionId: string,
    kind: GateReviewKind,
    nodeId: string,
    options: CreateReviewOptions & Pick<GateReview, 'reviewedOutput' | 'gateTiers'>
  ): Promise<GateReview> {
    const { reviewedOutput, gateTiers, ...reviewOptions } = options;
    const defaults = { ...this.gatesConfigProvider?.()?.evaluation };
    const definitions = await this.loadReviewDefinitions(reviewOptions.gateIds);
    const resolvedGateTiers = {
      ...this.deriveGateTiers(definitions),
      ...gateTiers,
    };
    const issued = createSemanticReviewContext(nodeId, randomUUID(), definitions, defaults);
    const review: GateReview = {
      ...this.buildPendingReview(reviewOptions, definitions),
      nodeId,
      kind,
      phase: 'awaiting-verdict',
      ...(reviewedOutput !== undefined ? { reviewedOutput } : {}),
      gateTiers: resolvedGateTiers,
      semanticContext:
        reviewedOutput === undefined ? issued : bindSemanticReviewTarget(issued, reviewedOutput),
    };
    await this.chainSessionStore.setReview(sessionId, review);
    return review;
  }

  /** Later capture wiring supplies actual output; submitted evaluation reports never enter here. */
  bindReviewOutput(review: GateReview, actualResponse: string): GateReview {
    const authority = review.semanticContext;
    if (authority === undefined) return review;
    if (authority.nodeId !== review.nodeId) throw new Error('Review authority names another node');
    return { ...review, semanticContext: bindSemanticReviewTarget(authority, actualResponse) };
  }

  /** Retry wiring calls this once: fresh server attempt, same rubric, no prior target. */
  renewReviewAttempt(review: GateReview): GateReview {
    const authority = review.semanticContext;
    if (authority === undefined) return review;
    return { ...review, semanticContext: renewSemanticReviewAttempt(authority, randomUUID()) };
  }

  /**
   * The attempt budget of a review opened on `nodeId` — the one resolver every review-opening
   * path reads (R167): the step's own `retries`, else the largest `retry_config.max_attempts`
   * across this call's gates, else `undefined` (the built-in default). The step path, a detached
   * node's review and the review a verdict opens when none was open all resolve it here, so a
   * gate's limit exhausts after the same number of FAILs whichever path opened its review.
   */
  resolveReviewMaxAttempts(
    context: ExecutionContext,
    nodeId: string,
    ordinal: number
  ): number | undefined {
    const step = parseStepForNode(context.parsedCommand?.steps ?? [], nodeId, ordinal);
    return step?.retries ?? context.gates.getMaxRetryLimit();
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

    // The step definition is addressed by its node id (R77): an inserted node has no parse step,
    // and the one at its ordinal would lend it that step's `retries`. Position only when the
    // context names no node.
    const currentStepNumber = sessionContext.currentStep ?? 1;
    const currentNodeId = sessionContext.currentNodeId ?? undefined;
    const currentStep = parseStepForNode(
      context.parsedCommand?.steps ?? [],
      currentNodeId,
      currentStepNumber
    );
    const nodeId = currentNodeId ?? currentStep?.nodeId;
    if (nodeId === undefined) {
      throw new Error(
        `A gate review of step ${currentStepNumber} was opened on a run that names no node for it`
      );
    }

    const maxAttempts = this.resolveReviewMaxAttempts(context, nodeId, currentStepNumber);
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
   * Add this call's request gates to the open review of the step they were resolved for (R154).
   * A FAIL re-renders that review, so a gate sent with it is shown before a verdict grades it: it
   * joins the review, which carries it from this call on. The gates are this call's temporary
   * gates in the step's resolved set (`reviewGateIds`) — the set the review opens with when no
   * review is open yet (R146). An id the review already holds is a no-op; attempts, history and
   * hints are kept. A call with no verdict joins too while the review awaits one (R173): it
   * re-renders the review, and the next verdict grades what joined. Any other verdict joins
   * nothing: a PASS would close the review ungraded.
   *
   * @returns the stored review, or `review` itself when nothing joined.
   */
  async joinSentGates(
    context: ExecutionContext,
    sessionId: string,
    review: GateReview
  ): Promise<GateReview> {
    const raw = context.getGateVerdict();
    const joins =
      raw === undefined
        ? acceptsVerdictlessJoin(review)
        : this.parseVerdict(raw, 'gate_verdict')?.verdict === 'FAIL';
    if (!joins) {
      return review;
    }
    const sent = new Set(context.state.gates.temporaryGateIds);
    const added = (context.state.gates.reviewGateIds ?? []).filter(
      (id) => sent.has(id) && !review.gateIds.includes(id)
    );
    if (added.length === 0) {
      return review;
    }
    const currentDefinitions = Object.entries(physicalReviewDefinitionIndex(review) ?? {});
    const collision = added.find((id) =>
      currentDefinitions.some(
        ([physicalId, snapshot]) => physicalId !== id && snapshot.definition['id'] === id
      )
    );
    if (collision !== undefined)
      throw new Error(
        `Gate '${collision}' conflicts with frozen authority; open a fresh server-issued review before joining it`
      );
    const defaults = { ...this.gatesConfigProvider?.()?.evaluation };
    const definitions = await this.loadReviewDefinitions(added);
    const issued = createSemanticReviewContext(
      review.nodeId,
      review.semanticContext?.attemptId ?? randomUUID(),
      definitions,
      defaults
    );
    const joined: GateReview = {
      ...review,
      gateIds: [...review.gateIds, ...added],
      prompts: [...review.prompts, ...this.buildReviewPrompts(definitions)],
      ...(review.gateTiers !== undefined
        ? { gateTiers: { ...review.gateTiers, ...this.deriveGateTiers(definitions) } }
        : {}),
      semanticContext: Object.freeze({
        ...issued,
        ...review.semanticContext,
        definitions: Object.freeze({
          ...review.semanticContext?.definitions,
          ...issued.definitions,
        }),
      }),
    };
    await this.chainSessionStore.setReview(sessionId, joined);
    return joined;
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
    const maxAttempts = this.resolveReviewMaxAttempts(context, node.nodeId, node.stepNumber);
    return this.createReview(sessionId, 'detached', node.nodeId, {
      gateIds,
      instructions: '',
      ...(maxAttempts !== undefined ? { maxAttempts } : {}),
      metadata: { ...node, sessionId },
      reviewedOutput,
    });
  }

  /**
   * What a FAIL on a detached node's review does (R10): the mode its OWN gates declare, through
   * `resolveEnforcementMode` — the failed gates when the verdict named them, else every gate of
   * the review. The run's current step is another node, so its published mode says nothing here.
   */
  async resolveReviewEnforcement(
    review: Pick<GateReview, 'gateIds' | 'semanticContext'>,
    failedGateIds: readonly string[]
  ): Promise<EnforcementMode> {
    const physicalDefinitions = physicalReviewDefinitionIndex(review);
    const definitions =
      physicalDefinitions === undefined
        ? await this.loadReviewDefinitions(review.gateIds)
        : review.gateIds.map((id): Pick<LightweightGateDefinition, 'id' | 'enforcementMode'> => {
            const mode = physicalDefinitions[id]?.definition['enforcementMode'];
            return {
              id,
              enforcementMode:
                mode === 'blocking' || mode === 'advisory' || mode === 'informational'
                  ? mode
                  : undefined,
            };
          });
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
  private deriveGateTiers(
    definitions: readonly LightweightGateDefinition[]
  ): NonNullable<GateReview['gateTiers']> {
    return Object.fromEntries(definitions.map((def) => [def.id, deriveGateTier(def)]));
  }

  /**
   * Load once at the review boundary; legacy missing/loading failures retain empty prompts.
   */
  private async loadReviewDefinitions(gateIds: string[]): Promise<LightweightGateDefinition[]> {
    if (!this.gateLoader || gateIds.length === 0) {
      return [];
    }

    try {
      return await this.gateLoader.loadGates(gateIds);
    } catch (error) {
      this.logger.warn('[GateEnforcementAuthority] Failed to load gate definitions for prompts', {
        error,
        gateIds,
      });
      return [];
    }
  }

  private buildReviewPrompts(
    definitions: readonly LightweightGateDefinition[]
  ): GateReviewPrompt[] {
    return definitions.map((def) => ({
      gateId: def.id,
      gateName: def.name,
      criteriaSummary: this.buildCriteriaSummary(def),
    }));
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
