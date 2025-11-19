// @lifecycle canonical - Plans operator execution order and dependencies.
import { METHODOLOGY_GATES } from '../../gates/constants.js';
import {
  CategoryExtractor,
  type CategoryExtractionResult,
} from '../../mcp-tools/prompt-engine/utils/category-extractor.js';

import type { FrameworkManager } from '../../frameworks/framework-manager.js';
import type { Logger } from '../../logging/index.js';
import type { ContentAnalyzer } from '../../semantic/configurable-semantic-analyzer.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
import type { ConvertedPrompt, GateDefinition } from '../../types/index.js';
import type {
  ExecutionPlan,
  ExecutionStrategy,
  ParsedCommand,
} from '../context/execution-context.js';
import type { ChainStepPrompt } from '../operators/chain-operator-executor.js';

type GateOverrideOptions = {
  apiValidation?: boolean;
  qualityGates?: string[];
  customChecks?: Array<{ name: string; description: string }>;
};

export interface ExecutionPlannerOptions {
  parsedCommand?: ParsedCommand;
  convertedPrompt: ConvertedPrompt;
  executionMode?: 'auto' | 'prompt' | 'template' | 'chain';
  frameworkEnabled?: boolean;
  gateOverrides?: GateOverrideOptions;
}

export interface ChainExecutionPlannerOptions {
  parsedCommand: ParsedCommand;
  steps: readonly ChainStepPrompt[];
  executionMode?: 'auto' | 'prompt' | 'template' | 'chain';
  frameworkEnabled?: boolean;
  gateOverrides?: GateOverrideOptions;
}

export interface ChainExecutionPlanResult {
  chainPlan: ExecutionPlan;
  stepPlans: ExecutionPlan[];
}

type SemanticAnalyzerLike = Pick<ContentAnalyzer, 'analyzePrompt' | 'isLLMEnabled'>;

/**
 * Determines execution strategy, complexity, and gate requirements for a command.
 * Extracted from PromptExecutionService to make planning reusable across the pipeline.
 */
export class ExecutionPlanner {
  private frameworkManager?: FrameworkManager;
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

  async createPlan(options: ExecutionPlannerOptions): Promise<ExecutionPlan> {
    const {
      parsedCommand,
      convertedPrompt,
      executionMode = 'auto',
      frameworkEnabled = false,
      gateOverrides,
    } = options;

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
    const strategy = this.determineStrategy({
      executionMode,
      convertedPrompt,
      parsedCommand,
      analysis,
    });

    const explicitGates = this.collectExplicitGateIds(convertedPrompt, categoryInfo);
    const autoGates = this.shouldAutoAssignGates()
      ? this.autoAssignGates(categoryInfo.category)
      : [];
    const mergedGates = this.mergeGates(explicitGates, autoGates, [
      ...(categoryInfo.gateConfiguration?.exclude ?? []),
      ...this.getPromptLevelExcludes(convertedPrompt),
    ]);

    if (convertedPrompt.enhancedGateConfiguration?.framework_gates === false) {
      METHODOLOGY_GATES.forEach((gateId: string) => mergedGates.delete(gateId));
    }

    if (gateOverrides?.qualityGates?.length) {
      for (const gateId of gateOverrides.qualityGates) {
        if (gateId) mergedGates.add(gateId);
      }
    }

    const apiValidationEnabled = this.shouldEnableApiValidation({
      overrides: gateOverrides,
      frameworkEnabled,
      hasGates: mergedGates.size > 0,
      strategy,
    });

    // Check for framework override from symbolic operators
    const hasFrameworkOverride = Boolean(parsedCommand?.executionPlan?.frameworkOverride);

    return {
      strategy,
      gates: Array.from(mergedGates),
      requiresFramework: this.requiresFramework(
        strategy,
        convertedPrompt,
        analysis,
        mergedGates,
        frameworkEnabled,
        hasFrameworkOverride
      ),
      requiresSession: this.requiresSession(parsedCommand, convertedPrompt, strategy),
      apiValidationEnabled,
      category: categoryInfo.category,
    };
  }

  async createChainPlan(options: ChainExecutionPlannerOptions): Promise<ChainExecutionPlanResult> {
    const {
      parsedCommand,
      steps,
      executionMode = 'auto',
      frameworkEnabled = false,
      gateOverrides,
    } = options;

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Chain planning requires at least one step with a converted prompt');
    }

    const chainPrompt = parsedCommand.convertedPrompt ?? steps[0]?.convertedPrompt;
    if (!chainPrompt) {
      throw new Error('Chain planning requires a converted prompt on the command or first step');
    }

    const chainPlan = await this.createPlan({
      parsedCommand,
      convertedPrompt: chainPrompt,
      executionMode,
      frameworkEnabled,
      gateOverrides,
    });

    const stepPlans: ExecutionPlan[] = [];
    for (const step of steps) {
      if (!step?.convertedPrompt) {
        throw new Error(`Chain step ${step?.promptId ?? 'unknown'} missing converted prompt for planning`);
      }

      const stepPlan = await this.createPlan({
        parsedCommand,
        convertedPrompt: step.convertedPrompt,
        executionMode,
        frameworkEnabled,
        gateOverrides,
      });
      stepPlans.push(stepPlan);
    }

