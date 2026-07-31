// @lifecycle canonical - Core gate enhancement logic for prompt enrichment.
import { GateSetResolver } from './gate-set-resolver.js';
import { isFrameworkInjected } from '../../execution/pipeline/decisions/injection/index.js';

import type { GateMetricsRecorder } from './gate-metrics-recorder.js';
import type { GateService } from './gate-service-interface.js';
import type { GateResolutionInput } from './gate-set-resolver.js';
import type { RegisteredGateResult } from './temporary-gate-registrar.js';
import type { Logger } from '../../../infra/logging/index.js';
import type { ExecutionContext } from '../../execution/context/index.js';
import type { ChainStepPrompt } from '../../execution/operators/types.js';
import type { FrameworkDecisionInput } from '../../execution/pipeline/decisions/index.js';
import type { GateSource } from '../../execution/pipeline/state/types.js';
import type { ConvertedPrompt, ExecutionModifiers } from '../../execution/types.js';
/** Narrow provider: returns active framework ID without importing FrameworkManager. */
type ActiveFrameworkIdProvider = () => string | undefined;
import type { GateContext } from '../core/gate-definitions.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { GateManager } from '../gate-manager.js';
import type { GatesConfig } from '../types.js';

/**
 * Every prompt in this execution that may carry inline gate definitions.
 *
 * A chain yields one entry per step rather than just the entry prompt: each step is a distinct
 * prompt with its own `gateConfiguration`, and a later step's definitions must already hold
 * canonical ids by the time that step resolves against the cumulative accumulator.
 *
 * A free function rather than a stage helper — `architecture.md` keeps orchestration free of
 * private helpers, and this is a pure projection with no dependencies.
 */
export function inlineDefinitionCarriers(
  gateContext: SinglePromptGateContext | ChainStepGateContext
): ReadonlyArray<ConvertedPrompt | undefined> {
  return gateContext.type === 'chain'
    ? gateContext.steps.map((step) => step.convertedPrompt)
    : [gateContext.prompt];
}

/**
 * Discriminated union for gate enhancement contexts.
 */
export interface SinglePromptGateContext {
  readonly type: 'single';
  readonly prompt: ConvertedPrompt;
  readonly inlineGateIds: string[];
}

export interface ChainStepGateContext {
  readonly type: 'chain';
  readonly steps: ChainStepPrompt[];
}

export type GateEnhancementContext = SinglePromptGateContext | ChainStepGateContext;

/**
 * Core gate enhancement logic extracted from GateEnhancementStage.
 *
 * Handles gate selection, framework coordination, accumulator management,
 * and prompt enrichment for both single-prompt and chain-step execution.
 */
export class GateEnhancementService {
  constructor(
    private readonly gateService: GateService | null,
    private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined,
    private readonly activeFrameworkIdProvider: ActiveFrameworkIdProvider,
    private readonly gateManagerProvider: () => GateManager | undefined,
    private readonly gateLoader: GateDefinitionProvider | undefined,
    private readonly metricsRecorder: GateMetricsRecorder,
    private readonly logger: Logger
  ) {}

  /**
   * Single owner for gate-set resolution — ADR 0001. Do not resolve gates outside it.
   *
   * Built per call rather than in the constructor: `gateManagerProvider` is a provider precisely
   * because the manager is wired after this service is constructed, so resolving it eagerly
   * would capture `undefined` for the process lifetime. Construction is three assignments.
   */
  private buildGateSetResolver(): GateSetResolver {
    return new GateSetResolver(this.logger, this.gateManagerProvider(), this.gateLoader);
  }

  isAvailable(): boolean {
    return this.gateService !== null;
  }

  shouldSkip(modifiers?: ExecutionModifiers): boolean {
    if (!modifiers) {
      return false;
    }
    return modifiers.clean === true || modifiers.framework === true;
  }

  /**
   * Load framework gate IDs from GateLoader for the current request.
   * Returns fresh data each call — GateLoader handles hot-reload internally.
   */
  async loadFrameworkGateIds(): Promise<Set<string>> {
    if (!this.gateLoader) {
      return new Set();
    }

    try {
      const ids = await this.gateLoader.getFrameworkGateIds();
      return new Set(ids);
    } catch (error) {
      this.logger.warn('[GateEnhancementService] Failed to load framework gate IDs', { error });
      return new Set();
    }
  }

