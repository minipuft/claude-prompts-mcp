// @lifecycle canonical - Enriches prompts with gate instructions prior to execution.
import { formatCriteriaAsGuidance } from '../criteria-guidance.js';
import { BasePipelineStage } from '../stage.js';

import type { FrameworkManager } from '../../../frameworks/index.js';
import type {
  GateDefinitionProvider,
  TemporaryGateRegistry,
  GateManager,
  GateReferenceResolver,
  IGateService,
  ServiceGateValidationResult,
} from '../../../gates/index.js';
import type { Logger } from '../../../logging/index.js';
import type {
  MetricsCollector,
  GateUsageMetric,
  GateValidationResult as MetricGateValidationResult,
} from '../../../metrics/index.js';
import type { FrameworksConfig, GatesConfig, ConvertedPrompt } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type { TemporaryGateInput, ExecutionModifiers } from '../../types.js';
import type { FrameworkDecisionInput } from '../decisions/index.js';
import type { GateSource } from '../state/types.js';

type FrameworksConfigProvider = () => FrameworksConfig;
type GatesConfigProvider = () => GatesConfig | undefined;

/**
 * Discriminated union for gate enhancement contexts
 */
interface SinglePromptGateContext {
  readonly type: 'single';
  readonly prompt: ConvertedPrompt;
  readonly inlineGateIds: string[];
}

interface ChainStepGateContext {
  readonly type: 'chain';
  readonly steps: ChainStepPrompt[];
}

type GateEnhancementContext = SinglePromptGateContext | ChainStepGateContext;

interface RegisteredGateResult {
  readonly temporaryGateIds: string[];
  readonly canonicalGateIds: string[];
}

/**
 * Normalized gate input structure for creating temporary gates
 */
interface NormalizedGateInput {
  name: string;
  type: 'validation' | 'guidance';
  scope: 'execution' | 'session' | 'chain' | 'step';
  criteria?: string[];
  guidance?: string;
  description?: string;
  pass_criteria?: string[];
  source: 'manual' | 'automatic' | 'analysis';
  context?: Record<string, unknown>;
  target_step_number?: number;
  apply_to_steps?: number[];
}

/**
 * Custom check structure from MCP requests
 */
interface CustomCheck {
  name?: string;
  description?: string;
}

/**
 * Raw gate input (flexible structure for parsing)
 * Accepts any object with at least some gate-like properties
 */
type RawGateInput =
  | string
  | TemporaryGateInput
  | {
      id?: string;
      name?: string;
      type?: string;
      scope?: string;
      criteria?: string[] | readonly string[];
      guidance?: string;
      description?: string;
      pass_criteria?: string[] | readonly string[];
      source?: string;
      context?: unknown;
    };

/**
 * Pipeline Stage 5: Gate Enhancement
 *
 * Renders gate guidance instructions and footer text for quality validation,
 * applying framework-specific and temporary gate criteria to prompts.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Enhanced prompts with gate instructions, context.activeGateIds
 * Can Early Exit: No
 */
export class GateEnhancementStage extends BasePipelineStage {
  readonly name = 'GateEnhancement';
  private readonly metricsProvider?: () => MetricsCollector | undefined;
  private readonly gatesConfigProvider?: GatesConfigProvider;
  /** Cached methodology gate IDs loaded from GateLoader */
  private methodologyGateIdsCache: Set<string> | null = null;

  constructor(
    private readonly gateService: IGateService | null,
    private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined,
    private readonly frameworksConfigProvider: FrameworksConfigProvider,
    private readonly gateReferenceResolver: GateReferenceResolver | undefined,
    private readonly frameworkManagerProvider: () => FrameworkManager | undefined,
    logger: Logger,
    metricsProvider?: () => MetricsCollector | undefined,
    gatesConfigProvider?: GatesConfigProvider,
    private readonly gateLoader?: GateDefinitionProvider,
    private readonly gateManagerProvider?: () => GateManager | undefined
  ) {
    super(logger);
    if (metricsProvider !== undefined) {
      this.metricsProvider = metricsProvider;
    }
    if (gatesConfigProvider !== undefined) {
      this.gatesConfigProvider = gatesConfigProvider;
    }
  }

  /**
   * Get methodology gate IDs dynamically from GateLoader.
   * Caches the result to avoid repeated disk reads.
   */
  private async getMethodologyGateIds(): Promise<Set<string>> {
    if (this.methodologyGateIdsCache) {
      return this.methodologyGateIdsCache;
    }

    if (!this.gateLoader) {
      this.logger.debug(
        '[GateEnhancementStage] No GateLoader available for methodology gate detection'
      );
      return new Set();
    }

    try {
      const ids = await this.gateLoader.getMethodologyGateIds();
      this.methodologyGateIdsCache = new Set(ids);
      return this.methodologyGateIdsCache;
    } catch (error) {
      this.logger.warn('[GateEnhancementStage] Failed to load methodology gate IDs', { error });
      return new Set();
    }
  }

  /**
   * Check if a gate ID is a methodology gate (synchronous check using cache).
   */
  private isMethodologyGate(gateId: string): boolean {
    return this.methodologyGateIdsCache?.has(gateId) ?? false;
  }

  /**
   * Clear the methodology gate cache.
   * Should be called when gates are hot-reloaded to ensure fresh data.
   */
  public clearMethodologyCache(): void {
    this.methodologyGateIdsCache = null;
    this.logger.debug('[GateEnhancementStage] Methodology gate cache cleared');
  }

  /**
   * Returns gate service with validation.
   * This method should only be called after the null check in execute().
   */
  private requireGateService(): IGateService {
    if (this.gateService === null) {
      throw new Error('Gate service not available');
    }
    return this.gateService;
  }

