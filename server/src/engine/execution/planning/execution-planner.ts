// @lifecycle canonical - Plans operator execution order and dependencies.
import { CategoryExtractor } from './category-extractor.js';
import { GateSetResolver } from '../../gates/services/gate-set-resolver.js';
import { isMethodologyInjected } from '../pipeline/decisions/injection/index.js';

import type { Logger } from '../../../infra/logging/index.js';
import type { ContentAnalysisResult, ContentAnalyzerPort } from '../../../shared/types/index.js';
import type { FrameworkManager } from '../../frameworks/framework-manager.js';
import type { GateDefinitionProvider } from '../../gates/core/gate-loader.js';
import type { GateManager } from '../../gates/gate-manager.js';
import type { ParsedCommand } from '../context/index.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type {
  ConvertedPrompt,
  ExecutionModifier,
  ExecutionModifiers,
  ExecutionPlan,
  ExecutionStrategyType,
} from '../types.js';

type GateOverrideOptions = {
  gates?: import('../../../shared/types/execution.js').GateSpecification[];
};

export interface ExecutionPlannerOptions {
  parsedCommand?: ParsedCommand;
  convertedPrompt: ConvertedPrompt;
  frameworkEnabled?: boolean;
  gateOverrides?: GateOverrideOptions;
}

export interface ChainExecutionPlannerOptions {
  parsedCommand: ParsedCommand;
  steps: readonly ChainStepPrompt[];
  frameworkEnabled?: boolean;
  gateOverrides?: GateOverrideOptions;
}

export interface ChainExecutionPlanResult {
  chainPlan: ExecutionPlan;
  stepPlans: ExecutionPlan[];
}

type SemanticAnalyzerLike = ContentAnalyzerPort;

type StrategyResolution = {
  strategy: ExecutionStrategyType;
};

/**
 * Determines execution strategy, complexity, and gate requirements for a command.
 * Extracted from PromptExecutor to make planning reusable across the pipeline.
 */
export class ExecutionPlanner {
  private frameworkManager: FrameworkManager | undefined;
  private gateLoader: GateDefinitionProvider | undefined;
  private gateManager: GateManager | undefined;
  private readonly categoryExtractor: CategoryExtractor;

  constructor(
    private readonly semanticAnalyzer: SemanticAnalyzerLike | null,
    private readonly logger: Logger
  ) {
    this.categoryExtractor = new CategoryExtractor(logger);
  }

  setFrameworkManager(manager?: FrameworkManager): void {
    this.frameworkManager = manager;
  }

  setGateLoader(loader?: GateDefinitionProvider): void {
    this.gateLoader = loader;
  }

  /**
   * Set the GateManager for category-based gate selection.
   * Used by autoAssignGates to dynamically select gates based on YAML activation rules.
   */
  setGateManager(manager?: GateManager): void {
    this.gateManager = manager;
  }

  /**
   * Build the gate-set resolver for this call. Stateless and cheap to construct, so it is
   * built per call rather than cached — that removes any need to invalidate it when
   * `setGateManager` / `setGateLoader` arrive in either order.
   */
  private buildGateSetResolver(): GateSetResolver {
    return new GateSetResolver(this.logger, this.gateManager, this.gateLoader);
  }

