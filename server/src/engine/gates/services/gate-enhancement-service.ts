// @lifecycle canonical - Core gate enhancement logic for prompt enrichment.
import { GateSetResolver } from './gate-set-resolver.js';
import { isFrameworkInjected } from '../../execution/pipeline/decisions/injection/index.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateMetricsRecorder } from './gate-metrics-recorder.js';
import type { GateService } from './gate-service-interface.js';
import type { GateResolutionInput } from './gate-set-resolver.js';
import type { RunStepView, RunStepViewProvider } from './run-step-view.js';
import type { RegisteredGateResult } from './temporary-gate-registrar.js';
import type { ExecutionContext, SessionContext } from '../../execution/context/index.js';
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
    private readonly logger: Logger,
    /**
     * The live run's step identities, when there is a run (P4 row 4.1). Optional: single prompts
     * and the call that starts a chain have no run, and a chain that never mutates selects
     * identically with or without it.
     */
    private readonly runStepViewProvider?: RunStepViewProvider
  ) {}

  /**
   * Single owner for gate-set resolution — ADR 0001. Do not resolve gates outside it.
   *
   * Built per call rather than in the constructor: `gateManagerProvider` is a provider precisely
   * because the manager is wired after this service is constructed, so resolving it eagerly
   * would capture `undefined` for the process lifetime. Construction is three assignments.
   */
  private buildGateSetResolver(): GateSetResolver {
    return new GateSetResolver(
      this.logger,
      this.gateManagerProvider(),
      this.gateLoader,
      this.temporaryGateRegistry
    );
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
      frameworkGatesEnabled: gatesConfig?.enableFrameworkGates !== false,
      knownFrameworkGateIds: [...frameworkGateIds],
      inlineOperatorGateIds: inlineGateIds,
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

    if (gatesConfig !== undefined && !gatesConfig.enableFrameworkGates) {
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

      this.metricsRecorder.recordGateUsageMetrics(context, gateIds, result.instructionLength);

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
    const runStepView = this.resolveRunStepView(context);
    const currentStepKey = this.resolveCurrentStepKey(runStepView);
    let totalGatesApplied = 0;

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
        // Row 4.5 (P5-F4 residual, DEV-T4-10, owner-ruled 2026-08-13). A modifier-skipped step
        // produces no output, so there is nothing to review. Write the same positive-empty-list
        // convention the "no applicable gates" case below uses (line ~356) rather than leaving
        // the field unset — unset is exactly what both readers' `?? accumulatedGateIds` fallback
        // turns into a run-wide review, the last remaining fallback path this row closes.
        if (this.isCurrentStep(step, currentStepKey)) {
          context.state.gates.reviewGateIds = [];
        }
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
        frameworkGatesEnabled: gatesConfig?.enableFrameworkGates !== false,
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

      if (gatesConfig !== undefined && !gatesConfig.enableFrameworkGates) {
        gateIds = gateIds.filter((gate) => !frameworkGateIds.has(gate));
      }

      gateIds = this.filterGatesByStepTarget(gateIds, step, runStepView);

      // P4-F3 / OQ-P5-4. The per-step list is what REVIEW must be scoped to, and it exists only
      // here, transiently. Published before the empty-list `continue` on purpose: "this step has
      // no applicable gates" is the finding, and leaving the field unwritten would hand its
      // readers the run-wide list through their fallback — the exact defect being closed.
      if (this.isCurrentStep(step, currentStepKey)) {
        context.state.gates.reviewGateIds = gateIds;
      }

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

        this.metricsRecorder.recordGateUsageMetrics(context, gateIds, result.instructionLength);
      } catch (error) {
        this.logger.warn(
          `[GateEnhancementService] Gate enhancement failed for step ${step.stepNumber}`,
          { error, promptId: step.promptId }
        );
      }
    }

    const allGateIds = [...context.gates.getAll()];
    context.state.gates.accumulatedGateIds = allGateIds;

    // P5-F4 / row 4.4. An INSERTED node has no parse-time step, so the loop above never visited
    // it and nothing above wrote a scope for it. Its review is INHERITED from the node its
    // triggering unknown blocked (owner ruling 2026-08-12). Written after the loop and
    // unconditionally within this branch — not behind an "unwritten" guard — because a chain
    // whose parse steps carry no node ids falls back to ordinal matching in `isCurrentStep`,
    // which can match some other step for an inserted current node; the run's own provenance is
    // the authority, so it wins outright.
    if (runStepView?.currentNodeOrigin !== undefined) {
      context.state.gates.reviewGateIds = this.inheritedReviewGateIds(allGateIds, runStepView);
    }

    context.state.gates.hasBlockingGates = totalGatesApplied > 0;

    if (!context.state.gates.enforcementMode && allGateIds.length > 0) {
      context.state.gates.enforcementMode = 'blocking';
    }
  }

  /**
   * Re-evaluate the pending review for the step this call is now STANDING ON, after any advance
   * that happened earlier in this same request (P5-F6).
   *
   * `enhanceChainSteps` (stage 11) runs once per request and writes `reviewGateIds` for the ONE
   * step the request STARTED on — the only step identity known at that point, because
   * `SessionManagementStage` (stage 13) and `StepResponseCaptureStage` (stage 16, where an
   * advance actually happens) both run later. A gate scoped to a specific step
   * (`target_step_number` / `target_step_id`) that is not the step the request started on is
   * therefore invisible to that one pre-advance write — advancing INTO the step it targets and
   * rendering that step happen in the SAME request, one stage after the only review-creation call
   * that used to exist. This method is the second call, made after the advance, with the
   * now-current step identity `sessionContext` carries.
   *
   * TRIGGERED only when the step-applicable set contains at least one EXPLICITLY step-targeted
   * gate that specifically matches the new step — never by an untargeted (run-wide) gate alone.
   * An untargeted gate already got its one opportunity to review when its id first entered
   * `reviewGateIds` at the step the request started on, and the NEXT call's ordinary pre-advance
   * creation (`SessionManagementStage`, which by then sees this step's identity as its OWN
   * pre-advance state) picks it up on schedule — same timing as before this method existed. If
   * this method fired on an untargeted gate alone, it would create that same-content review one
   * call EARLIER than today for every chain that carries only run-wide gates, changing what
   * renders on a request that must stay unchanged (P5-F6 regression, reproduced 2026-08-16 via
   * `p5-acceptance.integration.test.ts`: a narrower, step-targeted-only review created here
   * blocked the following call's full-scope creation from ever running, permanently dropping the
   * run-wide gate from that step's review).
   *
   * ONCE triggered, the created review's `gateIds` is still the FULL step-applicable set —
   * targeted matches AND untargeted pass-through, via the same `filterGatesForTarget` the
   * per-step walk in `enhanceChainSteps` already uses — not the targeted subset alone. A review
   * missing the run-wide gate would itself be an incomplete review, and per-review gate lists are
   * a single field (`PendingGateReview.gateIds`); there is no second review to carry the rest.
   *
   * Idempotent by construction: a `sessionContext.pendingReview` already set (same-step
   * re-render while a review is outstanding, or a review this same call already created via an
   * earlier branch) short-circuits before any lookup.
   */
  async ensurePostAdvanceReview(
    context: ExecutionContext,
    sessionContext: SessionContext
  ): Promise<void> {
    if (sessionContext.pendingReview !== undefined) {
      return;
    }
    if (context.state.gates.hasBlockingGates !== true) {
      return;
    }

    const accumulatedGateIds = context.state.gates.accumulatedGateIds ?? [];
    if (accumulatedGateIds.length === 0) {
      return;
    }

    const runStepView = this.resolveRunStepView(context);
    const gateIds = this.resolveStepReviewGateIds(
      accumulatedGateIds,
      { nodeId: sessionContext.currentNodeId, stepNumber: sessionContext.currentStep },
      runStepView
    );
    if (gateIds.length === 0) {
      return;
    }

    const authority = context.gateEnforcement;
    if (authority === undefined) {
      this.logger.warn(
        '[GateEnhancementService] GateEnforcementAuthority not available - cannot create post-advance review'
      );
      return;
    }

    const created = await authority.createReviewForStep(context, sessionContext, gateIds);
    if (created !== null) {
      context.diagnostics.info('GateEnhancement', 'Created post-advance PendingGateReview', {
        gateIds,
        stepNumber: sessionContext.currentStep,
        nodeId: sessionContext.currentNodeId,
        maxAttempts: created.maxAttempts,
      });
    }
  }

  /**
   * The full step-applicable set for `target` (targeted matches + untargeted pass-through, via
   * `filterGatesForTarget` — identical semantics to the per-step walk), but returned ONLY when at
   * least one member of that set carries an EXPLICIT step target that specifically matched
   * `target`. An all-untargeted match returns `[]`, which is what keeps
   * {@link ensurePostAdvanceReview} from firing on a run-wide gate alone (see its doc comment).
   */
  private resolveStepReviewGateIds(
    gateIds: readonly string[],
    target: { readonly nodeId?: string | null; readonly stepNumber?: number },
    runStepView: RunStepView | undefined
  ): string[] {
    const matched = this.filterGatesForTarget([...gateIds], target, runStepView);
    const hasNewlyTargetedGate = matched.some((gateId) => this.hasExplicitStepTarget(gateId));
    return hasNewlyTargetedGate ? matched : [];
  }

  /** Whether `gateId` carries a declared step target in the temporary gate registry. */
  private hasExplicitStepTarget(gateId: string): boolean {
    const tempGate = this.temporaryGateRegistry?.getTemporaryGate(gateId);
    if (tempGate === undefined) {
      return false;
    }
    return (
      tempGate.target_step_id !== undefined ||
      tempGate.target_step_number !== undefined ||
      (tempGate.apply_to_steps !== undefined && tempGate.apply_to_steps.length > 0)
    );
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

    // P6-F14: ids that matched no known gate in either GateManager or TemporaryGateRegistry —
    // dropped before Stage 2 ever saw them, so `vetoed` above cannot carry this.
    if (resolution.unregistered.size > 0) {
      context.diagnostics.warn('GateEnhancement', 'Unregistered gate ids dropped', {
        unregistered: Object.fromEntries(resolution.unregistered),
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

  /**
   * The live run's step identities for this call, or undefined when there is no run.
   *
   * Resolved once per chain enhancement rather than per step: the answer cannot change while
   * one call walks the step list, and a per-step lookup would let it appear to.
   */
  private resolveRunStepView(context: ExecutionContext): RunStepView | undefined {
    if (this.runStepViewProvider === undefined) {
      return undefined;
    }
    const chainId = context.getRequestedChainId();
    return chainId === undefined
      ? undefined
      : this.runStepViewProvider(chainId, context.getScopeOptions());
  }

  /**
   * Which step of the walk is the one the run is standing at.
   *
   * Gate enhancement is stage 11 and walks EVERY parse-time step, but only one of them is being
   * rendered on this call. Read off the run's own `currentNodeId` — the same value stage 13
   * publishes as `sessionContext.currentNodeId` and stage 14 resolves steps against — so this is
   * that one notion of "current", asked one hop earlier rather than a second one invented here.
   *
   * With no run to ask (the call that STARTS a chain) the run stands at its first node, so
   * ordinal 1. With `currentNodeId === null` the run has walked off its last node and no step is
   * current: ordinal 0 matches nothing, which leaves `reviewGateIds` unwritten for a run that
   * has no step left to review.
   */
  private resolveCurrentStepKey(view: RunStepView | undefined): {
    nodeId?: string;
    ordinal: number;
  } {
    if (view === undefined) {
      return { ordinal: 1 };
    }
    const currentNodeId = view.currentNodeId;
    if (currentNodeId === null) {
      return { ordinal: 0 };
    }
    if (typeof currentNodeId === 'string' && currentNodeId.length > 0) {
      const ordinal = view.nodeIds.indexOf(currentNodeId) + 1;
      return { nodeId: currentNodeId, ordinal: ordinal > 0 ? ordinal : 1 };
    }
    return { ordinal: 1 };
  }

  /**
   * Node id first, ordinal as fallback — the same precedence `filterGatesByStepTarget` and
   * stage 14's `resolveCurrentChainStep` use, for the same reason: once a node has been inserted
   * the run's ordinal space and the parse-time array stop being the same list.
   */
  private isCurrentStep(step: ChainStepPrompt, key: { nodeId?: string; ordinal: number }): boolean {
    if (key.nodeId !== undefined && typeof step.nodeId === 'string' && step.nodeId.length > 0) {
      return step.nodeId === key.nodeId;
    }
    return step.stepNumber === key.ordinal;
  }

  /** Which of the accumulated gates apply to THIS parse-time step. */
  private filterGatesByStepTarget(
    gateIds: string[],
    step: ChainStepPrompt,
    runStepView: RunStepView | undefined
  ): string[] {
    return this.filterGatesForTarget(
      gateIds,
      { nodeId: step.nodeId, stepNumber: step.stepNumber },
      runStepView
    );
  }

  /**
   * The review scope for an INSERTED node (P5-F4, owner ruling row 4.4).
   *
   * The node the triggering unknown blocked is the review scope to inherit: an investigation node
   * exists to unblock that step, so the gates its author bound to that step are the ones this
   * step's output must answer to. The two rejected alternatives were `[]` (loses the review the
   * investigation exists to serve) and the run-wide accumulator (the P4-F3 shape itself).
   *
   * Only the NODE address is supplied to the filter, never an ordinal. A gate addressed by
   * ordinal alone (`target_step_number` / `apply_to_steps` with no `target_step_id`) names a
   * parse-time position, and the run's ordinal space stopped agreeing with that array the moment
   * a node was inserted — inheriting it would be the same silent retarget `filterGatesForTarget`
   * exists to prevent. So those drop, which is the conservative direction.
   *
   * With no target to inherit (`unknownTargetNodeId` absent — the unknown named none, or its
   * ledger entry is gone) the node address is `null`, which drops every step-addressed gate and
   * keeps the untargeted ones. Run-wide inheritance is untouched either way: the ruling scopes
   * only TARGETED gates, exactly as Tier 4 does for planned steps.
   */
  private inheritedReviewGateIds(gateIds: string[], runStepView: RunStepView): string[] {
    const targetNodeId = runStepView.currentNodeOrigin?.unknownTargetNodeId;
    const nodeId = targetNodeId !== undefined && targetNodeId.length > 0 ? targetNodeId : null;
    return this.filterGatesForTarget(gateIds, { nodeId }, runStepView);
  }

  /**
   * The per-gate targeting decision, shared by the per-step walk and the inherited scope.
   *
   * Node id first (OQ-P4-3). A step-targeted gate is bound to a node id at registration, and
   * matching on that id is what makes the binding survive a mutation: matching on the ordinal
   * instead would silently move the gate one step later the moment a node was inserted ahead of
   * it, firing it against work its author never saw. The ordinal branch remains for gates and
   * chains that carry no node id at all (P3 D10 keeps `nodeId` optional).
   *
   * A gate whose target node has been RETIRED (`milestone='skipped'`) fires nowhere: its step
   * will not execute, and letting it fall through to the ordinal branch would attach it to
   * whatever step now sits at that position.
   *
   * `nodeId: null` is NOT `nodeId: undefined`. `null` means "this target has no node identity and
   * none can be inherited", so every node-addressed gate must drop; `undefined` means "this step
   * carries no node id" (legacy chains — P3 D10 keeps `nodeId` optional), where the ordinal branch
   * is the right answer. Collapsing the two would let an inherited scope with no target silently
   * widen to every node-addressed gate.
   */
  private filterGatesForTarget(
    gateIds: string[],
    target: { readonly nodeId?: string | null; readonly stepNumber?: number },
    runStepView: RunStepView | undefined
  ): string[] {
    if (!this.temporaryGateRegistry) {
      return gateIds;
    }

    return gateIds.filter((gateId) => {
      const tempGate = this.temporaryGateRegistry!.getTemporaryGate(gateId);
      if (!tempGate) {
        return true;
      }

      const targetNodeId = tempGate.target_step_id;
      if (targetNodeId !== undefined) {
        if (runStepView?.skippedNodeIds.includes(targetNodeId) === true) {
          this.logger.debug('[GateEnhancementService] Gate target node is skipped — not firing', {
            gateId,
            targetNodeId,
          });
          return false;
        }
        if (target.nodeId === null) {
          return false;
        }
        if (typeof target.nodeId === 'string' && target.nodeId.length > 0) {
          return targetNodeId === target.nodeId;
        }
      }

      if (tempGate.target_step_number !== undefined) {
        return tempGate.target_step_number === target.stepNumber;
      }
      if (tempGate.apply_to_steps !== undefined && tempGate.apply_to_steps.length > 0) {
        return (
          target.stepNumber !== undefined && tempGate.apply_to_steps.includes(target.stepNumber)
        );
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
    if (!gatesConfig?.enableFrameworkGates || !activeFrameworkId) {
      return gateIds;
    }
    const hasFrameworkGate = gateIds.some((gate) => frameworkGateIds.has(gate));
    if (hasFrameworkGate) {
      return gateIds;
    }
    return [...gateIds, 'framework-compliance'];
  }
}
