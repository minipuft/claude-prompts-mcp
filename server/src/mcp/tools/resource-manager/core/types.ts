// @lifecycle canonical - Types for unified resource manager.
/**
 * Unified Resource Manager Types
 *
 * Defines the types for the unified resource_manager MCP tool
 * that routes to prompt, gate, and framework handlers.
 */

import type {
  ArgumentValidationYaml,
  PromptInjectionConfigYaml,
} from '#modules/prompts/prompt-schema.js';
import type { Logger, ToolResponse } from '#shared/types/index.js';
import type {
  FrameworkManagerInput,
  FrameworkGate,
  TemplateSuggestion,
  FrameworkElements,
  ArgumentSuggestion,
  ProcessingStep,
  ExecutionStep,
  ExecutionTypeEnhancements,
  TemplateEnhancements,
  ExecutionFlow,
  QualityIndicators,
} from '../../framework-manager/core/types.js';
import type { FrameworkToolHandler } from '../../framework-manager/index.js';
import type { GateManagerInput } from '../../gate-manager/core/types.js';
import type { GateToolHandler } from '../../gate-manager/index.js';
import type { PreviewableAction } from '../../shared/preview-action.js';
import type { PromptArgumentUpdate } from '../prompt/operations/argument-updates.js';
import type { TemplatePatchOperation } from '../prompt/operations/template-patch.js';

/**
 * Script tool definition for inline tool creation
 */
export interface ToolDefinitionInput {
  /** Tool identifier (becomes directory name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool description */
  description?: string;
  /** Script content (written to script.py/js/sh) */
  script: string;
  /** Script runtime: python, node, shell, or auto (default: auto) */
  runtime?: 'python' | 'node' | 'shell' | 'auto';
  /** JSON Schema for input validation */
  schema?: Record<string, unknown>;
  /** Trigger mode: schema_match (default), explicit, always, never */
  trigger?: 'schema_match' | 'explicit' | 'always' | 'never';
  /** Require user confirmation before execution */
  confirm?: boolean;
  /** Strict mode: require ALL params vs ANY params */
  strict?: boolean;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Resource types supported by the unified manager
 */
export type ResourceType = 'prompt' | 'gate' | 'framework';

/**
 * All possible actions across resource types
 */
export type ResourceAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'validate' // prompt only, non-mutating draft validation
  | 'preview' // names its target in `preview_action`; never writes
  | 'reload'
  | 'analyze_type' // prompt only
  | 'analyze_gates' // prompt only
  | 'guide' // prompt only
  | 'switch' // framework only
  | 'history' // versioning (all types)
  | 'rollback' // versioning (all types)
  | 'compare'; // versioning (all types)

/**
 * Actions specific to certain resource types
 */
/**
 * Actions that destroy or overwrite operator-authored state and therefore require `confirm: true`.
 *
 * One registry, checked once before dispatch. Until this existed the same guard was hand-written
 * in six processors in two idioms (`!confirm` and `confirm !== true`), which is six places to
 * forget it — and `system_control`'s `session clear` shows what forgetting looks like.
 *
 * SCOPE: `resource_manager` only. `system_control` is a separate tool with its own action
 * vocabulary and its own three hand-written guards; it is NOT covered here. See the
 * consolidation plan's OQ-A2 before widening this — adding a confirmation requirement to an
 * action that never had one changes behaviour for existing callers.
 *
 * `reload` is deliberately absent: it re-reads from disk and destroys nothing.
 *
 * `preview` is absent for the same reason, and that absence is the whole point of it being an
 * action. While previewing was `dry_run: true` on `delete`, this guard saw `delete` and demanded
 * `confirm: true` — so seeing what a deletion would cost required confirming the deletion. A
 * membership test cannot get that backwards; a second condition on a boolean could.
 */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<ResourceAction> = new Set<ResourceAction>([
  'delete',
  'rollback',
]);

/**
 * `<resource_type>:<action>` pairs whose refusal carries information the router does not have, so
 * the handler owns the guard and the pre-dispatch check stands down for them.
 *
 * Exactly one entry, and it earns its place: `prompt delete` computes the set of prompts that
 * reference the target and names them in the refusal, so the operator learns what would break
 * before deciding. The router has no view of the prompt dependency graph, so guarding here would
 * replace a specific refusal with a generic one — a downgrade wearing the shape of consolidation.
 *
 * This is a bypass list, so it must not grow quietly. A new entry needs the same test: does the
 * handler's refusal tell the caller something the router cannot? "The message is nicer" does not
 * qualify. Every entry is covered by a handler-level test asserting the guard still refuses.
 */
export const HANDLER_OWNED_CONFIRMATION: ReadonlySet<string> = new Set<string>(['prompt:delete']);

/**
 * Actions that may read version history from a workspace other than this one.
 *
 * Reads only, and named as a set so the router's refusal message enumerates itself — a second list
 * in the message text is a second thing to forget to update. `rollback` is deliberately absent:
 * see the router's cross-workspace guard for why it refuses rather than ignores.
 */
export const CROSS_WORKSPACE_READ_ACTIONS: ReadonlySet<ResourceAction> = new Set<ResourceAction>([
  'history',
  'compare',
]);

export const PROMPT_ONLY_ACTIONS: ResourceAction[] = [
  'validate',
  'analyze_type',
  'analyze_gates',
  'guide',
];
export const FRAMEWORK_ONLY_ACTIONS: ResourceAction[] = ['switch'];
export const VERSIONING_ACTIONS: ResourceAction[] = ['history', 'rollback', 'compare'];
export const COMMON_ACTIONS: ResourceAction[] = [
  'create',
  'update',
  'delete',
  'list',
  'inspect',
  'preview',
  'reload',
  'history',
  'rollback',
  'compare',
];

/**
 * Unified input for the resource_manager tool
 */
type GatePassCriteria = NonNullable<GateManagerInput['pass_criteria']>[number];
type FrameworkPhase = NonNullable<FrameworkManagerInput['phases']>[number];
type FrameworkToolDescriptions = NonNullable<FrameworkManagerInput['tool_descriptions']>;

/**
 * What a prompt-domain processor receives.
 *
 * The router dispatches on `resource_type` and does not pass it on, so the prompt handler's own
 * argument object carries every field below EXCEPT that one. Processors were typed `args: any`
 * for exactly this reason — `ResourceManagerInput` did not describe what they are handed. Naming
 * the difference is what lets the versioning processors declare a real signature.
 */
export type PromptResourceInput = Omit<ResourceManagerInput, 'resource_type'>;

export interface ResourceManagerInput {
  // Router parameter (REQUIRED - validated by Zod schema)
  resource_type: ResourceType;