  async createPlan(options: ExecutionPlannerOptions): Promise<ExecutionPlan> {
    const { parsedCommand, convertedPrompt, frameworkEnabled = false, gateOverrides } = options;

    let analysis: ContentAnalysisResult | null = null;
    if (this.semanticAnalyzer) {
      try {
        analysis = await this.semanticAnalyzer.analyzePrompt(convertedPrompt);
      } catch (error) {
        this.logger.warn('[ExecutionPlanner] Semantic analysis failed', {
          promptId: convertedPrompt.id,
          error,
        });
      }
    }

    const categoryInfo = this.categoryExtractor.extractCategory(convertedPrompt);
    const strategyInput: Parameters<typeof this.resolveStrategy>[0] = {
      convertedPrompt,
      analysis,
    };
    if (parsedCommand !== undefined) {
      strategyInput.parsedCommand = parsedCommand;
    }
    const strategyInfo = this.resolveStrategy(strategyInput);

    const modifierResolution = this.normalizeModifiers(
      parsedCommand?.modifiers ?? convertedPrompt.executionModifiers
    );

    // Apply script-tools default: clean mode if prompt has script tools and no explicit overrides
    this.applyScriptToolDefaults(modifierResolution, convertedPrompt, parsedCommand, gateOverrides);

    // Gate resolution is owned by GateSetResolver (ADR 0001) — this stage only supplies inputs
    // and reads the result. Do not reintroduce gate logic here.
    const resolution = await this.buildGateSetResolver().resolve({
      prompt: convertedPrompt,
      category: categoryInfo.category,
      categoryGateConfig: categoryInfo.gateConfiguration,
      modifiers: modifierResolution.modifiers,
      frameworkInjected: isMethodologyInjected({
        modifiers: modifierResolution.modifiers,
        promptInjection: convertedPrompt.injection,
      }),
      callerGateIds: collectStringGateIds(gateOverrides),
    });

    // Check for framework override from symbolic operators
    const hasFrameworkOverride = Boolean(
      parsedCommand?.executionPlan?.frameworkOverride ?? parsedCommand?.executionPlan
    );

    const baseRequiresFramework = this.requiresFramework(
      strategyInfo.strategy,
      convertedPrompt,
      analysis,
      new Set(resolution.gateIds),
      frameworkEnabled,
      hasFrameworkOverride
    );
    const requiresFramework = resolveFrameworkRequirement(
      modifierResolution.modifiers,
      baseRequiresFramework
    );

    if (resolution.vetoed.size > 0) {
      this.logger.debug('[ExecutionPlanner] Gates removed by veto', {
        promptId: convertedPrompt.id,
        vetoed: Object.fromEntries(resolution.vetoed),
      });
    }

    const plan: ExecutionPlan = {
      strategy: strategyInfo.strategy,
      gates: [...resolution.gateIds],
      requiresFramework,
      requiresSession: this.requiresSession(
        parsedCommand,
        convertedPrompt,
        strategyInfo.strategy,
        new Set(resolution.gateIds)
      ),
    };
    if (categoryInfo.category !== undefined) {
      plan.category = categoryInfo.category;
    }
    if (modifierResolution.modifiers !== undefined) {
      plan.modifiers = modifierResolution.modifiers;
    }
    if (analysis !== null) {
      plan.semanticAnalysis = analysis;
    }

    return plan;
  }

  async createChainPlan(options: ChainExecutionPlannerOptions): Promise<ChainExecutionPlanResult> {
    const { parsedCommand, steps, frameworkEnabled = false, gateOverrides } = options;

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Chain planning requires at least one step with a converted prompt');
    }

    const chainPrompt = parsedCommand.convertedPrompt ?? steps[0]?.convertedPrompt;
    if (!chainPrompt) {
      throw new Error('Chain planning requires a converted prompt on the command or first step');
    }

    const chainPlanOptions: ExecutionPlannerOptions = {
      convertedPrompt: chainPrompt,
    };
    if (parsedCommand !== undefined) {
      chainPlanOptions.parsedCommand = parsedCommand;
    }
    if (frameworkEnabled !== undefined) {
      chainPlanOptions.frameworkEnabled = frameworkEnabled;
    }
    if (gateOverrides !== undefined) {
      chainPlanOptions.gateOverrides = gateOverrides;
    }

    const chainPlan = await this.createPlan(chainPlanOptions);

    const stepPlans: ExecutionPlan[] = [];
    for (const step of steps) {
      if (!step?.convertedPrompt) {
        throw new Error(
          `Chain step ${step?.promptId ?? 'unknown'} missing converted prompt for planning`
        );
      }

      const stepPlanOptions: ExecutionPlannerOptions = {
        convertedPrompt: step.convertedPrompt,
      };
      if (parsedCommand !== undefined) {
        stepPlanOptions.parsedCommand = parsedCommand;
      }
      if (frameworkEnabled !== undefined) {
        stepPlanOptions.frameworkEnabled = frameworkEnabled;
      }
      if (gateOverrides !== undefined) {
        stepPlanOptions.gateOverrides = gateOverrides;
      }

      const stepPlan = await this.createPlan(stepPlanOptions);
      stepPlans.push(stepPlan);
    }

