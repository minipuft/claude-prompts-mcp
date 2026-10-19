// @lifecycle canonical - Types for unified resource manager.
/**
 * Unified Resource Manager Types
 *
 * Defines the types for the unified resource_manager MCP tool
 * that routes to prompt, gate, and framework handlers.
 */

import type { Logger, ToolResponse } from '#shared/types/index.js';
import type { CategoryToolHandler } from '../../category-manager/index.js';
import type { FrameworkToolHandler } from '../../framework-manager/index.js';
import type { GateToolHandler } from '../../gate-manager/index.js';
import type { ResourceManagerInput } from '../../schemas/resource-manager.schema.js';

export type { ResourceManagerInput };

/**
 * One script tool to create with a prompt (`tools`), as the schema checked it. `planToolFiles`
 * writes it to `tools/{id}/`: `tool.yaml`, `schema.json` when `schema` is given, and the script.
 */
export type ToolDefinitionInput = NonNullable<ResourceManagerInput['tools']>[number];

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
 * What a prompt-domain processor receives.
 *
 * The router dispatches on `resource_type` and does not pass it on, so the prompt handler's own
 * argument object carries every `ResourceManagerInput` field EXCEPT that one. Processors were
 * typed `args: any` for exactly this reason — `ResourceManagerInput` did not describe what they
 * are handed. Naming the difference is what lets the versioning processors declare a real
 * signature.
 */
export type PromptResourceInput = Omit<ResourceManagerInput, 'resource_type'>;

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
  categoryManager: CategoryToolHandler;
}

/**
 * Validation result for action/resource_type combination
 */
export interface ActionValidationResult {
  valid: boolean;
  error?: string;
}
