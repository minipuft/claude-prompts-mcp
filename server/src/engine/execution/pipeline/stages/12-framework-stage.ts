// @lifecycle canonical - Applies framework guidance to prompts.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type {
  FrameworkExecutionContext,
  FrameworkSelection,
} from '../../../frameworks/types/index.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { ExecutionContext } from '../../context/index.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type { FrameworkDecisionInput } from '../decisions/index.js';

type FrameworkEnabledProvider = () => boolean;

/**
 * Pipeline Stage 12: Framework Resolution
 *
 * Injects framework-specific system prompts and framework context,
 * supporting both default framework and temporary overrides via symbolic operators (@).
 *
 * Dependencies: context.executionPlan, context.convertedPrompt
 * Output: context.frameworkContext (framework, system prompts)
 * Can Early Exit: No
 */
export class FrameworkResolutionStage extends BasePipelineStage {
  readonly name = 'FrameworkResolution';

  /**
   * Request-scoped framework gate IDs (set during execute, used synchronously within).
   * Reset to null after execute completes to prevent stale data across requests.
   */
  private currentRequestFrameworkGates: Set<string> | null = null;

  constructor(
    private readonly frameworkManager: FrameworkManager,
    private readonly frameworkEnabled: FrameworkEnabledProvider | null,
    logger: Logger,
    private readonly gateLoader?: GateDefinitionProvider
  ) {
    super(logger);
  }

  /**
   * Load framework gate IDs from GateLoader for the current request.
   * Returns fresh data each call - GateLoader handles hot-reload internally.
   */
  private async loadFrameworkGateIds(): Promise<Set<string>> {
    if (!this.gateLoader) {
      this.logger.debug(
        '[FrameworkResolutionStage] No GateLoader available for framework gate detection'
      );
      return new Set();
    }

    try {
      const ids = await this.gateLoader.getFrameworkGateIds();
      return new Set(ids);
    } catch (error) {
      this.logger.warn('[FrameworkResolutionStage] Failed to load framework gate IDs', { error });
      return new Set();
    }
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // Load fresh framework gate IDs for this request (prevents stale cache after hot-reload)
    this.currentRequestFrameworkGates = await this.loadFrameworkGateIds();

    if (context.state.session.isBlueprintRestored) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    const plan = context.executionPlan;
    if (!plan) {
      this.logExit({ skipped: 'Execution plan missing' });
      return;
    }

    // Use FrameworkDecisionAuthority for centralized decision making
    const decisionInput = this.buildDecisionInput(context);
    const decision = context.frameworkAuthority.decide(decisionInput);

    // Record framework decision diagnostic
    context.diagnostics.info(this.name, 'Framework decision made', {
      shouldApply: decision.shouldApply,
      frameworkId: decision.frameworkId,
      source: decision.source,
      reason: decision.reason,
    });

    // Check if framework is disabled by modifiers (%clean, %lean)
    if (!decision.shouldApply && decision.source === 'disabled') {
      // Allow @ operator override even when framework system is globally disabled
      const hasFrameworkOverride = Boolean(context.parsedCommand?.executionPlan?.frameworkOverride);

      if (!this.frameworkEnabled?.() && !hasFrameworkOverride) {
        this.logExit({
          skipped: 'Framework system disabled and no override specified',
          decision: { source: decision.source, reason: decision.reason },
        });
        return;
      }

      // If modifiers disabled it, respect that decision
      if (decision.reason.includes('%clean') || decision.reason.includes('%lean')) {
        this.logExit({
          skipped: 'Framework resolution disabled by modifier',
          decision: { source: decision.source, reason: decision.reason },
        });
        return;
      }
    }

    // For non-modifier disabling (no framework configured), check if resolution is needed
    if (!decision.shouldApply && decision.source === 'disabled' && !decision.reason.includes('%')) {
      // Framework not configured, but check if we need it
      const chainRequiresFramework = context.hasChainCommand()
        ? this.chainStepsRequireFramework(context)
        : false;
      const singleRequiresFramework = context.hasSinglePromptCommand()
        ? this.hasFrameworkGate(context.parsedCommand.inlineGateIds)
        : false;

      const requiresFramework = Boolean(
        plan.requiresFramework || chainRequiresFramework || singleRequiresFramework
      );

      if (!requiresFramework) {
        this.logExit({ skipped: 'Framework not required' });
        return;
      }
    }

    // If decision says to apply, or if requirements trigger framework resolution
    const chainRequiresFramework = context.hasChainCommand()
      ? this.chainStepsRequireFramework(context)
      : false;
    const singleRequiresFramework = context.hasSinglePromptCommand()
      ? this.hasFrameworkGate(context.parsedCommand.inlineGateIds)
      : false;

    const requiresFramework = Boolean(
      plan.requiresFramework ||
      chainRequiresFramework ||
      singleRequiresFramework ||
      decision.shouldApply
    );

    if (!requiresFramework) {
      this.logExit({ skipped: 'Framework not required' });
      return;
    }

    try {
      if (context.hasChainCommand()) {
        const result = this.resolveChainFrameworks(context, decision.frameworkId);
        this.logExit(result);
        return;
      }

      if (!context.hasSinglePromptCommand()) {
        this.handleError(new Error('Single prompt command required for framework resolution'));
        return;
      }

      const result = this.resolveSinglePromptFramework(context, decision.frameworkId);
      this.logExit(result);
    } catch (error) {
      this.handleError(error, 'Framework resolution failed');
    }
  }

