// @lifecycle canonical - Runs post-execution gate review workflows.
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';

/**
 * Pipeline Stage: Gate Review Rendering
 *
 * Renders synthetic gate review steps when a session has a pending review.
 * Keeps ChainOperatorExecutor focused on normal step rendering while this
 * stage handles review-specific content.
 */
export class GateReviewStage extends BasePipelineStage {
  readonly name = 'GateReview';

  constructor(
    private readonly chainOperatorExecutor: ChainOperatorExecutor,
    private readonly chainSessionManager: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const sessionId = context.sessionContext?.sessionId;
    if (!sessionId || !context.sessionContext?.pendingReview) {
      this.logExit({ skipped: 'No pending gate review' });
      return;
    }

    const steps = context.parsedCommand?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      this.logExit({ skipped: 'No chain steps available for gate review rendering' });
      return;
    }

    const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
    if (!pendingReview) {
      this.logExit({ skipped: 'Pending gate review missing from session manager' });
      return;
    }

    context.sessionContext = context.sessionContext
      ? {
          ...context.sessionContext,
          pendingReview,
        }
      : context.sessionContext;

    try {
      const chainContext = this.chainSessionManager.getChainContext(sessionId);
      const renderResult = await this.chainOperatorExecutor.renderStep({
        executionType: 'gate_review',
        stepPrompts: steps,
        chainContext,
        pendingGateReview: pendingReview,
        additionalGateIds: pendingReview.gateIds,
      });

      context.executionResults = {
        content: renderResult.content,
        metadata: {
          stepNumber: renderResult.stepNumber,
          totalSteps: renderResult.totalSteps,
          promptId: renderResult.promptId,
          promptName: renderResult.promptName,
          callToAction: renderResult.callToAction,
          gateReview: {
            gateIds: pendingReview.gateIds,
            attemptCount: pendingReview.attemptCount,
            maxAttempts: pendingReview.maxAttempts,
          },
        },
        generatedAt: Date.now(),
      };

      context.state.gates.reviewCallToAction = renderResult.callToAction;

      // Record diagnostic for gate review rendering
      context.diagnostics.info(this.name, 'Gate review step rendered', {
        sessionId,
        gateIds: pendingReview.gateIds,
        attemptCount: pendingReview.attemptCount,
        maxAttempts: pendingReview.maxAttempts,
        contentLength: renderResult.content.length,
      });

      this.logExit({
        renderedGateReview: true,
        gateCount: pendingReview.gateIds.length,
        attemptCount: pendingReview.attemptCount,
      });
    } catch (error) {
      this.handleError(error, 'Failed to render gate review step');
    }
  }
}
