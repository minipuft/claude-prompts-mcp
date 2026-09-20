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
 * Why this request sends a parameter the resource type does not read, or `null` when it does not.
 *
 * Returns the message rather than a boolean for the reason `describePreviewRefusal` does: the
 * caller needs the parameter's name and its real owners, not "invalid".
 *
 * Only the FIRST offending parameter is named. A caller who sent two wrong-type parameters almost
 * always sent them for one wrong reason, and naming all of them buries the correction.
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

  return null;
}