  /**
   * Type-safe resolution of gate enhancement context using type guards.
   * Eliminates runtime errors by using compile-time type narrowing.
   */
  private resolveGateContext(context: ExecutionContext): GateEnhancementContext | null {
    // Chain execution context
    if (context.hasChainCommand()) {
      return {
        type: 'chain',
        steps: context.parsedCommand.steps,
      };
    }

    // Legacy compatibility: fallback for non-chain commands with steps
    if (context.parsedCommand?.steps !== undefined && context.parsedCommand.steps.length > 0) {
      return {
        type: 'chain',
        steps: context.parsedCommand.steps,
      };
    }

    // Single prompt execution context
    if (context.hasSinglePromptCommand()) {
      return {
        type: 'single',
        prompt: context.parsedCommand.convertedPrompt,
        inlineGateIds: context.parsedCommand.inlineGateIds ?? [],
      };
    }

    // Fallback for non-type-guarded single prompts
    if (context.parsedCommand?.convertedPrompt !== undefined) {
      return {
        type: 'single',
        prompt: context.parsedCommand.convertedPrompt,
        inlineGateIds: context.parsedCommand.inlineGateIds ?? [],
      };
    }

    return null;
  }

  /**
   * Add gates to the context accumulator from a specific source.
   * This replaces direct array manipulation with tracked provenance.
   */
  private addGatesToAccumulator(
    context: ExecutionContext,
    gateIds: readonly string[] | undefined,
    source: GateSource
  ): void {
    if (!gateIds || gateIds.length === 0) {
      return;
    }
    const added = context.gates.addAll(gateIds, source);
    if (added > 0) {
      this.logger.debug('[GateEnhancementStage] Added gates to accumulator', {
        source,
        added,
        total: context.gates.size,
      });
    }
  }

  private shouldSkipGateEnhancement(modifiers?: ExecutionModifiers): boolean {
    if (!modifiers) {
      return false;
    }
    return modifiers.clean === true || modifiers.framework === true;
  }

  /**
   * Get the active framework ID from context using FrameworkDecisionAuthority.
   * This ensures consistent framework resolution across all pipeline stages.
   *
   * Priority (handled by authority):
   * 1. Modifiers (%clean, %lean) - disable framework (returns undefined)
   * 2. @ operator override - explicit user intent
   * 3. Client selection from judge phase - user chose
   * 4. Global active framework - system default
   */
  private getActiveFrameworkId(context: ExecutionContext): string | undefined {
    const decisionInput = this.buildDecisionInput(context);
    const frameworkId = context.frameworkAuthority.getFrameworkId(decisionInput);
    const decision = context.frameworkAuthority.getCachedDecision();

    this.logger.debug('[GateEnhancementStage] getActiveFrameworkId', {
      frameworkId,
      decision: decision
        ? {
            shouldApply: decision.shouldApply,
            frameworkId: decision.frameworkId,
            reason: decision.reason,
            source: decision.source,
          }
        : null,
    });

    return frameworkId;
  }

  /**
   * Ensure methodology validation gate is present when frameworks are active
   */
  private ensureDefaultMethodologyGate(
    gateIds: string[],
    gatesConfig: GatesConfig | undefined,
    activeFrameworkId: string | undefined
  ): string[] {
    this.logger.debug('[GateEnhancementStage] ensureDefaultMethodologyGate', {
      inputGateCount: gateIds.length,
      enableMethodologyGates: gatesConfig?.enableMethodologyGates,
      activeFrameworkId,
    });

    if (!gatesConfig?.enableMethodologyGates || !activeFrameworkId) {
      this.logger.debug('[GateEnhancementStage] ensureDefaultMethodologyGate - skipped', {
        reason: !gatesConfig?.enableMethodologyGates
          ? 'enableMethodologyGates is false or undefined'
          : 'activeFrameworkId is undefined',
      });
      return gateIds;
    }
    const hasMethodologyGate = gateIds.some((gate) => this.isMethodologyGate(gate));
    if (hasMethodologyGate) {
      this.logger.debug('[GateEnhancementStage] ensureDefaultMethodologyGate - already has', {
        existingGate: gateIds.find((gate) => this.isMethodologyGate(gate)),
      });
      return gateIds;
    }
    this.logger.debug(
      '[GateEnhancementStage] ensureDefaultMethodologyGate - adding framework-compliance'
    );
    return [...gateIds, 'framework-compliance'];
  }