    return {
      chainPlan,
      stepPlans,
    };
  }

  private determineStrategy(params: {
    executionMode: 'auto' | 'prompt' | 'template' | 'chain';
    convertedPrompt: ConvertedPrompt;
    parsedCommand?: ParsedCommand;
    analysis: ContentAnalysisResult | null;
  }): ExecutionStrategy {
    const { executionMode, convertedPrompt, parsedCommand, analysis } = params;

    if (executionMode && executionMode !== 'auto') {
      return executionMode;
    }

    if (convertedPrompt.executionMode) {
      return convertedPrompt.executionMode;
    }

    if (this.hasChainIndicators(parsedCommand, convertedPrompt, analysis)) {
      return 'chain';
    }

    if (analysis?.executionType === 'template') {
      return 'template';
    }

    if (analysis?.executionType === 'prompt') {
      return 'prompt';
    }

    return this.heuristicStrategy(convertedPrompt);
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

  private heuristicStrategy(prompt: ConvertedPrompt): ExecutionStrategy {
    if (prompt.chainSteps?.length) {
      return 'chain';
    }

    const hasSystemMessage = Boolean(prompt.systemMessage?.trim());
    const hasTemplateVars = /\{\{.*?\}\}/.test(prompt.userMessageTemplate ?? '');
    const hasComplexLogic = /{%-|{%\s*if|{%\s*for/.test(prompt.userMessageTemplate ?? '');

    if (hasSystemMessage || hasComplexLogic) {
      return 'template';
    }

    if (hasTemplateVars && (prompt.arguments?.length ?? 0) > 0) {
      return 'template';
    }

    return 'prompt';
  }

  /**
   * Determines whether gates should be auto-assigned based on category.
   * Gates are always auto-assigned when appropriate for the prompt category.
   *
   * Note: The semantic layer (LLM integration) controls whether the SERVER validates gates,
   * not whether gates are assigned. Gate instructions are always rendered so the LLM client
   * can self-validate when server-side validation is disabled.
   *
   * Explicit gates from user/prompt configuration are always honored.
   */
  private shouldAutoAssignGates(): boolean {
    // Gates should always be auto-assigned based on category
    // Server-side validation is controlled separately by semantic layer config
    return true;
  }

  private autoAssignGates(category: string): string[] {
    const gates = new Set<string>(['framework-compliance']);
    const normalizedCategory = category?.toLowerCase() ?? 'general';

    switch (normalizedCategory) {
      case 'code_generation':
      case 'development':
        gates.add('code-quality');
        gates.add('technical-accuracy');
        break;
      case 'analysis':
      case 'research':
        gates.add('research-quality');
        gates.add('technical-accuracy');
        break;
      case 'documentation':
        gates.add('content-structure');
        gates.add('educational-clarity');
        break;
      case 'architecture':
        gates.add('technical-accuracy');
        gates.add('security-awareness');
        break;
      default:
        break;
    }

    return Array.from(gates);
  }

  private collectExplicitGateIds(
    prompt: ConvertedPrompt,
    categoryInfo: CategoryExtractionResult
  ): Set<string> {
    const gateIds = new Set<string>();

    const addGate = (gateId?: string | null) => {
      if (gateId && gateId.trim().length > 0) {
        gateIds.add(gateId.trim());
      }
    };

    (prompt.gates || []).forEach((gate: GateDefinition) => addGate(gate.id || gate.name));
    (prompt as any).autoAssignedGates?.forEach?.((gate: { id?: string }) => addGate(gate?.id));
    this.getPromptLevelIncludes(prompt).forEach(addGate);
    (categoryInfo.gateConfiguration?.include || []).forEach(addGate);

    return gateIds;
  }

  private getPromptLevelIncludes(prompt: ConvertedPrompt): string[] {
    const includes: string[] = [];
    const gateConfig = (prompt as any).gateConfiguration;
    if (gateConfig?.include) {
      includes.push(...gateConfig.include);
    }
    if (prompt.enhancedGateConfiguration?.include) {
      includes.push(...prompt.enhancedGateConfiguration.include);
    }
    return includes;
  }

  private getPromptLevelExcludes(prompt: ConvertedPrompt): string[] {
    const excludes: string[] = [];
    const gateConfig = (prompt as any).gateConfiguration;
    if (gateConfig?.exclude) {
      excludes.push(...gateConfig.exclude);
    }
    if (prompt.enhancedGateConfiguration?.exclude) {
      excludes.push(...prompt.enhancedGateConfiguration.exclude);
    }
    return excludes;
  }

  private mergeGates(
    explicitGates: Set<string>,
    autoAssigned: string[],
    exclude: string[]
  ): Set<string> {
    const merged = new Set<string>(explicitGates);
    autoAssigned.forEach((gate) => {
      if (gate) merged.add(gate);
    });

    exclude.forEach((gateId) => merged.delete(gateId));

    return merged;
  }

  private requiresFramework(
    strategy: ExecutionStrategy,
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
    strategy: ExecutionStrategy
  ): boolean {
    if (strategy === 'chain') {
      return true;
    }

    if (prompt.chainSteps?.length) {
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

  private shouldEnableApiValidation(params: {
    overrides?: GateOverrideOptions;
    frameworkEnabled: boolean;
    hasGates: boolean;
    strategy: ExecutionStrategy;
  }): boolean {
    const { overrides } = params;

    if (overrides?.apiValidation !== undefined) {
      return overrides.apiValidation;
    }

    if ((overrides?.qualityGates?.length ?? 0) > 0) {
      return true;
    }

    if ((overrides?.customChecks?.length ?? 0) > 0) {
      return true;
    }

    return false;
  }
}
