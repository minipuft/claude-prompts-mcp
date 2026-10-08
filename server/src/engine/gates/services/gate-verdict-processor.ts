// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import {
  describeRefusal,
  describeMissingReview,
  describeGatelessStep,
  describeInBudgetAction,
  describeUnansweredStep,
} from './gate-review-refusal.js';
import {
  failedReviewGateIds,
  projectGateVerdictSummaries,
  projectVerdictDetection,
  projectReviewActionDetection,
} from './gate-verdict-summary.js';
import {
  projectCurrentResponseTarget,
  announceAdvancedStep,
  recordedStep,
} from '../../execution/capture/step-capture-service.js';
import { collectDetachedNodeFacts, collectRunHolds } from '../../execution/delegation/detached.js';
import { advanceReview } from '../../execution/pipeline/decisions/gates/review-lifecycle.js';
import { resolveReviewTarget } from '../../execution/pipeline/decisions/gates/review-target.js';
import {
  readSemanticReviewCriteria,
  projectRenewedSemanticCapture,
  resolvePinnedSemanticContext,
  resolveSemanticTargetResponseAdmission,
} from '../../execution/pipeline/decisions/gates/semantic-review-context.js';
import {
  hasStructuralFinding,
  selectToolReviewGateIds,
} from '../../execution/pipeline/decisions/gates/structural-review-composition.js';
import {
  isUnknownInterruptPending,
  resolveEnforcementMode,
} from '../../execution/pipeline/decisions/index.js';
import { buildPipelineHookContext } from '../../execution/pipeline/hook-context.js';
import { parseGateVerdict } from '../core/gate-verdict-contract.js';
import {
  evaluateSemanticEvaluation,
  semanticAttributionFaults,
  semanticFailureReasons,
} from '../core/semantic-evaluation.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  GateCheckResult,
  GateReview,
  GateReviewSemanticContext,
  GateVerdictSummary,
} from '#shared/types/chain-execution.js';
import type { McpToolRequest } from '#shared/types/execution.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '#shared/types/index.js';
import type { StateStoreOptions } from '#shared/types/persistence.js';
import type { SemanticGateSummaryFacts } from './gate-verdict-summary.js';
import type { ExecutionContext, SessionContext } from '../../execution/context/index.js';
import type { HandoffEvidenceMode } from '../../execution/delegation/handoff-contract.js';
import type { ReviewEvent } from '../../execution/pipeline/decisions/gates/review-lifecycle.js';
import type { SemanticTargetAdmission } from '../../execution/pipeline/decisions/gates/semantic-review-context.js';
import type {
  EnforcementMode,
  GateAction,
  InterruptResolutionAction,
} from '../../execution/pipeline/decisions/index.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

import { currentOrdinal, ordinalOf } from '#shared/utils/node-order.js';

/**
 * Outcome of a mid-chain interrupt resolution attempt (row 2.2).
 *
 * A named refusal carrying its own message, never a boolean: the plan requires every refusal to
 * tell the submitter WHY, and three different refusals collapsed into `false` is how a caller
 * ends up retrying the one thing that cannot work.
 */
export type InterruptResolution =
  { readonly kind: 'resolved' } | { readonly kind: 'refused'; readonly message: string };

/**
 * A step advance this call DECIDED but has not performed (P4.89).
 *
 * Every advance this processor reaches — a PASS clearing a review, and an advisory or
 * informational FAIL walking past one — used to run inside the verdict method, which is BEFORE
 * `StepCaptureService` captures the step that verdict answered. On a run's final step that
 * ordering is observable on the wire: advancing past the last node latches the run `completed`
 * and announces `chain/complete`, so a client that tears its handler down on the terminal event
 * never saw the `chain/step_complete` for the step it had just answered. Measured on a driven
 * two-step chain for both a gated PASS and an advisory FAIL.
 *
 * So the decision is returned instead of executed, and the stage applies it after the capture.
 * The node is the one the answered review GRADES (row 3.3), never the run's position: a review
 * opened on N while the run stands on N+1 advances past N, which the run already left — and
 * `advanceStep` no-ops on a node the run has passed, which is also what makes applying this
 * twice, or after the capture already did it, safe rather than a double advance.
 */
export interface DeferredAdvance {
  readonly sessionId: string;
  /** The node the run advances PAST — the node the answered review graded. */
  readonly nodeId: string;
  /** Why the run advances: the diagnostic line, and the `step_complete` status (skip: `failed`). */
  readonly reason: 'captured' | 'gate-pass' | 'advisory-fail' | 'informational-fail' | 'gate-skip';
}

/**
 * Result of processing gate verdicts for a request.
 */
export interface VerdictProcessingResult {
  /** Whether a PASS verdict advanced the step in this call */
  readonly passClearedThisCall: boolean;
  /** Whether the pipeline should exit early after verdict processing */
  readonly earlyExit: boolean;
  /** User response (may be unchanged or set to undefined if consumed by verdict) */
  readonly userResponse: string | undefined;
  /** The advance this call decided, for the stage to apply after the capture — see {@link DeferredAdvance}. */
  readonly deferredAdvance?: DeferredAdvance;
}

/** What a verdict or `gate_action` on a detached node's review did (row 4.8). */
export type DetachedReviewVerdictResult =
  | { readonly kind: 'refused'; readonly message: string }
  | {
      readonly kind: 'recorded';
      /** `cleared`: a FAIL on a review whose gates are not blocking (R10) — the result stands. */
      readonly result: 'passed' | 'failed' | 'exhausted' | 'retry' | 'skipped' | 'cleared';
      readonly attempt: number;
      readonly maxAttempts: number;
    };

/** A transition {@link advanceReview} applied — every outcome but a refusal. */
type AppliedAdvance = Exclude<ReturnType<typeof advanceReview>, { outcome: 'refused' }>;

/**
 * What answering a review did: the review as it stood when the event landed, the transition,
 * and the enforcement mode that decided a FAIL. A refusal carries the sentence the caller reads.
 */
type ReviewAnswer =
  | { readonly kind: 'refused'; readonly message: string }
  | {
      readonly kind: 'answered';
      readonly review: GateReview;
      readonly advance: AppliedAdvance;
      readonly enforcement: EnforcementMode;
      /** The gates the verdict failed BY NAME (R107); empty for any other event. */
      readonly failedGateIds: readonly string[];
      readonly verdict?: ParsedGateVerdict;
    };

type SemanticGateDecision =
  | ({ readonly kind: 'passed' } & SemanticGateSummaryFacts)
  | ({ readonly kind: 'failed'; readonly hint: string } & SemanticGateSummaryFacts)
  | { readonly kind: 'refused'; readonly message: string };

