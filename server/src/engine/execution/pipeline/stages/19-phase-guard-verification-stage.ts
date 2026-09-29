// @lifecycle canonical - Enforces framework phase-guard verification in the execution pipeline.
/**
 * Pipeline Stage 19: Phase Guard Verification
 *
 * Deterministic structural validation of LLM output against framework phase guards.
 * Evaluates phase markers and content rules (min_length, contains_any, etc.) without LLM cost.
 *
 * Position: After StepExecutionStage, before GateReviewStage
 *
 * Integration: On failure, creates a PendingGateReview via the gate enforcement authority
 * so the existing gate lifecycle handles persistence, advancement blocking, retry tracking,
 * and review rendering. Phase guards do NOT independently short-circuit via setResponse().
 *
 * Grading moved ahead of the advance (R170): StepResponseCaptureStage calls {@link
 * PhaseGuardVerificationStage.gradeAnswer} after it captured the answer and before it moves the
 * run, and a failing grade holds the run on the answered step. The grade is kept on the call's
 * context; this stage reads it and never grades the same call twice. A call stage 16 did not grade
 * on is graded here.
 *
 * Flow:
 * 1. Grade (or read this call's grade): framework active, guards declared, user_response present
 * 2. If nothing was graded → pass through (no-op)
 * 3. If all pass → merge guard summary into the graded step's own review (if any)
 * 4. If any fail → merge into the open gate review, else create PendingGateReview (R103)
 */

import { resolveGuardedProcessingSteps } from '../../../frameworks/declared-sections.js';
import {
  evaluatePhaseGuards,
  buildPhaseGuardPassSummary,
  buildRetryHints,
} from '../../../frameworks/phase-guards/index.js';
import { composeStructuralReview } from '../decisions/gates/structural-review-composition.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateReview, PendingGateReview } from '#shared/types/chain-execution.js';
import type { ChainSessionService } from '#shared/types/chain-session.js';
import type { PhaseGuardsConfig } from '#shared/types/core-config.js';
import type { FrameworkGuideProvider } from '../../../frameworks/declared-sections.js';
import type { AnswerGrade } from '../../../frameworks/phase-guards/index.js';
import type { ExecutionContext } from '../../context/index.js';

import { isRunComplete } from '#shared/types/chain-session.js';

/** Sentinel gate ID used for phase-guard-created pending reviews. */
export const PHASE_GUARD_GATE_ID = '__phase_guard__';

type FrameworkRegistryProvider = FrameworkGuideProvider;

type PhaseGuardsConfigProvider = () => PhaseGuardsConfig;

/**
 * Phase Guard Verification Stage — thin orchestration layer.
 *
 * Delegates to:
 * - evaluatePhaseGuards(): Pure evaluation logic (from phase-guards module)
 * - FrameworkRegistry: Phase definitions with markers and guards
 * - ChainSessionStore: Pending review persistence (via gate lifecycle)
 * - Config: Phase guard mode
 */
export class PhaseGuardVerificationStage extends BasePipelineStage {
  readonly name = 'PhaseGuardVerification';

