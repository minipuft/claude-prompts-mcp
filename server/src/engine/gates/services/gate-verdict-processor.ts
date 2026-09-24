// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import { advanceReview } from '../../execution/pipeline/decisions/gates/review-lifecycle.js';
import { resolveReviewTarget } from '../../execution/pipeline/decisions/gates/review-target.js';
import {
  isUnknownInterruptPending,
  resolveEnforcementMode,
} from '../../execution/pipeline/decisions/index.js';
import { buildPipelineHookContext } from '../../execution/pipeline/hook-context.js';
import { parseGateVerdict } from '../core/gate-verdict-contract.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateCheckResult, GateReview } from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
  PipelineHookContext,
} from '#shared/types/index.js';
import type { ExecutionContext, SessionContext } from '../../execution/context/index.js';
import type { ReviewEvent } from '../../execution/pipeline/decisions/gates/review-lifecycle.js';
import type {
  EnforcementMode,
  GateAction,
  InterruptResolutionAction,
} from '../../execution/pipeline/decisions/index.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

import { ordinalOf } from '#shared/utils/node-order.js';

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
  /** Why the run advances, for the diagnostic line the application emits. */
  readonly reason: 'gate-pass' | 'advisory-fail' | 'informational-fail';
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
    };

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
     * same outcome as a review of reminder-tier gates.
     */
    private readonly runReviewChecks?: (
      gateIds: string[],
      agentResponse: string
    ) => Promise<GateCheckResult[]>
  ) {}

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
            : await this.runReviewChecks([...review.gateIds], review.reviewedOutput ?? '');
        return checkResults.length > 0 ? { ...review, checkResults } : review;
      },
    });
    if (answer.kind === 'refused') {
      return answer;
    }
    const { review, advance } = answer;
    this.recordVerdictDetection(context, payload, advance.outcome);
    const passed = advance.outcome === 'passed';
    await this.emitGateEvents(
      context,
      passed ? 'passed' : 'failed',
      [...review.gateIds],
      payload.rationale
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
   * `retry` and `skip` are events on the review (`advanceReview`): retry reopens it with the
   * counter reset, skip clears it. `abort` cancels the RUN, not just the request:
   * `context.state.session.aborted` is per-request state that stage 21 reads to write a
   * `cancelled` execution record — it says the run ended without ending it, and until the cancel
   * landed the next call resumed the chain the user had just aborted. `cancelChain` returns false
   * for an already-terminal run; the run is over either way, so the abort exit still stands.
   *
   * @returns true: the pipeline exits early after an action.
   */
  async handleGateAction(
    context: ExecutionContext,
    session: ChainSession,
    gateAction: GateAction,
    sessionContext: SessionContext
  ): Promise<boolean> {
    const sessionId = session.sessionId;
    context.state.gates.retryLimitExceeded = false;
    context.state.gates.awaitingUserChoice = false;

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
      return true;
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
    }
    return true;
  }

  /**
   * Answer the review this call's `gate_verdict` addresses — the one path for every verdict on a
   * step review (row 3.3). The review is the one the trailer names, else the run's step review,
   * which may grade a node the run has already left (a phase-guard review, a final step). With
   * none open, the verdict opens one on the node the run stands on and answers it in the same
   * call (the deferred entry); that needs the authority, and without it the verdict is ignored
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
    if (verdictPayload === null || (opensNone && addressedReview(session).kind === 'refuse')) {
      return untouched;
    }
    const bare = !hasResponse && verdictPayload.verdict === 'PASS';
    const answer = await this.answerVerdict(context, session, verdictPayload, bare, trailerNodeId);
    if (answer.kind === 'refused') {
      context.setResponse({ content: [{ type: 'text', text: answer.message }], isError: true });
      context.diagnostics.warn('GateVerdictProcessor', 'Gate verdict refused', {
        sessionId: session.sessionId,
        message: answer.message,
      });
      return { ...untouched, earlyExit: true };
    }

    const { review, advance } = answer;
    this.recordVerdictDetection(context, verdictPayload, advance.outcome);
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
      if (review.gateIds.includes('__phase_guard__')) {
        context.state.gates.phaseGuardReviewClearedNodeId = review.nodeId;
      }
      await this.emitGateEvents(context, 'passed', [...review.gateIds], verdictPayload.rationale);
    } else if (advance.review !== null) {
      await this.handleBlockingFail(context, advance, verdictPayload);
    } else {
      deferredAdvance = await this.handleNonBlockingFail(
        context,
        session.sessionId,
        answer,
        verdictPayload
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
      earlyExit: !hasResponse,
      userResponse,
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
    bare: boolean,
    trailerNodeId: string | undefined
  ): Promise<ReviewAnswer> {
    const unanswered = bare ? this.unansweredReviewNode(session, trailerNodeId) : undefined;
    if (unanswered !== undefined) {
      return { kind: 'refused', message: describeUnansweredStep(session, unanswered) };
    }
    const authority = context.gateEnforcement;
    return this.answerReview(context, session, {
      event: { type: 'verdict', verdict, at: Date.now() },
      ...(trailerNodeId !== undefined ? { trailerNodeId } : {}),
      ...(authority !== undefined && !bare
        ? {
            open: async (nodeId: string) =>
              authority.createReview(session.sessionId, 'gate', nodeId, {
                gateIds: [],
                instructions: 'Gate validation failed. Review and remediate.',
              }),
          }
        : {}),
    });
  }

  /**
   * The node of the review a response-less PASS would answer, when that node holds no
   * captured output — a review opened when its step rendered, before anyone answered it.
   */
  private unansweredReviewNode(session: ChainSession, trailerNodeId?: string): string | undefined {
    const target = addressedReview(session, trailerNodeId);
    return target.kind === 'review' &&
      !this.chainSessionStore.isStepComplete(session.sessionId, target.nodeId)
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
    const target = addressedReview(session, trailerNodeId);
    const currentNodeId = session.state.currentNodeId;
    const found =
      target.kind === 'review'
        ? session.reviews?.[target.nodeId]
        : target.reason === 'no-review' && trailerNodeId === undefined && currentNodeId !== null
          ? await entry.open?.(currentNodeId)
          : undefined;
    if (found === undefined) {
      const ordinal = currentNodeId === null ? -1 : ordinalOf(session.state.nodes, currentNodeId);
      const message = describeMissingReview(target, trailerNodeId, ordinal);
      return { kind: 'refused', message };
    }
    const review = entry.grade === undefined ? found : await entry.grade(found);
    if (review !== found) {
      await this.chainSessionStore.setReview(session.sessionId, review);
    }

    const { event } = entry;
    const failedGateIds =
      event.type === 'verdict'
        ? this.recordPerGateVerdicts(context, event.verdict.raw, review)
        : [];
    const enforcement = await this.resolveFailEnforcement(context, review, failedGateIds);
    const advance = advanceReview(review, event, enforcement);
    if (advance.outcome === 'refused') {
      return { kind: 'refused', message: describeRefusal(advance.reason, review) };
    }
    if (event.type === 'verdict') {
      await this.chainSessionStore.recordGateReviewOutcome(session.sessionId, {
        verdict: event.verdict.verdict,
      });
    }
    if (advance.review === null) {
      await this.chainSessionStore.clearReview(session.sessionId, review.nodeId);
    } else {
      await this.chainSessionStore.setReview(session.sessionId, advance.review);
    }
    return { kind: 'answered', review, advance, enforcement, failedGateIds };
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
   * Called by `StepResponseCaptureStage` after `StepCaptureService` has captured and announced
   * the step the verdict graded, and before the post-advance review check — so the run's terminal
   * announcement can no longer arrive in front of the step event that produced it.
   *
   * The context snapshot is updated here rather than at decision time, because this is where the
   * new position exists. It is still written before the response is assembled, which is the
   * guarantee row B.54 pinned: a caller is never told the run sits on a step it has moved off.
   * A store failure propagates, as it did when this ran inline.
   */
  async applyDeferredAdvance(context: ExecutionContext, advance: DeferredAdvance): Promise<void> {
    const advanced = await this.chainSessionStore.advanceStep(advance.sessionId, advance.nodeId);

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
    if (advance.outcome === 'exhausted') {
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
        verdictPayload.rationale,
        review.maxAttempts
      );
    }

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

  /**
   * Advisory or informational FAIL: the review is already cleared (`advanceReview`); announce it
   * and decide the advance past the node the review graded, for the stage to apply after the
   * capture. Advisory also warns, naming the gates the verdict failed when it named any.
   */
  private async handleNonBlockingFail(
    context: ExecutionContext,
    sessionId: string,
    answer: Extract<ReviewAnswer, { kind: 'answered' }>,
    verdictPayload: { rationale: string }
  ): Promise<DeferredAdvance> {
    const { review, enforcement, failedGateIds } = answer;
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
    await this.emitGateEvents(context, 'failed', gateIds, verdictPayload.rationale);
    return {
      sessionId,
      nodeId: review.nodeId,
      reason: advisory ? 'advisory-fail' : 'informational-fail',
    };
  }

  /**
   * Read the submission's per-gate verdicts against the gates `review` advertised, and return the
   * ones it failed BY NAME (R107).
   *
   * The authority owns the parse because it owns the `index → gateId` join; this method owns only
   * WHEN it happens and WHERE the result lands, which is the processor's domain (verdict
   * processing) under the ownership matrix. A step review's entries land on request state, where
   * the assembler names the failing gates and the capture service persists them; a detached
   * review's answer is no capture, so its entries decide its enforcement and land nowhere.
   *
   * Nothing is written when the submission carried no per-gate block — an overall-only verdict
   * is valid and leaving the field undefined is what tells the assembler and the capture
   * service there is nothing extra to say. The field is never set to `[]`, so "the reviewer
   * said nothing per-gate" and "the reviewer failed gate X" stay distinguishable.
   */
  private recordPerGateVerdicts(
    context: ExecutionContext,
    raw: string,
    review: GateReview
  ): readonly string[] {
    const authority = context.gateEnforcement;
    const entries =
      authority === undefined || review.gateIds.length === 0
        ? []
        : authority.parseGateVerdicts(raw, review.gateIds, review.attemptCount);
    const failed = entries.filter((entry) => entry.verdict === 'FAIL').map((entry) => entry.gateId);
    if (entries.length > 0 && review.kind !== 'detached') {
      context.state.gates.perGateVerdicts = entries;
      context.diagnostics.info('GateVerdictProcessor', 'Per-gate verdicts recorded', {
        failed,
        total: entries.length,
      });
    }
    return failed;
  }

  /**
   * Parse a gate verdict using the authority (preferred) or contract fallback.
   */
  private parseVerdict(
    context: ExecutionContext,
    raw: string | undefined,
    source: 'gate_verdict' | 'user_response'
  ): ParsedGateVerdict | null {
    return context.gateEnforcement?.parseVerdict(raw, source) ?? parseGateVerdict(raw, source);
  }

  private recordVerdictDetection(
    context: ExecutionContext,
    verdictPayload: ParsedGateVerdict,
    outcome: string
  ): void {
    const verdictDetection: NonNullable<typeof context.state.gates.verdictDetection> = {
      verdict: verdictPayload.verdict,
      source: verdictPayload.source,
    };
    verdictDetection.rationale = verdictPayload.rationale;
    if (verdictPayload.detectedPattern !== undefined) {
      verdictDetection.pattern = verdictPayload.detectedPattern;
    }
    verdictDetection.outcome = outcome === 'passed' ? 'cleared' : 'pending';
    context.state.gates.verdictDetection = verdictDetection;
  }

  /**
   * Create hook execution context from the current execution state.
   */
  private createHookContext(context: ExecutionContext): PipelineHookContext {
    return buildPipelineHookContext(context);
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

    const hookContext = this.createHookContext(context);
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

/** The sentence a call reads when no review answers it: a name the run lacks, or no open review. */
function describeMissingReview(
  target: ReturnType<typeof resolveReviewTarget>,
  trailerNodeId: string | undefined,
  currentOrdinal: number
): string {
  if (target.kind === 'refuse' && target.reason === 'unknown-node') {
    return `❌ The reply names node '${trailerNodeId}', which this run does not have. Nothing was recorded.`;
  }
  if (target.kind === 'refuse' && target.reason === 'ambiguous') {
    const named = target.nodeIds.map((nodeId) => `'${nodeId}'`).join(', ');
    return `❌ Gate reviews are open on nodes ${named}; name the one this call answers with a HANDOFF RESULT trailer (\`node: <id>\`). Nothing was recorded.`;
  }
  const answerFirst = currentOrdinal > 0 ? `; answer step ${currentOrdinal} first` : '';
  return trailerNodeId === undefined
    ? `❌ No gate review is open on this run, so there is nothing for this call to answer${answerFirst}. Nothing was recorded.`
    : `❌ No gate review is open for node '${trailerNodeId}'. Nothing was recorded.`;
}

/** The sentence a response-less PASS reads when the step its review grades has no answer. */
function describeUnansweredStep(session: ChainSession, nodeId: string): string {
  const ordinal = ordinalOf(session.state.nodes, nodeId);
  return (
    `❌ Step ${ordinal} has no answer yet, so a gate_verdict alone has nothing to grade; answer ` +
    `step ${ordinal} first (send its output as user_response with the verdict). Nothing was recorded.`
  );
}

/**
 * The sentence a refused event reads (`advanceReview` refused it, and nothing was charged).
 *
 * - `failing-check` — a PASS over a check the engine recorded as failing (ruling B4): the stage
 *   that runs a gate's `shell_verify` / `script_tool` criteria writes `checkResults`, and a model
 *   PASS over a recorded exit code is an unnoticed contradiction. `gate_action: skip` is the
 *   operator's override, behind exhaustion; a FAIL is the submitter agreeing with the check.
 * - `phase` — the review is not waiting for this kind of call: an exhausted review answers only
 *   `gate_action` (R9), and a detached review never `abort`s — `cancel: true` stops a run.
 */
function describeRefusal(reason: 'phase' | 'failing-check', review: GateReview): string {
  if (reason === 'failing-check') {
    const failed = (review.checkResults ?? []).filter((result) => !result.passed);
    const gateIds = [...new Set(failed.map((result) => result.gateId))].join(', ');
    const summaries = failed.map((result) => result.summary).join('; ');
    return (
      `❌ Gate verdict refused: ${gateIds} recorded a failing check (${summaries}). ` +
      'Fix the cause and resubmit; the check re-runs on the next review.'
    );
  }
  const waitingFor: Record<GateReview['phase'], string> = {
    'awaiting-verdict': 'a gate_verdict',
    'awaiting-replacement': "the worker's replacement result",
    exhausted:
      review.kind === 'detached'
        ? 'gate_action "retry" or "skip", or cancel: true'
        : 'gate_action "retry", "skip" or "abort"',
  };
  return (
    `❌ The gate review of node '${review.nodeId}' (${review.attemptCount}/${review.maxAttempts} ` +
    `attempts) is waiting for ${waitingFor[review.phase]}. Nothing was recorded.`
  );
}
