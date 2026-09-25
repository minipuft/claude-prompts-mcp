// @lifecycle canonical - Captures step results (placeholder or real) in chain sessions.

import { handoffNodeToken, resolveHandoffEvidenceReason } from '../delegation/handoff-contract.js';
import { buildPipelineHookContext } from '../pipeline/hook-context.js';

import type { Logger } from '#infra/logging/index.js';
import type { ExecutionRecordStore } from '#modules/chains/execution-record-store.js';
import type { GateReview, InputRequiredReason } from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '#shared/types/index.js';
import type { DeferredAdvance } from '../../gates/services/gate-verdict-processor.js';
import type { ExecutionContext, SessionContext } from '../context/index.js';

import { currentOrdinal, nodeIdAt, ordinalOf, totalOf } from '#shared/utils/node-order.js';

const PLACEHOLDER_SOURCE = 'StepResponseCaptureStage';

/**
 * The step a capture call is acting on, carried as identity + position together.
 *
 * Both are needed and neither derives the other cheaply here: the store is addressed by
 * `nodeId`, while placeholder text, output mappings and diagnostics are all positional.
 */
export interface StepTarget {
  readonly ordinal: number;
  readonly nodeId: string;
}

/**
 * Input from verdict processing that affects step capture behavior.
 */
export interface StepCaptureInput {
  /** User response content (may have been consumed by verdict processing) */
  readonly userResponse: string | undefined;
  /** Whether a PASS verdict already advanced the step this call */
  readonly passClearedThisCall: boolean;
}

/**
 * Captures chain step results for STDIO transport compatibility.
 *
 * Records placeholder results to enable `{{previous_step_result}}` references
 * in downstream steps. Handles both placeholder capture (no user response)
 * and real response capture (user provided content).
 *
 * Extracted from StepResponseCaptureStage.
 */
