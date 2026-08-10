// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { UnknownObservationValidationError } from '../../capture/unknown-observation-processor.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ChainSessionService, ToolResponse } from '#shared/types/index.js';
import type { GateVerdictProcessor } from '../../../gates/services/gate-verdict-processor.js';
import type { StepCaptureService } from '../../capture/step-capture-service.js';
import type { UnknownObservationProcessor } from '../../capture/unknown-observation-processor.js';
import type { ExecutionContext, SessionContext } from '../../context/index.js';

/**
 * Pipeline Stage 16: Step Response Capture
 *
 * Thin orchestrator that delegates verdict processing and step capture to domain services.
 *
 * Dependencies: context.sessionContext
 * Output: Captured step results in TextReferenceStore
 * Can Early Exit: No
 */
export class StepResponseCaptureStage extends BasePipelineStage {
  readonly name = 'StepResponseCapture';

  constructor(
    private readonly verdictProcessor: GateVerdictProcessor,
    private readonly stepCaptureService: StepCaptureService,
    private readonly chainSessionStore: ChainSessionService,
    private readonly unknownObservationProcessor: UnknownObservationProcessor,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.sessionContext === undefined) {
      this.logExit({ skipped: 'No session context available' });
      return;
    }

    const sessionContext = context.sessionContext;
    if (!sessionContext.isChainExecution) {
      this.logExit({ skipped: 'Not a chain execution' });
      return;
    }

    const sessionId = sessionContext.sessionId;
    if (sessionId.trim().length === 0) {
      this.logExit({ skipped: 'Missing session identifier' });
      return;
    }

    const scopeOptions = context.getScopeOptions();
    const session = this.chainSessionStore.getSession(sessionId, scopeOptions);
    if (session === undefined) {
      this.logExit({ skipped: 'Session not found' });
      return;
    }

    const currentStepAtStart = session.state.currentStep;

    // Align pipeline session context with manager state
    this.alignSessionContext(context, sessionContext, session, currentStepAtStart);

    // Declared unknowns are applied here — ahead of the chain-context refresh below, so
    // this call's rendering sees the ledger it just wrote, and ahead of gate-action and
    // verdict handling because every one of those paths can exit early. A resume that
    // carries a gate verdict is exactly where an unknown tends to surface, so dropping
    // the batch there would be silent loss. Entries stamp `currentStepAtStart` — the step
    // being reported on, not the one this call advances to. Re-submitting the same batch
    // on a gate retry is idempotent by construction (see `computeUnknownLedger`).
    const observationsRejected = await this.applyObservations(
      context,
      sessionId,
      currentStepAtStart
    );
    if (observationsRejected) {
      this.logExit({ observations: 'rejected' });
      return;
    }

    // Refresh chain variables for downstream template rendering
    context.state.session.chainContext = this.chainSessionStore.getChainContext(
      sessionId,
      scopeOptions
    );

    const lifecycleDecision = context.state.session.lifecycleDecision;
    if (lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart') {
      this.logExit({ skipped: 'New session, nothing to capture' });
      return;
    }

    // Handle gate_action parameter (retry/skip/abort) when retry limit exceeded
    const gateAction = context.mcpRequest.gate_action;
    const authority = context.gateEnforcement;
    const isRetryLimitExceeded =
      authority !== undefined
        ? authority.isRetryLimitExceeded(sessionId)
        : this.chainSessionStore.isRetryLimitExceeded(sessionId);

    if (gateAction !== undefined && isRetryLimitExceeded) {
      const earlyExit = await this.verdictProcessor.handleGateAction(
        context,
        sessionId,
        gateAction,
        sessionContext
      );
      if (earlyExit) {
        this.logExit({ gateAction, handled: true });
        return;
      }
    }

    // Process gate verdicts
    const userResponse = context.mcpRequest.user_response?.trim();

    const deferredResult = await this.verdictProcessor.processDeferredVerdict(
      context,
      session,
      sessionId,
      currentStepAtStart,
      userResponse,
      sessionContext
    );
    if (deferredResult.earlyExit) {
      this.logExit({ gateVerdict: 'deferred', handled: true });
      return;
    }

    // Re-fetch session in case deferred verdict changed state
    const sessionAfterDeferred =
      this.chainSessionStore.getSession(sessionId, scopeOptions) ?? session;
    const pendingResult = await this.verdictProcessor.processPendingReviewVerdict(
      context,
      sessionAfterDeferred,
      sessionId,
      currentStepAtStart,
      deferredResult.userResponse,
      sessionContext
    );
    if (pendingResult.earlyExit) {
      this.logExit({ gateVerdict: 'pending-review', handled: true });
      return;
    }

    // Capture step result (placeholder or real response)
    const sessionForCapture = this.chainSessionStore.getSession(sessionId, scopeOptions) ?? session;
    await this.stepCaptureService.captureStep(
      context,
      sessionId,
      sessionForCapture,
      sessionContext,
      currentStepAtStart,
      {
        userResponse: pendingResult.userResponse,
        passClearedThisCall:
          pendingResult.passClearedThisCall || deferredResult.passClearedThisCall,
      }
    );

    this.logExit({ captured: true });
  }

  /**
   * Hand any declared unknown observations to the processor.
   *
   * @returns true when the batch was rejected and a tool-result error was set, meaning
   *   the stage must stop. Non-validation failures (persistence) propagate untouched.
   */
  private async applyObservations(
    context: ExecutionContext,
    sessionId: string,
    stepNumber: number
  ): Promise<boolean> {
    const observations = context.mcpRequest.observations;
    if (observations === undefined || observations.length === 0) {
      return false;
    }

    try {
      await this.unknownObservationProcessor.applyObservations(
        context,
        sessionId,
        stepNumber,
        observations
      );
      return false;
    } catch (error) {
      if (error instanceof UnknownObservationValidationError) {
        context.setResponse(this.buildErrorResponse(`❌ Error: ${error.message}`));
        return true;
      }
      throw error;
    }
  }

  private buildErrorResponse(message: string): ToolResponse {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  /**
   * Align pipeline session context with manager state.
   * Important for gate reviews where session state may have changed.
   */
  private alignSessionContext(
    context: ExecutionContext,
    sessionContext: SessionContext,
    session: NonNullable<ReturnType<ChainSessionService['getSession']>>,
    currentStepAtStart: number
  ): void {
    const updatedSessionContext: SessionContext = {
      sessionId: sessionContext.sessionId,
      isChainExecution: sessionContext.isChainExecution,
    };
    if (sessionContext.chainId !== undefined) {
      updatedSessionContext.chainId = sessionContext.chainId;
    }
    updatedSessionContext.currentStep = currentStepAtStart;
    updatedSessionContext.totalSteps = session.state.totalSteps;
    const pendingReview = session.pendingGateReview ?? sessionContext.pendingReview;
    if (pendingReview !== undefined) {
      updatedSessionContext.pendingReview = pendingReview;
    }
    if (sessionContext.previousStepResult !== undefined) {
      updatedSessionContext.previousStepResult = sessionContext.previousStepResult;
    }
    if (sessionContext.previousStepQualityScore !== undefined) {
      updatedSessionContext.previousStepQualityScore = sessionContext.previousStepQualityScore;
    }

    context.sessionContext = updatedSessionContext;
  }
}
