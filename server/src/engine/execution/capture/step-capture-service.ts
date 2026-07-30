// @lifecycle canonical - Captures step results (placeholder or real) in chain sessions.

import type { Logger } from '../../../infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../shared/types/index.js';
import type { ExecutionContext, SessionContext } from '../context/index.js';

const PLACEHOLDER_SOURCE = 'StepResponseCaptureStage';

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
 * Extracted from StepResponseCaptureStage (pipeline stage 08).
 */
export class StepCaptureService {
  constructor(
    private readonly chainSessionStore: ChainSessionService,
    private readonly logger: Logger
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

    // Determine target step number:
    // - If user_response provided: capture for CURRENT step (the one just rendered)
    // - Otherwise: capture placeholder for PREVIOUS step
    const targetStepNumber = hasUserResponseForCapture
      ? currentStepAtStart
      : currentStepAtStart - 1;

    if (!this.shouldCaptureStep(targetStepNumber, session.state.totalSteps)) {
      return;
    }

    const existingState = this.chainSessionStore.getStepState(sessionId, targetStepNumber);
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
          targetStepNumber,
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
          targetStepNumber,
          captureResponse,
          input.passClearedThisCall
        );
      } else {
        await this.capturePlaceholder(
          sessionId,
          session.chainId,
          targetStepNumber,
          session.state.totalSteps
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

  private shouldCaptureStep(stepNumber: number | undefined, totalSteps: number): boolean {
    if (stepNumber === undefined || stepNumber < 1) {
      return false;
    }
    if (totalSteps > 0 && stepNumber > totalSteps) {
      return false;
    }
    return true;
  }

  private async capturePlaceholder(
    sessionId: string,
    chainId: string,
    stepNumber: number,
    totalSteps: number
  ): Promise<void> {
    const placeholderContent = this.buildPlaceholderContent(chainId, stepNumber, totalSteps);

    await this.chainSessionStore.updateSessionState(sessionId, stepNumber, placeholderContent, {
      isPlaceholder: true,
      placeholderSource: PLACEHOLDER_SOURCE,
      capturedAt: Date.now(),
    });

    await this.chainSessionStore.completeStep(sessionId, stepNumber, {
      preservePlaceholder: true,
    });
  }

  private async captureRealResponse(
    sessionId: string,
    chainId: string,
    stepNumber: number,
    responseContent: string,
    outputMapping?: Record<string, string>
  ): Promise<void> {
    this.logger.debug(
      `Capturing real response for step ${stepNumber} in chain ${chainId}: ${responseContent.substring(0, 50)}...`
    );

    await this.chainSessionStore.updateSessionState(sessionId, stepNumber, responseContent, {
      isPlaceholder: false,
      source: 'user_response',
      capturedAt: Date.now(),
      outputMapping,
    });

    await this.chainSessionStore.completeStep(sessionId, stepNumber, {
      preservePlaceholder: false,
    });

    this.logger.debug(`Step ${stepNumber} completed with real response`);
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
    targetStepNumber: number,
    captureResponse: string,
    passClearedThisCall: boolean
  ): Promise<void> {
    this.logger.debug(
      `User response detected for step ${targetStepNumber}, replacing placeholder with real content`
    );

    const outputMapping = this.getStepOutputMapping(context, targetStepNumber);
    await this.captureRealResponse(
      sessionId,
      session.chainId,
      targetStepNumber,
      captureResponse,
      outputMapping
    );

    // Only advance if no pending gate review (gated flows advance on PASS verdict)
    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    const hasPendingReview = pendingReview !== undefined;
    if (!hasPendingReview && !passClearedThisCall) {
      await this.chainSessionStore.advanceStep(sessionId, targetStepNumber);
    } else if (hasPendingReview) {
      context.diagnostics.info(
        'StepCaptureService',
        'Response captured but advancement blocked by pending gate review',
        {
          capturedStep: targetStepNumber,
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
    targetStepNumber: number,
    captureResponse: string,
    passClearedThisCall: boolean
  ): Promise<void> {
    const outputMapping = this.getStepOutputMapping(context, targetStepNumber);
    await this.captureRealResponse(
      sessionId,
      session.chainId,
      targetStepNumber,
      captureResponse,
      outputMapping
    );

    const pendingReview = this.chainSessionStore.getPendingGateReview(sessionId);
    const hasPendingReview = pendingReview !== undefined;
    if (!hasPendingReview && !passClearedThisCall) {
      await this.chainSessionStore.advanceStep(sessionId, targetStepNumber);
    } else if (hasPendingReview) {
      context.diagnostics.info(
        'StepCaptureService',
        'Response captured but advancement blocked by pending gate review',
        {
          capturedStep: targetStepNumber,
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
        currentStep: updatedSession.state.currentStep,
        totalSteps: updatedSession.state.totalSteps,
      };
      context.state.session.chainContext = this.chainSessionStore.getChainContext(
        sessionId,
        scopeOptions
      );
    }
  }
}
