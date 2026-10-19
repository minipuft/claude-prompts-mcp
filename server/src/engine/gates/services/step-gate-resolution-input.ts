// @lifecycle canonical - What one step of the chain gate walk asks the resolver and the gate service with.
//
// The per-step inputs of the chain gate walk, apart from the service that runs it: the resolution
// input a walked step asks `GateSetResolver` with, and the gate context its guidance renders under.
// PURE: every answer reads only the step, its prompt and the walk's fixed settings, so each stays
// answerable without a PromptRequestContext (`architecture.md`). `GateEnhancementService` calls
// these from both walks it runs — the call's own (`enhanceChainSteps`) and the re-derivation after
// a remainder (`inheritedReviewGateIdsNow`) — so the two cannot ask with different inputs.

import { isFrameworkInjected } from '../../execution/pipeline/decisions/injection/index.js';

import type { GateSystemSettings } from '#shared/types/index.js';
import type { GateResolutionInput } from './gate-set-resolver.js';
import type { ChainStepPrompt } from '../../execution/operators/types.js';
import type { ConvertedPrompt } from '../../execution/types.js';
import type { GateContext } from '../core/gate-definitions.js';

/** The walk's settings a step's resolution reads: fixed for the whole walk, read per step. */
export interface StepWalkResolutionSettings {
  readonly gatesConfig: GateSystemSettings | undefined;
  readonly frameworkGateIds: Set<string>;
  readonly inlineDefinitionGateIds: readonly string[];
  readonly stepDefinitionIds: ReadonlyMap<string, string>;
}

/**
 * A step's `inlineGateIds` with each chain-prompt reference replaced by the id it registered
 * under (P6.158). PURE. A reference nothing registered stays as given and resolves to no gate.
 */
export function resolvedInlineGateIds(
  step: ChainStepPrompt,
  stepDefinitionIds: ReadonlyMap<string, string>
): string[] | undefined {
  return step.inlineGateIds?.map((gateId) => stepDefinitionIds.get(gateId) ?? gateId);
}

/**
 * The resolution input for one step of the gate walk: its own prompt (not the chain entry
 * prompt — each step may carry its own injection block and `gateConfiguration`), its inline gates
 * with chain-prompt references resolved, and the walk's settings. PURE.
 */
export function walkedStepResolutionInput(
  step: ChainStepPrompt,
  prompt: ConvertedPrompt,
  frameworkId: string | undefined,
  settings: StepWalkResolutionSettings
): GateResolutionInput {
  return stepResolutionInput({
    step,
    inlineGateIds: resolvedInlineGateIds(step, settings.stepDefinitionIds),
    prompt,
    frameworkId,
    frameworkInjected: isFrameworkInjected({
      modifiers: step.executionPlan?.modifiers,
      promptInjection: prompt.injection,
    }),
    frameworkGatesEnabled: settings.gatesConfig?.enableFrameworkGates !== false,
    knownFrameworkGateIds: [...settings.frameworkGateIds],
    inlineDefinitionGateIds: settings.inlineDefinitionGateIds,
  });
}

/**
 * One step's contribution to the chain's cumulative gate resolution.
 *
 * A free function rather than a method: deciding WHAT a step contributes reads only the step and
 * its prompt, so it stays answerable without a PromptRequestContext (`architecture.md`).
 */
function stepResolutionInput(args: {
  readonly step: ChainStepPrompt;
  /** The step's `inlineGateIds`, chain-prompt references resolved (P6.158). */
  readonly inlineGateIds: string[] | undefined;
  readonly prompt: ConvertedPrompt;
  readonly frameworkId: string | undefined;
  readonly frameworkInjected: boolean;
  readonly frameworkGatesEnabled: boolean;
  readonly knownFrameworkGateIds: readonly string[];
  readonly inlineDefinitionGateIds: readonly string[];
}): GateResolutionInput {
  const { step, prompt } = args;
  const plannedGates =
    Array.isArray(step.executionPlan?.gates) && step.executionPlan.gates.length > 0
      ? step.executionPlan.gates
      : [];

  return {
    prompt,
    category: prompt.category ?? '',
    modifiers: step.executionPlan?.modifiers,
    frameworkId: args.frameworkId,
    frameworkInjected: args.frameworkInjected,
    frameworkGatesEnabled: args.frameworkGatesEnabled,
    knownFrameworkGateIds: args.knownFrameworkGateIds,
    inlineOperatorGateIds: args.inlineGateIds ?? [],
    plannedGateIds: plannedGates,
    inlineDefinitionGateIds: args.inlineDefinitionGateIds,
    // A step with no category must not pull in registry gates on a 'general' fallback.
    autoAssignCategoryGates: prompt.category !== undefined && prompt.category.length > 0,
  };
}

/**
 * The gate context one step's enhancement runs under.
 *
 * Optional fields are assigned only when present: an absent key is what the readers of
 * `GateContext` test for, so writing `undefined` would not mean the same thing.
 */
export function stepGateContext(
  prompt: ConvertedPrompt,
  inlineGateIds: string[] | undefined,
  frameworkId: string | undefined
): GateContext {
  const gateCtx: GateContext = { promptId: prompt.id, criteriaExecution: 'pipeline' };
  if (inlineGateIds !== undefined) {
    gateCtx.explicitGateIds = inlineGateIds;
  }
  if (frameworkId !== undefined) {
    gateCtx.framework = frameworkId;
  }
  if (prompt.category !== undefined) {
    gateCtx.category = prompt.category;
  }
  return gateCtx;
}
