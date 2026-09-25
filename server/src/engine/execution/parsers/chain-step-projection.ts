// @lifecycle canonical - Sole projection of a chain prompt's declared steps onto a parsed command.
/**
 * A chain prompt's `chainSteps` → `ParsedCommand.steps`, for every command source that names one.
 *
 * Before this module the projection lived inside `CommandParsingStage.buildDirectCommand`, so only
 * a bare `>>chain` ran its steps. `>>chain :: verify:"…"` (or any `::` gate) is a SYMBOLIC command,
 * and `SymbolicCommandBuilder.buildSingleSymbolicPrompt` never read `chainSteps`: the run still got
 * one node per step (stage 13 counts `convertedPrompt.chainSteps`), but every "step" rendered the
 * chain prompt's own template and no step gate ever applied (P6.74). One command source reached the
 * steps and another did not, and nothing failed when they diverged. Both now call this function.
 *
 * Pure: it reads the prompt, the run's processed arguments and a lookup, and returns a value. The
 * run's arguments are passed by reference on purpose — a step that declares no `args` shares the
 * run's object, so a caller that merges request `options`/`inputs` into it afterwards reaches that
 * step too, exactly as the direct path always behaved.
 */

import type { DeclaredRunBudget } from '#shared/types/chain-session.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type { ConvertedPrompt } from '../types.js';
import type { ConvertedPromptLookup } from '../workflow-prompt-lookup.js';

import { PromptError } from '#shared/utils/index.js';
import { mintNodeIds } from '#shared/utils/node-order.js';

/** The `ParsedCommand` fields a chain prompt's steps decide. */
export interface ChainPromptProjection {
  readonly commandType: 'chain';
  readonly steps: ChainStepPrompt[];
  readonly budget?: DeclaredRunBudget;
}

/**
 * Project `chainPrompt.chainSteps` into parsed chain steps, or `undefined` when the prompt declares
 * none (a single prompt). Throws `PromptError` when a step names a prompt the lookup cannot resolve.
 */
export function projectChainPromptSteps(
  chainPrompt: ConvertedPrompt,
  runArgs: Record<string, unknown>,
  findPrompt: ConvertedPromptLookup
): ChainPromptProjection | undefined {
  const chainSteps = chainPrompt.chainSteps;
  if (chainSteps === undefined || chainSteps.length === 0) {
    return undefined;
  }

  // Minted once per parse, in step order — explicit `id` wins, otherwise a slug of
  // `stepName` (P3 Tier 1, additive only: nothing downstream consumes this yet).
  const nodeIds = mintNodeIds(chainSteps);
  const steps = chainSteps.map((step, index) => {
    const stepConverted = findPrompt(step.promptId);
    if (stepConverted === undefined) {
      throw new PromptError(`Converted prompt data not found for chain step: ${step.promptId}`);
    }

    return {
      stepNumber: index + 1,
      nodeId: nodeIds[index],
      promptId: step.promptId,
      // Step-declared `args` OVERRIDE the run's invocation arguments for this step only
      // (Tier A). This is the third stripper on the YAML step path — its siblings are
      // `ChainStepSchema` (now derived from the one node schema) and
      // `yaml-prompt-loader.normalizeChainSteps` — and a field carried at fewer than all
      // three is silently dead (P6-F7).
      args: step.args != null ? { ...runArgs, ...step.args } : runArgs,
      variableName: step.stepName ?? `step_${index + 1}`,
      convertedPrompt: stepConverted,
      inputMapping: step.inputMapping,
      outputMapping: step.outputMapping,
      retries: step.retries,
      ...(step.subagentModel != null || stepConverted.subagentModel != null
        ? { subagentModel: step.subagentModel ?? stepConverted.subagentModel }
        : {}),
      ...(step.agentType != null || stepConverted.agentType != null
        ? { agentType: step.agentType ?? stepConverted.agentType }
        : {}),
      // Step-declared framework only. Unlike agentType/subagentModel above there is no
      // `stepConverted` fallback: the referenced prompt's own framework preference is already
      // read by `generateExecutionContext(step.convertedPrompt, …)`, so reading it here too
      // would promote a prompt-level preference into an explicit per-step OVERRIDE and let it
      // outrank the run-wide choice the user actually made.
      ...(step.framework != null ? { framework: step.framework } : {}),
      // Step-declared inline gate ids (P6 Tier 4, OQ-P6-8). This projection was the THIRD
      // and last stripper between chain-step authoring and runtime (P6-F7); its sibling in
      // `yaml-prompt-loader.normalizeChainSteps` is removed in the same change, because a
      // field carried at fewer than all three is silently dead.
      //
      // No fallback to `stepConverted.inlineGateIds`, unlike agentType/subagentModel above:
      // there is no prompt-level equivalent to fall back to, and the step's own declaration
      // is the whole binding. Reader: `GateEnhancementService.enhanceChainSteps`, which
      // feeds these to `GateSetResolver` at rank `inline-operator`.
      ...(step.inlineGateIds != null ? { inlineGateIds: [...step.inlineGateIds] } : {}),
      // Row A.2 (OQ-A2b): the two fields the `-->` surface always carried and the node
      // vocabulary did not declare. Same three-stripper rule as `inlineGateIds` above, and
      // the same no-`stepConverted`-fallback posture — `inlineGateCriteria` has no
      // prompt-level equivalent, and `delegated` is a declaration stage 06 normalizes.
      ...(step.inlineGateCriteria != null
        ? { inlineGateCriteria: [...step.inlineGateCriteria] }
        : {}),
      ...(step.delegated != null ? { delegated: step.delegated } : {}),
      // Tier 4: detached delegation. Third stripper for `await`, carried with the other two.
      ...(step.await != null ? { await: step.await } : {}),
      // Threaded, not consumed (P5 Tier 1): step-declared visibility policy, carried through
      // to the parse-time step list so it survives blueprint clone / cold-load round-trips.
      ...(step.visibility != null ? { visibility: step.visibility } : {}),
    } as ChainStepPrompt;
  });

  // Tier A: a YAML chain's declared budget reaches the run through the same field a
  // submitted Workflow IR's does (`WorkflowCommandBuilder` sets it from `compileBudget`), so
  // every downstream reader of `parsedCommand.budget` — the P4 adaptive-mutation ceiling
  // today — serves both inputs with one code path.
  return {
    commandType: 'chain',
    steps,
    ...(chainPrompt.budget !== undefined ? { budget: chainPrompt.budget } : {}),
  };
}