  // Action (REQUIRED - validated by Zod schema)
  action: ResourceAction;

  // Common parameters
  id?: string;
  name?: string;
  description?: string;
  enabled_only?: boolean;
  confirm?: boolean;
  reason?: string;

  // Prompt-specific parameters
  category?: string;
  user_message_template?: string;
  system_message?: string;
  /**
   * Kept in lockstep with the `arguments` member of `resourceManagerInputSchema` and with
   * `PromptArgumentSchema` (prompt-schema.ts). `type` narrows to the loader's five-value
   * vocabulary rather than `string`: the schema now rejects anything else, so a wider type here
   * would describe values that can no longer arrive.
   */
  arguments?: Array<{
    name: string;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    required?: boolean;
    defaultValue?: unknown;
    validation?: ArgumentValidationYaml;
  }>;
  /** [Prompt] Explicit mapping from a client composer draft to a declared text argument. */
  composer?: { inputArgument: string };
  /**
   * [Prompt] Update-only structured per-field overlay onto EXISTING arguments, addressed by
   * `name` (Fix D, tier-b-settability-proposal §2 / P6-F16). Kept in lockstep with the
   * `argument_updates` member of `resourceManagerInputSchema`; the element type is the merge
   * applier's own (`PromptArgumentUpdate`), so a change there cannot leave this layer describing a
   * different shape.
   */
  argument_updates?: PromptArgumentUpdate[];
  /**
   * [Prompt] Anchored replacements applied to a prompt's text bodies. Kept in lockstep with the
   * `patch` member of `resourceManagerInputSchema`; the operation type is the applier's own, so a
   * change to `TemplatePatchOperation` cannot leave this layer describing a different shape.
   */
  patch?: TemplatePatchOperation[];
  /**
   * What `action: 'preview'` would do. Required with that action and refused without it.
   *
   * Which pairs are previewable is per resource type — `PREVIEWABLE_ACTIONS_BY_TYPE` owns that,
   * and the router refuses the rest by name.
   */
  preview_action?: PreviewableAction;
  /**
   * [Prompt] Update-only: tool parameter names whose fields this call CLEARS (P2.1). Kept in
   * lockstep with the `unset` member of `resourceManagerInputSchema`; the accepted vocabulary is
   * `UNSETTABLE_FIELDS`, which `resolveUnsetFields` validates against.
   */
  unset?: string[];
  /**
   * Workspace whose version history to READ, when it is not this one.
   *
   * Read-only and scope-local-on-write: honoured by `history` and `compare`, rejected by
   * `rollback`. See the router's cross-workspace guard.
   */
  source_workspace?: string;
  chain_steps?: Array<Record<string, unknown>>;
  /** [Prompt] Step-level operation for chain updates; omit to replace the entire array */
  chain_step_operation?: 'add' | 'remove' | 'reorder' | 'update';
  /** [Prompt] Target index for add (insertion point) or remove (step to delete) */
  chain_step_index?: number;
  /** [Prompt] Step definition for add operation */
  chain_step_data?: Record<string, unknown>;
  /** [Prompt] New index order for reorder operation */
  chain_step_order?: number[];
  /** [Prompt] Script tools to create with the prompt */
  tools?: ToolDefinitionInput[];
  /** [Prompt] Update-only: union with the current binding (`add`) or unbind and delete (`remove`). */
  tool_operation?: 'add' | 'remove';
  /** [Prompt] Tool ids to unbind and delete; required by `tool_operation: 'remove'`. */
  tool_ids?: string[];
  gate_configuration?: {
    include?: string[];
    exclude?: string[];
    framework_gates?: boolean;
  };
  /**
   * Prompt-level fields the YAML writer preserves rather than builds (OQ-P7-8 plus composer
   * metadata). Kept in
   * lockstep with `resourceManagerInputSchema` and with `PromptYamlSchema` — the value is written
   * verbatim into `prompt.yaml`, so a wider type here would describe values the loader rejects.
   * `register_with_mcp` and `mcp_prompt_mode` freeze the prompt against its category/global
   * default once set; see the schema for the operator-facing statement of that.
   */
  injection?: PromptInjectionConfigYaml;
  register_with_mcp?: boolean;
  mcp_prompt_mode?: 'expand' | 'launch';
  subagent_model?: 'heavy' | 'standard' | 'fast';
  agent_type?: string;
  execution_hint?: 'single' | 'chain';
  is_chain?: boolean;
  full_restart?: boolean;
  filter?: string;
  format?: 'table' | 'json' | 'text';
  detail?: 'summary' | 'full';
  search_query?: string;