  constructor(
    private readonly frameworkRegistryProvider: FrameworkRegistryProvider,
    private readonly configProvider: PhaseGuardsConfigProvider,
    private readonly chainSessionStore: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // The grade stage 16 took before it decided the advance, when it took one (R170): this stage
    // opens the review from that grade and never grades the same call twice.
    const grade = context.state.gates.answerGrade ?? this.gradeAnswer(context);
    if (grade.kind === 'skipped') {
      this.logExit({ skipped: grade.reason });
      return;
    }
    const { result, reviewedStep } = grade;
    const sessionId = context.sessionContext?.sessionId;
    if (sessionId === undefined) {
      this.logExit({ skipped: 'No chain session (phase guards require chain context)' });
      return;
    }
    // Read now, not when graded: the review of the graded step as it stands after this call's
    // verdict, capture and render.
    const gradedReview =
      reviewedStep === undefined
        ? undefined
        : this.chainSessionStore.getReview(sessionId, reviewedStep.nodeId);

    if (result.allPassed) {
      // Phase guards passed — merge structural verification into pending gate review.
      // Guards check structure (sections present); LLM gates check content quality.
      // Both signals compose into a single review rather than guards replacing gates.
      // See docs/architecture/overview.md "Phase Guard–Gate Review Composition".
      // The summary joins the GRADED step's own review (R16), never the shown one.
      const merged = await this.mergePassSummary(context, sessionId, gradedReview, result);
      this.logExit({ passed: true, phases: result.results.length, mergedIntoGateReview: merged });
      return;
    }

    // 8. Handle failures — create PendingGateReview via gate lifecycle
    context.diagnostics.warn(this.name, 'Phase guard failures detected', {
      failedPhases: result.failedPhases,
      maxAttempts: grade.maxAttempts,
      mode: grade.mode,
    });

    if (grade.mode === 'warn') {
      // Warn: log warning, don't block
      context.state.gates.advisoryWarnings.push(
        `[PhaseGuard] ${result.failedPhases.join(', ')} failed structural checks`
      );
      this.logExit({ passed: false, advisory: true, failedPhases: result.failedPhases });
      return;
    }

    // A call that captured no step graded no node's answer: the failure is said, and no review
    // opens (R28) — with no captured node there is nothing to grade against or to hold. A
    // detached node's late report is graded by its own review (`gradeLateReport`), not here.
    if (reviewedStep === undefined) {
      context.diagnostics.warn(this.name, 'Structural failure on a call that captured no step', {
        failedPhases: result.failedPhases,
      });
      this.logExit({ passed: false, skipped: 'No captured step to key a review by' });
      return;
    }

    // Enforce: persist ONE pending review so GateReviewStage renders feedback and
    // StepResponseCaptureStage blocks advancement on the next request. A gate review already
    // open on the graded step absorbs the finding (R103): its gate, criteria, retry budget and
    // spent attempts survive, and the structural findings join it. With no such review, the
    // finding opens its own. `composeStructuralReview` owns which of the two happens.
    const review = composeStructuralReview(gradedReview, {
      gateId: PHASE_GUARD_GATE_ID,
      feedback: result.retryFeedback,
      // Hints name what each check measured, and the add-the-section line is emitted only for a
      // section that is actually absent (`buildRetryHints` owns both halves — a hint is phase-
      // guard vocabulary, not stage orchestration). A hint for an absent section names the
      // phase's actual section_header (e.g. "## Dissolve"), NOT the phase id (e.g.
      // "dissolve_processing"): prefixing "## " onto the id produced a header the section-
      // splitter could never match → the model kept adding the wrong header → loop.
      retryHints: buildRetryHints(result),
      failedPhases: result.failedPhases,
      mode: grade.mode,
      previousResponse: grade.outputText,
      // WHICH step this review graded (row 2.11). Without it the renderer falls through to
      // `current_step`, which by this point in the pipeline may name the step the run ADVANCED
      // to — so the review quoted step N+1's task above step N's missing sections.
      reviewedStep,
      maxAttempts: grade.maxAttempts,
      createdAt: Date.now(),
    });

    await this.persistStructuralReview(context, sessionId, {
      ...review,
      nodeId: reviewedStep.nodeId,
    });

    this.relatchRunCompletion(context, sessionId);

    this.logExit({
      passed: false,
      createdPendingReview: true,
      mergedIntoGateReview: review.gateIds.length > 1,
      failedPhases: result.failedPhases,
      maxAttempts: review.maxAttempts,
    });
  }

  /**
   * Grade the answer this call captured against the framework's phase guards, ONCE per call, and
   * keep the grade on the call's context (R170).
   *
   * StepResponseCaptureStage calls this (through the builder's wiring) after it captured the
   * answer and before it decides the advance, so an answer that fails in `enforce` mode holds the
   * run on the step it answered (`holdsNodeId`) whatever a gate verdict said; {@link execute}
   * then opens the structural review from the same grade. A call stage 16 does not grade on is
   * graded by {@link execute} itself. The evaluation is `evaluatePhaseGuards`, a pure function of
   * the phase-guards module; this method only decides which phases may block and over what text.
   */
  gradeAnswer(context: ExecutionContext): AnswerGrade {
    const grade = this.takeGrade(context);
    context.state.gates.answerGrade = grade;
    if (grade.kind === 'evaluated') {
      this.logger.info('[PhaseGuardVerification] Graded the answer', {
        nodeId: grade.reviewedStep?.nodeId,
        allPassed: grade.result.allPassed,
        holdsNodeId: grade.holdsNodeId,
      });
    }
    return grade;
  }