type AdjudicatedReviewEvent =
  | {
      readonly kind: 'accepted';
      readonly event: ReviewEvent;
      readonly review: GateReview;
      readonly failedGateIds: readonly string[];
      readonly semantic?: readonly SemanticGateSummaryFacts[];
    }
  | { readonly kind: 'refused'; readonly message: string };

/** One event reaching the one review path, and how to find — or open — the review it answers. */
interface ReviewEntry {
  readonly event: ReviewEvent;
  /** The node a `HANDOFF RESULT` trailer names, when the call addressed one. */
  readonly trailerNodeId?: string;
  /**
   * Opens the review a verdict answers when none is open (the deferred entry). A PASS sent with
   * no answer gets none: it captures nothing, so it may not open a review on a step nobody
   * answered and advance it (R19).
   */
  readonly open?: (nodeId: string) => Promise<GateReview>;
  /** Grades the review before the event lands — a detached review's checks (R10.3). */
  readonly grade?: (review: GateReview) => Promise<GateReview>;
  /** The call carries no answer; with an unanswered node, the verdict grades nothing (R26). */
  readonly answerless?: boolean;
}

/**
 * The review a call addresses, through the one owner of that question (`resolveReviewTarget`).
 * Without a trailer it is the run's step review; a detached node's review answers only by name.
 */
export function addressedReview(
  session: ChainSession,
  trailerNodeId?: string
): ReturnType<typeof resolveReviewTarget> {
  return resolveReviewTarget({
    reviews: session.reviews ?? {},
    currentNodeId: session.state.currentNodeId,
    nodeIds: session.state.nodes.map((node) => node.id),
    ...(trailerNodeId !== undefined ? { trailerNodeId } : {}),
  });
}

/**
 * Processes gate verdicts, handles gate actions (retry/skip/abort),
 * and emits gate lifecycle events via hooks and notifications.
 *
 * Extracted from StepResponseCaptureStage.
 */
