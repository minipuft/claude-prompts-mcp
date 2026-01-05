// @lifecycle canonical - Injects prompt guidance metadata into the execution context.
import { BasePipelineStage } from '../stage.js';

import type {
  PromptGuidanceService,
  ServicePromptGuidanceResult,
} from '../../../frameworks/prompt-guidance/index.js';
import type { FrameworkMethodology } from '../../../frameworks/types/index.js';
import type { Logger } from '../../../logging/index.js';
import type { ContentAnalysisResult } from '../../../semantic/types.js';
import type { StyleManager } from '../../../styles/index.js';
import type { ConvertedPrompt } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { FrameworkDecisionInput } from '../decisions/index.js';

type GuidanceStore = Record<string, ServicePromptGuidanceResult>;

/**
 * Pipeline Stage: Prompt Guidance
 *
 * Applies methodology-driven system prompt injection and template enhancement
 * using the centralized PromptGuidanceService. In the two-phase client-driven
 * judge flow, this stage applies style enhancement from client selections.
 *
 * Client selections (set by JudgeSelectionStage, checked by this stage):
 * - clientFrameworkOverride: Override framework (used by FrameworkResolutionStage)
 * - clientSelectedGates: Additional gates (used by GateEnhancementStage)
 * - clientSelectedStyle: Response style enhancement (applied by this stage)
 */
export class PromptGuidanceStage extends BasePipelineStage {
  readonly name = 'PromptGuidance';

