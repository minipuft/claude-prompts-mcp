// @lifecycle canonical - Processes gate verdicts, actions, and hook events for chain sessions.
import {
  isUnknownInterruptPending,
  resolveEnforcementMode,
} from '../../execution/pipeline/decisions/index.js';
import { buildPipelineHookContext } from '../../execution/pipeline/hook-context.js';
import { parseGateVerdict } from '../core/gate-verdict-contract.js';

import type { Logger } from '#infra/logging/index.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
  PipelineHookContext,
} from '#shared/types/index.js';
import type { ExecutionContext, SessionContext } from '../../execution/context/index.js';
import type {
  GateAction,
  InterruptResolutionAction,
} from '../../execution/pipeline/decisions/index.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

import { nodeIdAt } from '#shared/utils/node-order.js';

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
 * The node id is resolved at DECISION time, not at application time: by then the capture may
 * have advanced the run itself (the advisory path), and `advanceStep` no-ops on a node the run
 * has already passed — which is what makes applying this twice, or after the capture already
 * did it, safe rather than a double advance.
 */
export interface DeferredAdvance {
  readonly sessionId: string;
  /** The node the run advances PAST — the step this call graded, not the one it moves to. */
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

/**
 * Processes gate verdicts, handles gate actions (retry/skip/abort),
 * and emits gate lifecycle events via hooks and notifications.
 *
 * Extracted from StepResponseCaptureStage.
 */
export class GateVerdictProcessor {
  /**
   * Translate the position this stage was handed into the node id the store addresses by.
   *
   * Returns `''` when no node sits at that position — the store treats an unresolvable id as
   * already-passed and leaves the run untouched, which is what the previous `currentStep ?? 0`
   * guard achieved by arithmetic. Never invents a node.
   */
  private resolveNodeId(session: ChainSession, ordinal: number): string {
    return nodeIdAt(session.state.nodes, ordinal) ?? '';
  }

  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger,
    private readonly hookRegistry?: HookRegistryPort,
    private readonly notificationEmitter?: McpNotificationEmitterPort
  ) {}

  /**
   * Resolve a mid-chain blocking-unknown interrupt with `resume` or `accept_alternative`
   * (OQ-4, row 2.2).
   *
   * Separate entry point from {@link handleGateAction}, not a fifth case inside it: that method
   * answers "the retry budget is spent, what now", and every branch of it addresses a gate the
   * run failed. This one addresses a hold NO gate produced — the run's steps all passed, and what
   * stopped it is a caller-declared unknown. Sharing an entry point would put a `resetRetryCount`
   * and a `cancelChain` in reach of a verb that means neither.
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
    const pending = this.chainSessionStore.getPendingGateReview(sessionId);

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

    await this.chainSessionStore.clearPendingGateReview(sessionId);

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
   * Handle gate_action parameter (retry/skip/abort) when retry limit exceeded.
   * Delegates to GateEnforcementAuthority when available, falls back to direct session ops.
   *
   * @returns true if the pipeline should exit early (abort or action completed)
   */
  async handleGateAction(
    context: ExecutionContext,
    sessionId: string,
    gateAction: GateAction,
    sessionContext: SessionContext
  ): Promise<boolean> {
    const authority = context.gateEnforcement;

    if (authority !== undefined) {
      const result = await authority.resolveAction(sessionId, gateAction);

      if (result.handled) {
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;

        if (result.retryReset === true) {
          context.diagnostics.info('GateVerdictProcessor', 'User chose to retry after exhaustion', {
            sessionId,
          });
        } else if (result.reviewCleared === true) {
          const clearedContext = { ...sessionContext };
          delete clearedContext.pendingReview;
          context.sessionContext = clearedContext;
          context.diagnostics.warn('GateVerdictProcessor', 'User chose to skip failed gate', {
            sessionId,
            skippedGates: context.state.gates.retryExhaustedGateIds,
          });
        } else if (result.sessionAborted === true) {
          context.state.session.aborted = true;
          context.diagnostics.info(
            'GateVerdictProcessor',
            'User chose to abort chain after gate failure',
            {
              sessionId,
              failedGates: context.state.gates.retryExhaustedGateIds,
            }
          );
        }
      }
      return true;
    }

    // Fallback: Direct session manager interaction (legacy path)
    switch (gateAction) {
      case 'retry': {
        await this.chainSessionStore.resetRetryCount(sessionId);
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        context.diagnostics.info('GateVerdictProcessor', 'User chose to retry after exhaustion', {
          sessionId,
        });
        break;
      }

      case 'skip': {
        await this.chainSessionStore.clearPendingGateReview(sessionId);
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        const clearedContext = { ...sessionContext };
        delete clearedContext.pendingReview;
        context.sessionContext = clearedContext;
        context.diagnostics.warn('GateVerdictProcessor', 'User chose to skip failed gate', {
          sessionId,
          skippedGates: context.state.gates.retryExhaustedGateIds,
        });
        break;
      }

      case 'abort': {
        // Mirrors GateEnforcementAuthority.resolveAction — see the note there. The flag alone
        // only makes the abort visible in the ledger; cancelling the run is what makes it stick.
        const cancelled = await this.chainSessionStore.cancelChain(sessionId);
        if (!cancelled) {
          this.logger.warn(
            `[GateVerdictProcessor] Abort requested for session ${sessionId}, but the run could not be cancelled (already terminal or out of scope)`
          );
        }
        context.state.session.aborted = true;
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        context.diagnostics.info(
          'GateVerdictProcessor',
          'User chose to abort chain after gate failure',
          {
            sessionId,
            failedGates: context.state.gates.retryExhaustedGateIds,
          }
        );
        break;
      }
    }
    return true;
  }

