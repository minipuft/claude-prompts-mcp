// @lifecycle canonical - Controls all injection decisions using the modular injection system.
import {
  InjectionDecisionService,
  type InjectionDecisionInput,
  type InjectionType,
  type InjectionRuntimeOverride,
  getSessionOverrideManager,
  isSessionOverrideManagerInitialized,
} from '../decisions/injection/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ExecutionContextType, InjectionConfig } from '../decisions/injection/index.js';

type InjectionConfigProvider = () => InjectionConfig;

/**
 * Pipeline Stage 07b: Injection Control
 *
 * Controls when system prompts, gate guidance, and style guidance are injected
 * during prompt and chain execution. Uses a modular design with
 * InjectionDecisionService for hierarchical configuration resolution.
 *
 * Key improvements over the old system:
 * - Clear boolean semantics: inject=true means INJECT, inject=false means SKIP
 * - Hierarchical configuration: Global → Category → Chain → Step
 * - Multiple injection types controlled separately
 * - Conditional injection based on gate status, step type, etc.
 * - Runtime overrides via system_control
 *
 * For chains:
 * - Step 1: Default behavior based on config (usually inject)
 * - Step N>1: Inject based on configured frequency
 *
 * For single prompts:
 * - Always inject unless modifiers (%clean, %lean) disable it
 *
 * Dependencies: context.sessionContext.currentStep (from Session Stage 07)
 * Output: context.state.injection (InjectionState)
 * Can Early Exit: No
 */
export class InjectionControlStage extends BasePipelineStage {
  readonly name = 'InjectionControl';

  private injectionService: InjectionDecisionService | null = null;

  constructor(
    private readonly getInjectionConfig: InjectionConfigProvider,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // Skip if session blueprint was restored (decisions already made)
    if (context.state.session.isBlueprintRestored) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    // Create authority if not already created
    if (!this.injectionService) {
      const config = this.getInjectionConfig();
      this.injectionService = new InjectionDecisionService(config, this.logger);
    }

    // Pull active session overrides (if initialized via system_control) and
    // sync them into the decision service so runtime overrides take effect.
    const sessionOverrides = this.getSessionOverrides();
    this.injectionService.syncRuntimeOverrides(sessionOverrides ?? new Map());

    // Build decision input from context
    const overrideRecord = this.toSessionOverrideRecord(sessionOverrides);
    const input = this.buildDecisionInput(context, overrideRecord);

    // Get decisions for all injection types
    const injectionState = this.injectionService.decideAll(input);

    // Persist active session overrides for downstream diagnostics/status
    if (overrideRecord) {
      injectionState.sessionOverrides = overrideRecord;
    }

    // Store injection decisions in state (authoritative source for downstream stages)
    context.state.injection = injectionState;

    this.logExit({
      systemPrompt: injectionState.systemPrompt?.inject,
      gateGuidance: injectionState.gateGuidance?.inject,
      styleGuidance: injectionState.styleGuidance?.inject,
      currentStep: input.currentStep,
      source: {
        systemPrompt: injectionState.systemPrompt?.source,
        gateGuidance: injectionState.gateGuidance?.source,
        styleGuidance: injectionState.styleGuidance?.source,
      },
    });
  }

  /**
   * Build the decision input from execution context.
   */
  private buildDecisionInput(
    context: ExecutionContext,
    sessionOverrides?: Partial<Record<InjectionType, boolean>>
  ): Omit<InjectionDecisionInput, 'injectionType'> {
    const currentStep = context.sessionContext?.currentStep ?? 1;
    const input: Omit<InjectionDecisionInput, 'injectionType'> = {
      currentStep,
      executionContext: context.sessionContext?.pendingReview ? 'gate_review' : 'step',
    };

    const totalSteps = context.sessionContext?.totalSteps;
    if (totalSteps !== undefined) {
      input.totalSteps = totalSteps;
    }

    const gateStatuses = this.buildGateStatusMap(context);
    if (gateStatuses) {
      input.gateStatuses = gateStatuses;
    }

    const categoryId = this.getCategoryId(context);
    if (categoryId) {
      input.categoryId = categoryId;
    }

    const chainId = context.getRequestedChainId();
    if (chainId) {
      input.chainId = chainId;
    }

    const promptId = context.parsedCommand?.promptId;
    if (promptId) {
      input.promptId = promptId;
    }

    const modifiers = context.executionPlan?.modifiers;
    if (modifiers) {
      input.modifiers = modifiers;
    }

    const stepType = this.getStepType(context);
    if (stepType) {
      input.stepType = stepType;
    }

    const previousStepResult = context.sessionContext?.previousStepResult;
    if (previousStepResult) {
      input.previousStepResult = previousStepResult;
    }

    if (sessionOverrides) {
      input.sessionOverrides = sessionOverrides;
    }

    return input;
  }