  /**
   * Type-safe resolution of gate enhancement context.
   */
  resolveGateContext(context: ExecutionContext): GateEnhancementContext | null {
    if (context.hasChainCommand()) {
      return { type: 'chain', steps: context.parsedCommand.steps };
    }

    if (context.parsedCommand?.steps !== undefined && context.parsedCommand.steps.length > 0) {
      return { type: 'chain', steps: context.parsedCommand.steps };
    }

    if (context.hasSinglePromptCommand()) {
      return {
        type: 'single',
        prompt: context.parsedCommand.convertedPrompt,
        inlineGateIds: context.parsedCommand.inlineGateIds ?? [],
      };
    }

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
   * Enhance a single prompt with gate instructions.
   * Uses GateAccumulator for centralized deduplication with priority-based conflict resolution.
   */
  async enhanceSinglePrompt(
    gateContext: SinglePromptGateContext,
    context: ExecutionContext,
    registeredGates: RegisteredGateResult,
    gatesConfig: GatesConfig | undefined,
    frameworkGateIds: Set<string>,
    /** Canonical ids for this prompt's inline definitions, already registered by the caller. */
    inlineDefinitionGateIds: readonly string[] = []
  ): Promise<void> {
    const executionPlan = context.executionPlan;
    if (executionPlan === undefined) {
      return;
    }

    const { prompt, inlineGateIds } = gateContext;
    const clientSelectedGates = context.state.framework.clientSelectedGates ?? [];

    const activeFrameworkId = this.getActiveFrameworkId(context);

    await this.resolveIntoAccumulator(context, {
      prompt,
      category: prompt.category ?? '',
      modifiers: executionPlan.modifiers,
      frameworkId: activeFrameworkId,
      frameworkInjected: isFrameworkInjected({
        modifiers: executionPlan.modifiers,
        promptInjection: prompt.injection,
      }),
      frameworkGatesEnabled: gatesConfig?.enableMethodologyGates !== false,
      knownFrameworkGateIds: [...frameworkGateIds],
      inlineOperatorGateIds: inlineGateIds,
      clientSelectedGateIds: clientSelectedGates,
      callerGateIds: registeredGates.temporaryGateIds,
      plannedGateIds: executionPlan.gates,
      frameworkGateIds: registeredGates.canonicalGateIds,
      inlineDefinitionGateIds,
    });

    let gateIds = [...context.gates.getAll()];
    gateIds = this.ensureDefaultFrameworkGate(
      gateIds,
      gatesConfig,
      activeFrameworkId,
      frameworkGateIds
    );

    if (gatesConfig !== undefined && !gatesConfig.enableMethodologyGates) {
      const beforeCount = gateIds.length;
      gateIds = gateIds.filter((gate) => !frameworkGateIds.has(gate));
      if (beforeCount !== gateIds.length) {
        context.diagnostics.info('GateEnhancement', 'Framework gates filtered by config', {
          filtered: beforeCount - gateIds.length,
          remaining: gateIds.length,
        });
      }
    }

    if (gateIds.length === 0) {
      context.diagnostics.info('GateEnhancement', 'Gate enhancement skipped - no gates to apply');
      return;
    }

    context.diagnostics.info('GateEnhancement', 'Gates accumulated for single prompt', {
      totalGates: gateIds.length,
      sourceCounts: context.gates.getSourceCounts(),
    });

    try {
      const originalTemplate = prompt.userMessageTemplate ?? '';
      const gateService = this.requireGateService();

      const gateCtx: GateContext = {
        promptId: prompt.id,
        explicitGateIds: [...inlineGateIds, ...registeredGates.canonicalGateIds],
      };
      if (activeFrameworkId !== undefined) {
        gateCtx.framework = activeFrameworkId;
      }
      if (executionPlan.category !== undefined) {
        gateCtx.category = executionPlan.category;
      }

      const result = await gateService.enhancePrompt(prompt, gateIds, gateCtx);

      const enhancedTemplate = result.enhancedPrompt.userMessageTemplate ?? '';
      if (enhancedTemplate.startsWith(originalTemplate)) {
        context.gateInstructions = enhancedTemplate.substring(originalTemplate.length).trim();
      }

      executionPlan.gates = gateIds;

      if (result.validationResults !== undefined && result.validationResults.length > 0) {
        context.state.gates.validationResults = result.validationResults.map((r) => ({
          ...r,
          valid: r.passed,
        }));
      }

      this.metricsRecorder.recordGateUsageMetrics(
        context,
        gateIds,
        result.instructionLength,
        result.validationResults
      );

      context.state.gates.accumulatedGateIds = gateIds;

      const isSinglePrompt = !context.parsedCommand?.steps?.length;
      context.state.gates.hasBlockingGates = !isSinglePrompt && gateIds.length > 0;

      if (!context.state.gates.enforcementMode && gateIds.length > 0) {
        context.state.gates.enforcementMode = isSinglePrompt ? 'advisory' : 'blocking';
      }
    } catch (error) {
      this.logger.warn('[GateEnhancementService] Gate enhancement failed', { error });
    }
  }

  /**
   * Enhance gate instructions for each step in a multi-step command.
   * Uses GateAccumulator for global gates while handling step-specific gates per step.
   */
  async enhanceChainSteps(
    gateContext: ChainStepGateContext,
    context: ExecutionContext,
    registeredGates: RegisteredGateResult,
    gatesConfig: GatesConfig | undefined,
    frameworkGateIds: Set<string>,
    /**
     * Canonical ids for every step's inline definitions, registered up front by the caller.
     *
     * Supplied as one flat list rather than per step because the chain accumulator is cumulative
     * — step N already inherits steps 1..N-1 — so partitioning the ids per step would suppress
     * nothing while adding a way to get the mapping wrong.
     */
    inlineDefinitionGateIds: readonly string[] = []
  ): Promise<void> {
    const gateService = this.requireGateService();
    const { steps } = gateContext;
    let totalGatesApplied = 0;

    const clientSelectedGates = context.state.framework.clientSelectedGates ?? [];
    this.addGatesToAccumulator(context, clientSelectedGates, 'client-selection');
    this.addGatesToAccumulator(context, registeredGates.temporaryGateIds, 'temporary-request');
    this.addGatesToAccumulator(context, registeredGates.canonicalGateIds, 'framework-guide');

    for (const step of steps) {
      const prompt = step.convertedPrompt;
      if (prompt === undefined) {
        this.logger.warn(
          `[GateEnhancementService] Skipping step ${step.stepNumber} - no convertedPrompt`
        );
        continue;
      }

      if (this.shouldSkip(step.executionPlan?.modifiers)) {
        continue;
      }

      const plannedGates =
        Array.isArray(step.executionPlan?.gates) && step.executionPlan.gates.length > 0
          ? step.executionPlan.gates
          : [];
      const stepInlineGates = Array.isArray(step.inlineGateIds) ? step.inlineGateIds : [];

      const activeFrameworkId = this.getActiveFrameworkId(context);
      const stepFrameworkId = step.frameworkContext?.selectedFramework?.id ?? activeFrameworkId;

      await this.resolveIntoAccumulator(context, {
        prompt,
        category: prompt.category ?? '',
        modifiers: step.executionPlan?.modifiers,
        frameworkId: stepFrameworkId,
        // Read from the step's own prompt, not the chain entry prompt: each step is a distinct
        // prompt and may carry its own injection block.
        frameworkInjected: isFrameworkInjected({
          modifiers: step.executionPlan?.modifiers,
          promptInjection: prompt.injection,
        }),
        frameworkGatesEnabled: gatesConfig?.enableMethodologyGates !== false,
        knownFrameworkGateIds: [...frameworkGateIds],
        inlineOperatorGateIds: stepInlineGates,
        plannedGateIds: plannedGates,
        inlineDefinitionGateIds,
        // A step with no category must not pull in registry gates on a 'general' fallback.
        autoAssignCategoryGates: prompt.category !== undefined && prompt.category.length > 0,
      });

      // The accumulator is intentionally NOT reset between steps: step N inherits the gates
      // accumulated by steps 1..N-1, which is the pre-existing chain contract.
      let gateIds = [...context.gates.getAll()];
      gateIds = this.ensureDefaultFrameworkGate(
        gateIds,
        gatesConfig,
        activeFrameworkId,
        frameworkGateIds
      );

      if (gatesConfig !== undefined && !gatesConfig.enableMethodologyGates) {
        gateIds = gateIds.filter((gate) => !frameworkGateIds.has(gate));
      }

      gateIds = this.filterGatesByStepNumber(gateIds, step.stepNumber);

      if (gateIds.length === 0) {
        continue;
      }

      try {
        const originalTemplate = prompt.userMessageTemplate ?? '';

        const stepGateContext: GateContext = { promptId: prompt.id };
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

        const enhancedTemplate = result.enhancedPrompt.userMessageTemplate ?? '';
        if (enhancedTemplate.startsWith(originalTemplate)) {
          const stepGateInstructions = enhancedTemplate.substring(originalTemplate.length).trim();
          step.metadata ??= {};
          step.metadata['gateInstructions'] = stepGateInstructions;
        }

        totalGatesApplied += gateIds.length;

        this.metricsRecorder.recordGateUsageMetrics(
          context,
          gateIds,
          result.instructionLength,
          result.validationResults
        );
      } catch (error) {
        this.logger.warn(
          `[GateEnhancementService] Gate enhancement failed for step ${step.stepNumber}`,
          { error, promptId: step.promptId }
        );
      }
    }

    const allGateIds = [...context.gates.getAll()];
    context.state.gates.accumulatedGateIds = allGateIds;
    context.state.gates.hasBlockingGates = totalGatesApplied > 0;

    if (!context.state.gates.enforcementMode && allGateIds.length > 0) {
      context.state.gates.enforcementMode = 'blocking';
    }
  }

  private requireGateService(): GateService {
    if (this.gateService === null) {
      throw new Error('Gate service not available');
    }
    return this.gateService;
  }

  /**
   * Resolve a gate set through `GateSetResolver` (the single owner, ADR 0001) and record the
   * result in the accumulator.
   *
   * The split of responsibility is deliberate: the resolver decides *which* ids survive, while
   * this method owns *enrichment* — reading `retry_config` and `blockResponseOnFail` off the
   * registry guide for `registry-auto` entries. Enrichment stayed here because it reaches into
   * the gate registry for per-gate execution metadata, which is not a resolution concern.
   */
  private async resolveIntoAccumulator(
    context: ExecutionContext,
    input: GateResolutionInput
  ): Promise<void> {
    const resolution = await this.buildGateSetResolver().resolve(input);

    const registryGateIds: string[] = [];
    for (const gate of resolution.accepted) {
      if (gate.source === 'registry-auto') {
        registryGateIds.push(gate.id);
      } else {
        this.addGatesToAccumulator(context, [gate.id], gate.source);
      }
    }
    this.addRegistryGatesWithRetryConfig(context, registryGateIds);

    if (resolution.vetoed.size > 0) {
      context.diagnostics.info('GateEnhancement', 'Gates removed by veto', {
        vetoed: Object.fromEntries(resolution.vetoed),
      });
    }
  }

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
      this.logger.debug('[GateEnhancementService] Added gates to accumulator', {
        source,
        added,
        total: context.gates.size,
      });
    }
  }

  private addRegistryGatesWithRetryConfig(
    context: ExecutionContext,
    gateIds: readonly string[]
  ): void {
    if (!gateIds || gateIds.length === 0) {
      return;
    }

    const gateManager = this.gateManagerProvider?.();
    let added = 0;

    for (const gateId of gateIds) {
      let retryLimit: number | undefined;
      let blockResponseOnFail = false;

      if (gateManager) {
        try {
          const registry = gateManager.getGateRegistry();
          const gate = registry?.getGuide(gateId);

          if (gate) {
            const retryConfig = gate.getRetryConfig();
            if (retryConfig?.max_attempts !== undefined) {
              retryLimit = retryConfig.max_attempts;
            }

            const definition = gate.getDefinition();
            if (definition.blockResponseOnFail === true) {
              blockResponseOnFail = true;
              context.gates.addBlockingGate(gateId);
            }
          }
        } catch {
          // Gate registry lookup failed - continue without config
        }
      }

      const metadata = retryLimit !== undefined ? { retryLimit, blockResponseOnFail } : undefined;
      if (context.gates.add(gateId, 'registry-auto', metadata)) {
        added++;
      }
    }

    if (added > 0) {
      this.logger.debug('[GateEnhancementService] Added registry gates with config', {
        added,
        total: context.gates.size,
        blockingGates: context.gates.getBlockingGateIds(),
      });
    }
  }

  private filterGatesByStepNumber(gateIds: string[], stepNumber: number): string[] {
    if (!this.temporaryGateRegistry) {
      return gateIds;
    }

    return gateIds.filter((gateId) => {
      const tempGate = this.temporaryGateRegistry!.getTemporaryGate(gateId);
      if (!tempGate) {
        return true;
      }
      if (tempGate.target_step_number !== undefined) {
        return tempGate.target_step_number === stepNumber;
      }
      if (tempGate.apply_to_steps !== undefined && tempGate.apply_to_steps.length > 0) {
        return tempGate.apply_to_steps.includes(stepNumber);
      }
      return true;
    });
  }

  private getActiveFrameworkId(context: ExecutionContext): string | undefined {
    const decisionInput = this.buildDecisionInput(context);
    return context.frameworkAuthority.getFrameworkId(decisionInput);
  }

  private buildDecisionInput(context: ExecutionContext): FrameworkDecisionInput {
    let globalActiveFramework = context.frameworkContext?.selectedFramework?.id;

    if (!globalActiveFramework) {
      globalActiveFramework = this.activeFrameworkIdProvider();
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

    return result;
  }

  private ensureDefaultFrameworkGate(
    gateIds: string[],
    gatesConfig: GatesConfig | undefined,
    activeFrameworkId: string | undefined,
    frameworkGateIds: Set<string>
  ): string[] {
    if (!gatesConfig?.enableMethodologyGates || !activeFrameworkId) {
      return gateIds;
    }
    const hasFrameworkGate = gateIds.some((gate) => frameworkGateIds.has(gate));
    if (hasFrameworkGate) {
      return gateIds;
    }
    return [...gateIds, 'framework-compliance'];
  }
}
