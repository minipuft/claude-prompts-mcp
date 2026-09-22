// @lifecycle canonical - Captures step results (placeholder or real) in chain sessions.

import { handoffNodeToken, resolveHandoffEvidenceReason } from '../delegation/handoff-contract.js';
import { buildPipelineHookContext } from '../pipeline/hook-context.js';

import type { Logger } from '#infra/logging/index.js';
import type { ExecutionRecordStore } from '#modules/chains/execution-record-store.js';
import type { InputRequiredReason } from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '#shared/types/index.js';
import type { ExecutionContext, SessionContext } from '../context/index.js';

import { currentOrdinal, nodeIdAt, totalOf } from '#shared/utils/node-order.js';

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
   * Determines target step, checks eligibility, writes placeholder or real response,
   * and advances step unless blocked by a pending gate review.
   */
  async captureStep(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    sessionContext: SessionContext,
    currentStepAtStart: number,
    input: StepCaptureInput
  ): Promise<void> {
    const captureResponse =
      input.userResponse !== undefined && input.userResponse.length > 0
        ? input.userResponse
        : undefined;
    const hasUserResponseForCapture = captureResponse !== undefined;

    const target = this.resolveTarget(session, currentStepAtStart, hasUserResponseForCapture);
    if (target === undefined) {
      return;
    }

    const existingState = this.chainSessionStore.getStepState(sessionId, target.nodeId);
    if (existingState?.state === 'completed' && !existingState.isPlaceholder) {
      return;
    }

    if (existingState?.state === 'completed' && existingState.isPlaceholder === true) {
      if (captureResponse !== undefined) {
        await this.replaceplaceholderWithReal(
          context,
          sessionId,
          session,
          sessionContext,
          target,
          captureResponse,
          input.passClearedThisCall
        );
      }
      return;
    }

    try {
      if (captureResponse !== undefined) {
        await this.captureRealAndAdvance(
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
    target: StepTarget
  ): Promise<void> {
    await this.capturePlaceholder(sessionId, session.chainId, target, totalOf(session.state.nodes));
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

    await this.announceStepComplete(context, chainId, target, responseContent);

    this.logger.debug(`Step ${target.ordinal} (${target.nodeId}) completed with real response`);
  }

  /**
   * Announce the step-completed fact to hook consumers and to the connected client.
   *
   * Placed here and nowhere else because this is the one path that records a REAL step
   * completion, and `captureStep` returns early for a step already completed non-placeholder —
   * so a gate retry re-entering capture cannot announce a second time. The placeholder write
   * deliberately does not announce: it is a STDIO transport artifact standing in for output
   * that has not arrived, and a client told "step 2 complete" for it would advance past a step
   * whose result does not exist yet.
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
   * `status` is the STEP's lifecycle as this call leaves it, not the verdict's wording: a
   * cleared review means the step is done, an uncleared one means the run is waiting on the
   * submitter, which is what `input_required` says.
   */
  ledgerSubmittedVerdict(
    context: ExecutionContext,
    sessionId: string,
    session: ChainSession,
    currentStepAtStart: number
  ): void {
    if (this.executionRecordStore === null) return;

    const detection = context.state.gates.verdictDetection;
    if (detection === undefined || context.state.session.capturedStep !== undefined) return;

    const target = this.resolveTarget(session, currentStepAtStart, true);
    if (target === undefined) return;

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
        : { inputRequired: describeOutstandingReview(session) }),
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
  ): Promise<void> {
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

    // Only advance if no pending gate review (gated flows advance on PASS verdict)
    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    const hasPendingReview = pendingReview !== undefined;
    if (!hasPendingReview && !passClearedThisCall) {
      await this.chainSessionStore.advanceStep(sessionId, target.nodeId);
    } else if (hasPendingReview) {
      context.diagnostics.info(
        'StepCaptureService',
        'Response captured but advancement blocked by pending gate review',
        {
          capturedStep: target.ordinal,
          gateIds: pendingReview.gateIds,
          attemptCount: pendingReview.attemptCount,
          maxAttempts: pendingReview.maxAttempts,
        }
      );
      context.state.gates.awaitingUserChoice = true;
    }

    this.syncSessionContext(context, sessionId, sessionContext);
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
  ): Promise<void> {
    const outputMapping = this.getStepOutputMapping(context, target.ordinal);
    await this.captureRealResponse(
      context,
      sessionId,
      session.chainId,
      target,
      captureResponse,
      outputMapping
    );

    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    const hasPendingReview = pendingReview !== undefined;
    if (!hasPendingReview && !passClearedThisCall) {
      await this.chainSessionStore.advanceStep(sessionId, target.nodeId);
    } else if (hasPendingReview) {
      context.diagnostics.info(
        'StepCaptureService',
        'Response captured but advancement blocked by pending gate review',
        {
          capturedStep: target.ordinal,
          gateIds: pendingReview.gateIds,
          attemptCount: pendingReview.attemptCount,
          maxAttempts: pendingReview.maxAttempts,
        }
      );
      context.state.gates.awaitingUserChoice = true;
    }
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
 * Why a verdict-time record says the step is still waiting on its submitter.
 *
 * Read off the review the run is holding on, so the row names the gate and the attempt rather
 * than restating the status in a second vocabulary. A run whose review was cleared between the
 * snapshot and this call answers the generic reason instead of inventing a gate id.
 */
function describeOutstandingReview(session: ChainSession): InputRequiredReason {
  const review = session.pendingGateReview;
  const gateId = review?.gateIds[0];
  return gateId === undefined || review === undefined
    ? { kind: 'awaiting_response' }
    : { kind: 'gate_review', gateId, attempt: review.attemptCount };
}