  /**
   * Build a map of gate IDs to their current status.
   */
  private buildGateStatusMap(
    context: ExecutionContext
  ): Map<string, 'pass' | 'fail' | 'pending'> | undefined {
    const gateStatuses = new Map<string, 'pass' | 'fail' | 'pending'>();

    // Check accumulated gates for their status
    const accumulatedGateIds = context.state.gates.accumulatedGateIds ?? [];

    if (accumulatedGateIds.length === 0) {
      return undefined;
    }

    // If there's a pending review, those gates are 'pending'
    const pendingReview = context.sessionContext?.pendingReview;
    if (pendingReview) {
      // Gates in pending review are pending
      gateStatuses.set('pending-review', 'pending');
    }

    // For now, mark all accumulated gates as 'pending' until we have results
    // This could be enhanced to track actual pass/fail status per gate
    for (const gateId of accumulatedGateIds) {
      if (!gateStatuses.has(gateId)) {
        gateStatuses.set(gateId, 'pending');
      }
    }

    return gateStatuses.size > 0 ? gateStatuses : undefined;
  }

  /**
   * Get the category ID from the context.
   */
  private getCategoryId(context: ExecutionContext): string | undefined {
    // Try to get from converted prompt
    if (context.parsedCommand?.convertedPrompt?.category) {
      return context.parsedCommand.convertedPrompt.category;
    }

    // Try to get from chain steps
    if (context.hasChainCommand()) {
      const firstStep = context.parsedCommand.steps[0];
      if (firstStep?.convertedPrompt?.category) {
        return firstStep.convertedPrompt.category;
      }
    }

    return undefined;
  }

  /**
   * Get the step type from the context.
   * Step type can be defined in step metadata.
   */
  private getStepType(context: ExecutionContext): string | undefined {
    if (!context.hasChainCommand()) {
      return undefined;
    }

    const currentStep = context.sessionContext?.currentStep ?? 1;
    const steps = context.parsedCommand.steps;
    const step = steps[currentStep - 1];

    // Try to get step type from metadata
    if (step?.metadata?.['stepType']) {
      return String(step.metadata['stepType']);
    }

    return undefined;
  }

  /**
   * Retrieve active session overrides from the SessionOverrideManager if available.
   */
  private getSessionOverrides(): Map<InjectionType, InjectionRuntimeOverride> | undefined {
    if (!isSessionOverrideManagerInitialized()) {
      return undefined;
    }

    const manager = getSessionOverrideManager();
    return manager.getAllOverrides();
  }

  /**
   * Convert runtime overrides map to the lightweight record stored on pipeline state.
   */
  private toSessionOverrideRecord(
    overrides?: Map<InjectionType, InjectionRuntimeOverride>
  ): Partial<Record<InjectionType, boolean>> | undefined {
    if (!overrides || overrides.size === 0) {
      return undefined;
    }

    const record: Partial<Record<InjectionType, boolean>> = {};
    for (const [type, override] of overrides) {
      if (override.enabled !== undefined) {
        record[type] = override.enabled;
      }
    }

    return Object.keys(record).length > 0 ? record : undefined;
  }

  /**
   * Reset the service (for testing or when config changes).
   */
  resetService(): void {
    this.injectionService = null;
  }

  /**
   * Get the current service instance (for testing).
   */
  getService(): InjectionDecisionService | null {
    return this.injectionService;
  }
}