  /**
   * Build decision input from context for FrameworkDecisionAuthority.
   * This extracts all relevant data for the centralized framework decision.
   */
  private buildDecisionInput(context: ExecutionContext): FrameworkDecisionInput {
    // Get global active framework from multiple sources:
    // 1. context.frameworkContext (set by FrameworkStage, may not exist yet)
    // 2. frameworkManager.selectFramework() (direct query to framework state)
    let globalActiveFramework = context.frameworkContext?.selectedFramework?.id;

    this.logger.debug('[GateEnhancementStage] buildDecisionInput - initial', {
      fromContext: globalActiveFramework,
      hasFrameworkContext: Boolean(context.frameworkContext),
    });

    const frameworkManager = this.frameworkManagerProvider();
    this.logger.debug('[GateEnhancementStage] buildDecisionInput - frameworkManager', {
      hasFrameworkManager: Boolean(frameworkManager),
      isInitialized: frameworkManager?.isInitialized,
    });

    if (!globalActiveFramework && frameworkManager) {
      try {
        // Query framework manager for the current active framework
        const activeFramework = frameworkManager.selectFramework({});
        globalActiveFramework = activeFramework?.id;
        this.logger.debug('[GateEnhancementStage] buildDecisionInput - selected', {
          selectedId: activeFramework?.id,
          selectedName: activeFramework?.name,
        });
      } catch (error) {
        // Framework manager may not be initialized, log the error
        this.logger.warn('[GateEnhancementStage] buildDecisionInput - selectFramework failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result: FrameworkDecisionInput = {};
    if (context.executionPlan?.modifiers !== undefined) {
      result.modifiers = context.executionPlan.modifiers;
    }
    const operatorOverride = context.parsedCommand?.executionPlan?.frameworkOverride;
    if (operatorOverride !== undefined) {
      result.operatorOverride = operatorOverride;
    }
    if (context.state.framework.clientOverride !== undefined) {
      result.clientOverride = context.state.framework.clientOverride;
    }
    if (globalActiveFramework !== undefined) {
      result.globalActiveFramework = globalActiveFramework;
    }

    this.logger.debug('[GateEnhancementStage] buildDecisionInput - result', result);

    return result;
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (this.gateService === null) {
      this.logExit({ skipped: 'Gate service unavailable' });
      return;
    }

    const gatesConfig = this.gatesConfigProvider?.();
    if (gatesConfig?.enabled === false) {
      this.logExit({ skipped: 'Gate system disabled by configuration' });
      return;
    }

    const executionPlan = context.executionPlan;
    if (executionPlan === undefined) {
      this.logExit({ skipped: 'Execution plan missing' });
      return;
    }

    if (this.shouldSkipGateEnhancement(executionPlan.modifiers)) {
      this.logExit({ skipped: 'Gate enhancement disabled by execution modifier' });
      return;
    }

    // Initialize methodology gate IDs cache for dynamic filtering
    await this.getMethodologyGateIds();

    const registeredGates = await this.registerTemporaryGates(context);

    // Type-safe variant resolution
    const gateContext = this.resolveGateContext(context);
    if (gateContext === null) {
      this.logExit({ skipped: 'Unsupported execution context' });
      return;
    }

    // Variant-specific processing
    if (gateContext.type === 'chain') {
      await this.enhanceChainSteps(gateContext, context, registeredGates, gatesConfig);
      return;
    }

    if (gateContext.type === 'single') {
      await this.enhanceSinglePrompt(gateContext, context, registeredGates, gatesConfig);
      return;
    }
  }

  /**
   * Enhance a single prompt with gate instructions.
   * Uses GateAccumulator for centralized deduplication with priority-based conflict resolution.
   */
  private async enhanceSinglePrompt(
    gateContext: SinglePromptGateContext,
    context: ExecutionContext,
    registeredGates: RegisteredGateResult,
    gatesConfig: GatesConfig | undefined
  ): Promise<void> {
    const executionPlan = context.executionPlan;
    if (executionPlan === undefined) {
      return;
    }

    const { prompt, inlineGateIds } = gateContext;

    // Include client-selected gates from two-phase judge flow
    const clientSelectedGates = context.state.framework.clientSelectedGates ?? [];

    // Use accumulator for centralized deduplication with priority tracking
    // Priority order (highest to lowest): inline-operator > client-selection > temporary-request > prompt-config > methodology > registry-auto
    this.addGatesToAccumulator(context, inlineGateIds, 'inline-operator');
    this.addGatesToAccumulator(context, clientSelectedGates, 'client-selection');
    this.addGatesToAccumulator(context, registeredGates.temporaryGateIds, 'temporary-request');
    this.addGatesToAccumulator(context, executionPlan.gates, 'prompt-config');
    this.addGatesToAccumulator(context, registeredGates.canonicalGateIds, 'methodology');

    // Auto-select gates from registry based on activation rules (lowest priority)
    // This queries GateManager.selectGates() which evaluates gate activation rules
    const activeFrameworkId = this.getActiveFrameworkId(context);
    const selectionContext: import('../../../gates/types/index.js').GateSelectionContext = {
      enabledOnly: true,
    };
    if (prompt.category !== undefined) {
      selectionContext.promptCategory = prompt.category;
    }
    if (activeFrameworkId !== undefined) {
      selectionContext.framework = activeFrameworkId;
    }

    const registryGates = this.selectRegistryGates(selectionContext);
    this.addGatesToAccumulator(context, registryGates, 'registry-auto');

    // Get deduplicated gate list from accumulator
    let gateIds = [...context.gates.getAll()];

    // activeFrameworkId already computed above for registry selection
    gateIds = this.ensureDefaultMethodologyGate(gateIds, gatesConfig, activeFrameworkId);

    // Filter methodology gates if disabled
    if (gatesConfig !== undefined && !gatesConfig.enableMethodologyGates) {
      const beforeCount = gateIds.length;
      gateIds = gateIds.filter((gate) => !this.isMethodologyGate(gate));
      if (beforeCount !== gateIds.length) {
        context.diagnostics.info(this.name, 'Methodology gates filtered by config', {
          filtered: beforeCount - gateIds.length,
          remaining: gateIds.length,
        });
      }
    }

    if (gateIds.length === 0) {
      context.diagnostics.info(this.name, 'Gate enhancement skipped - no gates to apply');
      this.logExit({ skipped: 'No gates to apply' });
      return;
    }

    // Record diagnostic for gate accumulation
    context.diagnostics.info(this.name, 'Gates accumulated for single prompt', {
      totalGates: gateIds.length,
      sourceCounts: context.gates.getSourceCounts(),
    });

    try {
      const originalTemplate = prompt.userMessageTemplate ?? '';
      const gateService = this.requireGateService();

      // Include both inline gates (:: operator) AND canonical gates from gates parameter
      // as explicit - they should bypass activation filtering since user requested them
      const gateContext: import('../../../gates/core/gate-definitions.js').GateContext = {
        promptId: prompt.id,
        explicitGateIds: [...inlineGateIds, ...registeredGates.canonicalGateIds],
      };

      if (activeFrameworkId !== undefined) {
        gateContext.framework = activeFrameworkId;
      }
      if (executionPlan.category !== undefined) {
        gateContext.category = executionPlan.category;
      }

      const result = await gateService.enhancePrompt(prompt, gateIds, gateContext);

      // Extract gate instructions by comparing original vs enhanced template
      const enhancedTemplate = result.enhancedPrompt.userMessageTemplate ?? '';
      if (enhancedTemplate.startsWith(originalTemplate)) {
        // Gate instructions are appended, extract them
        context.gateInstructions = enhancedTemplate.substring(originalTemplate.length).trim();
      }

      executionPlan.gates = gateIds;

      if (result.validationResults !== undefined && result.validationResults.length > 0) {
        context.state.gates.validationResults = result.validationResults.map((r) => ({
          ...r,
          valid: r.passed,
        }));
      }

      this.recordGateUsageMetrics(
        context,
        gateIds,
        result.instructionLength,
        result.validationResults
      );

      // Store accumulated gate IDs for downstream stages
      context.state.gates.accumulatedGateIds = gateIds;

      // Single prompts use advisory mode (execute normally, append gate guidance)
      // Chains use blocking mode (pause for gate review before execution)
      const isSinglePrompt = !context.parsedCommand?.steps?.length;
      context.state.gates.hasBlockingGates = !isSinglePrompt && gateIds.length > 0;

      // Enforcement mode: advisory for single prompts, blocking for chains
      if (!context.state.gates.enforcementMode && gateIds.length > 0) {
        context.state.gates.enforcementMode = isSinglePrompt ? 'advisory' : 'blocking';
      }

      this.logExit({
        gateCount: gateIds.length,
        serviceType: gateService.serviceType,
        gateInstructionsStored: Boolean(context.gateInstructions),
        sourceCounts: context.gates.getSourceCounts(),
      });
    } catch (error) {
      this.logger.warn('[GateEnhancementStage] Gate enhancement failed', {
        error,
      });
    }
  }

  /**
   * Enhance gate instructions for each step in a multi-step command.
   * Uses GateAccumulator for global gates while handling step-specific gates per step.
   */
  private async enhanceChainSteps(
    gateContext: ChainStepGateContext,
    context: ExecutionContext,
    registeredGates: RegisteredGateResult,
    gatesConfig: GatesConfig | undefined
  ): Promise<void> {
    const gateService = this.requireGateService();
    const { steps } = gateContext;
    let totalGatesApplied = 0;

    // Add globally applicable gates to the accumulator ONCE
    // These apply to all steps (subject to step filtering)
    const clientSelectedGates = context.state.framework.clientSelectedGates ?? [];
    this.addGatesToAccumulator(context, clientSelectedGates, 'client-selection');
    this.addGatesToAccumulator(context, registeredGates.temporaryGateIds, 'temporary-request');
    this.addGatesToAccumulator(context, registeredGates.canonicalGateIds, 'methodology');

    for (const step of steps) {
      // Each step should have a convertedPrompt (set during parsing)
      const prompt = step.convertedPrompt;
      if (prompt === undefined) {
        this.logger.warn(
          `[GateEnhancementStage] Skipping step ${step.stepNumber} - no convertedPrompt`
        );
        continue;
      }

      if (this.shouldSkipGateEnhancement(step.executionPlan?.modifiers)) {
        this.logger.debug(
          '[GateEnhancementStage] Skipping gate enhancement for step due to modifiers',
          {
            promptId: step.promptId,
          }
        );
        continue;
      }

      // Planned gates from ExecutionPlanningStage (auto-gates, overrides)
      const plannedGates =
        Array.isArray(step.executionPlan?.gates) && step.executionPlan.gates.length > 0
          ? step.executionPlan.gates
          : [];

      // Use pre-registered inline gate IDs for this step (if any)
      const stepInlineGates = Array.isArray(step.inlineGateIds) ? step.inlineGateIds : [];

      // Resolve framework ID for this step (needed for registry selection)
      const activeFrameworkId = this.getActiveFrameworkId(context);
      const stepFrameworkId = step.frameworkContext?.selectedFramework?.id ?? activeFrameworkId;

      // Auto-select gates from registry based on activation rules
      const registrySelectionContext: import('../../../gates/types/index.js').GateSelectionContext =
        {
          enabledOnly: true,
        };
      if (prompt.category !== undefined && prompt.category.length > 0) {
        registrySelectionContext.promptCategory = prompt.category;
      }
      if (stepFrameworkId !== undefined) {
        registrySelectionContext.framework = stepFrameworkId;
      }

      const registryGates =
        registrySelectionContext.promptCategory !== undefined
          ? this.selectRegistryGates(registrySelectionContext)
          : [];

      // Add step-specific gates to accumulator (they'll be deduplicated against global gates)
      this.addGatesToAccumulator(context, stepInlineGates, 'inline-operator');
      this.addGatesToAccumulator(context, plannedGates, 'prompt-config');
      this.addGatesToAccumulator(context, registryGates, 'registry-auto');

      // Get all accumulated gates (global + step-specific, deduplicated)
      let gateIds = [...context.gates.getAll()];
      gateIds = this.ensureDefaultMethodologyGate(gateIds, gatesConfig, activeFrameworkId);

      if (gatesConfig !== undefined && !gatesConfig.enableMethodologyGates) {
        gateIds = gateIds.filter((gate) => !this.isMethodologyGate(gate));
      }

      // Filter gates by step number (for step-specific targeting)
      gateIds = this.filterGatesByStepNumber(gateIds, step.stepNumber);

      if (gateIds.length === 0) {
        continue; // Skip this step if no gates to apply
      }

      try {
        const originalTemplate = prompt.userMessageTemplate ?? '';

        // stepFrameworkId already computed above for registry gate selection
        // Uses: @ operator > client selection from judge phase > global active framework

        const stepGateContext: import('../../../gates/core/gate-definitions.js').GateContext = {
          promptId: prompt.id,
        };
        if (Array.isArray(step.inlineGateIds)) {
          stepGateContext.explicitGateIds = step.inlineGateIds;
        }
        if (stepFrameworkId !== undefined) {
          stepGateContext.framework = stepFrameworkId;
        }
        if (prompt.category !== undefined) {
          stepGateContext.category = prompt.category;
        }

        const result = await gateService.enhancePrompt(prompt, gateIds, stepGateContext);

        // Extract gate instructions for this step
        const enhancedTemplate = result.enhancedPrompt.userMessageTemplate ?? '';
        if (enhancedTemplate.startsWith(originalTemplate)) {
          const stepGateInstructions = enhancedTemplate.substring(originalTemplate.length).trim();

          // Store step-specific gate instructions in step metadata
          step.metadata ??= {};
          step.metadata['gateInstructions'] = stepGateInstructions;
        }

        // DON'T update step's convertedPrompt - keep original template unchanged
        // step.convertedPrompt = result.enhancedPrompt; // REMOVED

        totalGatesApplied += gateIds.length;

        this.recordGateUsageMetrics(
          context,
          gateIds,
          result.instructionLength,
          result.validationResults
        );
      } catch (error) {
        this.logger.warn(
          `[GateEnhancementStage] Gate enhancement failed for step ${step.stepNumber}`,
          {
            error,
            promptId: step.promptId,
          }
        );
      }
    }

    // Store accumulated gate IDs for downstream stages (chain path)
    const allGateIds = [...context.gates.getAll()];
    context.state.gates.accumulatedGateIds = allGateIds;
    context.state.gates.hasBlockingGates = totalGatesApplied > 0;

    // Enforcement mode defaults to 'blocking' - can be overridden by response-capture-stage
    // based on gate definitions when they're loaded via GateLoader
    if (!context.state.gates.enforcementMode && allGateIds.length > 0) {
      context.state.gates.enforcementMode = 'blocking';
    }

    this.logExit({
      gateCount: totalGatesApplied,
      stepCount: steps.length,
      serviceType: gateService.serviceType,
      sourceCounts: context.gates.getSourceCounts(),
    });
  }

  /**
   * Select gates from registry based on activation rules.
   *
   * Queries GateManager.selectGates() to find gates whose activation rules
   * match the current category and/or framework context.
   */
  private selectRegistryGates(
    context: import('../../../gates/types/index.js').GateSelectionContext
  ): string[] {
    const gateManager = this.gateManagerProvider?.();

    if (!gateManager) {
      this.logger.warn(
        '[GateEnhancementStage] GateManager unavailable - no automatic gate selection'
      );
      return [];
    }

    try {
      const result = gateManager.selectGates(context);

      this.logger.debug('[GateEnhancementStage] Registry gate selection', {
        category: context.promptCategory,
        framework: context.framework,
        selectedCount: result.selectedIds.length,
        skippedCount: result.skippedIds.length,
        selectedIds: result.selectedIds,
        selectionMethod: result.metadata.selectionMethod,
      });

      return result.selectedIds;
    } catch (error) {
      this.logger.warn('[GateEnhancementStage] Registry selection failed', {
        error: error instanceof Error ? error.message : String(error),
        category: context.promptCategory,
        framework: context.framework,
      });
      return [];
    }
  }

  /**
   * Filter gates by step number for step-specific targeting
   *
   * @param gateIds - Array of gate IDs to filter
   * @param stepNumber - Current step number (1-based)
   * @returns Filtered array of gate IDs that apply to this step
   */
  private filterGatesByStepNumber(gateIds: string[], stepNumber: number): string[] {
    if (!this.temporaryGateRegistry) {
      return gateIds; // No filtering if registry unavailable
    }

    return gateIds.filter((gateId) => {
      const tempGate = this.temporaryGateRegistry!.getTemporaryGate(gateId);

      // If not a temporary gate, keep it (canonical gates always apply)
      if (!tempGate) {
        return true;
      }

      // If gate has target_step_number, only apply to that specific step
      if (tempGate.target_step_number !== undefined) {
        return tempGate.target_step_number === stepNumber;
      }

      // If gate has apply_to_steps, only apply to those specific steps
      if (tempGate.apply_to_steps !== undefined && tempGate.apply_to_steps.length > 0) {
        return tempGate.apply_to_steps.includes(stepNumber);
      }

      // No step targeting specified - apply to all steps
      return true;
    });
  }

  private getMetricsCollector(): MetricsCollector | undefined {
    return this.metricsProvider?.();
  }

  private recordGateUsageMetrics(
    context: ExecutionContext,
    gateIds: string[],
    instructionLength?: number,
    validationResults?: ServiceGateValidationResult[]
  ): void {
    const metrics = this.getMetricsCollector();
    if (metrics === undefined || gateIds.length === 0) {
      return;
    }

    const temporaryIds = new Set<string>(context.state.gates.temporaryGateIds ?? []);

    const validationMap = new Map<string, ServiceGateValidationResult>();
    validationResults?.forEach((result) => validationMap.set(result.gateId, result));

    const baseCharacters =
      instructionLength !== undefined && gateIds.length > 0
        ? Math.floor(instructionLength / gateIds.length)
        : 0;
    let remainder =
      instructionLength !== undefined && gateIds.length > 0
        ? instructionLength % gateIds.length
        : 0;

    for (const gateId of gateIds) {
      const isTemporary = temporaryIds.has(gateId) || gateId.startsWith('temp_');
      const validation = validationMap.get(gateId);
      const instructionCharacters = baseCharacters + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder--;
      }

      const metric: GateUsageMetric = {
        gateId,
        gateType: isTemporary ? 'temporary' : 'canonical',
        instructionCount: 1,
        instructionCharacters,
        temporary: isTemporary,
      };

      const sessionId = context.getSessionId();
      if (sessionId !== undefined) {
        metric.sessionId = sessionId;
      }

      const resolvedValidation =
        validation !== undefined
          ? this.toMetricValidationResult(validation)
          : validationResults !== undefined && validationResults.length > 0
            ? 'skipped'
            : undefined;
      if (resolvedValidation !== undefined) {
        metric.validationResult = resolvedValidation;
      }

      const metadata: Record<string, unknown> = {};
      if (context.executionPlan?.strategy !== undefined) {
        metadata['strategy'] = context.executionPlan.strategy;
      }
      if (context.executionPlan?.category !== undefined) {
        metadata['category'] = context.executionPlan.category;
      }
      if (this.gateService?.serviceType !== undefined) {
        metadata['serviceType'] = this.gateService.serviceType;
      }
      if (Object.keys(metadata).length > 0) {
        metric.metadata = metadata;
      }

      metrics.recordGateUsage(metric);
    }
  }

  private toMetricValidationResult(
    validation: ServiceGateValidationResult
  ): MetricGateValidationResult {
    return validation.passed ? 'passed' : 'failed';
  }

  /**
   * Normalize gate input to standard format, supporting multiple input styles
   *
   * @param gate - Raw gate input to normalize
   * @param isChainExecution - Whether we're in a chain execution context
   * @param currentStep - Current step number for smart defaults (default: 1)
   */
  private normalizeGateInput(
    gate: RawGateInput,
    isChainExecution: boolean = false,
    currentStep: number = 1
  ): {
    normalized: NormalizedGateInput;
    isValid: boolean;
  } {
    // Support simple string format: "criteria text"
    if (typeof gate === 'string') {
      return {
        normalized: {
          name: 'Inline Validation Criteria',
          type: 'validation',
          scope: 'execution',
          description: 'Inline validation criteria',
          source: 'automatic',
          ...(gate ? { criteria: [gate] } : {}),
          ...(isChainExecution ? { apply_to_steps: [currentStep] } : {}),
        },
        isValid: true,
      };
    }

    // Normalize gate type with fallback
    const normalizeType = (type: string | undefined): NormalizedGateInput['type'] => {
      const validTypes: NormalizedGateInput['type'][] = ['validation', 'guidance'];
      return validTypes.includes(type as NormalizedGateInput['type'])
        ? (type as NormalizedGateInput['type'])
        : 'validation';
    };

    // Normalize scope with fallback
    const normalizeScope = (scope: string | undefined): NormalizedGateInput['scope'] => {
      const validScopes: NormalizedGateInput['scope'][] = ['execution', 'session', 'chain', 'step'];
      return validScopes.includes(scope as NormalizedGateInput['scope'])
        ? (scope as NormalizedGateInput['scope'])
        : 'execution';
    };

    // Normalize source with fallback
    const normalizeSource = (source: string | undefined): NormalizedGateInput['source'] => {
      const validSources: NormalizedGateInput['source'][] = ['manual', 'automatic', 'analysis'];
      return validSources.includes(source as NormalizedGateInput['source'])
        ? (source as NormalizedGateInput['source'])
        : 'automatic';
    };

    // Convert readonly arrays to mutable arrays and filter for strings
    const normalizeCriteria = (
      criteria: unknown[] | readonly unknown[] | undefined
    ): string[] | undefined => {
      if (criteria === undefined || !Array.isArray(criteria)) return undefined;
      const stringCriteria = criteria.filter((c): c is string => typeof c === 'string');
      return stringCriteria.length > 0 ? stringCriteria : undefined;
    };

    // Normalize context to proper type
    const normalizeContext = (context: unknown): Record<string, unknown> | undefined => {
      if (context === undefined || context === null) return undefined;
      if (typeof context === 'object') {
        return context as Record<string, unknown>;
      }
      return undefined;
    };

    // Extract criteria from either criteria or pass_criteria property
    const extractedCriteria = 'criteria' in gate ? gate.criteria : undefined;
    const extractedPassCriteria = 'pass_criteria' in gate ? gate.pass_criteria : undefined;

    // Extract step targeting
    const targetStepNumber =
      'target_step_number' in gate && typeof gate.target_step_number === 'number'
        ? gate.target_step_number
        : undefined;
    const applyToSteps =
      'apply_to_steps' in gate && Array.isArray(gate.apply_to_steps)
        ? gate.apply_to_steps.filter((n): n is number => typeof n === 'number')
        : undefined;

    // Smart default: If in chain execution and no step-targeting specified, apply to current step
    const effectiveApplyToSteps =
      applyToSteps && applyToSteps.length > 0
        ? applyToSteps
        : targetStepNumber === undefined && isChainExecution
          ? [currentStep]
          : undefined;

    // Support object with criteria or other gate properties
    // Name fallback: explicit name > id > default
    // This allows {id: "my-check", criteria: [...]} to display as "my-check"
    const normalized: NormalizedGateInput = {
      name: gate.name ?? gate.id ?? 'Inline Quality Criteria',
      type: normalizeType(gate.type),
      scope: normalizeScope(gate.scope),
      description: gate.description ?? 'Temporary gate criteria',
      source: normalizeSource(gate.source),
    };

    const criteria = normalizeCriteria(extractedCriteria);
    if (criteria !== undefined) {
      normalized.criteria = criteria;
    }

    if (gate.guidance !== undefined) {
      normalized.guidance = gate.guidance;
    }

    const passCriteria = normalizeCriteria(extractedPassCriteria ?? extractedCriteria);
    if (passCriteria !== undefined) {
      normalized.pass_criteria = passCriteria;
    }

    const contextValue = normalizeContext(gate.context);
    if (contextValue !== undefined) {
      normalized.context = contextValue;
    }

    if (targetStepNumber !== undefined) {
      normalized.target_step_number = targetStepNumber;
    }

    if (effectiveApplyToSteps !== undefined) {
      normalized.apply_to_steps = effectiveApplyToSteps;
    }

    return {
      normalized,
      isValid: true,
    };
  }

  /**
   * Register temporary gates from normalized gate specifications.
   * Uses unified 'gates' parameter (already normalized from legacy parameters).
   */
  private async registerTemporaryGates(context: ExecutionContext): Promise<RegisteredGateResult> {
    this.logger.debug('[GateEnhancementStage] registerTemporaryGates - parsedCommand structure', {
      hasOperators: Boolean(context.parsedCommand?.operators),
      operatorTypes:
        context.parsedCommand?.operators !== undefined
          ? (context.parsedCommand.operators as { operatorTypes?: unknown }).operatorTypes
          : undefined,
      operatorCount:
        context.parsedCommand?.operators !== undefined
          ? (context.parsedCommand.operators as { operators?: unknown[] }).operators?.length
          : undefined,
      format: context.parsedCommand?.format,
    });

    // Use normalized gates from metadata (unified 'gates' parameter)
    const overrides = context.state.gates.requestedOverrides as Record<string, any> | undefined;
    const normalizedGates = overrides?.['gates'] as
      | import('../../../types/execution.js').GateSpecification[]
      | undefined;

    // Track canonical gate IDs and resolved gates to prevent duplicates
    // NOTE: Do NOT pre-populate with string gates - they need canonical resolution first
    const canonicalGateIds = new Set<string>();
    const resolvedGateIds = new Set<string>(); // Track all resolved gates (canonical or processed)
    const createdIds: string[] = [];

    // Use normalized gates from unified parameter
    const tempGateInputs: RawGateInput[] = normalizedGates ?? [];

    const registry = this.temporaryGateRegistry;
    const registryAvailable = registry !== undefined;
    if (!tempGateInputs.length) {
      return { temporaryGateIds: [], canonicalGateIds: [] };
    }

    const scopeId =
      context.getSessionId?.() ||
      context.mcpRequest.chain_id ||
      context.mcpRequest.command ||
      'execution';

    // Determine if we're in a chain execution and get current step for smart defaults
    const isChainExecution =
      context.hasChainCommand() ||
      (context.parsedCommand?.steps !== undefined && context.parsedCommand.steps.length > 1);
    const currentStep = context.sessionContext?.currentStep ?? 1;

    // Deduplication sets to avoid duplicate temp gate creation in a single batch
    const seenStringInputs = new Set<string>();
    const seenGateSignatures = new Set<string>();

    for (const rawGate of tempGateInputs) {
      try {
        // Handle string gate IDs - resolve to canonical definitions first
        if (typeof rawGate === 'string') {
          const trimmed = rawGate.trim();
          if (!trimmed || seenStringInputs.has(trimmed)) {
            continue;
          }
          seenStringInputs.add(trimmed);

          // Try to resolve as canonical gate (loads from YAML with guidance.md)
          if (this.gateReferenceResolver) {
            const resolution = await this.gateReferenceResolver.resolve(trimmed);
            if (resolution.referenceType === 'registered') {
              canonicalGateIds.add(resolution.gateId);
              resolvedGateIds.add(resolution.gateId);
              this.logger.debug(
                '[GateEnhancementStage] Resolved string gate to canonical definition',
                { input: trimmed, gateId: resolution.gateId }
              );
              continue; // Canonical gate - don't create temp gate
            }
          }

          // Not a canonical gate - will fall through to normalization as inline criteria
          this.logger.debug(
            '[GateEnhancementStage] String gate not canonical, treating as criteria',
            {
              input: trimmed,
            }
          );
        }

        // For object gates, use existing resolveCanonicalGateId logic
        if (typeof rawGate === 'object' && rawGate !== null) {
          const canonicalCandidate = await this.resolveCanonicalGateId(rawGate, resolvedGateIds);
          if (canonicalCandidate) {
            canonicalGateIds.add(canonicalCandidate);
            resolvedGateIds.add(canonicalCandidate);
            this.logger.debug(
              '[GateEnhancementStage] Resolved object gate to canonical definition',
              {
                gateId: canonicalCandidate,
              }
            );
            continue;
          }
        }

        const { normalized: gate, isValid } = this.normalizeGateInput(
          rawGate,
          isChainExecution,
          currentStep
        );

        if (!isValid) {
          this.logger.warn('[GateEnhancementStage] Invalid gate format, skipping', {
            gate: rawGate,
          });
          continue;
        }

        const criteria = gate.criteria ?? gate.pass_criteria ?? [];
        const criteriaArray = Array.isArray(criteria)
          ? criteria.filter((c): c is string => typeof c === 'string')
          : [];

        // Build a signature to deduplicate identical gate content (for object inputs)
        const signatureParts = [
          gate.type ?? 'validation',
          gate.scope ?? 'execution',
          (gate.name ?? '').toLowerCase(),
          (gate.description ?? '').toLowerCase(),
          (gate.guidance ?? '').toLowerCase(),
          criteriaArray.join('|').toLowerCase(),
          (gate.apply_to_steps ?? []).join(','),
          gate.target_step_number ?? '',
        ];
        const gateSignature = signatureParts.join('||');
        if (seenGateSignatures.has(gateSignature)) {
          this.logger.debug('[GateEnhancementStage] Skipping duplicate temporary gate', {
            signature: gateSignature,
          });
          continue;
        }
        seenGateSignatures.add(gateSignature);

        let effectiveGuidance = gate.guidance || '';

        if (!effectiveGuidance && criteriaArray.length > 0) {
          effectiveGuidance = formatCriteriaAsGuidance(criteriaArray);
          this.logger.debug('[GateEnhancementStage] Auto-generated guidance from criteria', {
            criteriaCount: criteriaArray.length,
            guidanceLength: effectiveGuidance.length,
          });
        } else if (!effectiveGuidance && gate.description) {
          effectiveGuidance = gate.description;
          this.logger.debug('[GateEnhancementStage] Using description as guidance', {
            guidanceLength: effectiveGuidance.length,
          });
        }

        if (!effectiveGuidance && criteriaArray.length === 0 && !gate.description) {
          this.logger.warn(
            '[GateEnhancementStage] Skipping gate with no usable content (no guidance, criteria, or description)',
            { gate }
          );
          continue;
        }

        if (!registryAvailable) {
          continue;
        }

        // Check if gate already exists (registered by earlier stage with user-provided ID)
        const gateIdCandidate =
          typeof rawGate === 'object' &&
          rawGate !== null &&
          'id' in rawGate &&
          typeof rawGate.id === 'string'
            ? rawGate.id
            : null;

        if (gateIdCandidate && registry.getTemporaryGate(gateIdCandidate)) {
          this.logger.debug('[GateEnhancementStage] Skipping gate already registered', {
            gateId: gateIdCandidate,
          });
          // Still track it as a canonical gate if needed
          createdIds.push(gateIdCandidate);
          continue;
        }

        const tempGateDefinition: Omit<
          import('../../../gates/core/temporary-gate-registry.js').TemporaryGateDefinition,
          'id' | 'created_at'
        > & { id?: string } = {
          name: gate.name,
          type: gate.type,
          scope: gate.scope,
          description: gate.description ?? effectiveGuidance.substring(0, 100),
          guidance: effectiveGuidance,
          source: gate.source,
        };

        if (gateIdCandidate) {
          tempGateDefinition.id = gateIdCandidate;
        }
        if (criteriaArray.length > 0) {
          tempGateDefinition.pass_criteria = criteriaArray;
        } else if (gate.pass_criteria !== undefined) {
          tempGateDefinition.pass_criteria = gate.pass_criteria;
        }
        if (gate.context !== undefined) {
          tempGateDefinition.context = gate.context;
        }
        if (gate.target_step_number !== undefined) {
          tempGateDefinition.target_step_number = gate.target_step_number;
        }
        if (gate.apply_to_steps !== undefined) {
          tempGateDefinition.apply_to_steps = gate.apply_to_steps;
        }

        const gateId = registry.createTemporaryGate(tempGateDefinition, scopeId);

        createdIds.push(gateId);
        this.trackTemporaryGateScope(context, gate.scope ?? 'execution', scopeId);

        this.logger.debug('[GateEnhancementStage] Registered temporary gate', {
          gateId,
          name: gate.name,
          hasGuidance: !!effectiveGuidance,
          guidanceLength: effectiveGuidance.length,
          criteriaCount: criteriaArray.length,
        });
      } catch (error) {
        this.logger.warn('[GateEnhancementStage] Failed to register temporary gate', {
          gate: rawGate,
          error,
        });
      }
    }

    if (registryAvailable && createdIds.length) {
      const existing = context.state.gates.temporaryGateIds ?? [];
      context.state.gates.temporaryGateIds = [...existing, ...createdIds];

      this.logger.info('[GateEnhancementStage] Successfully registered temporary gates', {
        count: createdIds.length,
        gateIds: createdIds,
      });
    }

    if (canonicalGateIds.size > 0) {
      const overrides = context.state.gates.requestedOverrides as
        | Record<string, unknown>
        | undefined;

      // Merge canonical gate IDs back into gates array
      const existingGates = (overrides?.['gates'] as any[]) ?? [];
      const existingGateStrings = existingGates.filter((g): g is string => typeof g === 'string');
      const merged = new Set<string>(existingGateStrings);
      canonicalGateIds.forEach((gateId) => merged.add(gateId));

      // Update gates with merged canonical IDs
      if (overrides) {
        const nonStringGates = existingGates.filter((g) => typeof g !== 'string');
        overrides['gates'] = [...Array.from(merged), ...nonStringGates];
      }
      context.state.gates.canonicalGateIdsFromTemporary = Array.from(canonicalGateIds);
    }

    return {
      temporaryGateIds: registryAvailable ? createdIds : [],
      canonicalGateIds: Array.from(canonicalGateIds),
    };
  }

  private trackTemporaryGateScope(
    context: ExecutionContext,
    scope: string,
    scopeId?: string
  ): void {
    if (!scopeId) {
      return;
    }

    const normalizedScope: 'execution' | 'session' | 'chain' | 'step' =
      scope === 'session' || scope === 'chain' || scope === 'step' ? scope : 'execution';

    const scopes = context.state.gates.temporaryGateScopes ?? [];

    if (!context.state.gates.temporaryGateScopes) {
      context.state.gates.temporaryGateScopes = scopes;
    }

    const exists = scopes.some(
      (entry) => entry.scope === normalizedScope && entry.scopeId === scopeId
    );
    if (!exists) {
      scopes.push({ scope: normalizedScope, scopeId });
    }
  }

  private convertCustomChecks(customChecks?: ReadonlyArray<CustomCheck>): Array<{
    name: string;
    type: string;
    scope: string;
    description: string;
    guidance: string;
    pass_criteria: string[];
    source: string;
  }> {
    if (!Array.isArray(customChecks) || !customChecks.length) {
      return [];
    }

    return customChecks
      .filter((check) => check && (check.name || check.description))
      .map((check) => ({
        name: check.name ?? 'Custom Check',
        type: 'validation',
        scope: 'execution',
        description: check.description ?? check.name ?? '',
        guidance: check.description
          ? `Ensure: ${check.description}`
          : 'Ensure the output satisfies the described custom check.',
        pass_criteria: [],
        source: 'manual',
      }));
  }

  private async resolveCanonicalGateId(
    gate: RawGateInput,
    requestedQualityGates: Set<string>
  ): Promise<string | undefined> {
    const candidate = this.extractGateReferenceCandidate(gate);
    if (!candidate || requestedQualityGates.has(candidate)) {
      return undefined;
    }

    if (typeof gate === 'object' && gate !== null && this.gateInputContainsInlineContent(gate)) {
      return undefined;
    }

    if (!this.gateReferenceResolver) {
      return undefined;
    }

    const resolution = await this.gateReferenceResolver.resolve(candidate);
    if (
      resolution.referenceType === 'registered' &&
      !requestedQualityGates.has(resolution.gateId)
    ) {
      return resolution.gateId;
    }
    return undefined;
  }

  private extractGateReferenceCandidate(gate: RawGateInput): string | undefined {
    if (typeof gate === 'string') {
      const trimmed = gate.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    if (gate && typeof gate === 'object') {
      const id = 'id' in gate && typeof gate.id === 'string' ? gate.id : undefined;
      const trimmed = id?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : undefined;
    }

    return undefined;
  }

  private gateInputContainsInlineContent(gate: Record<string, unknown>): boolean {
    const hasCriteria = Array.isArray(gate['criteria']) && gate['criteria'].length > 0;
    const hasPassCriteria =
      Array.isArray(gate['pass_criteria']) && gate['pass_criteria'].length > 0;
    const hasGuidance = typeof gate['guidance'] === 'string' && gate['guidance'].trim().length > 0;
    const hasDescription =
      typeof gate['description'] === 'string' && gate['description'].trim().length > 0;
    return hasCriteria || hasPassCriteria || hasGuidance || hasDescription;
  }
}