  /**
   * Process a deferred verdict (verdict without existing pending review).
   * Uses GateEnforcementAuthority to create/clear reviews as needed.
   */
  async processDeferredVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    currentStepAtStart: number,
    userResponse: string | undefined,
    sessionContext: SessionContext
  ): Promise<VerdictProcessingResult> {
    const authority = context.gateEnforcement;
    const gateVerdictInput = context.getGateVerdict();
    if (session.pendingGateReview !== undefined || gateVerdictInput === undefined || !authority) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const verdictPayload = this.parseVerdict(context, gateVerdictInput, 'gate_verdict');
    if (verdictPayload === null) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const enforcementMode = resolveEnforcementMode(context.state.gates.enforcementMode);
    const outcome = await authority.recordOutcome(sessionId, verdictPayload, enforcementMode);

    this.recordVerdictDetection(
      context,
      verdictPayload,
      outcome.status === 'cleared' ? 'cleared' : 'pending'
    );

    let passClearedThisCall = false;
    let deferredAdvance: DeferredAdvance | undefined;
    if (outcome.status === 'cleared') {
      deferredAdvance = {
        sessionId,
        nodeId: this.resolveNodeId(session, currentStepAtStart),
        reason: 'gate-pass',
      };
      context.sessionContext = { ...sessionContext };
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Gate PASS (no prior review) - advance deferred until the step is captured',
        { stepToAdvance: currentStepAtStart }
      );
      passClearedThisCall = true;
    }

    // Sync newly created pending review (on FAIL) into session context
    const pending = this.chainSessionStore.getPendingGateReview(sessionId);
    if (pending !== undefined) {
      sessionContext.pendingReview = pending;
      context.sessionContext = { ...sessionContext };
    }

    const hasResponse = typeof userResponse === 'string' && userResponse.length > 0;
    const advance = deferredAdvance !== undefined ? { deferredAdvance } : {};
    if (!hasResponse) {
      return { passClearedThisCall, earlyExit: true, userResponse, ...advance };
    }

    return { passClearedThisCall, earlyExit: false, userResponse, ...advance };
  }

  /**
   * Process a verdict against an existing pending review.
   * Handles blocking/advisory/informational enforcement modes.
   */
  async processPendingReviewVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    currentStepAtStart: number,
    userResponse: string | undefined,
    sessionContext: SessionContext
  ): Promise<VerdictProcessingResult> {
    if (session.pendingGateReview === undefined) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    const gateVerdictInput = context.getGateVerdict();
    const verdictPayload = this.parseVerdict(context, gateVerdictInput, 'gate_verdict');
    const capturedGateIds = [...session.pendingGateReview.gateIds];

    if (verdictPayload === null) {
      return { passClearedThisCall: false, earlyExit: false, userResponse };
    }

    // Read the per-gate block BEFORE anything branches on the overall verdict: this is the only
    // call that holds both the submission and the gate list it was advertised against, and the
    // clear path deletes the pending review a few lines below. Entries land on request state,
    // where the assembler names the failing gates and the capture service persists them.
    this.recordPerGateVerdicts(
      context,
      verdictPayload.raw,
      capturedGateIds,
      session.pendingGateReview.attemptCount
    );

    // Checked BEFORE the outcome is recorded, not after: recording spends a retry attempt, and a
    // verdict the engine will not accept must not cost the submitter one.
    const refusal = this.refuseVerdictAgainstRecordedFailure(
      session.pendingGateReview,
      verdictPayload.verdict
    );
    if (refusal !== null) {
      context.setResponse({
        content: [{ type: 'text', text: `❌ ${refusal}` }],
        isError: true,
      });
      context.diagnostics.warn(
        'GateVerdictProcessor',
        'Gate PASS refused — a recorded check failed',
        { sessionId, gateIds: capturedGateIds }
      );
      return { passClearedThisCall: false, earlyExit: true, userResponse };
    }

    const outcome = await this.chainSessionStore.recordGateReviewOutcome(sessionId, {
      verdict: verdictPayload.verdict,
      rationale: verdictPayload.rationale,
      rawVerdict: verdictPayload.raw,
      reviewer: verdictPayload.source,
    });

    this.recordVerdictDetection(context, verdictPayload, outcome);

    let passClearedThisCall = false;
    let deferredAdvance: DeferredAdvance | undefined;

    if (outcome === 'cleared') {
      deferredAdvance = {
        sessionId,
        nodeId: this.resolveNodeId(session, currentStepAtStart),
        reason: 'gate-pass',
      };
      context.diagnostics.info(
        'GateVerdictProcessor',
        'Gate PASS - advance deferred until the step is captured',
        { stepToAdvance: currentStepAtStart }
      );
      delete sessionContext.pendingReview;
      passClearedThisCall = true;

      if (capturedGateIds.includes('__phase_guard__')) {
        context.state.gates.phaseGuardReviewCleared = true;
      }

      await this.emitGateEvents(context, 'passed', capturedGateIds, verdictPayload.rationale);
    } else {
      // Awaited, as the `cleared` branch above is. Fired and forgotten, the advisory and
      // informational handlers cleared the pending review and advanced the step AFTER the
      // snapshot two lines below had already been taken, so the response reported the step
      // the run had not moved off — and any failure in either was dropped entirely.
      deferredAdvance = await this.handleFailedVerdict(
        context,
        session,
        sessionId,
        sessionContext,
        capturedGateIds,
        verdictPayload
      );
    }

    context.sessionContext = { ...sessionContext };

    const hasResponse = typeof userResponse === 'string' && userResponse.length > 0;
    const advance = deferredAdvance !== undefined ? { deferredAdvance } : {};
    if (!hasResponse) {
      return { passClearedThisCall, earlyExit: true, userResponse, ...advance };
    }

    return { passClearedThisCall, earlyExit: false, userResponse, ...advance };
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
   * Refuse, by name, a PASS that walks past a check the engine recorded as failing (ruling B4).
   *
   * `GateReviewStage` runs each gate's `shell_verify` / `script_tool` criteria and writes the
   * outcome to `PendingGateReview.checkResults`. Until this existed, nothing downstream read it:
   * the stage printed the failing command into the review, the model answered PASS anyway, and
   * the processor cleared on the verdict alone — a recorded exit code losing to an opinion.
   *
   * Scope, deliberately narrow:
   *
   * - **PASS only.** A FAIL is the submitter agreeing with the check; it takes the normal
   *   failure path with its retry budget intact.
   * - **`gate_action: skip` / `abort` are untouched.** They are the operator's override, by
   *   design and behind retry exhaustion — a human choosing to ship past a failing check is a
   *   decision, where a model PASS over the same check is an unnoticed contradiction. They do
   *   not pass through here at all (`handleGateAction`).
   * - **No recorded results, no refusal.** A review of reminder-tier gates records nothing, so
   *   this returns `null` and the verdict is the model's as before.
   *
   * @returns the sentence the submitter reads, or `null` when the verdict may proceed.
   */
  private refuseVerdictAgainstRecordedFailure(
    pendingReview: ChainSession['pendingGateReview'],
    verdict: 'PASS' | 'FAIL'
  ): string | null {
    if (verdict !== 'PASS') return null;

    const failed = (pendingReview?.checkResults ?? []).filter((result) => !result.passed);
    if (failed.length === 0) return null;

    const gateIds = [...new Set(failed.map((result) => result.gateId))].join(', ');
    const summaries = failed.map((result) => result.summary).join('; ');
    return (
      `Gate verdict refused: ${gateIds} recorded a failing check (${summaries}). ` +
      'Fix the cause and resubmit; the check re-runs on the next review.'
    );
  }

  /**
   * Handle a FAIL verdict based on enforcement mode.
   *
   * @returns the advance the advisory and informational modes decide, for the stage to apply
   *   after the capture; `undefined` in blocking mode, where the run holds where it is.
   */
  private async handleFailedVerdict(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    sessionContext: SessionContext,
    capturedGateIds: string[],
    verdictPayload: ParsedGateVerdict
  ): Promise<DeferredAdvance | undefined> {
    const pending = this.chainSessionStore.getPendingGateReview(sessionId);
    if (pending !== undefined) {
      sessionContext.pendingReview = pending;
    } else {
      delete sessionContext.pendingReview;
    }

    const enforcementMode = resolveEnforcementMode(context.state.gates.enforcementMode);

    if (verdictPayload.verdict !== 'FAIL') return undefined;

    switch (enforcementMode) {
      case 'blocking':
        await this.handleBlockingFail(context, sessionId, capturedGateIds, verdictPayload);
        return undefined;

      case 'advisory':
        return await this.handleAdvisoryFail(
          context,
          session,
          sessionId,
          sessionContext,
          capturedGateIds,
          verdictPayload
        );

      case 'informational':
        return await this.handleInformationalFail(
          context,
          session,
          sessionId,
          sessionContext,
          capturedGateIds,
          verdictPayload
        );
    }
  }

  /**
   * Blocking FAIL: flag the hold and announce it, in ONE order — `retryExhausted`, then
   * `responseBlocked`, then `failed` (P4.117).
   *
   * Every event is awaited, as the advisory and informational handlers' are (row B.54). Fired and
   * forgotten, the three interleaved with each other and finished after the response had been
   * built, and a throw outside `emitGateEvents`' own catch became an unhandled rejection nothing
   * reported. Awaited, the order is the order written here and any failure reaches the caller's
   * call.
   */
  private async handleBlockingFail(
    context: ExecutionContext,
    sessionId: string,
    capturedGateIds: string[],
    verdictPayload: { rationale: string }
  ): Promise<void> {
    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    const isRetryExhausted =
      pendingReview !== undefined && this.chainSessionStore.isRetryLimitExceeded(sessionId);

    if (isRetryExhausted && pendingReview !== undefined) {
      context.state.gates.retryLimitExceeded = true;
      context.state.gates.escalationSource = 'gate-review';
      context.state.gates.retryExhaustedGateIds = [...pendingReview.gateIds];
      context.diagnostics.warn('GateVerdictProcessor', 'Gate retry limit exceeded', {
        attemptCount: pendingReview.attemptCount,
        maxAttempts: pendingReview.maxAttempts,
        gateIds: pendingReview.gateIds,
      });

      await this.emitGateEvents(
        context,
        'retryExhausted',
        pendingReview.gateIds,
        verdictPayload.rationale
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

    await this.emitGateEvents(context, 'failed', capturedGateIds, verdictPayload.rationale);
    context.diagnostics.info('GateVerdictProcessor', 'Gate FAIL - blocking mode, awaiting retry');
  }

  private async handleAdvisoryFail(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    sessionContext: SessionContext,
    capturedGateIds: string[],
    verdictPayload: { rationale: string }
  ): Promise<DeferredAdvance> {
    context.state.gates.advisoryWarnings.push(
      `Gate ${capturedGateIds.join(', ')} failed: ${verdictPayload.rationale}`
    );
    context.diagnostics.warn('GateVerdictProcessor', 'Gate FAIL - advisory mode, continuing', {
      rationale: verdictPayload.rationale,
    });

    await this.emitGateEvents(context, 'failed', capturedGateIds, verdictPayload.rationale);
    await this.chainSessionStore.clearPendingGateReview(sessionId);
    delete sessionContext.pendingReview;
    return {
      sessionId,
      nodeId: this.resolveAdvanceTarget(context, session),
      reason: 'advisory-fail',
    };
  }

  private async handleInformationalFail(
    context: ExecutionContext,
    session: ChainSession,
    sessionId: string,
    sessionContext: SessionContext,
    _capturedGateIds: string[],
    verdictPayload: { rationale: string }
  ): Promise<DeferredAdvance> {
    const infoGateIds = [...(session.pendingGateReview?.gateIds ?? [])];
    context.diagnostics.info(
      'GateVerdictProcessor',
      'Gate FAIL - informational mode, logged only',
      { rationale: verdictPayload.rationale }
    );

    await this.emitGateEvents(context, 'failed', infoGateIds, verdictPayload.rationale);
    await this.chainSessionStore.clearPendingGateReview(sessionId);
    delete sessionContext.pendingReview;
    return {
      sessionId,
      nodeId: this.resolveAdvanceTarget(context, session),
      reason: 'informational-fail',
    };
  }

  /**
   * The node a FAIL-mode advance walks past: `currentNodeId` when the context already carries
   * it, otherwise the position translated through the node list.
   *
   * A context with neither yields `''`, and the store no-ops on an unresolvable id — the same
   * outcome the `?? 0` arithmetic produced before node ids existed.
   */
  private resolveAdvanceTarget(context: ExecutionContext, session: ChainSession): string {
    const currentStep = context.sessionContext?.currentStep ?? 0;
    return context.sessionContext?.currentNodeId ?? this.resolveNodeId(session, currentStep);
  }

  /**
   * Put the submission's per-gate verdicts on request state, keyed by gate id.
   *
   * The authority owns the parse because it owns the `index → gateId` join; this method owns
   * only WHEN it happens and WHERE the result lands, which is the processor's domain
   * (verdict processing) under the ownership matrix.
   *
   * Nothing is written when the submission carried no per-gate block — an overall-only verdict
   * is valid and leaving the field undefined is what tells the assembler and the capture
   * service there is nothing extra to say. The field is never set to `[]`, so "the reviewer
   * said nothing per-gate" and "the reviewer failed gate X" stay distinguishable.
   */
  private recordPerGateVerdicts(
    context: ExecutionContext,
    raw: string,
    gateIds: readonly string[],
    attempt: number
  ): void {
    const authority = context.gateEnforcement;
    if (authority === undefined || gateIds.length === 0) {
      return;
    }

    const entries = authority.parseGateVerdicts(raw, gateIds, attempt);
    if (entries.length === 0) {
      return;
    }

    context.state.gates.perGateVerdicts = entries;
    context.diagnostics.info('GateVerdictProcessor', 'Per-gate verdicts recorded', {
      failed: entries.filter((entry) => entry.verdict === 'FAIL').map((entry) => entry.gateId),
      total: entries.length,
    });
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
    verdictDetection.outcome = outcome === 'cleared' ? 'cleared' : 'pending';
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
    reason?: string
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

        case 'retryExhausted': {
          const sessionId = context.sessionContext?.sessionId;
          const pendingReview = sessionId
            ? this.chainSessionStore.getPendingGateReview(sessionId)
            : undefined;
          const maxAttempts = pendingReview?.maxAttempts ?? 2;

          await hooks?.emitRetryExhausted(gateIds, chainId ?? '', hookContext);
          notifications?.emitRetryExhausted({
            gateIds,
            chainId: chainId ?? '',
            maxAttempts,
          });
          break;
        }

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