  private takeGrade(context: ExecutionContext): AnswerGrade {
    // 1. Get phase guard config — skip if mode is "off"
    const config = this.configProvider();
    if (config.mode === 'off') {
      return { kind: 'skipped', reason: 'Phase guards disabled (mode: off)' };
    }

    // 2. Need a chain session for gate lifecycle integration
    const sessionId = context.sessionContext?.sessionId;
    if (!sessionId) {
      return { kind: 'skipped', reason: 'No chain session (phase guards require chain context)' };
    }

    // 3. Check if framework is active (fallback to authority for chain continuation)
    const frameworkId = this.resolveFrameworkId(context);
    if (!frameworkId) {
      return { kind: 'skipped', reason: 'No active framework' };
    }

    // 4. Get framework phases with guards
    const phases = resolveGuardedProcessingSteps(this.frameworkRegistryProvider, frameworkId);
    if (phases.length === 0) {
      return { kind: 'skipped', reason: 'No phases with guards' };
    }

    // 5. Get the LLM's previous response (user_response from chain continuation)
    const outputText = this.extractOutputText(context);
    if (!outputText) {
      return { kind: 'skipped', reason: 'No user_response to evaluate' };
    }

    // 6. Skip if the graded step's review already carries a structural finding (avoid duplicate
    // reviews). Read by the node this call CAPTURED, never the shown review (R16): that one may
    // grade an earlier step, and skipping on it left this step's answer ungraded. A call that
    // captured nothing has no review to read.
    const reviewedStep = this.resolveReviewedStepIdentity(context);
    const gradedReview =
      reviewedStep === undefined
        ? undefined
        : this.chainSessionStore.getReview(sessionId, reviewedStep.nodeId);
    if (gradedReview?.gateIds.includes(PHASE_GUARD_GATE_ID)) {
      return { kind: 'skipped', reason: 'Phase guard review already pending' };
    }

    // 6b. Skip if this call's verdict closed the structural review of the node it would grade.
    // Without this, a PASS closes N's review → this stage re-evaluates the same user_response
    // (N's re-answer, or nothing captured at all) → fails → recreates N's review → loop. A NEXT
    // step captured on the verdict's call is its own answer and is graded (row 3.15).
    const clearedNodeId = context.state.gates.phaseGuardReviewClearedNodeId;
    if (clearedNodeId !== undefined && (reviewedStep?.nodeId ?? clearedNodeId) === clearedNodeId) {
      return { kind: 'skipped', reason: 'Phase guard review cleared by verdict this turn' };
    }

    // 6c. A guard may only block on a header the prompt actually declared (Tier 3.1 / OQ-4).
    // The declaration is read back from what the render RECORDED, never re-derived from
    // `phases.yaml` — that is the source these guards already come from, so re-deriving would
    // make declared and guarded identical by construction and this filter a no-op. A phase whose
    // header was never declared is evaluated for diagnostics but cannot block: the model was not
    // told about it, so failing it is unsatisfiable. No record at all therefore blocks nothing,
    // which can only make enforcement rarer, never stricter.
    const blockingPhases = this.resolveBlockingPhases(context, phases, reviewedStep?.nodeId);
    if (blockingPhases.length === 0) {
      return { kind: 'skipped', reason: 'No declared headers to enforce' };
    }

    // 7. Evaluate phase guards
    const result = evaluatePhaseGuards(outputText, blockingPhases);
    const holds = !result.allPassed && config.mode === 'enforce' && reviewedStep !== undefined;
    return {
      kind: 'evaluated',
      result,
      outputText,
      mode: config.mode,
      maxAttempts: config.maxRetries + 1,
      reviewedStep,
      ...(holds ? { holdsNodeId: reviewedStep.nodeId } : {}),
    };
  }

