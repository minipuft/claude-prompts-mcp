// @lifecycle canonical - Sole owner of "resolve a prompt id, then project it for the Workflow IR".
/**
 * One derivation of "does this prompt id resolve", for the callers that feed the Workflow IR.
 *
 * Three sites built the same lambda by hand — `RemainderProcessor.validate`,
 * `WorkflowCommandBuilder.build`, and `SymbolicCommandBuilder.buildSymbolicChain` — and two of
 * them carried a verbatim copy of the `WorkflowPromptInfo` projection. The projection is the part
 * that drifts: it decides what "required argument" means to the validator, and two copies of that
 * decision are two answers waiting to disagree.
 *
 * This lives in `engine/` rather than beside `modules/prompts/chain-step-resolution.ts` because
 * `engine/` may not value-import `modules/` ('engine-no-modules-or-mcp-value',
 * .dependency-cruiser.cjs). The chain-step resolver answers the same question over REGISTERED IDS
 * at the write, load and CI boundaries; this answers it over a loaded `ConvertedPrompt` collection
 * inside a run. Same question, two vocabularies, one per layer — not two derivations of one.
 */

import type { WorkflowPromptInfo } from '#modules/workflow-ir/types.js';
import type { ConvertedPrompt } from './types.js';

/** Resolve a prompt id to its loaded definition. `undefined` means the id does not exist. */
export type ConvertedPromptLookup = (promptId: string) => ConvertedPrompt | undefined;

/**
 * Exact-id lookup over a loaded collection.
 *
 * Map-backed rather than a linear `find`: a workflow submission resolves once per node, so the
 * scan a caller would otherwise repeat is quadratic in the node count.
 */
export function createConvertedPromptLookup(
  prompts: readonly ConvertedPrompt[]
): ConvertedPromptLookup {
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return (promptId) => byId.get(promptId);
}

/**
 * What the Workflow IR validator reads off a prompt — the whole projection, in one place.
 *
 * Module-private: `workflowPromptInfoLookup` is the surface. Exporting the projection alone would
 * let a caller re-pair it with its own lookup, which is the two-derivations shape this file exists
 * to remove.
 */
function toWorkflowPromptInfo(prompt: ConvertedPrompt): WorkflowPromptInfo {
  return {
    requiredArguments: prompt.arguments
      .filter((argument) => argument.required === true)
      .map((argument) => argument.name),
  };
}

/** Adapt a prompt lookup into the `WorkflowValidatorDeps.lookupPrompt` shape. */
export function workflowPromptInfoLookup(
  findPrompt: ConvertedPromptLookup
): (promptId: string) => WorkflowPromptInfo | undefined {
  return (promptId) => {
    const converted = findPrompt(promptId);
    return converted === undefined ? undefined : toWorkflowPromptInfo(converted);
  };
}
