// @lifecycle canonical - Applies framework methodology guidance to prompts.
import { BasePipelineStage } from '../stage.js';

import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type { FrameworkExecutionContext, FrameworkMethodology } from '../../../frameworks/types/index.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import { METHODOLOGY_GATES } from '../../../gates/constants.js';
import type { ChainStepPrompt } from '../../operators/chain-operator-executor.js';

type FrameworkEnabledProvider = () => boolean;

/**
 * Pipeline Stage 6: Framework Resolution
 *
 * Injects methodology-specific system prompts and framework context,
 * supporting both default framework and temporary overrides via symbolic operators (@).
 *
 * Dependencies: context.executionPlan, context.convertedPrompt
 * Output: context.frameworkContext (methodology, system prompts)
 * Can Early Exit: No
 */
export class FrameworkResolutionStage extends BasePipelineStage {
  readonly name = 'FrameworkResolution';

  constructor(
    private readonly frameworkManager: FrameworkManager,
    private readonly frameworkEnabled: FrameworkEnabledProvider | null,
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

    if (!this.frameworkEnabled?.()) {
      this.logExit({ skipped: 'Framework system disabled' });
      return;
    }

    const plan = context.executionPlan;
    if (!plan) {
      this.logExit({ skipped: 'Execution plan missing' });
      return;
    }

    const chainRequiresFramework = context.hasChainCommand()
      ? this.chainStepsRequireFramework(context)
      : false;
    const singleRequiresFramework = context.hasSinglePromptCommand()
      ? this.hasMethodologyGate(context.parsedCommand.inlineGateIds)
      : false;

    const requiresFramework = Boolean(
      plan.requiresFramework || chainRequiresFramework || singleRequiresFramework
    );

    if (!requiresFramework) {
      this.logExit({ skipped: 'Framework not required' });
      return;
    }

    try {
      if (context.hasChainCommand()) {
        const result = this.resolveChainFrameworks(context);
        this.logExit(result);
        return;
      }

      if (!context.hasSinglePromptCommand()) {
        this.handleError(new Error('Single prompt command required for framework resolution'));
        return;
      }

      const result = this.resolveSinglePromptFramework(context);
      this.logExit(result);
    } catch (error) {
      this.handleError(error, 'Framework resolution failed');
    }
  }

  private resolveSinglePromptFramework(context: ExecutionContext): Record<string, unknown> {
    const prompt = context.requireConvertedPrompt();
    const frameworkOverride = this.getFrameworkOverride(context);

    const frameworkContext: FrameworkExecutionContext = this.frameworkManager.generateExecutionContext(
      prompt,
      frameworkOverride ? { userPreference: frameworkOverride } : {}
    );

    context.frameworkContext = frameworkContext;

    return {
      framework: frameworkContext.selectedFramework?.name,
      override: Boolean(frameworkOverride),
    };
  }

  private resolveChainFrameworks(context: ExecutionContext): Record<string, unknown> {
    const steps = context.requireChainSteps();
    const frameworkOverride = this.getFrameworkOverride(context);
    const resolvedSteps: string[] = [];

    for (const step of steps) {
      const requiresFrameworkForStep = this.stepRequiresFramework(step);

      if (!requiresFrameworkForStep) {
        step.frameworkContext = undefined;
        continue;
      }

      if (!step.convertedPrompt) {
        throw new Error('Chain step missing converted prompt for framework resolution');
      }

      const frameworkContext = this.frameworkManager.generateExecutionContext(
        step.convertedPrompt,
        frameworkOverride ? { userPreference: frameworkOverride } : {}
      );

      step.frameworkContext = frameworkContext;
      resolvedSteps.push(step.promptId);
    }

    // Surface the first resolved framework context for downstream telemetry/formatting
    context.frameworkContext = resolvedSteps.length > 0 ? steps.find((step) => step.frameworkContext)?.frameworkContext : undefined;

    return {
      chainSteps: steps.length,
      frameworksApplied: resolvedSteps.length,
      override: Boolean(frameworkOverride),
    };
  }

  private getFrameworkOverride(context: ExecutionContext): FrameworkMethodology | undefined {
    const override = context.parsedCommand?.executionPlan?.frameworkOverride;
    return override ? (override as FrameworkMethodology) : undefined;
  }

  private chainStepsRequireFramework(context: ExecutionContext): boolean {
    if (!context.hasChainCommand()) {
      return false;
    }
    return context.parsedCommand.steps.some((step) => this.stepRequiresFramework(step));
  }

  private stepRequiresFramework(step: ChainStepPrompt): boolean {
    if (step.executionPlan?.requiresFramework) {
      return true;
    }

    if (this.hasMethodologyGate(step.executionPlan?.gates)) {
      return true;
    }

    if (this.hasMethodologyGate(step.inlineGateIds)) {
      return true;
    }

    return false;
  }

  private hasMethodologyGate(gates?: readonly string[] | null): boolean {
    if (!Array.isArray(gates)) {
      return false;
    }

    return gates.some((gateId) => Boolean(gateId) && METHODOLOGY_GATES.has(gateId as string));
  }
}