  /**
   * Prefix the pass summary onto the graded step's review and write it back by its node. The
   * shown review is refreshed only when it IS that review. No review, or one already carrying a
   * summary, merges nothing.
   */
  private async mergePassSummary(
    context: ExecutionContext,
    sessionId: string,
    review: GateReview | undefined,
    result: ReturnType<typeof evaluatePhaseGuards>
  ): Promise<boolean> {
    if (review === undefined || review.metadata?.['phaseGuardContext'] !== undefined) return false;
    const merged: GateReview = {
      ...review,
      combinedPrompt: `${buildPhaseGuardPassSummary(result)}\n\n---\n\n${review.combinedPrompt}`,
      metadata: {
        ...review.metadata,
        phaseGuardContext: {
          allPassed: true,
          phaseCount: result.results.length,
          evaluatedAt: Date.now(),
        },
      },
    };
    await this.chainSessionStore.setReview(sessionId, merged);
    if (context.sessionContext?.pendingReview?.nodeId === merged.nodeId) {
      context.sessionContext = { ...context.sessionContext, pendingReview: merged };
    }
    context.diagnostics.info(this.name, 'Merged phase guard results into gate review', {
      phaseCount: result.results.length,
      nodeId: merged.nodeId,
    });
    return true;
  }

  /**
   * Persist `review`, keyed by the node whose answer was graded (R8), and hand it to
   * GateReviewStage through the context.
   */
  private async persistStructuralReview(
    context: ExecutionContext,
    sessionId: string,
    review: PendingGateReview & { nodeId: string }
  ): Promise<void> {
    await this.chainSessionStore.setPendingGateReview(sessionId, review);
    if (context.sessionContext) {
      context.sessionContext = { ...context.sessionContext, pendingReview: review };
    }
  }

  /**
   * Grade a detached node's late report against the output that node RECORDED (row 3.8).
   *
   * A late report is landed and answered by StepResponseCaptureStage, so {@link execute} never
   * runs on it — and it captures no step, so there would be no node to key a review by if it did.
   * The capture stage calls this instead, with the node the report landed on and the review that
   * landing opened, or re-opened for a replacement. The grade reads `recordedOutput`, never this
   * call's `user_response`, and blocks only on headers the NODE's own render declared.
   *
   * A failing grade joins the node's gate review through `composeStructuralReview` — one review
   * names the gates and the missing sections — or opens a structural review of its own when no
   * gate applies. A replacement's grade supersedes the previous one: the review names only what
   * the new output misses, keeps its spent attempts, and closes once nothing is left in it.
   *
   * @returns the node's review after grading; null when none is open.
   */
  async gradeLateReport(
    context: ExecutionContext,
    sessionId: string,
    node: { readonly nodeId: string; readonly stepNumber: number },
    review: GateReview | null,
    recordedOutput: string
  ): Promise<GateReview | null> {
    const config = this.configProvider();
    const frameworkId = this.resolveFrameworkId(context);
    if (config.mode === 'off' || frameworkId === undefined) return review;
    const phases = this.resolveBlockingPhases(
      context,
      resolveGuardedProcessingSteps(this.frameworkRegistryProvider, frameworkId),
      node.nodeId
    );
    const result = evaluatePhaseGuards(recordedOutput, phases);
    const base = review === null ? undefined : withoutStructuralFinding(review);
    if (result.allPassed || config.mode === 'warn') {
      if (!result.allPassed) {
        context.diagnostics.warn(this.name, 'Late report failed structural checks (warn mode)', {
          nodeId: node.nodeId,
          failedPhases: result.failedPhases,
        });
      }
      return this.settleGrade(sessionId, review, base);
    }
    const composed = composeStructuralReview(base, {
      gateId: PHASE_GUARD_GATE_ID,
      feedback: result.retryFeedback,
      retryHints: buildRetryHints(result),
      failedPhases: result.failedPhases,
      mode: config.mode,
      previousResponse: recordedOutput,
      reviewedStep: { stepNumber: node.stepNumber, nodeId: node.nodeId },
      maxAttempts: config.maxRetries + 1,
      createdAt: Date.now(),
    });
    // A merged review is the gate review with the finding added; a structural one of its own
    // still inherits what the node's review already spent (a replacement of a structural review).
    const graded: GateReview = {
      ...composed,
      nodeId: node.nodeId,
      kind: 'detached',
      phase: base?.phase ?? 'awaiting-verdict',
      reviewedOutput: recordedOutput,
      attemptCount: base?.attemptCount ?? 0,
      maxAttempts: base?.maxAttempts ?? composed.maxAttempts,
      history: base?.history ?? [],
    };
    await this.chainSessionStore.setReview(sessionId, graded);
    return graded;
  }