  // Gate-specific parameters
  gate_type?: 'validation' | 'guidance';
  guidance?: string;
  pass_criteria?: Array<string | GatePassCriteria>;
  activation?: {
    prompt_categories?: string[];
    frameworks?: string[];
    explicit_request?: boolean;
  };
  retry_config?: {
    max_attempts?: number;
    improvement_hints?: boolean | string[];
    preserve_context?: boolean;
  };

  // Framework-specific parameters
  framework?: string;
  system_prompt_guidance?: string;
  phases?: FrameworkPhase[];
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  tool_descriptions?: Record<string, string | FrameworkToolDescriptions[string]>;
  enabled?: boolean;
  persist?: boolean;

  // Advanced framework parameters (not advertised for token efficiency)
  framework_gates?: FrameworkGate[];
  template_suggestions?: TemplateSuggestion[];
  framework_elements?: FrameworkElements;
  argument_suggestions?: ArgumentSuggestion[];
  judge_prompt?: string;

  // Advanced phases parameters
  processing_steps?: ProcessingStep[];
  execution_steps?: ExecutionStep[];
  execution_type_enhancements?: ExecutionTypeEnhancements;
  template_enhancements?: TemplateEnhancements;
  execution_flow?: ExecutionFlow;
  quality_indicators?: QualityIndicators;

  // Versioning parameters
  /** [Versioning] Target version for rollback action */
  version?: number;
  /** [Versioning] Starting version for compare action */
  from_version?: number;
  /** [Versioning] Ending version for compare action */
  to_version?: number;
  /** [Versioning] Max versions to return in history. Default: 10 */
  limit?: number;
  /** [Versioning] Skip auto-versioning for this update */
  skip_version?: boolean;
  /** [Prompt update] Refuse unless this is still the current recorded version. */
  expected_version?: number;
}

/**
 * Interface for prompt resource service (breaks concrete import cycle).
 * The concrete PromptResourceHandler in ../prompt/ implements this.
 */
export interface PromptResourceHandlerPort {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleAction(args: { action: string; [key: string]: any }, extra: any): Promise<ToolResponse>;
}

/**
 * Dependencies for the ResourceManagerRouter
 */
export interface ResourceManagerDependencies {
  logger: Logger;
  promptResourceHandler: PromptResourceHandlerPort;
  gateManager: GateToolHandler;
  frameworkManager: FrameworkToolHandler;
}

/**
 * Validation result for action/resource_type combination
 */
export interface ActionValidationResult {
  valid: boolean;
  error?: string;
}
