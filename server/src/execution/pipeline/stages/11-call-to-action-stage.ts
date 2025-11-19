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

    const metadata = (results.metadata ?? {}) as Record<string, unknown>;
    const callToAction =
      (metadata['callToAction'] as string | undefined) ||
      (context.metadata['gateReviewCallToAction'] as string | undefined);

    if (!callToAction || callToAction.trim().length === 0) {
      this.logExit({ skipped: 'No call to action provided' });
      return;
    }

    const sanitizedCTA = callToAction.trim();
    if (this.isFinalCallToAction(sanitizedCTA)) {
      this.logExit({ skipped: 'Final step call-to-action suppressed' });
      return;
    }

    const heading = this.buildHeading(context);
    const footer = ['---', heading, sanitizedCTA].join('\n\n');

    results.content = `${results.content}\n\n${footer}`.trim();
    delete context.metadata['gateReviewCallToAction'];

    this.logExit({ appended: true });
  }

  private isFinalCallToAction(text: string): boolean {
    const normalized = text.toLowerCase();
    return normalized.includes('deliver the final response');
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