export class StepCaptureService {
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger,
    /**
     * Ledger writer for the capture-time `completed` step row (S8). Optional, matching the
     * pipeline stages that hold the same store: absent, capture still happens, just unledgered.
     */
    private readonly executionRecordStore: ExecutionRecordStore | null = null,
    /**
     * Hook fan-out and client push for the step-completed fact. Optional for the same reason
     * the record store is: a pipeline built without them still captures, just unannounced.
     */
    private readonly hookRegistry?: HookRegistryPort,
    private readonly notificationEmitter?: McpNotificationEmitterPort
  ) {}

  /**
   * Capture a step result and optionally advance the chain.
   *
   * Determines target step, checks eligibility, writes placeholder or real response, and
   * returns the advance past it unless a pending gate review holds it. The caller applies that
   * advance through `GateVerdictProcessor.applyDeferredAdvance`, the one place the run's move
   * past a step is announced (R25) — so a capture a review holds announces nothing.
   */
  async captureStep(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    sessionContext: SessionContext,
    currentStepAtStart: number,
    input: StepCaptureInput
  ): Promise<DeferredAdvance | undefined> {
    const captureResponse =
      input.userResponse !== undefined && input.userResponse.length > 0
        ? input.userResponse
        : undefined;
    const hasUserResponseForCapture = captureResponse !== undefined;

    const target = this.resolveTarget(session, currentStepAtStart, hasUserResponseForCapture);
    if (target === undefined) {
      return undefined;
    }

    const existingState = this.chainSessionStore.getStepState(sessionId, target.nodeId);
    if (existingState?.state === 'completed' && !existingState.isPlaceholder) {
      return undefined;
    }

    if (existingState?.state === 'completed' && existingState.isPlaceholder === true) {
      if (captureResponse !== undefined) {
        return this.replaceplaceholderWithReal(
          context,
          sessionId,
          session,
          sessionContext,
          target,
          captureResponse,
          input.passClearedThisCall
        );
      }
      return undefined;
    }

    try {
      let advance: DeferredAdvance | undefined;
      if (captureResponse !== undefined) {
        advance = await this.captureRealAndAdvance(
          context,
          sessionId,
          session,
          target,
          captureResponse,
          input.passClearedThisCall
        );
      } else {
        await this.capturePlaceholder(
          sessionId,
          session.chainId,
          target,
          totalOf(session.state.nodes)
        );
      }

      this.syncSessionContext(context, sessionId, sessionContext);
      return advance;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to capture previous step result: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Move a run past a DETACHED node the parent resumed without waiting for (Tier 4).
   *
   * The node's output does not exist yet, so it is recorded the way a response-less call has
   * always recorded one — a placeholder, completed — and the run advances past it. The placeholder
   * is what keeps the node OWED: `unreportedDetachedNodeIds` counts a spawned node until it holds
   * a real output, which {@link recordDetachedReport} writes over this placeholder when the
   * worker's result lands. Advancing past the run's last node this way leaves the run held open
   * rather than completed — the store's completion guard decides that, not this method.
   */
  async passDetachedNode(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    sessionContext: SessionContext,
    target: StepTarget,
    options: {
      /** The node already holds its reported result (row 4.8): pass it without a placeholder. */
      readonly keepRecordedOutput?: boolean;
    } = {}
  ): Promise<void> {
    if (options.keepRecordedOutput !== true) {
      await this.capturePlaceholder(
        sessionId,
        session.chainId,
        target,
        totalOf(session.state.nodes)
      );
    }
    await this.chainSessionStore.advanceStep(sessionId, target.nodeId);
    this.syncSessionContext(context, sessionId, sessionContext);
  }

  /**
   * Record a detached node's LATE result on that node — not on the step the run stands on.
   *
   * The same writes an ordinary capture makes for a real output (store, completed lifecycle,
   * capture-time execution record with its `handoff_evidence`, the step-complete announcement),
   * with two deliberate omissions. It does not advance: the run passed this node when the parent
   * moved on, and advancing again would move the CURRENT step. And it does not publish
   * `capturedStep`, which tells the phase-guard stage which output this call graded — a late
   * report is not the current step's answer, and grading it there would raise a review on a step
   * that has not been answered.
   */
  async recordDetachedReport(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    target: StepTarget,
    reply: string
  ): Promise<void> {
    await this.chainSessionStore.updateSessionState(sessionId, target.nodeId, reply, {
      isPlaceholder: false,
      source: 'detached_report',
      capturedAt: Date.now(),
      outputMapping: this.getStepOutputMapping(context, target.ordinal),
    });
    await this.chainSessionStore.completeStep(sessionId, target.nodeId, {
      preservePlaceholder: false,
    });
    this.ledgerCapturedStep(context, sessionId, session.chainId, target, reply);
    await this.announceStepComplete(context, session.chainId, target, reply);
  }

  /**
   * Resolve which step this call captures for, as BOTH the identity the store addresses by and
   * the position everything else in the pipeline still speaks.
   *
   * - user_response present: capture for the CURRENT step (the one just rendered)
   * - otherwise: capture a placeholder for the PREVIOUS step
   *
   * Returns undefined when the position falls outside the run — before its first step, past its
   * last, or on no node at all. All three mean "nothing to capture", and collapsing them here
   * keeps the decision in one place instead of three guards at the call site.
   */
  private resolveTarget(
    session: ChainSession,
    currentStepAtStart: number,
    hasUserResponseForCapture: boolean
  ): StepTarget | undefined {
    const ordinal = hasUserResponseForCapture ? currentStepAtStart : currentStepAtStart - 1;
    const totalSteps = totalOf(session.state.nodes);
    if (totalSteps > 0 && ordinal > totalSteps) {
      return undefined;
    }
    const nodeId = nodeIdAt(session.state.nodes, ordinal);
    return nodeId === null ? undefined : { ordinal, nodeId };
  }

  private async capturePlaceholder(
    sessionId: string,
    chainId: string,
    target: StepTarget,
    totalSteps: number
  ): Promise<void> {
    const placeholderContent = this.buildPlaceholderContent(chainId, target.ordinal, totalSteps);

    await this.chainSessionStore.updateSessionState(sessionId, target.nodeId, placeholderContent, {
      isPlaceholder: true,
      placeholderSource: PLACEHOLDER_SOURCE,
      capturedAt: Date.now(),
    });

    await this.chainSessionStore.completeStep(sessionId, target.nodeId, {
      preservePlaceholder: true,
    });
  }

  private async captureRealResponse(
    context: ExecutionContext,
    sessionId: string,
    chainId: string,
    target: StepTarget,
    responseContent: string,
    outputMapping?: Record<string, string>
  ): Promise<void> {
    this.logger.debug(
      `Capturing real response for step ${target.ordinal} (${target.nodeId}) in chain ${chainId}: ${responseContent.substring(0, 50)}...`
    );

    await this.chainSessionStore.updateSessionState(sessionId, target.nodeId, responseContent, {
      isPlaceholder: false,
      source: 'user_response',
      capturedAt: Date.now(),
      outputMapping,
    });

    await this.chainSessionStore.completeStep(sessionId, target.nodeId, {
      preservePlaceholder: false,
    });

    this.ledgerCapturedStep(context, sessionId, chainId, target, responseContent);

    // Publish which step this call GRADED, for the stages that run after the advance (row 2.11).
    // Here rather than at either call site because this is the one place a non-placeholder
    // output is written — a placeholder must not claim to have produced gradeable output — and
    // it is written BEFORE any advance, so the identity is the producing node's, not the next
    // one's. Reader: `PhaseGuardVerificationStage` (`internal-state.ts` names both ends).
    context.state.session.capturedStep = { nodeId: target.nodeId, ordinal: target.ordinal };

    this.logger.debug(`Step ${target.ordinal} (${target.nodeId}) completed with real response`);
  }

  /**
   * Announce a detached node's late result to hook consumers and to the connected client.
   *
   * The one announcement not made where the run moves (`applyDeferredAdvance`, R25): the run
   * passed a detached node on a placeholder, silently, because a client told "step 2 complete"
   * for it would act on a result that does not exist yet — so the node is announced when its
   * real output lands, here.
   *
   * Isolated the way the gate emissions are (`GateVerdictProcessor.emitGateEvents`): one catch
   * around both channels, because announcing is never a reason to fail a capture that already
   * persisted. `HookRegistry` isolates each consumer callback itself, so nothing here nests a
   * second layer around that.
   */
  private async announceStepComplete(
    context: ExecutionContext,
    chainId: string,
    target: StepTarget,
    responseContent: string
  ): Promise<void> {
    if (this.hookRegistry === undefined && this.notificationEmitter === undefined) return;

    try {
      const hookContext = buildPipelineHookContext(context);
      await this.hookRegistry?.emitStepComplete(
        chainId,
        target.ordinal,
        responseContent,
        hookContext
      );
      this.notificationEmitter?.emitChainStepComplete({
        chainId,
        stepIndex: target.ordinal,
        status: 'passed',
      });
    } catch (error) {
      this.logger.warn(
        `[StepCaptureService] Failed to announce step ${target.ordinal} completion: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Append the capture-time `completed` row for the step whose real output was just captured.
   * This is the moment the handoff-evidence fact exists and the only writer that binds
   * `handoff_evidence`: the reason a delegated step's resume was or was not acceptable, bound
   * for EVERY delegated step and in both evidence modes, NULL only when the step was not
   * delegated — partial population BY ROW TYPE. The reason is recorded here regardless of mode
   * BECAUSE the mode decides refusal, not observation: under `required` an unacceptable resume
   * never reaches this method (stage 16 refuses first), so the rows this writes under `required`
   * are `ok`, and the other three are what `advisory` is for. Exactly one row per captured step:
   * gate retries re-enter `captureStep` and take its completed-non-placeholder early return
   * before reaching this.
   *
   * It is also the ONLY append that fires on a call carrying a `gate_verdict`, which is why
   * `gateVerdicts` binds here (P4.76). Measured against a hermetic server on 2026-09-20, not
   * reasoned about: of the five `executionRecordStore.append()` sites, this is the one that
   * runs when the client answers the step and submits the verdict in one call — the shape the
   * server's own footer advertises (`user_response="..." gate_verdict="..."`). Stage 16 runs
   * `processPendingReviewVerdict` before `captureStep`, so the verdicts are on request state by
   * the time this reads them.
   *
   * The SPLIT shape — response on one call, verdict on a later one — is covered by
   * {@link ledgerSubmittedVerdict}, which appends a SECOND row for the same step rather than
   * rewriting this one (P4.86).
   */
  private ledgerCapturedStep(
    context: ExecutionContext,
    sessionId: string,
    chainId: string,
    target: StepTarget,
    responseContent: string
  ): void {
    if (this.executionRecordStore === null) return;

    // Same two-key resolution as GateReviewStage: the node id is the identity, the ordinal is
    // the fallback for a chain parsed before node-id minting.
    const steps = context.parsedCommand?.steps;
    const step =
      steps?.find((candidate) => candidate.nodeId === target.nodeId) ??
      steps?.find((candidate) => candidate.stepNumber === target.ordinal);

    // The token is derived from the step the same way the brief derived it — one exported
    // derivation, so "what the brief printed" and "what the record measures the reply against"
    // cannot drift. A step the two-key lookup above could not resolve still has an ordinal.
    const handoffEvidence = resolveHandoffEvidenceReason({
      delegated: step?.delegated,
      expectedToken: handoffNodeToken(step ?? { stepNumber: target.ordinal }),
      reply: responseContent,
    });

    // Omitted rather than bound to `[]` when the call carried no per-gate detail: the column
    // already defaults to `'[]'`, and writing it explicitly would make "ungated step" and
    // "reviewer said nothing per-gate" the same row.
    const gateVerdicts = context.state.gates.perGateVerdicts;

    const capturedAt = Date.now();
    this.executionRecordStore.append({
      sessionId,
      chainId,
      stepNumber: target.ordinal,
      nodeId: target.nodeId,
      ...(step?.promptId !== undefined ? { promptId: step.promptId } : {}),
      status: 'completed',
      substate: { respondedAt: capturedAt },
      startedAt: capturedAt,
      completedAt: capturedAt,
      ...(handoffEvidence !== undefined ? { handoffEvidence } : {}),
      ...(gateVerdicts !== undefined ? { gateVerdicts } : {}),
      scope: context.getScopeOptions(),
    });
  }

  /**
   * Append the verdict-time row for a call that carried a gate verdict and captured nothing
   * (P4.86).
   *
   * The two-call pattern — answer the step, then submit the verdict — is what the server's own
   * retry prompt asks for on a failed review, and it reached no record at all: the step's
   * `completed` row was written by the earlier call, so `captureStep` takes its
   * completed-non-placeholder early return and {@link ledgerCapturedStep} never runs. The
   * verdict, its per-gate entries and the fact that a review was answered existed only in that
   * request's memory.
   *
   * A SECOND row for the same step, never an edit of the first: `execution_records` is
   * append-only per step (see its contract), the earlier row is the true record of what the
   * step produced and when, and a reader that wants the current picture resolves the latest
   * record for the step — which is exactly what `v_execution_history` already does per session
   * via `MAX(execution_id)` over monotonic ULIDs.
   *
   * Applicability is read off request state rather than passed in, because both facts are
   * already published there and a stage re-deriving either could disagree with the service that
   * wrote it:
   *
   * - `verdictDetection` is set by `GateVerdictProcessor` only for a verdict it PROCESSED. A
   *   verdict refused over a recorded failing check never reaches it, and must not be recorded
   *   as though the engine had accepted it.
   * - `capturedStep` is set by {@link captureRealResponse} for the step captured on this call.
   *   Present means {@link ledgerCapturedStep} already bound this call's verdicts (P4.76), so
   *   recording them again would double-count the same submission.
   *
   * The row names the node whose review the verdict answered (`verdictDetection.nodeId`), which
   * is not always the step the run stands on: a PASS sent alone for step 1's structural review
   * while the run waits on a delegated step 2 records step 1, and step 2 gets no row (R27).
   *
   * `status` is the STEP's lifecycle as this call leaves it, not the verdict's wording: a
   * cleared review means the step is done, an uncleared one means the run is waiting on the
   * submitter, which is what `input_required` says.
   */
  ledgerSubmittedVerdict(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession
  ): void {
    if (this.executionRecordStore === null) return;

    const detection = context.state.gates.verdictDetection;
    if (detection === undefined || context.state.session.capturedStep !== undefined) return;

    // The node whose review the verdict answered, never the step the run stands on (R27): a
    // verdict sent alone at a later step answers an earlier node's review and completes nothing.
    const target = {
      ordinal: ordinalOf(session.state.nodes, detection.nodeId),
      nodeId: detection.nodeId,
    };
    if (target.ordinal === -1) {
      throw new Error(
        `Verdict answered a review of node ${target.nodeId}, which is not in the run`
      );
    }

    const steps = context.parsedCommand?.steps;
    const step =
      steps?.find((candidate) => candidate.nodeId === target.nodeId) ??
      steps?.find((candidate) => candidate.stepNumber === target.ordinal);

    const gateVerdicts = context.state.gates.perGateVerdicts;
    const submittedAt = Date.now();

    this.executionRecordStore.append({
      sessionId,
      chainId: session.chainId,
      stepNumber: target.ordinal,
      nodeId: target.nodeId,
      ...(step?.promptId !== undefined ? { promptId: step.promptId } : {}),
      status: detection.outcome === 'cleared' ? 'completed' : 'input_required',
      substate: { respondedAt: submittedAt },
      startedAt: submittedAt,
      ...(detection.outcome === 'cleared'
        ? { completedAt: submittedAt }
        : { inputRequired: describeOutstandingReview(session, target) }),
      ...(gateVerdicts !== undefined ? { gateVerdicts } : {}),
      scope: context.getScopeOptions(),
    });

    this.logger.debug(
      `Recorded a ${detection.verdict} verdict for step ${target.ordinal} (${target.nodeId}) submitted without a response`
    );
  }

  getStepOutputMapping(
    context: ExecutionContext,
    stepNumber: number
  ): Record<string, string> | undefined {
    const steps = context.parsedCommand?.steps;
    if (steps === undefined) return undefined;
    const step = steps.find((s) => s.stepNumber === stepNumber);
    return step?.outputMapping;
  }

  private buildPlaceholderContent(chainId: string, stepNumber: number, totalSteps: number): string {
    const timestamp = new Date().toISOString();
    return [
      `Step ${stepNumber}/${totalSteps} for chain "${chainId}" marked complete at ${timestamp}.`,
      'The STDIO transport cannot automatically return assistant output, so this placeholder marks the result as available for downstream templates.',
      'Continue by following the next set of chain instructions.',
    ].join(' ');
  }

  /**
   * Replace an existing placeholder with a real response and optionally advance.
   */
  private async replaceplaceholderWithReal(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    sessionContext: SessionContext,
    target: StepTarget,
    captureResponse: string,
    passClearedThisCall: boolean
  ): Promise<DeferredAdvance | undefined> {
    this.logger.debug(
      `User response detected for step ${target.ordinal} (${target.nodeId}), replacing placeholder with real content`
    );

    const outputMapping = this.getStepOutputMapping(context, target.ordinal);
    await this.captureRealResponse(
      context,
      sessionId,
      session.chainId,
      target,
      captureResponse,
      outputMapping
    );

    this.syncSessionContext(context, sessionId, sessionContext);
    return this.advanceUnlessHeld(context, sessionId, target, passClearedThisCall);
  }

  /**
   * Capture a real response for a step that has no existing state, and optionally advance.
   */
  private async captureRealAndAdvance(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    target: StepTarget,
    captureResponse: string,
    passClearedThisCall: boolean
  ): Promise<DeferredAdvance | undefined> {
    const outputMapping = this.getStepOutputMapping(context, target.ordinal);
    await this.captureRealResponse(
      context,
      sessionId,
      session.chainId,
      target,
      captureResponse,
      outputMapping
    );

    return this.advanceUnlessHeld(context, sessionId, target, passClearedThisCall);
  }

  /**
   * The advance past the captured node, unless an open review holds it ({@link reviewHolding}). A
   * PASS that decides this node's advance this call (`passClearedThisCall`, which stage 16 sets
   * only when the answered review graded the captured node) leaves nothing to return.
   */
  private advanceUnlessHeld(
    context: ExecutionContext,
    sessionId: string,
    target: StepTarget,
    passClearedThisCall: boolean
  ): DeferredAdvance | undefined {
    const session = this.chainSessionStore.getSession(sessionId, context.getScopeOptions());
    const review = session === undefined ? undefined : reviewHolding(session, target.nodeId);
    if (review === undefined) {
      return passClearedThisCall
        ? undefined
        : { sessionId, nodeId: target.nodeId, reason: 'captured' };
    }
    context.diagnostics.info(
      'StepCaptureService',
      'Response captured but advancement blocked by pending gate review',
      {
        capturedStep: target.ordinal,
        reviewedNodeId: review.nodeId,
        gateIds: review.gateIds,
        attemptCount: review.attemptCount,
        maxAttempts: review.maxAttempts,
      }
    );
    context.state.gates.awaitingUserChoice = true;
    return undefined;
  }

  private syncSessionContext(
    context: ExecutionContext,
    sessionId: string,
    sessionContext: SessionContext
  ): void {
    const scopeOptions = context.getScopeOptions();
    const updatedSession = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (updatedSession !== undefined) {
      context.sessionContext = {
        ...sessionContext,
        currentStep: currentOrdinal(updatedSession.state.nodes, updatedSession.state.currentNodeId),
        totalSteps: totalOf(updatedSession.state.nodes),
        currentNodeId: updatedSession.state.currentNodeId,
      };
      context.state.session.chainContext = this.chainSessionStore.getChainContext(
        sessionId,
        scopeOptions
      );
    }
  }
}

/**
 * The open review that holds a step's advance: the review of the node itself, else any open
 * review of a node BEFORE it in the run (R14). PURE. The one hold derivation: the capture asks it
 * before advancing, and the shell stage asks it before releasing a step its check held (P6.53).
 *
 * The store keeps one review per node, so a FAIL on step N's review sent with step N+1's answer
 * leaves N's review open beside N+1's capture; walking N+1 on would leave N's review behind the
 * run. A review of a later node does not hold an earlier capture, and a detached node's review
 * never holds one — completion counts those (`nodesHoldingRunOpen`).
 */
export function reviewHolding(session: ChainSession, nodeId: string): GateReview | undefined {
  const reviews = session.reviews ?? {};
  const own = reviews[nodeId];
  if (own !== undefined && own.kind !== 'detached') return own;
  const position = ordinalOf(session.state.nodes, nodeId);
  return Object.values(reviews).find(
    (review) =>
      review.kind !== 'detached' && ordinalOf(session.state.nodes, review.nodeId) < position
  );
}

/**
 * Why a verdict-time record says the step is still waiting on its submitter.
 *
 * Read off the review the run is holding on, so the row names the gate and the attempt rather
 * than restating the status in a second vocabulary. A run whose review was cleared between the
 * snapshot and this call answers the generic reason instead of inventing a gate id.
 */
function describeOutstandingReview(session: ChainSession, target: StepTarget): InputRequiredReason {
  const review = reviewHolding(session, target.nodeId);
  const gateId = review?.gateIds[0];
  return gateId === undefined || review === undefined
    ? { kind: 'awaiting_response' }
    : { kind: 'gate_review', gateId, attempt: review.attemptCount };
}