  /**
   * Build decision input from context for FrameworkDecisionAuthority.
   * This extracts all relevant data for the centralized framework decision.
   */
  private buildDecisionInput(context: ExecutionContext): FrameworkDecisionInput {
    const decisionInput: FrameworkDecisionInput = {};

    const modifiers = context.executionPlan?.modifiers;
    if (modifiers) {
      decisionInput.modifiers = modifiers;
    }

    const operatorOverride = context.parsedCommand?.executionPlan?.frameworkOverride;
    if (operatorOverride) {
      decisionInput.operatorOverride = operatorOverride;
    }

    const globalActiveFramework = context.frameworkContext?.selectedFramework?.id;
    if (globalActiveFramework) {
      decisionInput.globalActiveFramework = globalActiveFramework;
    }

    return decisionInput;
  }

  /**
   * Resolve framework context for a single prompt.
   * @param context - Execution context
   * @param authorityFrameworkId - Framework ID from FrameworkDecisionAuthority (already resolved)
   */
  private resolveSinglePromptFramework(
    context: ExecutionContext,
    authorityFrameworkId?: string
  ): Record<string, unknown> {
    const prompt = context.requireConvertedPrompt();

    // Use framework ID from authority decision (already resolved with proper priority)
    const frameworkOverride = authorityFrameworkId;

    const frameworkContext: FrameworkExecutionContext =
      this.frameworkManager.generateExecutionContext(
        prompt,
        frameworkOverride ? { userPreference: frameworkOverride } : {}
      );

    context.frameworkContext = frameworkContext;
    // Coordination flag: system prompt already applied via framework context for single prompts
    context.state.framework.systemPromptApplied = true;

    // Note: InjectionControlStage now controls system prompt injection.
    // Downstream stages read from context.state.injection for injection decisions.

    return {
      framework: frameworkContext.selectedFramework?.name,
      override: Boolean(frameworkOverride),
      source: 'authority-decision',
    };
  }

  /**
   * Resolve framework context for chain steps.
   * Generates framework context for each step but does NOT make injection decisions.
   * Injection frequency control is handled by InjectionControlStage
   * which runs after Session Stage when currentStep is known.
   *
   * @param context - Execution context
   * @param authorityFrameworkId - Framework ID from FrameworkDecisionAuthority (already resolved)
   */
  private resolveChainFrameworks(
    context: ExecutionContext,
    authorityFrameworkId?: string
  ): Record<string, unknown> {
    const steps = context.requireChainSteps();

    // Use framework ID from authority decision (already resolved with proper priority)
    const frameworkOverride = authorityFrameworkId;
    const resolvedSteps: string[] = [];

    for (const step of steps) {
      // Check step-level modifiers for per-step framework control
      if (this.stepHasDisablingModifiers(step)) {
        delete step.frameworkContext;
        continue;
      }

      const requiresFrameworkForStep = this.stepRequiresFramework(step);

      if (!requiresFrameworkForStep) {
        delete step.frameworkContext;
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
    if (resolvedSteps.length > 0) {
      const resolvedContext = steps.find((step) => step.frameworkContext)?.frameworkContext;
      if (resolvedContext) {
        context.frameworkContext = resolvedContext;
      }
    }

    // InjectionControlStage controls injection frequency for chains.
    // It runs after SessionManagementStage when currentStep is known.

    return {
      chainSteps: steps.length,
      frameworksApplied: resolvedSteps.length,
      override: Boolean(frameworkOverride),
      source: 'authority-decision',
    };
  }

  /**
   * Check if a step has modifiers that disable framework.
   * This is for per-step control within chains.
   */
  private stepHasDisablingModifiers(step: ChainStepPrompt): boolean {
    const modifiers = step.executionPlan?.modifiers;
    if (!modifiers) {
      return false;
    }
    return modifiers.clean === true || modifiers.lean === true;
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

    if (this.hasFrameworkGate(step.executionPlan?.gates)) {
      return true;
    }

    if (this.hasFrameworkGate(step.inlineGateIds)) {
      return true;
    }

    return false;
  }

  /**
   * Check if any gates in the array are framework gates.
   * Uses request-scoped data loaded at start of execute().
   */
  private hasFrameworkGate(gates?: readonly string[] | null): boolean {
    if (!Array.isArray(gates)) {
      return false;
    }

    return gates.some(
      (gateId) =>
        Boolean(gateId) && (this.currentRequestFrameworkGates?.has(gateId as string) ?? false)
    );
  }
}
