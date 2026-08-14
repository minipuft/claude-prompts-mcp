// @lifecycle canonical - Applies framework guidance to prompts.
import {
  anyStepRequiresFramework,
  containsFrameworkGate,
  stepHasDisablingModifiers,
  stepRequiresFramework,
} from '../decisions/framework/framework-requirement.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type { FrameworkExecutionContext } from '../../../frameworks/types/index.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { ExecutionContext } from '../../context/index.js';
import type { FrameworkDecision, FrameworkDecisionInput } from '../decisions/index.js';

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
    const frameworkGateIds = await this.loadFrameworkGateIds();

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

    // A framework is resolved when the authority says to apply one, or when the plan or a
    // framework gate requires one regardless. This derivation stays in the stage rather than
    // folding into FrameworkDecisionAuthority: the authority caches on first `decide()`, and
    // GateEnhancementService (stage 11) calls it first on the normal path — so a requirement
    // computed inside `decide()` would be evaluated before the framework gate ids are loaded
    // here, and would silently never apply. See Tier 12 in the follow-up plan.
    const chainRequiresFramework = context.hasChainCommand()
      ? anyStepRequiresFramework(context.parsedCommand.steps, frameworkGateIds)
      : false;
    const singleRequiresFramework = context.hasSinglePromptCommand()
      ? containsFrameworkGate(context.parsedCommand.inlineGateIds, frameworkGateIds)
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
        const result = this.resolveChainFrameworks(
          context,
          frameworkGateIds,
          decision.frameworkId,
          decision.source
        );
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

    // `globalActiveFramework` is deliberately absent. Its only source here would be
    // `context.frameworkContext`, whose sole writer is this stage, further down — so at this
    // point it is always undefined and the field could never be populated. The channel is
    // real, but its producer is GateEnhancementService, which resolves the active framework
    // from its own provider and primes the authority's cache at stage 11.
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
  /**
   * A step's own framework declaration, or undefined when it cannot take effect.
   *
   * An unresolvable id must not become the preference: `getFramework` is the only authority on
   * validity, and a renamed id passed through would silently produce a context for nothing. The
   * step degrades to the run-wide choice rather than failing the whole chain.
   *
   * `enabled` is part of the test, not just existence — `generateExecutionContext` honours a
   * `userPreference` only when the resolved framework is enabled, so checking existence alone
   * would count a disabled framework as applied and report a step that never took effect.
   *
   * Extracted rather than inlined because the loop it came from was already at cognitive
   * complexity 15 and this pushed it to 23.
   */
  private resolveStepDeclaredFramework(step: {
    promptId: string;
    framework?: string;
  }): string | undefined {
    const declared = step.framework;
    if (declared === undefined) return undefined;

    if (this.frameworkManager.getFramework(declared)?.enabled === true) return declared;

    this.logger.warn(
      `[FrameworkStage] Step '${step.promptId}' declares framework '${declared}', which is not a ` +
        'known enabled framework — falling back to the run-wide framework.'
    );
    return undefined;
  }

  /**
   * Which framework a step actually runs under, and whether the step's own declaration won.
   *
   * The precedence itself is described at the call site. Returned as a pair because the caller
   * needs both answers and deriving the second from the first (`preference === declared`) reads
   * as an equality check when it is really a provenance question.
   */
  private selectStepFramework(
    step: { promptId: string; framework?: string },
    override: string | undefined,
    operatorWins: boolean
  ): { preference: string | undefined; fromStep: boolean } {
    const declared = this.resolveStepDeclaredFramework(step);
    const preference = operatorWins ? (override ?? declared) : (declared ?? override);
    return { preference, fromStep: declared !== undefined && preference === declared };
  }

  private resolveChainFrameworks(
    context: ExecutionContext,
    frameworkGateIds: ReadonlySet<string>,
    authorityFrameworkId?: string,
    authoritySource?: FrameworkDecision['source']
  ): Record<string, unknown> {
    const steps = context.requireChainSteps();

    // Use framework ID from authority decision (already resolved with proper priority)
    const frameworkOverride = authorityFrameworkId;
    // A step's declared framework slots BETWEEN the two ranks the authority already
    // documents: below `^ReACT` on the command line (explicit user intent, source 'operator'),
    // above the global active framework (a system default nobody chose for this run). So a
    // declaration yields to an operator and outranks the default — which is also why this needs
    // the decision's SOURCE and not just its id: the id alone cannot distinguish "the user asked
    // for CAGEERF" from "CAGEERF happens to be active".
    const operatorWins = authoritySource === 'operator';
    const resolvedSteps: string[] = [];
    const stepDeclared: string[] = [];

    for (const step of steps) {
      // Check step-level modifiers for per-step framework control
      if (stepHasDisablingModifiers(step)) {
        delete step.frameworkContext;
        continue;
      }

      const requiresFrameworkForStep = stepRequiresFramework(step, frameworkGateIds);

      if (!requiresFrameworkForStep) {
        delete step.frameworkContext;
        continue;
      }

      if (!step.convertedPrompt) {
        throw new Error('Chain step missing converted prompt for framework resolution');
      }

      const { preference, fromStep } = this.selectStepFramework(
        step,
        frameworkOverride,
        operatorWins
      );
      if (fromStep) {
        stepDeclared.push(step.promptId);
      }

      const frameworkContext = this.frameworkManager.generateExecutionContext(
        step.convertedPrompt,
        preference ? { userPreference: preference } : {}
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
      stepDeclaredFrameworks: stepDeclared.length,
      source: 'authority-decision',
    };
  }
}
