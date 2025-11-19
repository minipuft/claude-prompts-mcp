// @lifecycle canonical - Injects prompt guidance metadata into the execution context.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { PromptGuidanceService, ServicePromptGuidanceResult } from '../../../frameworks/prompt-guidance/index.js';
import type { FrameworkMethodology } from '../../../frameworks/types/index.js';
import type { ConvertedPrompt } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

type GuidanceStore = Record<string, ServicePromptGuidanceResult>;

/**
 * Pipeline Stage: Prompt Guidance
 *
 * Applies methodology-driven system prompt injection and template enhancement
 * using the centralized PromptGuidanceService. Ensures a single source of truth
 * for framework guidance before gate instructions are rendered.
 */
export class PromptGuidanceStage extends BasePipelineStage {
  readonly name = 'PromptGuidance';

  constructor(
    private readonly promptGuidanceService: PromptGuidanceService | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.metadata['sessionBlueprintRestored']) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    if (!this.promptGuidanceService?.isInitialized()) {
      this.logExit({ skipped: 'Prompt guidance unavailable' });
      return;
    }

    const plan = context.executionPlan;
    if (!plan?.requiresFramework) {
      this.logExit({ skipped: 'Framework guidance not required' });
      return;
    }

    try {
      if (context.hasChainCommand()) {
        const guidedSteps = await this.applyGuidanceToChain(context);
        this.logExit({ chainStepsGuided: guidedSteps });
        return;
      }

      if (!context.hasSinglePromptCommand()) {
        this.logExit({ skipped: 'No prompt to guide' });
        return;
      }

      const prompt = context.requireConvertedPrompt();
      const result = await this.applyGuidance(prompt, context);
      if (result?.enhancedPrompt) {
        context.parsedCommand!.convertedPrompt = result.enhancedPrompt;
      }

      this.logExit({
        promptId: prompt.id,
        guidanceApplied: Boolean(result?.guidanceApplied),
      });
    } catch (error) {
      this.handleError(error, 'Prompt guidance failed');
    }
  }

  private async applyGuidanceToChain(context: ExecutionContext): Promise<number> {
    const steps = context.requireChainSteps();
    let applied = 0;

    for (const step of steps) {
      if (step.executionPlan && step.executionPlan.requiresFramework === false) {
        continue;
      }

      if (!step.convertedPrompt) {
        this.logger.warn('[PromptGuidanceStage] Chain step missing convertedPrompt', {
          promptId: step.promptId,
        });
        continue;
      }

      const result = await this.applyGuidance(step.convertedPrompt, context, step.promptId);
      if (result?.enhancedPrompt) {
        step.convertedPrompt = result.enhancedPrompt;
      }

      if (result?.guidanceApplied) {
        applied += 1;
      }
    }

    return applied;
  }

  private async applyGuidance(
    prompt: ConvertedPrompt,
    context: ExecutionContext,
    promptId: string = prompt.id
  ): Promise<ServicePromptGuidanceResult | null> {
    try {
      const guidance = await this.promptGuidanceService!.applyGuidance(prompt, {
        includeSystemPromptInjection: true,
        includeTemplateEnhancement: true,
        frameworkOverride: this.getFrameworkOverride(context),
      });

      this.recordGuidanceResult(context, promptId, guidance);
      return guidance;
    } catch (error) {
      this.logger.warn('[PromptGuidanceStage] Failed to apply guidance', {
        promptId,
        error,
      });
      return null;
    }
  }

  private recordGuidanceResult(
    context: ExecutionContext,
    promptId: string,
    result: ServicePromptGuidanceResult
  ): void {
    const store = this.getGuidanceStore(context);
    store[promptId] = result;
  }

  private getGuidanceStore(context: ExecutionContext): GuidanceStore {
    if (context.metadata['promptGuidanceResults'] === undefined) {
      context.metadata['promptGuidanceResults'] = {};
    }

    return context.metadata['promptGuidanceResults'] as GuidanceStore;
  }

  private getFrameworkOverride(context: ExecutionContext): FrameworkMethodology | undefined {
    const override = context.parsedCommand?.executionPlan?.frameworkOverride;
    return override ? (override as FrameworkMethodology) : undefined;
  }
}