export class GateVerdictProcessor {
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger,
    private readonly hookRegistry?: HookRegistryPort,
    private readonly notificationEmitter?: McpNotificationEmitterPort,
    /**
     * Runs a review's ground-truth checks (`runGateReviewEvidence`, bound to the gate loader and
     * the executors at the composition root) for a DETACHED node's review, whose checks run when
     * its verdict arrives (row 4.8). Absent, a detached review records no check results — the
     * same outcome as a review of reminder-tier gates. `scope` is the verdict request's, for the
     * shell executor's gate master-switch read.
     * `issuedDefinitions` is the review's own frozen authority; omitted on legacy reviews.
     */
    private readonly runReviewChecks?: (
      gateIds: string[],
      agentResponse: string,
      scope: StateStoreOptions | undefined,
      issuedDefinitions?: GateReviewSemanticContext['definitions']
    ) => Promise<GateCheckResult[]>
  ) {}

  /** Target admission precedes resume routing, unknown observations and direct verdict grading. */
  admitSemanticTargetResponse(
    context: ExecutionContext,
    session: ChainSession,
    options: {
      currentStepAtStart?: number;
      evidenceMode?: HandoffEvidenceMode;
      trailerNodeId?: string;
    } = {}
  ): SemanticTargetAdmission {
    const ordinal =
      options.currentStepAtStart ??
      currentOrdinal(session.state.nodes, session.state.currentNodeId);
    return resolveSemanticTargetResponseAdmission({
      verdictPresent: context.getGateVerdict() !== undefined,
      suppliedResponse: context.mcpRequest.user_response,
      currentResponseNodeId: projectCurrentResponseTarget(session, ordinal)?.nodeId,
      currentNodeId: session.state.currentNodeId,
      nodeIds: session.state.nodes.map((node) => node.id),
      reviews: session.reviews ?? {},
      currentStep: recordedStep(context, session, session.state.currentNodeId ?? undefined, ordinal)
        .step,
      detachedNodes: collectDetachedNodeFacts(context.parsedCommand?.steps, session),
      holds: collectRunHolds(session),
      evidenceMode: options.evidenceMode,
      trailerNodeId: options.trailerNodeId,
      actionPresent: context.mcpRequest.gate_action !== undefined,
    });
  }

  /**
   * Answer a detached node's gate review with this call's `gate_verdict` (row 4.8, R8/R10).
   *
   * The review is the one the trailer names (`nodeId`), and nothing here reads or moves the step
   * the run stands on. Before the verdict lands, the gates' shell and script checks run against
   * the node's RECORDED output (`reviewedOutput`, R10.3) and are recorded on the review; a PASS
   * over a failing one is refused and spends no attempt. A blocking FAIL asks for a replacement
   * report, or — once the attempts are spent — a `gate_action`; a FAIL on gates that are not
   * blocking clears the review (R10). A PASS deletes the review.
   *
   * @returns the refusal sentence when nothing was recorded; otherwise the outcome and counter.
   */
  async processDetachedReviewVerdict(
    context: ExecutionContext,
    session: ChainSession,
    nodeId: string
  ): Promise<DetachedReviewVerdictResult> {
    const payload = this.parseVerdict(context, context.getGateVerdict(), 'gate_verdict');
    if (payload === null) {
      return {
        kind: 'refused',
        message: '❌ The gate_verdict could not be read. Nothing was recorded.',
      };
    }
    const answer = await this.answerReview(context, session, {
      event: { type: 'verdict', verdict: payload, at: Date.now() },
      trailerNodeId: nodeId,
      grade: async (review) => {
        const checkResults =
          this.runReviewChecks === undefined
            ? []
            : await this.runReviewChecks(
                selectToolReviewGateIds(review),
                review.reviewedOutput ?? '',
                context.getScopeOptions(),
                review.semanticContext?.definitions
              );
        return checkResults.length > 0 ? { ...review, checkResults } : review;
      },
    });
    if (answer.kind === 'refused') {
      return answer;
    }
    const { review, advance } = answer;
    const effectiveVerdict = answer.verdict ?? payload;
    this.recordVerdictDetection(context, effectiveVerdict, advance.outcome, review.nodeId);
    const passed = advance.outcome === 'passed';
    await this.emitGateEvents(
      context,
      passed ? 'passed' : 'failed',
      [...review.gateIds],
      effectiveVerdict.rationale
    );
    return {
      kind: 'recorded',
      // A verdict lands on one of these four; `reopened` and `aborted` answer other events.
      result: advance.outcome as 'passed' | 'failed' | 'exhausted' | 'cleared',
      attempt: advance.attempt,
      maxAttempts: review.maxAttempts,
    };
  }

  /**
   * Resolve an exhausted detached review with `gate_action` (row 4.8): `retry` resets the counter
   * and asks for another replacement; `skip` accepts the recorded result and deletes the review.
   * `abort` is refused here — `cancel: true` is how a run is stopped, and it needs no node.
   */
  async processDetachedReviewAction(
    context: ExecutionContext,
    session: ChainSession,
    nodeId: string,
    action: GateAction | InterruptResolutionAction
  ): Promise<DetachedReviewVerdictResult> {
    const answer =
      action === 'retry' || action === 'skip'
        ? await this.answerReview(context, session, {
            event: { type: 'gate_action', action, at: Date.now() },
            trailerNodeId: nodeId,
          })
        : undefined;
    if (answer?.kind !== 'answered') {
      return {
        kind: 'refused',
        message: `❌ gate_action "${action}" does not resolve a detached review: use "retry" or "skip", or cancel: true. Nothing was recorded.`,
      };
    }
    return {
      kind: 'recorded',
      result: answer.advance.outcome === 'reopened' ? 'retry' : 'skipped',
      attempt: answer.advance.attempt,
      maxAttempts: answer.review.maxAttempts,
    };
  }

  /**
   * Apply a detached node's replacement report to its review (R10.2): the counter and history
   * its FAIL charged stay, the new output replaces the graded one, and the review awaits a
   * verdict again. The detached router sends only a report whose review awaits a replacement.
   *
   * @returns the reopened review, or `null` when the review did not accept a replacement.
   */
  async applyReplacementReport(
    context: ExecutionContext,
    session: ChainSession,
    nodeId: string,
    output: string
  ): Promise<GateReview | null> {
    const answer = await this.answerReview(context, session, {
      event: { type: 'replacement-report', output },
      trailerNodeId: nodeId,
    });
    return answer.kind === 'answered' ? answer.advance.review : null;
  }

  /**
   * Resolve a mid-chain blocking-unknown interrupt with `resume` or `accept_alternative`
   * (OQ-4, row 2.2).
   *
   * Separate entry point from {@link handleGateAction}, not a fifth case inside it: that method
   * answers "the retry budget is spent, what now", and every branch of it addresses a gate the
   * run failed. This one addresses a hold NO gate produced — the run's steps all passed, and what
   * stopped it is a caller-declared unknown. Sharing an entry point would put a retry's counter
   * reset and a `cancelChain` in reach of a verb that means neither.
   *
   * BOTH verbs are refused, by name, in the two states where they could otherwise acquire an
   * unintended meaning:
   *
   * - **nothing pending** — the run is not holding, so there is nothing to resume. Answering
   *   silently would let a client "resume" a run that was already advancing and read the next
   *   step as confirmation the verb worked.
   * - **an ORDINARY pending review** — a real gate review is outstanding, and `resume` is not a
   *   verdict. Accepting it here would be a second, undocumented way to clear a gate hold
   *   without answering it, which is exactly what `gate_action: 'skip'` is for and is deliberately
   *   gated behind retry exhaustion.
   *
   * `accept_alternative` additionally requires that a `remainder` was accepted on this same call
   * (plan §Interrupt payload). `remainderAccepted` is passed in rather than re-read, because the
   * caller already applied it and the two facts must be the same fact — a check that re-derived
   * "was there a remainder" could say yes for a submission the store refused.
   *
   * @returns `resolved` when the review was cleared and the run may continue into its step;
   *   `refused` carrying the sentence the submitter reads. Never throws: an inadmissible verb is
   *   a client error with an explanation, the posture `WorkflowCommandBuilder` and
   *   `RemainderProcessor` both take.
   */
  async resolveUnknownInterrupt(
    context: ExecutionContext,
    sessionId: string,
    action: InterruptResolutionAction,
    sessionContext: SessionContext,
    remainderAccepted: boolean
  ): Promise<InterruptResolution> {
    const session = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
    const target = session === undefined ? undefined : addressedReview(session);
    const pending = target?.kind === 'review' ? session?.reviews?.[target.nodeId] : undefined;

    if (pending === undefined) {
      return {
        kind: 'refused',
        message:
          `gate_action:"${action}" refused: this run is not holding on a blocking-unknown ` +
          'interrupt. It is only meaningful while the response reports ' +
          '`chain_interrupt.paused: true`.',
      };
    }

    if (!isUnknownInterruptPending(pending)) {
      return {
        kind: 'refused',
        message:
          `gate_action:"${action}" refused: this run is holding on a gate review ` +
          `(${(pending.gateIds ?? []).join(', ')}), not on a blocking-unknown interrupt. ` +
          'Answer it with `gate_verdict`.',
      };
    }

    if (action === 'accept_alternative' && !remainderAccepted) {
      return {
        kind: 'refused',
        message:
          'gate_action:"accept_alternative" refused: it accepts a plan, so it requires a ' +
          '`remainder` in the SAME call. Send `remainder:{mode:"replace", nodes:[…]}` alongside ' +
          'it, or use gate_action:"resume" to continue with the current plan.',
      };
    }

    await this.chainSessionStore.clearReview(sessionId, pending.nodeId);

    // Stage 18 skips step execution while `sessionContext.pendingReview` is set, and it reads
    // context rather than the store — so clearing one without the other leaves the run resumed
    // in storage and still silent on the wire.
    const clearedContext = { ...sessionContext };
    delete clearedContext.pendingReview;
    context.sessionContext = clearedContext;

    context.diagnostics.info('GateVerdictProcessor', 'Blocking-unknown interrupt resolved', {
      sessionId,
      action,
      remainderAccepted,
    });

    return { kind: 'resolved' };
  }

  /**
   * Resolve the step review's exhaustion with `gate_action` (retry/skip/abort).
   *
   * Only an exhausted review accepts one (R9); {@link refusesInBudgetAction} answers an action
   * sent while the review still has attempts left.
   *
   * `retry` and `skip` are events on the review (`advanceReview`): retry reopens it with the
   * counter reset, skip clears it and accepts the answer the step already holds (R24) — it
   * announces that step and returns the advance past it, for the stage to apply. A skip on a step
   * that holds no answer is refused by name and records nothing: a call with no answer advances
   * nothing (R19). `abort` cancels the RUN, not just the request:
   * `context.state.session.aborted` is per-request state that stage 21 reads to write a
   * `cancelled` execution record — it says the run ended without ending it, and until the cancel
   * landed the next call resumed the chain the user had just aborted. `cancelChain` returns false
   * for an already-terminal run; the run is over either way, so the abort exit still stands.
   *
   * @returns the advance a skip decided; the pipeline exits early after every action.
   */
  async handleGateAction(
    context: ExecutionContext,
    session: ChainSession,
    gateAction: GateAction,
    sessionContext: SessionContext
  ): Promise<DeferredAdvance | undefined> {
    const sessionId = session.sessionId;
    context.state.gates.retryLimitExceeded = false;
    context.state.gates.awaitingUserChoice = false;
    context.state.gates.gateActionAnsweredReview = true;

    if (gateAction === 'abort') {
      if (!(await this.chainSessionStore.cancelChain(sessionId))) {
        this.logger.warn(
          `[GateVerdictProcessor] Abort requested for session ${sessionId}, but the run could not be cancelled (already terminal or out of scope)`
        );
      }
      context.state.session.aborted = true;
      context.diagnostics.info(
        'GateVerdictProcessor',
        'User chose to abort chain after gate failure',
        {
          sessionId,
          failedGates: context.state.gates.retryExhaustedGateIds,
        }
      );
      return undefined;
    }

    const target = addressedReview(session);
    if (
      gateAction === 'skip' &&
      target.kind === 'review' &&
      !this.holdsAnswer(target.nodeId, session)
    ) {
      const ordinal = ordinalOf(session.state.nodes, target.nodeId);
      const message = `❌ gate_action "skip" refused: nothing to skip past on step ${ordinal}; answer it first. Nothing was recorded.`;
      context.setResponse({ content: [{ type: 'text', text: message }], isError: true });
      return undefined;
    }

    const answer = await this.answerReview(context, session, {
      event: { type: 'gate_action', action: gateAction, at: Date.now() },
    });
    if (answer.kind === 'refused') {
      context.setResponse({ content: [{ type: 'text', text: answer.message }], isError: true });
    } else if (answer.advance.review !== null) {
      sessionContext.pendingReview = answer.advance.review;
      context.sessionContext = { ...sessionContext };
      context.diagnostics.info('GateVerdictProcessor', 'User chose to retry after exhaustion', {
        sessionId,
      });
    } else {
      const clearedContext = { ...sessionContext };
      delete clearedContext.pendingReview;
      context.sessionContext = clearedContext;
      context.diagnostics.warn('GateVerdictProcessor', 'User chose to skip failed gate', {
        sessionId,
        skippedGates: context.state.gates.retryExhaustedGateIds,
      });
      return { sessionId, nodeId: answer.review.nodeId, reason: 'gate-skip' };
    }
    return undefined;
  }

  /**
   * Refuse, by name, a `gate_action` sent while the step review still has attempts left, and
   * record nothing (P6.76). The review is waiting for an answer or a verdict; before this the
   * action fell through to the verdict path and came back as the same review with `isError:
   * false`, neither applied nor refused. A pending shell check is the other holder that takes a
   * `gate_action`, at any attempt (P6.32), so while one is pending the action is left to it.
   *
   * @returns true when the call was refused and its response is set.
   */
  refusesInBudgetAction(
    context: ExecutionContext,
    session: ChainSession,
    gateAction: GateAction
  ): boolean {
    const target = addressedReview(session);
    const review = target.kind === 'review' ? session.reviews?.[target.nodeId] : undefined;
    if (
      review === undefined ||
      review.phase === 'exhausted' ||
      this.chainSessionStore.getPendingShellVerification(session.sessionId) !== undefined
    ) {
      return false;
    }
    const message = describeInBudgetAction(gateAction, review, session);
    context.setResponse({ content: [{ type: 'text', text: message }], isError: true });
    return true;
  }

  /**
   * Refuse, by name, a `gate_action` sent while the run holds nothing it could act on — no review
   * and no pending shell check (R169) — and record nothing. Before this the action fell through
   * to the verdict path and the call re-rendered the step with `isError: false`, neither applied
   * nor refused: a client that sent `retry` read the step as its retry, and one that sent `abort`
   * read a run it believed stopped. The same refusal family as {@link refusesInBudgetAction}.
   *
   * @returns true when the call was refused and its response is set.
   */
  refusesUnheldAction(
    context: ExecutionContext,
    session: ChainSession,
    gateAction: GateAction
  ): boolean {
    if (
      Object.keys(session.reviews ?? {}).length > 0 ||
      this.chainSessionStore.getPendingShellVerification(session.sessionId) !== undefined
    ) {
      return false;
    }
    const stop = gateAction === 'abort' ? ' To stop the run, send cancel: true.' : '';
    const message =
      `❌ gate_action "${gateAction}" has nothing to act on: this run holds no gate review and ` +
      `no shell check.${stop} Nothing was recorded.`;
    context.setResponse({ content: [{ type: 'text', text: message }], isError: true });
    return true;
  }

  /**
   * Announce the step the run just moved past, with the output it was captured with (R25). The
   * one emitter of `step_complete` for a run's own advance; a skipped step is `failed`: its gates
   * failed, and the run moves past it anyway.
   */
  private async announceAdvancedStep(
    context: ExecutionContext,
    session: ChainSession,
    advance: DeferredAdvance
  ): Promise<void> {
    await announceAdvancedStep({
      context,
      session,
      advance,
      chainSessionStore: this.chainSessionStore,
      logger: this.logger,
      hookRegistry: this.hookRegistry,
      notificationEmitter: this.notificationEmitter,
    });
  }

  /**
   * Answer the review this call's `gate_verdict` addresses — the one path for every verdict on a
   * step review (row 3.3). The review is the one the trailer names, else the run's step review,
   * which may grade a node the run has already left (a phase-guard review, a final step). With
   * none open, the verdict opens one on the node the run stands on, grading that step's resolved
   * gates (`stepReviewGateIds`), and answers it in the same call (the deferred entry); that needs the authority, and without it the verdict is ignored
   * as before. A PASS sent with no answer captures nothing, so it advances nothing (R19): it
   * opens no review, and on a review of a node that holds no captured output (the review stage
   * 13 opens when a gated step renders) it is refused, naming the step to answer first. A bare
   * FAIL still spends an attempt (P4.116).
   *
   * One submission is one recorded attempt, whichever entry it took (P4.116). A refusal — an
   * unknown or review-less node, an exhausted review (R9), a PASS over a failing check — records
   * nothing and ends the call with the sentence the submitter reads.
   */
  async processReviewVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionContext: SessionContext,
    userResponse: string | undefined,
    trailerNodeId?: string
  ): Promise<VerdictProcessingResult> {
    const untouched = { passClearedThisCall: false, earlyExit: false, userResponse };
    const verdictPayload = this.parseVerdict(context, context.getGateVerdict(), 'gate_verdict');
    const authority = context.gateEnforcement;
    const hasResponse = typeof userResponse === 'string' && userResponse.length > 0;
    const opensNone = authority === undefined && trailerNodeId === undefined;
    if (
      verdictPayload === null ||
      (opensNone && addressedReview(session).kind === 'refuse') ||
      this.passGradesNothing(context, session, verdictPayload, hasResponse, trailerNodeId)
    ) {
      return untouched;
    }
    const captureNodeId = projectCurrentResponseTarget(
      session,
      currentOrdinal(session.state.nodes, session.state.currentNodeId)
    )?.nodeId;
    const answer = await this.answerVerdict(
      context,
      session,
      verdictPayload,
      hasResponse,
      trailerNodeId
    );
    if (answer.kind === 'refused') {
      context.setResponse({ content: [{ type: 'text', text: answer.message }], isError: true });
      context.diagnostics.warn('GateVerdictProcessor', 'Gate verdict refused', {
        sessionId: session.sessionId,
        message: answer.message,
      });
      return { ...untouched, earlyExit: true };
    }

    const { review, advance } = answer;
    const effectiveVerdict = answer.verdict ?? verdictPayload;
    this.recordVerdictDetection(context, effectiveVerdict, advance.outcome, review.nodeId);
    let deferredAdvance: DeferredAdvance | undefined;
    if (advance.outcome === 'passed') {
      deferredAdvance = {
        sessionId: session.sessionId,
        nodeId: review.nodeId,
        reason: 'gate-pass',
      };
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Gate PASS - advance deferred until the step is captured',
        { reviewedNodeId: review.nodeId }
      );
      if (hasStructuralFinding(review)) {
        context.state.gates.phaseGuardReviewClearedNodeId = review.nodeId;
      }
      await this.emitGateEvents(context, 'passed', [...review.gateIds], effectiveVerdict.rationale);
    } else if (advance.review !== null && answer.enforcement === 'blocking') {
      await this.handleBlockingFail(context, advance, effectiveVerdict);
    } else {
      deferredAdvance = await this.handleNonBlockingFail(
        context,
        session,
        answer,
        effectiveVerdict
      );
    }

    if (advance.review === null) {
      delete sessionContext.pendingReview;
    } else {
      sessionContext.pendingReview = advance.review;
    }
    context.sessionContext = { ...sessionContext };

    return {
      passClearedThisCall: advance.outcome === 'passed',
      ...projectRenewedSemanticCapture({
        review,
        renewedReview: advance.review,
        renewAttempt: advance.renewAttempt,
        responseNodeId: captureNodeId,
        userResponse,
      }),
      ...(deferredAdvance !== undefined ? { deferredAdvance } : {}),
    };
  }

  /**
   * Answer a verdict through the one review path. A `bare` PASS (no answer sent with it) opens
   * no review, and is refused outright when its review grades a node with no captured output.
   */
  private async answerVerdict(
    context: ExecutionContext,
    session: ChainSession,
    verdict: ParsedGateVerdict,
    hasResponse: boolean,
    trailerNodeId: string | undefined
  ): Promise<ReviewAnswer> {
    const gateless =
      verdict.verdict === 'FAIL'
        ? this.gatelessStepOrdinal(context, session, trailerNodeId)
        : undefined;
    if (gateless !== undefined) {
      return { kind: 'refused', message: describeGatelessStep(gateless) };
    }
    const bare = !hasResponse && verdict.verdict === 'PASS';
    const unanswered = bare ? this.unansweredReviewNode(session, trailerNodeId) : undefined;
    if (unanswered !== undefined) {
      return { kind: 'refused', message: describeUnansweredStep(session, unanswered) };
    }
    const authority = context.gateEnforcement;
    return this.answerReview(context, session, {
      event: { type: 'verdict', verdict, at: Date.now() },
      answerless: !hasResponse,
      ...(trailerNodeId !== undefined ? { trailerNodeId } : {}),
      ...(authority !== undefined && !bare
        ? {
            open: async (nodeId: string) => {
              // The step path's budget, from the one resolver (R167). A review opened here used
              // to pass none, and so always took the built-in default.
              const maxAttempts = authority.resolveReviewMaxAttempts(
                context,
                nodeId,
                ordinalOf(session.state.nodes, nodeId)
              );
              return authority.createReview(session.sessionId, 'gate', nodeId, {
                gateIds: stepReviewGateIds(context),
                instructions: context.gateInstructions ?? '',
                ...(maxAttempts !== undefined ? { maxAttempts } : {}),
              });
            },
          }
        : {}),
    });
  }

  /**
   * The ordinal of the step this call's verdict would open a review on, when that step carries
   * no gates — no review is open for it and its resolved set is empty. A review opened there
   * would grade nothing: with no gate publishing a mode, its FAIL held the step as blocking and
   * exhausted it naming no gate (P6.76, R38).
   */
  private gatelessStepOrdinal(
    context: ExecutionContext,
    session: ChainSession,
    trailerNodeId: string | undefined
  ): number | undefined {
    const currentNodeId = session.state.currentNodeId;
    const target = addressedReview(session, trailerNodeId);
    const opensOne =
      trailerNodeId === undefined && target.kind === 'refuse' && target.reason === 'no-review';
    return opensOne && currentNodeId !== null && stepReviewGateIds(context).length === 0
      ? ordinalOf(session.state.nodes, currentNodeId)
      : undefined;
  }

  /**
   * A PASS sent with an answer on a step that carries no gates grades nothing: the verdict is
   * set aside and the answer is captured as if sent alone. A FAIL there is refused instead
   * (`answerVerdict`), and a PASS with no answer keeps its refusal (R19).
   */
  private passGradesNothing(
    context: ExecutionContext,
    session: ChainSession,
    verdict: ParsedGateVerdict,
    hasResponse: boolean,
    trailerNodeId: string | undefined
  ): boolean {
    return (
      verdict.verdict === 'PASS' &&
      hasResponse &&
      this.gatelessStepOrdinal(context, session, trailerNodeId) !== undefined
    );
  }

  /**
   * Does `nodeId` hold a captured output? A verdict sent with no answer captures nothing, so it
   * may move the run past a node only when this is true (R19): a non-blocking FAIL on an
   * unanswered node is recorded and warned about, and the run stays on it (P6.35). Holding the
   * review rather than refusing keeps every FAIL polarity alike — a bare FAIL of either mode
   * spends an attempt of the node's open review (P4.116, R26).
   */
  private holdsAnswer(nodeId: string, session: ChainSession): boolean {
    return this.chainSessionStore.isStepComplete(session.sessionId, nodeId);
  }

  /**
   * The node of the review a response-less PASS would answer, when that node holds no
   * captured output — a review opened when its step rendered, before anyone answered it.
   */
  private unansweredReviewNode(session: ChainSession, trailerNodeId?: string): string | undefined {
    const target = addressedReview(session, trailerNodeId);
    return target.kind === 'review' && !this.holdsAnswer(target.nodeId, session)
      ? target.nodeId
      : undefined;
  }

  /**
   * The one review path: resolve the review the event addresses (`resolveReviewTarget`), apply
   * the event (`advanceReview`), persist what it returned. Every verdict, replacement report and
   * `gate_action` reaches a review through here, so no caller derives the reviewed node from the
   * run's position, and no caller moves a review on its own terms.
   *
   * A verdict is also counted in the run's cumulative gate counters (`recordGateReviewOutcome`);
   * the review itself is persisted here, from what the transition returned.
   */
  private async answerReview(
    context: ExecutionContext,
    session: ChainSession,
    entry: ReviewEntry
  ): Promise<ReviewAnswer> {
    const { trailerNodeId } = entry;
    const admission = this.admitSemanticTargetResponse(context, session, { trailerNodeId });
    if (admission.kind === 'refused') return admission;
    const target = addressedReview(session, trailerNodeId);
    const currentNodeId = session.state.currentNodeId;
    const found = await this.findAddressedReview(session, entry, target);
    if (found === undefined) {
      const ordinal = currentNodeId === null ? -1 : ordinalOf(session.state.nodes, currentNodeId);
      const message = describeMissingReview(target, trailerNodeId, ordinal);
      return { kind: 'refused', message };
    }
    const review = entry.grade === undefined ? found : await entry.grade(found);

    const adjudicated = this.adjudicateReviewEvent(
      review,
      this.markUnanswered(entry, review.nodeId, session)
    );
    if (adjudicated.kind === 'refused') return adjudicated;
    const { event } = adjudicated;
    const original = entry.event.type === 'verdict' ? entry.event.verdict : undefined;
    const reported =
      original === undefined ? [] : this.readPerGateVerdicts(context, original, review);
    const failedGateIds = failedReviewGateIds(review, reported, adjudicated.failedGateIds);
    const enforcement = await this.resolveFailEnforcement(context, review, failedGateIds);
    const advance = this.applyReviewAttemptIntent(
      context,
      advanceReview(adjudicated.review, event, enforcement)
    );
    // Validate structured indexes and renewal authority before any freshly graded review write.
    // A renewed review is persisted below once; the original stays available to failed capture.
    if (review !== found && advance.renewAttempt !== true) {
      await this.chainSessionStore.setReview(session.sessionId, review);
    }
    if (advance.outcome === 'refused') {
      return { kind: 'refused', message: describeRefusal(advance.reason, review) };
    }
    if (event.type === 'verdict') {
      await this.chainSessionStore.recordGateReviewOutcome(session.sessionId, {
        verdict: event.verdict.verdict,
      });
    }
    context.state.gates.reviewActionDetection = projectReviewActionDetection(review, event);
    if (advance.review === null) {
      await this.chainSessionStore.clearReview(session.sessionId, review.nodeId);
    } else {
      await this.chainSessionStore.setReview(session.sessionId, advance.review);
    }
    context.state.gates.perGateVerdicts = projectGateVerdictSummaries({
      reported,
      semantic: adjudicated.semantic ?? [],
      review,
      original,
      outcome: advance.outcome,
      enforcement,
      timestamp: Date.now(),
    });
    return {
      kind: 'answered',
      review,
      advance,
      enforcement,
      failedGateIds,
      ...(event.type === 'verdict' ? { verdict: event.verdict } : {}),
    };
  }

  private async findAddressedReview(
    session: ChainSession,
    entry: ReviewEntry,
    target: ReturnType<typeof addressedReview>
  ): Promise<GateReview | undefined> {
    const currentNodeId = session.state.currentNodeId;
    return target.kind === 'review'
      ? session.reviews?.[target.nodeId]
      : target.reason === 'no-review' && entry.trailerNodeId === undefined && currentNodeId !== null
        ? entry.open?.(currentNodeId)
        : undefined;
  }

  /** One adjudication seam for ordinary and detached verdicts; report data supplies no authority. */
  private adjudicateReviewEvent(review: GateReview, event: ReviewEvent): AdjudicatedReviewEvent {
    if (event.type !== 'verdict') return { kind: 'accepted', event, review, failedGateIds: [] };
    const issued = review.semanticContext;
    if (issued === undefined) {
      return event.verdict.submission?.per_gate?.some((entry) => entry.evaluation !== undefined) ===
        true
        ? {
            kind: 'refused',
            message: 'Open a fresh server-issued review, then capture the node.',
          }
        : { kind: 'accepted', event, review, failedGateIds: [] };
    }
    if (issued.nodeId !== review.nodeId) {
      return {
        kind: 'refused',
        message: 'Server review context names a different node; no attempt was charged.',
      };
    }
    let decisions: SemanticGateDecision[];
    try {
      decisions = Object.entries(issued.definitions)
        .filter(([, snapshot]) => readSemanticReviewCriteria(snapshot).length > 0)
        .map(([gateId]) => this.adjudicateSemanticGate(review, event.verdict, gateId));
    } catch (error) {
      return {
        kind: 'refused',
        message: `Semantic review context unavailable: ${error instanceof Error ? error.message : 'unavailable context'}`,
      };
    }
    const refused = decisions.find((decision) => decision.kind === 'refused');
    if (refused !== undefined) return refused;
    const failed = decisions.filter((decision) => decision.kind === 'failed');
    const semantic = decisions.filter((decision) => decision.kind !== 'refused');
    if (failed.length === 0)
      return { kind: 'accepted', event, review, failedGateIds: [], semantic };
    const hints = failed.map((decision) => decision.hint);
    const verdict: ParsedGateVerdict = {
      ...event.verdict,
      verdict: 'FAIL',
      rationale: hints.join('; '),
    };
    return {
      kind: 'accepted',
      event: { ...event, verdict },
      review: { ...review, retryHints: [...new Set([...(review.retryHints ?? []), ...hints])] },
      failedGateIds: failed.map((decision) => decision.gateId),
      semantic,
    };
  }

  private adjudicateSemanticGate(
    review: GateReview,
    verdict: ParsedGateVerdict,
    gateId: string
  ): SemanticGateDecision {
    const issued = review.semanticContext;
    const index = review.gateIds.indexOf(gateId) + 1;
    if (issued === undefined || index === 0) {
      return {
        kind: 'refused',
        message: `Server semantic definition '${gateId}' is not available in this review.`,
      };
    }
    const expected = resolvePinnedSemanticContext(issued, gateId);
    const claim = verdict.submission?.per_gate?.find((entry) => entry.index === index);
    const report = claim?.evaluation;
    const result = evaluateSemanticEvaluation(expected, report);
    const faults = semanticAttributionFaults(result);
    if (faults.length > 0) {
      return {
        kind: 'refused',
        message: `Semantic report for '${gateId}' refused: ${faults.map((entry) => entry.message).join('; ')}. Capture the current attempt before reviewing it.`,
      };
    }
    const facts = { gateId, result, binding: expected.binding };
    if (result.passed && claim?.passed !== false) return { kind: 'passed', ...facts };
    return {
      kind: 'failed',
      ...facts,
      hint: result.passed
        ? `Semantic gate '${gateId}' held by explicit per-gate FAIL: ${claim?.rationale ?? verdict.rationale}`
        : `Semantic gate '${gateId}' failed: ${semanticFailureReasons(result).join('; ')}`,
    };
  }

  /** Apply lifecycle intent through the existing authority before announcing or persisting it. */
  private applyReviewAttemptIntent(
    context: ExecutionContext,
    advance: ReturnType<typeof advanceReview>
  ): ReturnType<typeof advanceReview> {
    if (advance.renewAttempt !== true || advance.review === null) return advance;
    const authority = context.gateEnforcement;
    if (authority === undefined) {
      if (advance.review.semanticContext !== undefined) {
        throw new Error('Semantic review retry requires gate enforcement authority');
      }
      return advance;
    }
    return { ...advance, review: authority.renewReviewAttempt(advance.review) };
  }

  /** The entry's event, flagged `unanswered` when neither the call nor the node holds an answer. */
  private markUnanswered(entry: ReviewEntry, nodeId: string, session: ChainSession): ReviewEvent {
    const { event } = entry;
    return event.type === 'verdict' &&
      entry.answerless === true &&
      !this.holdsAnswer(nodeId, session)
      ? { ...event, unanswered: true }
      : event;
  }

  /**
   * What a FAIL on `review` does. A step review reads the mode the step's gates published, and
   * when the verdict failed gates BY NAME only those decide (R107); an overall-only verdict names
   * none, and the owner falls back to the step's strictest gate. A detached review grades another
   * node than the current step, so its own gates decide (R10), through the authority that loads
   * them.
   */
  private async resolveFailEnforcement(
    context: ExecutionContext,
    review: GateReview,
    failedGateIds: readonly string[]
  ): Promise<EnforcementMode> {
    if (review.kind === 'detached') {
      return (
        (await context.gateEnforcement?.resolveReviewEnforcement(review, failedGateIds)) ??
        resolveEnforcementMode()
      );
    }
    return resolveEnforcementMode(
      context.state.gates.enforcementMode,
      context.state.gates.stepEnforcement,
      failedGateIds
    );
  }

  /**
   * Perform an advance this processor decided earlier in the same request (P4.89).
   *
   * Called by `StepResponseCaptureStage` after `StepCaptureService` has captured the step the
   * verdict graded, and before the post-advance review check. Every advance past a node holding
   * a real output runs here — the capture's own (`captured`) included — so this is where the run
   * announces `step_complete` (R25): once, on the call that moves it, and only when it did move.
   * A held capture or an in-budget FAIL moves nothing and announces nothing.
   *
   * The context snapshot is updated here rather than at decision time, because this is where the
   * new position exists. It is still written before the response is assembled, which is the
   * guarantee row B.54 pinned: a caller is never told the run sits on a step it has moved off.
   * A store failure propagates, as it did when this ran inline.
   *
   * A pending `:: verify:` check holds its step as an open review does (R29): every advance —
   * the capture's, a verdict's, a skip's — moves nothing while one is pending. The shell stage
   * clears the check first and then applies the held step's advance here, on the call it passes.
   * A check armed for the next answer (no node yet) holds only the capture it will grade — the
   * answer captured on this call — so a review it was left to still moves its step (P6.53).
   */
  async applyDeferredAdvance(context: ExecutionContext, advance: DeferredAdvance): Promise<void> {
    const check = this.chainSessionStore.getPendingShellVerification(advance.sessionId);
    if (
      check !== undefined &&
      (check.nodeId !== undefined || context.state.session.capturedStep?.nodeId === advance.nodeId)
    ) {
      // The release applies this advance later; keep why it was decided (P6.54)
      if (advance.reason !== 'captured') {
        await this.chainSessionStore.setPendingShellVerification(advance.sessionId, {
          ...check,
          heldAdvance: { nodeId: advance.nodeId, reason: advance.reason },
        });
      }
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Advance held by pending shell verification',
        {
          reason: advance.reason,
          heldNodeId: advance.nodeId,
        }
      );
      return;
    }
    const session = this.chainSessionStore.getSession(advance.sessionId, context.getScopeOptions());
    const fromNodeId = session?.state.currentNodeId;
    const advanced = await this.chainSessionStore.advanceStep(advance.sessionId, advance.nodeId);
    if (session !== undefined && advanced !== false && advanced.nodeId !== fromNodeId) {
      await this.announceAdvancedStep(context, session, advance);
    }

    const sessionContext = context.sessionContext;
    if (advanced !== false && sessionContext !== undefined) {
      context.sessionContext = {
        ...sessionContext,
        currentStep: advanced.ordinal,
        currentNodeId: advanced.nodeId,
      };
    }

    context.diagnostics.info('GateVerdictProcessor', 'Advanced step after capture', {
      reason: advance.reason,
      pastNodeId: advance.nodeId,
      advancedTo: advanced === false ? false : advanced.ordinal,
    });
  }

  /**
   * Blocking FAIL: flag the hold and announce it, in ONE order — `retryExhausted`, then
   * `responseBlocked`, then `failed` (P4.117).
   *
   * Every event is awaited, as the non-blocking handler's are (row B.54). Fired and forgotten,
   * the three interleaved with each other and finished after the response had been built, and a
   * throw outside `emitGateEvents`' own catch became an unhandled rejection nothing reported.
   */
  private async handleBlockingFail(
    context: ExecutionContext,
    advance: AppliedAdvance & { readonly review: GateReview },
    verdictPayload: { rationale: string }
  ): Promise<void> {
    const review = advance.review;
    await this.flagExhaustion(context, advance, verdictPayload.rationale);

    if (context.gates.hasBlockingGates()) {
      const blockedGateIds = [...context.gates.getBlockingGateIds()];
      context.state.gates.responseBlocked = true;
      context.state.gates.blockedGateIds = blockedGateIds;
      context.diagnostics.info('GateVerdictProcessor', 'Response content blocked by gate failure', {
        blockedGateIds,
      });
      await this.emitGateEvents(context, 'responseBlocked', blockedGateIds);
    }

    await this.emitGateEvents(context, 'failed', [...review.gateIds], verdictPayload.rationale);
    context.diagnostics.info('GateVerdictProcessor', 'Gate FAIL - blocking mode, awaiting retry');
  }

  /** An exhausting FAIL flags the retry limit and announces `retryExhausted`, in any mode. */
  private async flagExhaustion(
    context: ExecutionContext,
    advance: AppliedAdvance,
    rationale: string
  ): Promise<void> {
    const review = advance.review;
    if (advance.outcome !== 'exhausted' || review === null) {
      return;
    }
    context.state.gates.retryLimitExceeded = true;
    context.state.gates.escalationSource = 'gate-review';
    context.state.gates.retryExhaustedGateIds = [...review.gateIds];
    context.diagnostics.warn('GateVerdictProcessor', 'Gate retry limit exceeded', {
      attemptCount: review.attemptCount,
      maxAttempts: review.maxAttempts,
      gateIds: review.gateIds,
    });
    await this.emitGateEvents(
      context,
      'retryExhausted',
      review.gateIds,
      rationale,
      review.maxAttempts
    );
  }

  /**
   * Advisory or informational FAIL: announce it and decide the advance past the node the review
   * graded, for the stage to apply after the capture. Advisory also warns, naming the gates the
   * verdict failed when it named any. A FAIL that graded no answer left its review open, charged
   * (R26): it advances nothing (R19, P6.35), and past the budget it exhausts as a blocking one.
   */
  private async handleNonBlockingFail(
    context: ExecutionContext,
    session: ChainSession,
    answer: Extract<ReviewAnswer, { kind: 'answered' }>,
    verdictPayload: { rationale: string }
  ): Promise<DeferredAdvance | undefined> {
    const { review, enforcement, failedGateIds, advance } = answer;
    const advisory = enforcement === 'advisory';
    const gateIds = advisory && failedGateIds.length > 0 ? [...failedGateIds] : [...review.gateIds];
    if (advisory) {
      context.state.gates.advisoryWarnings.push(
        `Gate ${gateIds.join(', ')} failed: ${verdictPayload.rationale}`
      );
      context.diagnostics.warn('GateVerdictProcessor', 'Gate FAIL - advisory mode, continuing', {
        rationale: verdictPayload.rationale,
      });
    } else {
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Gate FAIL - informational mode, logged only',
        {
          rationale: verdictPayload.rationale,
        }
      );
    }
    await this.flagExhaustion(context, advance, verdictPayload.rationale);
    await this.emitGateEvents(context, 'failed', gateIds, verdictPayload.rationale);
    if (advance.review !== null) {
      return undefined;
    }
    return {
      sessionId: session.sessionId,
      nodeId: review.nodeId,
      reason: advisory ? 'advisory-fail' : 'informational-fail',
    };
  }

  /**
   * The authority owns the index-to-gate join and validates it before transition writes.
   * These are original client claims; accepted transitions project them with retained kernel
   * and tool facts before publishing request state for response and capture consumers.
   */
  private readPerGateVerdicts(
    context: ExecutionContext,
    verdict: ParsedGateVerdict,
    review: GateReview
  ): GateVerdictSummary[] {
    return (
      context.gateEnforcement?.parseGateVerdicts(
        verdict.submission ?? verdict.raw,
        review.gateIds,
        review.attemptCount
      ) ?? []
    );
  }

  /**
   * Parse a gate verdict using the authority (preferred) or contract fallback.
   */
  private parseVerdict(
    context: ExecutionContext,
    raw: McpToolRequest['gate_verdict'],
    source: 'gate_verdict' | 'user_response'
  ): ParsedGateVerdict | null {
    return context.gateEnforcement?.parseVerdict(raw, source) ?? parseGateVerdict(raw, source);
  }

  private recordVerdictDetection(
    context: ExecutionContext,
    verdictPayload: ParsedGateVerdict,
    outcome: string,
    nodeId: string
  ): void {
    context.state.gates.verdictDetection = projectVerdictDetection(verdictPayload, outcome, nodeId);
  }

  /**
   * Emit gate events via hooks and notifications.
   */
  private async emitGateEvents(
    context: ExecutionContext,
    event: 'passed' | 'failed' | 'retryExhausted' | 'responseBlocked',
    gateIds: string[],
    reason?: string,
    maxAttempts?: number
  ): Promise<void> {
    const hooks = this.hookRegistry;
    const notifications = this.notificationEmitter;

    if (!hooks && !notifications) return;

    const hookContext = buildPipelineHookContext(context);
    const chainId = context.sessionContext?.sessionId;

    try {
      switch (event) {
        case 'passed':
          for (const gateId of gateIds) {
            await hooks?.emitGateEvaluated(
              { id: gateId } as any,
              { passed: true, reason: reason ?? 'Gate passed', blocksResponse: false },
              hookContext
            );
          }
          break;

        case 'failed':
          for (const gateId of gateIds) {
            await hooks?.emitGateFailed(
              { id: gateId } as any,
              reason ?? 'Gate failed',
              hookContext
            );
            notifications?.emitGateFailed({ gateId, reason: reason ?? 'Gate failed', chainId });
          }
          break;

        case 'retryExhausted':
          await hooks?.emitRetryExhausted(gateIds, chainId ?? '', hookContext);
          notifications?.emitRetryExhausted({
            gateIds,
            chainId: chainId ?? '',
            maxAttempts: maxAttempts ?? 0,
          });
          break;

        case 'responseBlocked':
          await hooks?.emitResponseBlocked(gateIds, hookContext);
          notifications?.emitResponseBlocked({ gateIds, chainId });
          break;
      }
    } catch (error) {
      this.logger.warn('[GateVerdictProcessor] Failed to emit gate event', {
        event,
        gateIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * The gates the review of the step this call stands on grades: the step's own set, which stage 11
 * publishes as `reviewGateIds`, else the single prompt's resolved set (`accumulatedGateIds`, the
 * path that writes no step scope) — the set stage 13 opens the step's review with. A review this
 * call's verdict opens grades the same gates, so its warning and events name them (P6.75).
 */
function stepReviewGateIds(context: ExecutionContext): string[] {
  return [...(context.state.gates.reviewGateIds ?? context.state.gates.accumulatedGateIds ?? [])];
}