  constructor(
    private readonly promptGuidanceService: PromptGuidanceService | null,
    private readonly styleManager: StyleManager | null,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // Skip if session blueprint restored (resuming a chain)
    if (context.state.session.isBlueprintRestored) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    // Skip if judge phase triggered (pipeline already returned with judge response)
    if (context.state.framework.judgePhaseTriggered) {
      this.logExit({ skipped: 'Judge phase triggered - pipeline returning early' });
      return;
    }

    // Check for and apply client selections from two-phase judge flow
    if (this.hasClientSelections(context)) {
      this.applyClientSelections(context);
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
        context.parsedCommand.convertedPrompt = result.enhancedPrompt;
      }

      this.logExit({
        promptId: prompt.id,
        guidanceApplied: Boolean(result?.guidanceApplied),
      });
    } catch (error) {
      this.handleError(error, 'Prompt guidance failed');
    }
  }

  /**
   * Check if client has provided resource selections from judge phase or operator-based style.
   * JudgeSelectionStage sets: clientFrameworkOverride, clientSelectedGates, clientSelectedStyle
   * Symbolic operators set: context.parsedCommand.executionPlan.styleSelection
   */
  private hasClientSelections(context: ExecutionContext): boolean {
    const operatorStyle = context.parsedCommand?.executionPlan?.styleSelection;
    return Boolean(
      context.state.framework.clientOverride ||
      context.state.framework.clientSelectedGates ||
      context.state.framework.clientSelectedStyle ||
      operatorStyle
    );
  }

  /**
   * Apply client selections to the execution context.
   * JudgeSelectionStage already set the metadata keys that downstream stages check.
   * This stage only needs to apply style enhancement (not covered by other stages).
   *
   * Style priority (highest first):
   * 1. Operator-based style (#analytical in command)
   * 2. Client-selected style (from judge phase)
   */
  private applyClientSelections(context: ExecutionContext): void {
    const selectedFramework = context.state.framework.clientOverride;
    const selectedGates = context.state.framework.clientSelectedGates;
    const clientStyle = context.state.framework.clientSelectedStyle;
    const operatorStyle = context.parsedCommand?.executionPlan?.styleSelection;

    // Apply style enhancement - operator takes priority over client selection
    const selectedStyle = operatorStyle ?? clientStyle;
    if (selectedStyle) {
      this.applyStyleEnhancement(context, selectedStyle);
    }

    this.logger.info('[PromptGuidanceStage] Client selections detected', {
      framework: selectedFramework,
      gates: selectedGates?.length ?? 0,
      style: selectedStyle,
      styleSource: operatorStyle ? 'operator' : clientStyle ? 'client' : 'none',
    });
  }

  /**
   * Apply style enhancement to the prompt based on selected style.
   */
  private applyStyleEnhancement(context: ExecutionContext, style: string): void {
    const styleDecision = context.state.injection?.styleGuidance;
    if (styleDecision?.inject === false) {
      this.logger.debug('[PromptGuidanceStage] Style guidance injection suppressed by decision', {
        style,
        source: styleDecision.source,
      });
      return;
    }

    const styleGuidance = this.getStyleGuidance(style);
    if (!styleGuidance) {
      this.logger.warn('[PromptGuidanceStage] Unknown style selected:', style);
      return;
    }

    // Store style metadata for downstream processing
    context.state.framework.selectedStyleGuidance = styleGuidance;
    context.state.framework.styleEnhancementApplied = true;

    // Enhance single prompts
    if (context.hasSinglePromptCommand()) {
      const prompt = context.requireConvertedPrompt();
      const enhancedSystemMessage = this.enhanceWithStyle(prompt.systemMessage, styleGuidance);
      context.parsedCommand.convertedPrompt = {
        ...prompt,
        systemMessage: enhancedSystemMessage,
      };
    }

    // Enhance chain steps
    if (context.hasChainCommand()) {
      const steps = context.requireChainSteps();
      for (const step of steps) {
        if (step.convertedPrompt) {
          const enhancedSystemMessage = this.enhanceWithStyle(
            step.convertedPrompt.systemMessage,
            styleGuidance
          );
          step.convertedPrompt = {
            ...step.convertedPrompt,
            systemMessage: enhancedSystemMessage,
          };
        }
      }
    }

    this.logger.debug('[PromptGuidanceStage] Style enhancement applied:', style);
  }

  /**
   * Get guidance instructions for a style type.
   * Uses StyleManager if available, falls back to hardcoded styles for backward compatibility.
   */
  private getStyleGuidance(style: string): string | null {
    // Try StyleManager first (dynamic YAML-based styles)
    if (this.styleManager) {
      const guidance = this.styleManager.getStyleGuidance(style);
      if (guidance) {
        return guidance;
      }
    }

    // Fallback to hardcoded styles for backward compatibility
    const legacyStyles: Record<string, string> = {
      analytical:
        'Structure your response with systematic analysis. Use data-driven reasoning, present evidence clearly, and organize findings logically with clear sections.',
      procedural:
        'Provide step-by-step instructions. Number each step, explain prerequisites, and include verification points. Focus on actionable guidance.',
      creative:
        'Approach this with innovative thinking. Explore unconventional solutions, brainstorm alternatives, and encourage novel perspectives.',
      reasoning:
        'Apply logical decomposition. Break down the problem, show your reasoning chain, identify assumptions, and evaluate conclusions systematically.',
    };
    return legacyStyles[style.toLowerCase()] ?? null;
  }

  /**
   * Enhance a system message with style guidance.
   */
  private enhanceWithStyle(systemMessage: string | undefined, styleGuidance: string): string {
    const base = systemMessage ?? '';
    if (base.includes(styleGuidance)) {
      return base; // Already contains guidance
    }
    return base
      ? `${base}\n\n**Response Style:** ${styleGuidance}`
      : `**Response Style:** ${styleGuidance}`;
  }

  private async applyGuidanceToChain(context: ExecutionContext): Promise<number> {
    const steps = context.requireChainSteps();
    let applied = 0;

    for (const step of steps) {
      if (step.executionPlan?.requiresFramework === false) {
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
      // Use injection decision from InjectionControlStage (now runs BEFORE this stage)
      // InjectionControlStage populates context.state.injection with clear boolean semantics:
      // inject=true means INJECT, inject=false means SKIP
      const injectionDecision = context.state.injection?.systemPrompt;
      const includeSystemPrompt =
        (injectionDecision?.inject ?? true) && context.state.framework.systemPromptApplied !== true;

      // Get semantic analysis from execution plan (set by Planning Stage)
      const semanticAnalysis = context.executionPlan?.semanticAnalysis;
      const selectedResources = context.state.framework.selectedResources;
      const availableResources = context.state.framework.availableResources as
        | ConvertedPrompt[]
        | undefined;

      const guidanceOptions: Parameters<PromptGuidanceService['applyGuidance']>[1] = {
        includeSystemPromptInjection: includeSystemPrompt,
        includeTemplateEnhancement: true,
      };

      const frameworkOverride = this.getFrameworkOverride(context);
      if (frameworkOverride) {
        guidanceOptions.frameworkOverride = frameworkOverride;
      }

      if (semanticAnalysis) {
        guidanceOptions.semanticAnalysis = semanticAnalysis;
      }
      if (selectedResources) {
        guidanceOptions.selectedResources = selectedResources;
      }
      if (availableResources) {
        guidanceOptions.availableResources = availableResources;
      }

      const guidance = await this.promptGuidanceService!.applyGuidance(prompt, guidanceOptions);

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
    if (context.state.framework.guidanceResults === undefined) {
      context.state.framework.guidanceResults = {};
    }

    return context.state.framework.guidanceResults as GuidanceStore;
  }

  /**
   * Get framework override using the centralized FrameworkDecisionAuthority.
   * This ensures consistent framework resolution across all pipeline stages.
   */
  private getFrameworkOverride(context: ExecutionContext): FrameworkMethodology | undefined {
    const decisionInput = this.buildDecisionInput(context);
    const frameworkId = context.frameworkAuthority.getFrameworkId(decisionInput);
    return frameworkId;
  }

  /**
   * Build decision input from context for FrameworkDecisionAuthority.
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

    const clientOverride = context.state.framework.clientOverride;
    if (clientOverride) {
      decisionInput.clientOverride = clientOverride;
    }

    const globalActiveFramework = context.frameworkContext?.selectedFramework?.id;
    if (globalActiveFramework) {
      decisionInput.globalActiveFramework = globalActiveFramework;
    }

    return decisionInput;
  }
}
