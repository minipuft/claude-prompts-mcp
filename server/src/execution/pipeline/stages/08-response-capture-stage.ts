// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { StepState } from '../../../mcp-tools/prompt-engine/core/types.js';
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { HookRegistry, HookExecutionContext } from '../../../hooks/index.js';
import type { Logger } from '../../../logging/index.js';
import type { McpNotificationEmitter } from '../../../notifications/index.js';
import type { ExecutionContext, SessionContext } from '../../context/index.js';
import type { GateAction } from '../decisions/index.js';

const PLACEHOLDER_SOURCE = 'StepResponseCaptureStage';

/**
 * Pipeline Stage 8: Step Response Capture
 *
 * Captures results from previous chain steps for STDIO transport compatibility,
 * recording placeholder results to enable {{previous_step_result}} references
 * in downstream steps.
 *
 * Dependencies: context.sessionContext
 * Output: Captured step results in TextReferenceManager
 * Can Early Exit: No
 */
export class StepResponseCaptureStage extends BasePipelineStage {
  readonly name = 'StepResponseCapture';

  constructor(
    private readonly chainSessionManager: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // Use type-safe access for session-related properties
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

    const session = this.chainSessionManager.getSession(sessionId);
    if (session === undefined) {
      this.logExit({ skipped: 'Session not found' });
      return;
    }

    // Capture state at start of execution to avoid mutation issues
    const currentStepAtStart = session.state.currentStep;

    // Keep pipeline session context aligned with manager state (important for gate reviews)
    const updatedSessionContext: SessionContext = {
      sessionId,
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

    // Always refresh chain variables for downstream template rendering
    context.state.session.chainContext = this.chainSessionManager.getChainContext(sessionId);

    const lifecycleDecision = context.state.session.lifecycleDecision;
    if (lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart') {
      this.logExit({ skipped: 'New session, nothing to capture' });
      return;
    }

    let userResponse = context.mcpRequest.user_response?.trim();
    const gateVerdictInput = context.getGateVerdict();
    const hasUserResponse = (value: string | undefined): value is string =>
      typeof value === 'string' && value.length > 0;

    // Use authority for verdict parsing if available (preferred), fallback to local parsing
    type ParsedVerdict = ReturnType<StepResponseCaptureStage['parseGateVerdict']>;
    const parseVerdict = (
      raw: string | undefined,
      source: 'gate_verdict' | 'user_response'
    ): ParsedVerdict =>
      context.gateEnforcement?.parseVerdict(raw, source) ?? this.parseGateVerdict(raw, source);

    // Do not parse verdicts from user_response (contract-first). Only use gate_verdict parameter.
    const verdictFromUserResponse = null;

    // Handle gate_action parameter (retry/skip/abort) when retry limit exceeded
    // Delegate to GateEnforcementAuthority for consistent action handling
    const gateAction = context.mcpRequest.gate_action;
    const authority = context.gateEnforcement;
    // Track if we already advanced due to a PASS/continue verdict in this request
    let passClearedThisCall = false;
    const isRetryLimitExceeded =
      authority !== undefined
        ? authority.isRetryLimitExceeded(sessionId)
        : this.chainSessionManager.isRetryLimitExceeded(sessionId);

    if (gateAction !== undefined && isRetryLimitExceeded) {
      await this.handleGateAction(context, sessionId, gateAction, sessionContext);
      // If abort, exit early
      if (gateAction === 'abort') {
        this.logExit({ gateAction: 'abort', sessionAborted: true });
        return;
      }
      this.logExit({ gateAction, handled: true });
      return;
    }

    // Deferred review support: if a verdict is provided without an existing pending review,
    // use the GateEnforcementAuthority to create/clear reviews as needed before execution.
    if (session.pendingGateReview === undefined && gateVerdictInput !== undefined && authority) {
      const verdictPayload = parseVerdict(gateVerdictInput, 'gate_verdict');
      if (verdictPayload !== null) {
        const enforcementMode = context.state.gates.enforcementMode ?? 'blocking';
        const outcome = await authority.recordOutcome(sessionId, verdictPayload, enforcementMode);

        // Record detection metadata for diagnostics
        const verdictDetection: NonNullable<typeof context.state.gates.verdictDetection> = {
          verdict: verdictPayload.verdict,
          source: verdictPayload.source,
        };
        verdictDetection.rationale = verdictPayload.rationale;
        if (verdictPayload.detectedPattern !== undefined) {
          verdictDetection.pattern = verdictPayload.detectedPattern;
        }
        verdictDetection.outcome = outcome.status === 'cleared' ? 'cleared' : 'pending';
        context.state.gates.verdictDetection = verdictDetection;

        // Advance immediately on PASS; otherwise sync newly created pending review (on FAIL)
        if (outcome.status === 'cleared') {
          const stepToAdvance = currentStepAtStart;
          await this.chainSessionManager.advanceStep(sessionId, stepToAdvance);
          context.diagnostics.info(this.name, 'Gate PASS (no prior review) - advanced step', {
            stepToAdvance,
          });
          passClearedThisCall = true;
        }

        // Sync newly created pending review (on FAIL) into session context so ExecutionStage skips
        const pending = this.chainSessionManager.getPendingGateReview(sessionId);
        if (pending !== undefined) {
          sessionContext.pendingReview = pending;
          context.sessionContext = { ...sessionContext };
        }

        // If no step output accompanies the verdict, we can stop here after verdict handling
        if (!hasUserResponse(userResponse)) {
          this.logExit({
            gateVerdict: verdictPayload.verdict,
            gateVerdictSource: verdictPayload.source,
          });
          return;
        }
      }
    }

    if (session.pendingGateReview !== undefined) {
      const verdictPayload = parseVerdict(gateVerdictInput, 'gate_verdict');
      // Capture gateIds before recordGateReviewOutcome - it may clear the pending review
      const capturedGateIds = [...session.pendingGateReview.gateIds];

      if (verdictPayload !== null) {
        const outcome = await this.chainSessionManager.recordGateReviewOutcome(sessionId, {
          verdict: verdictPayload.verdict,
          rationale: verdictPayload.rationale,
          rawVerdict: verdictPayload.raw,
          reviewer: verdictPayload.source,
        });

        // Add detection metadata for transparency and debugging
        const verdictDetection: NonNullable<typeof context.state.gates.verdictDetection> = {
          verdict: verdictPayload.verdict,
          source: verdictPayload.source,
        };
        verdictDetection.rationale = verdictPayload.rationale;
        if (verdictPayload.detectedPattern !== undefined) {
          verdictDetection.pattern = verdictPayload.detectedPattern;
        }
        verdictDetection.outcome = outcome;

        context.state.gates.verdictDetection = verdictDetection;

        if (outcome === 'cleared') {
          // Gate review passed - advance to next step
          const stepToAdvance = currentStepAtStart;
          await this.chainSessionManager.advanceStep(sessionId, stepToAdvance);
          context.diagnostics.info(this.name, 'Gate PASS - advanced step', { stepToAdvance });
          delete sessionContext.pendingReview;
          passClearedThisCall = true;

          // Emit gate passed event (use captured gateIds - review was cleared)
          await this.emitGateEvents(context, 'passed', capturedGateIds, verdictPayload.rationale);
        } else {
          const pending = this.chainSessionManager.getPendingGateReview(sessionId);
          if (pending !== undefined) {
            sessionContext.pendingReview = pending;
          } else {
            delete sessionContext.pendingReview;
          }

          // Get enforcement mode (defaults to 'blocking')
          const enforcementMode = context.state.gates.enforcementMode ?? 'blocking';

          // Handle FAIL verdict based on enforcement mode
          if (verdictPayload.verdict === 'FAIL') {
            switch (enforcementMode) {
              case 'blocking': {
                // Stay on step, check retry limit (render review screen with context)
                const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
                const isRetryExhausted =
                  pendingReview !== undefined &&
                  this.chainSessionManager.isRetryLimitExceeded(sessionId);

                if (isRetryExhausted && pendingReview !== undefined) {
                  context.state.gates.retryLimitExceeded = true;
                  context.state.gates.retryExhaustedGateIds = [...pendingReview.gateIds];
                  context.diagnostics.warn(this.name, 'Gate retry limit exceeded', {
                    attemptCount: pendingReview.attemptCount,
                    maxAttempts: pendingReview.maxAttempts,
                    gateIds: pendingReview.gateIds,
                  });

                  // Emit retry exhausted event
                  await this.emitGateEvents(
                    context,
                    'retryExhausted',
                    pendingReview.gateIds,
                    verdictPayload.rationale
                  );
                }

                // Check if any gates have blockResponseOnFail enabled
                // This suppresses response content when gate fails
                if (context.gates.hasBlockingGates()) {
                  const blockedGateIds = [...context.gates.getBlockingGateIds()];
                  context.state.gates.responseBlocked = true;
                  context.state.gates.blockedGateIds = blockedGateIds;
                  context.diagnostics.info(this.name, 'Response content blocked by gate failure', {
                    blockedGateIds,
                  });

                  // Emit response blocked event
                  await this.emitGateEvents(context, 'responseBlocked', blockedGateIds);
                }

                // Emit gate failed event (use captured gateIds)
                await this.emitGateEvents(
                  context,
                  'failed',
                  capturedGateIds,
                  verdictPayload.rationale
                );

                context.diagnostics.info(this.name, 'Gate FAIL - blocking mode, awaiting retry');
                break;
              }

              case 'advisory': {
                // Log warning but allow advancement (advisoryWarnings initialized in ExecutionContext)
                context.state.gates.advisoryWarnings.push(
                  `Gate ${capturedGateIds.join(', ')} failed: ${verdictPayload.rationale}`
                );
                context.diagnostics.warn(this.name, 'Gate FAIL - advisory mode, continuing', {
                  rationale: verdictPayload.rationale,
                });

                // Emit gate failed event (advisory mode still counts as failure, use captured gateIds)
                await this.emitGateEvents(
                  context,
                  'failed',
                  capturedGateIds,
                  verdictPayload.rationale
                );

                // Clear pending review and advance step (non-blocking mode continues)
                await this.chainSessionManager.clearPendingGateReview(sessionId);
                const stepToAdvance = currentStepAtStart;
                await this.chainSessionManager.advanceStep(sessionId, stepToAdvance);
                delete sessionContext.pendingReview;
                passClearedThisCall = true;
                break;
              }

              case 'informational': {
                // Log only, no user impact
                const infoGateIds = [...(session.pendingGateReview?.gateIds ?? [])];
                context.diagnostics.info(this.name, 'Gate FAIL - informational mode, logged only', {
                  rationale: verdictPayload.rationale,
                });

                // Emit gate failed event (informational mode still counts as failure)
                await this.emitGateEvents(context, 'failed', infoGateIds, verdictPayload.rationale);

                // Clear pending review and advance step (non-blocking mode continues)
                await this.chainSessionManager.clearPendingGateReview(sessionId);
                const stepToAdvance = currentStepAtStart;
                await this.chainSessionManager.advanceStep(sessionId, stepToAdvance);
                delete sessionContext.pendingReview;
                passClearedThisCall = true;
                break;
              }
            }
          }
        }
        context.sessionContext = {
          ...sessionContext,
        };

        if (gateVerdictInput === undefined && verdictFromUserResponse !== null) {
          userResponse = undefined;
        }

        if (!hasUserResponse(userResponse)) {
          this.logExit({
            gateVerdict: verdictPayload.verdict,
            gateVerdictSource: verdictPayload.source,
          });
          return;
        }
      }
    }

    // Check if user provided a response for the current step
    const captureResponse = hasUserResponse(userResponse) ? userResponse : undefined;
    const hasUserResponseForCapture = captureResponse !== undefined;

    // Determine target step number:
    // - If user_response provided: capture for CURRENT step (the one just rendered)
    // - Otherwise: capture placeholder for PREVIOUS step
    const targetStepNumber = hasUserResponseForCapture
      ? currentStepAtStart
      : currentStepAtStart - 1;

    if (!this.shouldCaptureStep(targetStepNumber, session.state.totalSteps)) {
      this.logExit({ skipped: 'No prior step to capture' });
      return;
    }

    const existingState = this.chainSessionManager.getStepState(sessionId, targetStepNumber);
    if (existingState?.state === StepState.COMPLETED && !existingState.isPlaceholder) {
      this.logExit({ skipped: 'Step already completed with real output' });
      return;
    }

    if (existingState?.state === StepState.COMPLETED && existingState.isPlaceholder === true) {
      // Check if user provided a response to advance past the placeholder
      if (captureResponse !== undefined) {
        // User provided explicit response - capture and advance
        this.logger.debug(
          `User response detected for step ${targetStepNumber}, replacing placeholder with real content`
        );

        const outputMapping = this.getStepOutputMapping(context, targetStepNumber);
        const response = captureResponse;
        await this.captureRealResponse(
          sessionId,
          session.chainId,
          targetStepNumber,
          response,
          outputMapping
        );

        // Only advance if no pending gate review (gated flows advance on PASS verdict)
        const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
        const hasPendingReview = pendingReview !== undefined;
        if (!hasPendingReview && !passClearedThisCall) {
          await this.chainSessionManager.advanceStep(sessionId, targetStepNumber);
        } else if (hasPendingReview) {
          // User submitted user_response but gate review is blocking advancement
          // Add explicit feedback so user understands why chain didn't advance
          context.diagnostics.info(
            this.name,
            'Response captured but advancement blocked by pending gate review',
            {
              capturedStep: targetStepNumber,
              gateIds: pendingReview.gateIds,
              attemptCount: pendingReview.attemptCount,
              maxAttempts: pendingReview.maxAttempts,
            }
          );
          // Set flag so call-to-action stage can show appropriate messaging
          context.state.gates.awaitingUserChoice = true;
        }

        const updatedSession = this.chainSessionManager.getSession(sessionId);
        if (updatedSession !== undefined) {
          context.sessionContext = {
            ...sessionContext,
            currentStep: updatedSession.state.currentStep,
            totalSteps: updatedSession.state.totalSteps,
          };
          context.state.session.chainContext = this.chainSessionManager.getChainContext(sessionId);
        }

        this.logExit({
          capturedStep: targetStepNumber,
          responseType: 'user_response',
          advanced: !hasPendingReview,
          blockedByGateReview: hasPendingReview,
        });
        return;
      }

      // No response provided - placeholder already exists
      this.logExit({ skipped: 'Placeholder already recorded' });
      return;
    }

    try {
      let didAdvance = false;
      let blockedByGateReview = false;

      // Check for user response before creating placeholder
      if (captureResponse !== undefined) {
        // User provided explicit response
        const outputMapping = this.getStepOutputMapping(context, targetStepNumber);
        const response = captureResponse;
        await this.captureRealResponse(
          sessionId,
          session.chainId,
          targetStepNumber,
          response,
          outputMapping
        );

        // Only advance if no pending gate review (gated flows advance on PASS verdict)
        const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
        const hasPendingReview = pendingReview !== undefined;
        if (!hasPendingReview && !passClearedThisCall) {
          await this.chainSessionManager.advanceStep(sessionId, targetStepNumber);
          didAdvance = true;
        } else if (hasPendingReview) {
          // User submitted user_response but gate review is blocking advancement
          blockedByGateReview = true;
          context.diagnostics.info(
            this.name,
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
      } else {
        // No response - create placeholder
        await this.capturePlaceholder(
          sessionId,
          session.chainId,
          targetStepNumber,
          session.state.totalSteps
        );
      }

      const updatedSession = this.chainSessionManager.getSession(sessionId);
      if (updatedSession !== undefined) {
        context.sessionContext = {
          ...sessionContext,
          currentStep: updatedSession.state.currentStep,
          totalSteps: updatedSession.state.totalSteps,
        };
        context.state.session.chainContext = this.chainSessionManager.getChainContext(sessionId);
      }

      const responseType = hasUserResponseForCapture ? 'user_response' : 'placeholder';
      this.logExit({
        capturedStep: targetStepNumber,
        responseType,
        advanced: didAdvance,
        blockedByGateReview,
      });
    } catch (error) {
      this.handleError(error, 'Failed to capture previous step result');
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

    await this.chainSessionManager.updateSessionState(sessionId, stepNumber, placeholderContent, {
      isPlaceholder: true,
      placeholderSource: PLACEHOLDER_SOURCE,
      capturedAt: Date.now(),
    });

    await this.chainSessionManager.completeStep(sessionId, stepNumber, {
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

    await this.chainSessionManager.updateSessionState(sessionId, stepNumber, responseContent, {
      isPlaceholder: false,
      source: 'user_response',
      capturedAt: Date.now(),
      outputMapping, // Pass through for named output storage
    });

    await this.chainSessionManager.completeStep(sessionId, stepNumber, {
      preservePlaceholder: false, // Real completion
    });

    // Note: Step advancement is handled by the caller - only advance if no pending gate review
    this.logger.debug(`Step ${stepNumber} completed with real response`);
  }

  private getStepOutputMapping(
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
   * Handle user choice action when retry limit is exceeded.
   * Delegates to GateEnforcementAuthority for session manager interactions,
   * handles context state updates locally.
   */
  private async handleGateAction(
    context: ExecutionContext,
    sessionId: string,
    gateAction: GateAction,
    sessionContext: NonNullable<typeof context.sessionContext>
  ): Promise<void> {
    const authority = context.gateEnforcement;

    // Delegate session manager operations to authority if available
    if (authority !== undefined) {
      const result = await authority.resolveAction(sessionId, gateAction);

      // Handle context state updates based on action result
      if (result.handled) {
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;

        if (result.retryReset === true) {
          context.diagnostics.info(this.name, 'User chose to retry after exhaustion', {
            sessionId,
          });
        } else if (result.reviewCleared === true) {
          const clearedContext = { ...sessionContext };
          delete clearedContext.pendingReview;
          context.sessionContext = clearedContext;
          context.diagnostics.warn(this.name, 'User chose to skip failed gate', {
            sessionId,
            skippedGates: context.state.gates.retryExhaustedGateIds,
          });
        } else if (result.sessionAborted === true) {
          context.state.session.aborted = true;
          context.diagnostics.info(this.name, 'User chose to abort chain after gate failure', {
            sessionId,
            failedGates: context.state.gates.retryExhaustedGateIds,
          });
        }
      }
      return;
    }

    // Fallback: Direct session manager interaction (legacy path)
    switch (gateAction) {
      case 'retry': {
        await this.chainSessionManager.resetRetryCount(sessionId);
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        context.diagnostics.info(this.name, 'User chose to retry after exhaustion', {
          sessionId,
        });
        break;
      }

      case 'skip': {
        await this.chainSessionManager.clearPendingGateReview(sessionId);
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        const clearedContext = { ...sessionContext };
        delete clearedContext.pendingReview;
        context.sessionContext = clearedContext;
        context.diagnostics.warn(this.name, 'User chose to skip failed gate', {
          sessionId,
          skippedGates: context.state.gates.retryExhaustedGateIds,
        });
        break;
      }

      case 'abort': {
        context.state.session.aborted = true;
        context.state.gates.retryLimitExceeded = false;
        context.state.gates.awaitingUserChoice = false;
        context.diagnostics.info(this.name, 'User chose to abort chain after gate failure', {
          sessionId,
          failedGates: context.state.gates.retryExhaustedGateIds,
        });
        break;
      }
    }
  }

  /**
   * Create hook execution context from the current execution state.
   */
  private createHookContext(context: ExecutionContext): HookExecutionContext {
    // Use session ID, execution scope ID, or generate a fallback
    const executionId =
      context.sessionContext?.sessionId ??
      context.state.session.executionScopeId ??
      `exec-${Date.now().toString(36)}`;

    // Get framework decision from the authority (cached, doesn't recompute)
    const frameworkDecision = context.frameworkAuthority.getCachedDecision();

    return {
      executionId,
      executionType: context.sessionContext?.isChainExecution ? 'chain' : 'single',
      chainId: context.sessionContext?.sessionId,
      currentStep: context.sessionContext?.currentStep,
      frameworkEnabled: frameworkDecision?.shouldApply ?? false,
      frameworkId: frameworkDecision?.frameworkId,
    };
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
    const deps = context.metadata['pipelineDependencies'] as
      | { hookRegistry?: HookRegistry; notificationEmitter?: McpNotificationEmitter }
      | undefined;
    const hooks = deps?.hookRegistry;
    const notifications = deps?.notificationEmitter;

    if (!hooks && !notifications) return;

    const hookContext = this.createHookContext(context);
    const chainId = context.sessionContext?.sessionId;

    try {
      switch (event) {
        case 'passed':
          // Emit for each gate that passed
          for (const gateId of gateIds) {
            await hooks?.emitGateEvaluated(
              { id: gateId } as any, // Minimal gate definition for hook
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
          // Get max attempts from pending review or use default
          const sessionId = context.sessionContext?.sessionId;
          const pendingReview = sessionId
            ? this.chainSessionManager.getPendingGateReview(sessionId)
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
      // Hook/notification errors should not break the pipeline
      this.logger.warn('[StepResponseCaptureStage] Failed to emit gate event', {
        event,
        gateIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private parseGateVerdict(
    raw: string | undefined,
    source: 'gate_verdict' | 'user_response'
  ): {
    verdict: 'PASS' | 'FAIL';
    rationale: string;
    raw: string;
    source: 'gate_verdict' | 'user_response';
    detectedPattern?: string;
  } | null {
    if (raw === undefined || raw.length === 0) {
      return null;
    }

    // Multiple format support (v3.1) - try patterns in order of specificity
    const patterns = [
      // Pattern 1: Full format with hyphen (original - backward compatible)
      { regex: /^GATE_REVIEW:\s*(PASS|FAIL)\s*-\s*(.+)$/i, priority: 'primary' },

      // Pattern 2: Full format with colon separator
      { regex: /^GATE_REVIEW:\s*(PASS|FAIL)\s*:\s*(.+)$/i, priority: 'high' },

      // Pattern 3: Simplified format with hyphen
      { regex: /^GATE\s+(PASS|FAIL)\s*-\s*(.+)$/i, priority: 'high' },

      // Pattern 4: Simplified format with colon
      { regex: /^GATE\s+(PASS|FAIL)\s*:\s*(.+)$/i, priority: 'medium' },

      // Pattern 5: Minimal format (gate_verdict parameter only - prevents false positives)
      { regex: /^(PASS|FAIL)\s*[-:]\s*(.+)$/i, priority: 'fallback' },
    ];

    for (const { regex, priority } of patterns) {
      // Security: Skip minimal format for user_response to prevent false positives
      if (priority === 'fallback' && source === 'user_response') {
        continue;
      }

      const match = raw.match(regex);
      if (match !== null) {
        const [, verdictRaw, rationaleRaw] = match;
        if (verdictRaw === undefined || verdictRaw.length === 0) {
          continue;
        }
        const rationale = rationaleRaw?.trim() ?? '';

        // Validation: Require non-empty rationale
        if (rationale.length === 0) {
          this.logger.warn(
            `Gate verdict detected but missing rationale: "${raw.substring(0, 50)}..."`
          );
          continue; // Try next pattern
        }

        return {
          verdict: verdictRaw.toUpperCase() as 'PASS' | 'FAIL',
          rationale,
          raw,
          source,
          detectedPattern: priority, // For telemetry and debugging
        };
      }
    }

    // No pattern matched
    return null;
  }
}
