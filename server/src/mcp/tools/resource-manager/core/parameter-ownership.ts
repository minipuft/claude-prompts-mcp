// @lifecycle canonical - Which resource types READ each resource_manager parameter.
/**
 * A parameter accepted for a type that ignores it is a silent no-op.
 *
 * `resource_manager` publishes ONE flat schema for four resource types, so every parameter is
 * accepted for every type at the boundary and the router decides which ones reach a handler.
 * Where the router forwards a parameter to a subset of the four, the other types accept it,
 * drop it, write nothing for it, and answer `updated successfully` — measured 2026-09-19:
 * `resource_type:"framework"` + `unset:["description"]` replied success, saved version 2, and
 * left `framework.yaml` byte-identical. `gate` and `category` did the same.
 *
 * This is the same defect `describePreviewRefusal` was written for (`shared/preview-action.ts`):
 * `dry_run` was accepted on gate and framework `update`, where nothing read it, so a preview
 * performed the mutation. That fix enumerated one parameter's supported pairs. This table
 * enumerates the whole class — every type-specific parameter, and the types that read it — so a
 * new parameter cannot join the class without being classified here.
 *
 * Not a guard where the defect lives: the defect is the ACCEPTANCE, and the refusal stands at the
 * router before dispatch, ahead of any write or version snapshot.
 */

import type { ResourceType } from './types.js';

/**
 * Parameters every route reads. Listed rather than implied, so the completeness check can say
 * "this new parameter is unclassified" instead of silently treating it as common.
 *
 * `resource_type` is the router's own dispatch key and never reaches a handler; it is common in
 * the only sense that matters here — no type ignores it.
 */
export const COMMON_PARAMETERS: ReadonlySet<string> = new Set<string>([
  'resource_type',
  'action',
  'id',
  'name',
  'description',
  'confirm',
  'reason',
  'source_workspace',
  'preview_action',
  'version',
  'from_version',
  'to_version',
  'limit',
  'skip_version',
]);

/**
 * Every type-specific parameter → the resource types whose router branch forwards it.
 *
 * The owner list is what the refusal message quotes, so it is also the documentation: a reader
 * told `unset` belongs to "prompt" learns where to send it, not merely that they were wrong.
 */
export const PARAMETER_OWNERS: Readonly<Record<string, readonly ResourceType[]>> = {
  // Prompt-only authoring, discovery and concurrency parameters.
  full_restart: ['prompt'],
  goal: ['prompt'],
  include_legacy: ['prompt'],
  category: ['prompt'],
  user_message_template: ['prompt'],
  system_message: ['prompt'],
  arguments: ['prompt'],
  argument_updates: ['prompt'],
  patch: ['prompt'],
  unset: ['prompt'],
  tool_operation: ['prompt'],
  tool_ids: ['prompt'],
  chain_steps: ['prompt'],
  chain_step_operation: ['prompt'],
  chain_step_index: ['prompt'],
  chain_step_data: ['prompt'],
  chain_step_order: ['prompt'],
  edges: ['prompt'],
  budget: ['prompt'],
  artifacts: ['prompt'],
  tools: ['prompt'],
  gate_configuration: ['prompt'],
  composer: ['prompt'],
  injection: ['prompt'],
  subagent_model: ['prompt'],
  agent_type: ['prompt'],
  execution_hint: ['prompt'],
  filter: ['prompt'],
  detail: ['prompt'],
  search_query: ['prompt'],
  expected_version: ['prompt'],

  // Two keys a prompt and a category each own in their own file (`prompt.yaml` /
  // `category.yaml`). A gate or framework has no MCP registration to describe.
  register_with_mcp: ['prompt', 'category'],
  mcp_prompt_mode: ['prompt', 'category'],

  // Gate authoring.
  type: ['gate'],
  gate_type: ['gate'],
  subject: ['gate'],
  severity: ['gate'],
  enforcement_mode: ['gate'],
  guidance: ['gate'],
  pass_criteria: ['gate'],
  activation: ['gate'],
  retry_config: ['gate'],

  // Framework authoring.
  framework: ['framework'],
  system_prompt_guidance: ['framework'],
  phases: ['framework'],
  gates: ['framework'],
  tool_descriptions: ['framework'],
  enabled: ['framework'],
  persist: ['framework'],
  framework_gates: ['framework'],
  template_suggestions: ['framework'],
  framework_elements: ['framework'],
  argument_suggestions: ['framework'],
  judge_prompt: ['framework'],
  processing_steps: ['framework'],
  execution_steps: ['framework'],
  execution_type_enhancements: ['framework'],
  template_enhancements: ['framework'],
  execution_flow: ['framework'],
  quality_indicators: ['framework'],

  // Only gate and framework carry an enable/disable bit, so only their listings can filter on it.
  enabled_only: ['gate', 'framework'],
};