  /**
   * Persist a passing grade: a review whose previous structural finding was dropped is written
   * back without it, or deleted when that finding was all it held.
   */
  private async settleGrade(
    sessionId: string,
    review: GateReview | null,
    base: GateReview | undefined
  ): Promise<GateReview | null> {
    if (review === null || base === undefined || base === review) return review;
    if (base.gateIds.length === 0) {
      await this.chainSessionStore.clearPendingGateReview(sessionId, { nodeId: base.nodeId });
      return null;
    }
    await this.chainSessionStore.setReview(sessionId, base);
    return base;
  }

  /**
   * Read the completion latch again after this stage opened a review (P4.119 / R96).
   *
   * Stage 18 latched completion before the review existed: on the final step the capture has
   * already walked the run past its last node. The latch is `isRunComplete`, which an outstanding
   * review holds open, so it is re-read where its input just changed — otherwise one reply says
   * both "complete" and "awaiting your verdict".
   */
  private relatchRunCompletion(context: ExecutionContext, sessionId: string): void {
    if (context.state.session.chainComplete !== true) return;
    const run = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
    context.state.session.chainComplete = run !== undefined && isRunComplete(run);
  }

  /**
   * Resolve the active framework ID from context or cached authority decision.
   *
   * On first request: FrameworkResolutionStage populates frameworkContext → read from there.
   * On chain continuation: FrameworkResolutionStage skips (blueprint-restored) → fall back to
   * FrameworkDecisionAuthority which was populated by GateEnhancementStage.
   */
  private resolveFrameworkId(context: ExecutionContext): string | undefined {
    const fromContext = context.frameworkContext?.selectedFramework?.id;
    if (fromContext) return fromContext;

    return context.frameworkAuthority.getCachedFrameworkId();
  }

  /**
   * The guarded phases that may block for `gradedNodeId`: those whose header the node's render
   * declared (6c above). The rest are advisory and only logged.
   */
  private resolveBlockingPhases<P extends { section_header?: string | undefined }>(
    context: ExecutionContext,
    phases: readonly P[],
    gradedNodeId: string | undefined
  ): P[] {
    const declaredHeaders = this.resolveDeclaredHeaders(context, gradedNodeId);
    const blocking = phases.filter(
      (phase) => phase.section_header !== undefined && declaredHeaders.has(phase.section_header)
    );
    if (blocking.length < phases.length) {
      this.logger.warn('[PhaseGuard] Guards on undeclared headers are advisory this turn', {
        undeclared: phases
          .filter((phase) => !blocking.includes(phase))
          .map((phase) => phase.section_header),
        declaredCount: declaredHeaders.size,
      });
    }
    return blocking;
  }

