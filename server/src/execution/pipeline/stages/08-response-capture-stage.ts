// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { StepState } from '../../../mcp-tools/prompt-engine/core/types.js';
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

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
    if (!context.sessionContext) {
      this.logExit({ skipped: 'No session context available' });
      return;
    }

    const sessionContext = context.sessionContext;
    if (!sessionContext.isChainExecution) {
      this.logExit({ skipped: 'Not a chain execution' });
      return;
    }

    const sessionId = sessionContext.sessionId;
    if (!sessionId) {
      this.logExit({ skipped: 'Missing session identifier' });
      return;
    }

    const session = this.chainSessionManager.getSession(sessionId);
    if (!session) {
      this.logExit({ skipped: 'Session not found' });
      return;
    }

    // Always refresh chain variables for downstream template rendering
    context.metadata['chainContext'] = this.chainSessionManager.getChainContext(sessionId);

    const lifecycleDecision = context.metadata['sessionLifecycleDecision'] as string | undefined;
    if (lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart') {
      this.logExit({ skipped: 'New session, nothing to capture' });
      return;
    }

    let userResponse = context.mcpRequest.user_response?.trim();
    const gateVerdictInput = context.getGateVerdict();
    const verdictFromUserResponse =
      !gateVerdictInput && userResponse
        ? this.parseGateVerdict(userResponse, 'user_response')
        : null;

    if (session.pendingGateReview) {
      const verdictPayload =
        this.parseGateVerdict(gateVerdictInput ?? undefined, 'gate_verdict') ??
        verdictFromUserResponse;

      if (verdictPayload) {
        const outcome = await this.chainSessionManager.recordGateReviewOutcome(sessionId, {
          verdict: verdictPayload.verdict,
          rationale: verdictPayload.rationale,
          rawVerdict: verdictPayload.raw,
          reviewer: verdictPayload.source,
        });

        if (outcome === 'cleared') {
          sessionContext.pendingReview = undefined;
        } else {
          sessionContext.pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
        }
        context.sessionContext = {
          ...sessionContext,
        };

        if (!gateVerdictInput && verdictFromUserResponse) {
          userResponse = undefined;
        }

        if (!userResponse) {
          this.logExit({
            gateVerdict: verdictPayload.verdict,
            gateVerdictSource: verdictPayload.source,
          });
          return;
        }
      }
    }

    // Check if user provided a response for the current step
    const hasUserResponse = userResponse && userResponse.length > 0;

    // Determine target step number:
    // - If user_response provided: capture for CURRENT step (the one just rendered)
    // - Otherwise: capture placeholder for PREVIOUS step
    const targetStepNumber = hasUserResponse
      ? (session.state.currentStep ?? 1)
      : (session.state.currentStep ?? 1) - 1;

    if (!this.shouldCaptureStep(targetStepNumber, session.state.totalSteps)) {
      this.logExit({ skipped: 'No prior step to capture' });
      return;
    }

    const existingState = this.chainSessionManager.getStepState(sessionId, targetStepNumber);
    if (existingState?.state === StepState.COMPLETED && !existingState.isPlaceholder) {
      this.logExit({ skipped: 'Step already completed with real output' });
      return;
    }

    if (existingState?.state === StepState.COMPLETED && existingState.isPlaceholder) {
      // Check if user provided a response to advance past the placeholder
      if (hasUserResponse) {
        // User provided explicit response - capture and advance
        this.logger.debug(
          `User response detected for step ${targetStepNumber}, replacing placeholder with real content`
        );

        await this.captureRealResponse(sessionId, session.chainId, targetStepNumber, userResponse!);

        const updatedSession = this.chainSessionManager.getSession(sessionId);
        if (updatedSession) {
          context.sessionContext = {
            ...sessionContext,
            currentStep: updatedSession.state.currentStep,
            totalSteps: updatedSession.state.totalSteps,
          };
          context.metadata['chainContext'] = this.chainSessionManager.getChainContext(sessionId);
        }

        this.logExit({
          capturedStep: targetStepNumber,
          responseType: 'user_response',
          advanced: true,
        });
        return;
      }

      // No response provided - placeholder already exists
      this.logExit({ skipped: 'Placeholder already recorded' });
      return;
    }

    try {
      // Check for user response before creating placeholder
      if (hasUserResponse) {
        // User provided explicit response
        await this.captureRealResponse(sessionId, session.chainId, targetStepNumber, userResponse!);
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
      if (updatedSession) {
        context.sessionContext = {
          ...sessionContext,
          currentStep: updatedSession.state.currentStep,
          totalSteps: updatedSession.state.totalSteps,
        };
        context.metadata['chainContext'] = this.chainSessionManager.getChainContext(sessionId);
      }

      const responseType = userResponse ? 'user_response' : 'placeholder';
      this.logExit({
        capturedStep: targetStepNumber,
        responseType,
        advanced: !!userResponse,
      });
    } catch (error) {
      this.handleError(error, 'Failed to capture previous step result');
    }
  }

  private shouldCaptureStep(stepNumber: number | undefined, totalSteps: number): boolean {
    if (!stepNumber || stepNumber < 1) {
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
    responseContent: string
  ): Promise<void> {
    this.logger.debug(
      `Capturing real response for step ${stepNumber} in chain ${chainId}: ${responseContent.substring(0, 50)}...`
    );

    await this.chainSessionManager.updateSessionState(sessionId, stepNumber, responseContent, {
      isPlaceholder: false,
      source: 'user_response',
      capturedAt: Date.now(),
    });

    await this.chainSessionManager.completeStep(sessionId, stepNumber, {
      preservePlaceholder: false, // Real completion, advance currentStep
    });

    this.logger.debug(`Step ${stepNumber} completed with real response, advancing to next step`);
  }

  private buildPlaceholderContent(chainId: string, stepNumber: number, totalSteps: number): string {
    const timestamp = new Date().toISOString();
    return [
      `Step ${stepNumber}/${totalSteps} for chain "${chainId}" marked complete at ${timestamp}.`,
      'The STDIO transport cannot automatically return assistant output, so this placeholder marks the result as available for downstream templates.',
      'Continue by following the next set of chain instructions.',
    ].join(' ');
  }

  private parseGateVerdict(
    raw: string | undefined,
    source: 'gate_verdict' | 'user_response'
  ): {
    verdict: 'PASS' | 'FAIL';
    rationale: string;
    raw: string;
    source: 'gate_verdict' | 'user_response';
  } | null {
    if (!raw) {
      return null;
    }

    const match = raw.match(/^GATE_REVIEW:\s*(PASS|FAIL)\s*-\s*(.+)$/i);
    if (!match) {
      return null;
    }

    return {
      verdict: match[1].toUpperCase() as 'PASS' | 'FAIL',
      rationale: match[2].trim(),
      raw,
      source,
    };
  }
}
