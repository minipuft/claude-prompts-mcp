// @lifecycle canonical - Generates follow-up guidance or call-to-action messaging.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

/**
 * Pipeline Stage: Call To Action
 *
 * Appends standardized CTA footers to rendered content so ExecutionStage
 * focuses on building the core instructions.
 */
export class CallToActionStage extends BasePipelineStage {
  readonly name = 'CallToAction';

  constructor(logger: Logger) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const results = context.executionResults;
    if (!results || typeof results.content !== 'string') {
      this.logExit({ skipped: 'No execution results to augment' });
      return;
    }

    const metadata = results.metadata ?? {};
    const pendingReview = Boolean(context.sessionContext?.pendingReview);
    const finalChainStep = this.isFinalChainStep(context);
    const callToAction =
      (metadata['callToAction'] as string | undefined) || context.state.gates.reviewCallToAction;

    if (!callToAction || callToAction.trim().length === 0) {
      if (finalChainStep && !pendingReview) {
        this.appendFinalCallToAction(context);
        this.logExit({ appended: 'final-step' });
        return;
      }
      this.logExit({ skipped: 'No call to action provided' });
      return;
    }

    const sanitizedCTA = callToAction.trim();
    if (this.isFinalCallToAction(sanitizedCTA)) {
      delete context.state.gates.reviewCallToAction;
      if (finalChainStep && !pendingReview) {
        this.appendFinalCallToAction(context);
        this.logExit({ appended: 'final-step-from-template' });
      } else {
        this.logExit({ skipped: 'Final step call-to-action suppressed' });
      }
      return;
    }

    // CTA output intentionally disabled for intermediate steps (footer carries resume instructions).
    delete context.state.gates.reviewCallToAction;
    this.logExit({ skipped: 'CTA suppressed in favor of streamlined footer' });
  }

  private isFinalCallToAction(text: string): boolean {
    const normalized = text.toLowerCase();
    return normalized.includes('deliver the final response');
  }

  private isFinalChainStep(context: ExecutionContext): boolean {
    const session = context.sessionContext;
    if (!session?.isChainExecution) {
      return false;
    }
    const { currentStep, totalSteps } = session;
    if (typeof currentStep !== 'number' || typeof totalSteps !== 'number' || totalSteps <= 0) {
      return false;
    }
    return currentStep >= totalSteps;
  }

  private appendFinalCallToAction(context: ExecutionContext): void {
    if (!context.executionResults || typeof context.executionResults.content !== 'string') {
      return;
    }

    // Only append completion message on the final chain step
    if (!this.isFinalChainStep(context)) {
      return;
    }

    const message = '\n\n✅ Chain execution complete. You may now respond to the user.';
    context.executionResults.content = `${context.executionResults.content}${message}`;
  }

  private buildHeading(context: ExecutionContext): string {
    const sessionContext = context.sessionContext;
    const requiresGateVerdict = Boolean(sessionContext?.pendingReview);
    const requiresUserResponse = !requiresGateVerdict && Boolean(sessionContext?.isChainExecution);

    if (requiresGateVerdict) {
      return '### Next Action - reply via `gate_verdict`';
    }

    if (requiresUserResponse) {
      return '### Next Action - reply via `user_response`';
    }

    return '### Next Action';
  }
}