    return {
      chainPlan,
      stepPlans,
    };
  }

  private resolveStrategy(params: {
    convertedPrompt: ConvertedPrompt;
    parsedCommand?: ParsedCommand;
    analysis: ContentAnalysisResult | null;
  }): StrategyResolution {
    const { convertedPrompt, parsedCommand, analysis } = params;

    if (this.hasChainIndicators(parsedCommand, convertedPrompt, analysis)) {
      return { strategy: 'chain' };
    }

    if (analysis?.executionType === 'chain') {
      return { strategy: 'chain' };
    }

    if (analysis?.executionType === 'single') {
      return { strategy: 'single' };
    }

    return this.heuristicResolution(convertedPrompt);
  }

  private hasChainIndicators(
    parsedCommand?: ParsedCommand,
    prompt?: ConvertedPrompt,
    analysis?: ContentAnalysisResult | null
  ): boolean {
    if (prompt?.chainSteps?.length) {
      return true;
    }

    if (parsedCommand?.commandType === 'chain') {
      return true;
    }

    const hasChainOperator = parsedCommand?.operators?.operators?.some((op) => op.type === 'chain');
    if (hasChainOperator) {
      return true;
    }

    if (analysis?.executionType === 'chain') {
      return true;
    }

    if (analysis?.executionCharacteristics?.hasChainSteps) {
      return true;
    }

    return false;
  }

  private heuristicResolution(prompt: ConvertedPrompt): StrategyResolution {
    if (prompt.chainSteps?.length) {
      return { strategy: 'chain' };
    }

    const hasSystemMessage = Boolean(prompt.systemMessage?.trim());
    const hasTemplateVars = /\{\{.*?\}\}/.test(prompt.userMessageTemplate ?? '');
    const hasComplexLogic = /{%-|{%\s*if|{%\s*for/.test(prompt.userMessageTemplate ?? '');

    // All single prompts resolve to 'single' strategy (formerly 'prompt' or 'template')
    return { strategy: 'single' };
  }

  private normalizeModifiers(modifiers?: ExecutionModifiers): { modifiers?: ExecutionModifiers } {
    const normalizedModifier = this.extractModifierFromFlags(modifiers);
    const normalizedModifiers =
      normalizedModifier !== undefined
        ? this.buildModifiers(normalizedModifier)
        : modifiers
          ? this.stripModifierFlags(modifiers)
          : undefined;

    return { modifiers: normalizedModifiers };
  }

  private buildModifiers(modifier: ExecutionModifier): ExecutionModifiers {
    return {
      clean: modifier === 'clean',
      judge: modifier === 'judge',
      lean: modifier === 'lean',
      framework: modifier === 'framework',
    };
  }

  private stripModifierFlags(modifiers: ExecutionModifiers): ExecutionModifiers {
    return {
      clean: modifiers.clean === true,
      judge: modifiers.judge === true,
      lean: modifiers.lean === true,
      framework: modifiers.framework === true,
    };
  }

  private extractModifierFromFlags(modifiers?: ExecutionModifiers): ExecutionModifier | undefined {
    if (!modifiers) {
      return undefined;
    }

    const enabled: ExecutionModifier[] = [];
    if (modifiers.clean) enabled.push('clean');
    if (modifiers.judge) enabled.push('judge');
    if (modifiers.lean) enabled.push('lean');
    if (modifiers.framework) enabled.push('framework');

    if (enabled.length > 1) {
      this.logger.warn(
        '[ExecutionPlanner] Multiple execution modifiers detected; using the first match',
        {
          modifiers: enabled,
        }
      );
    }

    return enabled[0];
  }

  /**
   * Apply script-tools default: clean mode for prompts with script tools.
   *
   * Script tool prompts default to %clean to focus output on tool results.
   * This default is overridden if the user explicitly provides:
   * - Any modifier flag (%judge, %lean, %framework, or even %clean)
   * - Custom gates via the gates parameter
   *
   * @param modifierResolution - Current modifier resolution (mutated in place)
   * @param convertedPrompt - The prompt being executed
   * @param parsedCommand - User's parsed command (to detect explicit modifiers)
   * @param gateOverrides - User's gate overrides (to detect custom gates)
   */
  private applyScriptToolDefaults(
    modifierResolution: { modifiers?: ExecutionModifiers },
    convertedPrompt: ConvertedPrompt,
    parsedCommand?: ParsedCommand,
    gateOverrides?: GateOverrideOptions
  ): void {
    // Only apply to prompts with script tools
    if (!convertedPrompt.scriptTools || convertedPrompt.scriptTools.length === 0) {
      return;
    }

    // Don't override if user explicitly provided modifier flags via command
    const userModifiers = parsedCommand?.modifiers;
    if (userModifiers) {
      const hasExplicitModifier =
        userModifiers.clean === true ||
        userModifiers.judge === true ||
        userModifiers.lean === true ||
        userModifiers.framework === true;
      if (hasExplicitModifier) {
        return;
      }
    }

    const hasExistingModifier =
      modifierResolution.modifiers?.clean === true ||
      modifierResolution.modifiers?.judge === true ||
      modifierResolution.modifiers?.lean === true ||
      modifierResolution.modifiers?.framework === true;
    if (hasExistingModifier) {
      return;
    }

    // Don't override if user provided custom gates
    if (gateOverrides?.gates && gateOverrides.gates.length > 0) {
      return;
    }

    // Apply clean mode as default for script-tool prompts
    if (!modifierResolution.modifiers) {
      modifierResolution.modifiers = { clean: true };
    } else if (!modifierResolution.modifiers.clean) {
      modifierResolution.modifiers = { ...modifierResolution.modifiers, clean: true };
    }

    this.logger.debug('[ExecutionPlanner] Applied clean mode default for script-tool prompt', {
      promptId: convertedPrompt.id,
      scriptToolCount: convertedPrompt.scriptTools.length,
    });
  }

  private requiresFramework(
    strategy: ExecutionStrategyType,
    prompt: ConvertedPrompt,
    analysis: ContentAnalysisResult | null,
    gates: Set<string>,
    frameworkEnabled: boolean,
    hasFrameworkOverride: boolean
  ): boolean {
    // Framework context required when:
    // . Enabled in config (normal framework resolution)
    // . Framework override detected from symbolic operator (@)
    // This supports BOTH system prompt injection AND gate filtering
    return frameworkEnabled || hasFrameworkOverride;
  }

  private requiresSession(
    parsedCommand: ParsedCommand | undefined,
    prompt: ConvertedPrompt,
    strategy: ExecutionStrategyType,
    gates: Set<string>
  ): boolean {
    if (strategy === 'chain') {
      return true;
    }

    if (prompt.chainSteps?.length) {
      return true;
    }

    // Explicit gates (from MCP gates parameter or prompt config) require a session
    // for gate verdict tracking and review submission
    if (gates.size > 0) {
      return true;
    }

    // Check for any operator that requires session state (chain, gate)
    const hasSessionOperator =
      parsedCommand?.operators?.operators?.some(
        (op) => op.type === 'chain' || op.type === 'gate'
      ) ?? false;

    if (hasSessionOperator) {
      return true;
    }

    return false;
  }
}

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Resolve whether a methodology system prompt is required, from the execution modifiers.
 *
 * This is the half of the former `applyModifierOverrides` that belongs to planning. The other
 * half — what those modifiers do to the gate set — moved to `GateSetResolver`, because gates
 * are owned by `engine/gates`. Splitting the method was deliberate: leaving it whole would have
 * put a framework decision inside the gates domain, which `no-frameworks-in-gates` exists to
 * prevent.
 *
 * `%clean` and `%lean` both suppress the methodology; `%framework` and `%judge` both force it.
 */
function resolveFrameworkRequirement(
  modifiers: ExecutionModifiers | undefined,
  requiresFramework: boolean
): boolean {
  if (!modifiers) {
    return requiresFramework;
  }

  if (modifiers.clean === true || modifiers.lean === true) {
    return false;
  }

  if (modifiers.framework === true || modifiers.judge === true) {
    return true;
  }

  return requiresFramework;
}

/**
 * Extract plain gate ids from the unified `gates` parameter, discarding inline definition
 * objects — those are registered separately by the temporary-gate registrar.
 */
function collectStringGateIds(gateOverrides: GateOverrideOptions | undefined): string[] {
  return (gateOverrides?.gates ?? []).filter((gate): gate is string => typeof gate === 'string');
}