/**
 * Every parameter `resource_manager` declares — the two tables above, unioned.
 *
 * The same set `tests/unit/mcp-tools/resource-manager/parameter-ownership.test.ts` already pins
 * against `resourceManagerInputSchema.shape` in both directions, and
 * `tests/unit/mcp-tools/tool-input-fields.test.ts` pins that shape against
 * `tooling/contracts/resource-manager.json`. So this set IS the contract, reached without
 * importing the schema into the router's own module.
 */
export const DECLARED_PARAMETERS: ReadonlySet<string> = new Set<string>([
  ...COMMON_PARAMETERS,
  ...Object.keys(PARAMETER_OWNERS),
]);

/**
 * Why this request sends a parameter this tool will not read, or `null` when it does not.
 *
 * TWO halves of one class, in one function because they are one question — "will anything read
 * this key?" — and a caller should not have to discover which half caught them:
 *
 *   1. DECLARED but owned by other resource types (#337). The key is real; the type is wrong.
 *   2. UNDECLARED entirely (R46). `resourceManagerInputSchema` is `.passthrough()`, so a key the
 *      contract never named arrives intact, is read by nobody, and the call answers success — the
 *      same silent no-op #337 closed for half the class and left open for the other half.
 *      Measured 2026-09-20 on a server built before P4.65: `update` carrying `edges` answered
 *      "Prompt Updated", saved version 2, and left the file byte-identical.
 *
 * The passthrough is now load-bearing FOR the refusal rather than in spite of it: a `.strict()`
 * schema would reject the key at the SDK boundary with a zod message that names no resource type
 * and offers no correction, and it would put the second refusal path this function exists to
 * avoid one layer above the first. Its original justification — eleven framework advanced fields
 * that rode it undeclared — was closed at P4.1/P4.5 when all eleven were declared.
 *
 * Returns the message rather than a boolean for the reason `describePreviewRefusal` does: the
 * caller needs the parameter's name, not "invalid".
 *
 * Only the FIRST offending parameter is named. A caller who sent two wrong parameters almost
 * always sent them for one wrong reason, and naming all of them buries the correction. The
 * undeclared half deliberately lists nothing else: dumping seventy declared names to correct one
 * typo is noise, and the contract is one `action:"guide"` away.
 */
export function describeParameterRefusal(resourceType: ResourceType, args: object): string | null {
  // `args` is the validated tool input, an interface without an index signature. The lookup is
  // keyed by this table, never by caller-supplied text, so the widening reads nothing the schema
  // did not declare.
  const sent = args as Record<string, unknown>;

  for (const [parameter, owners] of Object.entries(PARAMETER_OWNERS)) {
    if (sent[parameter] === undefined) continue;
    if (owners.includes(resourceType)) continue;

    const ownerList = owners.map((owner) => `"${owner}"`).join(' and ');
    return (
      `'${parameter}' is not a parameter of resource_type:"${resourceType}" — it is read only ` +
      `by resource_type:${ownerList}.\n\n` +
      `It was accepted and ignored before, which reported a change that never happened. ` +
      `Re-send it with resource_type:${ownerList}, or drop it from this call.`
    );
  }

  for (const parameter of Object.keys(sent)) {
    if (DECLARED_PARAMETERS.has(parameter)) continue;
    // "Was it sent", the same test the loop above applies — not "is the key present". JSON has no
    // `undefined`, so nothing over MCP reaches here this way; an in-process caller building its
    // argument object with an unset optional field does, and refusing that would be refusing a
    // key nobody sent. A JSON `null` is still a value, and is still refused.
    if (sent[parameter] === undefined) continue;

    return (
      `'${parameter}' is not a parameter of resource_manager.\n\n` +
      `It was accepted and ignored before, which reported a change that never happened. ` +
      `Check the spelling, or drop it from this call — ` +
      `\`resource_type:"prompt", action:"guide"\` lists what this tool accepts.`
    );
  }

  return null;
}