  /**
   * Headers the model was actually shown for the node being graded.
   *
   * Per node, not run-wide (R85 / P4.111). Each node's declaration is written by its own render
   * and follows that node's own injection decision, so a step that opted out of the framework
   * recorded nothing and is graded against nothing. The run-wide union this replaced blocked such
   * a step on its SIBLINGS' vocabulary: headers a different prompt was shown, which this one was
   * told nothing about — the unsatisfiable guard the declaration contract exists to prevent.
   *
   * The union survives as the fallback for a call that captured no step identity, where there is
   * no node to ask. Such a call opens no review (R28), so the union decides only whether its
   * failure is reported. It is a union over nodes that DID declare, so an opted-out node still
   * contributes nothing to it. An empty set means nothing was recorded, which blocks nothing.
   */
  private resolveDeclaredHeaders(
    context: ExecutionContext,
    gradedNodeId: string | undefined
  ): Set<string> {
    const headers = new Set<string>();
    const sessionId = context.sessionContext?.sessionId;
    if (sessionId === undefined) return headers;

    // `state` is non-optional on the type but absent on partial test doubles and on a session
    // restored before its state was hydrated; read defensively rather than trusting the shape.
    const session = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
    const stepStates = session?.state?.stepStates;
    if (stepStates === undefined) return headers;

    // The node this stage is grading — the same identity the review is stamped with: the step the
    // capture RECORDED, or the detached node a late report landed on — never the run's position,
    // which has already advanced.
    //
    // The per-node answer is used only when that node has a declaration ON RECORD, empty
    // included: an empty array is a render saying "I declared nothing", which grades against
    // nothing, while an ABSENT array is a node no render wrote for, which still falls back to the
    // run. A gated chain step's only render is its gate review, and stage 20 records that review's
    // declaration against the reviewed node (P4.115), so such a step is graded on its own headers.
    // Reading absent as empty would quietly stop enforcing wherever no render recorded.
    const graded = gradedNodeId === undefined ? undefined : stepStates.get(gradedNodeId);
    if (graded?.declaredSections !== undefined) {
      for (const header of graded.declaredSections) {
        headers.add(header);
      }
      return headers;
    }

    for (const metadata of stepStates.values()) {
      for (const header of metadata.declaredSections ?? []) {
        headers.add(header);
      }
    }
    return headers;
  }

  /**
   * The identity of the step this stage is grading, for the review's metadata (row 2.11).
   *
   * Read from what the capture RECORDED (`context.state.session.capturedStep`), never derived
   * from the run's position: this stage runs after StepResponseCaptureStage has already advanced
   * the run, and `currentStep - 1` is wrong exactly on the calls where no advance happened — the
   * final step, and any step whose advance a pending review blocked.
   *
   * Empty when this call captured nothing. The caller then opens no review (a review is keyed by
   * the node it grades, R8); stamping a guess instead would grade a step nobody answered.
   */
  private resolveReviewedStepIdentity(
    context: ExecutionContext
  ): { stepNumber: number; nodeId: string } | undefined {
    const captured = context.state.session.capturedStep;
    if (captured === undefined) return undefined;
    return { stepNumber: captured.ordinal, nodeId: captured.nodeId };
  }

  /**
   * Extract the LLM's previous response for phase guard evaluation.
   *
   * Reads `user_response` from the MCP request — the LLM's actual output
   * from the previous turn. This is what guards should validate (did the
   * LLM follow framework phases?), NOT the rendered template from StepExecutionStage.
   */
  private extractOutputText(context: ExecutionContext): string | undefined {
    const userResponse = context.mcpRequest.user_response?.trim();
    if (typeof userResponse === 'string' && userResponse.length > 0) return userResponse;
    return undefined;
  }
}

/**
 * `review` without the structural finding a previous grade merged into it, or `review` itself
 * when it carries none. Exact for a DETACHED review only: it opens with an empty prompt and no
 * hints (`openDetachedReview`) and a verdict adds neither, so every prompt line and hint on one
 * came from a grade — which the grade of a replacement report supersedes.
 */
function withoutStructuralFinding(review: GateReview): GateReview {
  if (!review.gateIds.includes(PHASE_GUARD_GATE_ID)) return review;
  const {
    failedPhases: _phases,
    mode: _mode,
    source: _source,
    ...metadata
  } = review.metadata ?? {};
  return {
    ...review,
    gateIds: review.gateIds.filter((gateId) => gateId !== PHASE_GUARD_GATE_ID),
    combinedPrompt: '',
    retryHints: [],
    metadata,
  };
}

/**
 * Factory function for creating the phase guard verification stage.
 */
export function createPhaseGuardVerificationStage(
  frameworkRegistryProvider: FrameworkRegistryProvider,
  configProvider: PhaseGuardsConfigProvider,
  chainSessionStore: ChainSessionService,
  logger: Logger
): PhaseGuardVerificationStage {
  return new PhaseGuardVerificationStage(
    frameworkRegistryProvider,
    configProvider,
    chainSessionStore,
    logger
  );
}
