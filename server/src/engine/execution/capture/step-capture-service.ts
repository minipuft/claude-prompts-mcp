// @lifecycle canonical - Captures step results (placeholder or real) in chain sessions.

import { resolveDelegationSkipped } from '../delegation/acknowledgment.js';

import type { Logger } from '#infra/logging/index.js';
import type { ExecutionRecordStore } from '#modules/chains/execution-record-store.js';
import type { ChainSession, ChainSessionService } from '#shared/types/index.js';
import type { ExecutionContext, SessionContext } from '../context/index.js';

import { currentOrdinal, nodeIdAt, totalOf } from '#shared/utils/node-order.js';

const PLACEHOLDER_SOURCE = 'StepResponseCaptureStage';

/**
 * The step a capture call is acting on, carried as identity + position together.
 *
 * Both are needed and neither derives the other cheaply here: the store is addressed by
 * `nodeId`, while placeholder text, output mappings and diagnostics are all positional.
 */
interface StepTarget {
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
    private readonly executionRecordStore: ExecutionRecordStore | null = null
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

    this.logger.debug(`Step ${target.ordinal} (${target.nodeId}) completed with real response`);
  }

  /**
   * Append the capture-time `completed` row for the step whose real output was just captured
   * (S8). This is the moment the delegation-acknowledgment fact exists and the only writer
   * that binds `delegation_skipped`: 1/0 when the captured step was delegated AND carried gate
   * text (the same `metadata['gateInstructions']` field the brief derived its Result Contract
   * from), NULL everywhere else — partial population BY ROW TYPE. Exactly one row per captured
   * step: gate retries re-enter `captureStep` and take its completed-non-placeholder early
   * return before reaching this.
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

    const stepGateText =
      typeof step?.metadata?.['gateInstructions'] === 'string'
        ? step.metadata['gateInstructions']
        : undefined;
    const delegationSkipped = resolveDelegationSkipped({
      delegated: step?.delegated,
      stepGateText,
      capturedResponse: responseContent,
    });

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
      ...(delegationSkipped !== undefined ? { delegationSkipped } : {}),
      scope: context.getScopeOptions(),
    });
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
