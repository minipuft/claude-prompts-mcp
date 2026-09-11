// @lifecycle canonical - Types for category manager MCP tool.
/**
 * Category Manager Types
 */

import type { ConfigManager, Logger } from '#shared/types/index.js';

/**
 * Category manager action identifiers.
 *
 * The same ten `COMMON_ACTIONS` gate and framework answer — deliberately not a subset. A
 * resource type that accepts `create` and refuses `history` is a surface a caller has to learn
 * by provoking refusals, and `COMMON_ACTIONS` is what the router lets through by default, so a
 * missing case here becomes an "Unknown action" rather than a designed refusal.
 */
export type CategoryManagerActionId =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'preview'
  | 'reload'
  | 'history'
  | 'rollback'
  | 'compare';

/**
 * Category manager input parameters.
 *
 * Every member is an EXISTING `resource_manager` parameter under the same name. Nothing new was
 * published for this resource type: `id`, `name` and `description` are the common trio, and
 * `register_with_mcp` / `mcp_prompt_mode` already existed for prompts — where they FREEZE the
 * prompt against its category, which only means something because the category level is the
 * layer this handler makes authorable.
 */
export interface CategoryManagerInput {
  action: CategoryManagerActionId;
  /** Category id. The DIRECTORY name under the prompts root, which is what the loader reads. */
  id?: string;
  /** Display name. Absent from `category.yaml`, `loader.ts` derives one from the id. */
  name?: string;
  /** Description. Absent from `category.yaml`, `loader.ts` derives `Prompts in the <id> category`. */
  description?: string;
  /**
   * MCP registration default for prompts in this category. Reaches `category.yaml` through
   * `PRESERVED_CATEGORY_YAML_KEYS`: supplied it is written, omitted it is carried forward from
   * the existing file, so an update never silently strips a hand-authored value.
   */
  registerWithMcp?: boolean;
  /** Native MCP prompt behaviour default for prompts in this category. Same preservation path. */
  mcpPromptMode?: 'expand' | 'launch';
  confirm?: boolean;
  /**
   * What `action: 'preview'` would do.
   *
   * `delete` or `rollback`, matching gate and framework. `update` is deliberately absent for the
   * same reason it is for those two: no category update path reads a preview flag, so accepting
   * it would perform the update. The router refuses it by name.
   */
  preview_action?: 'delete' | 'rollback';
  /** Workspace whose version history to READ. Honoured by `history`/`compare`. */
  source_workspace?: string;
  reason?: string;
  /** Skip automatic version saving for this update */
  skip_version?: boolean;
  /** Target version for rollback action */
  version?: number;
  /** Starting version for compare action */
  from_version?: number;
  /** Ending version for compare action */
  to_version?: number;
  /** Maximum number of versions to show in history */
  limit?: number;
}

/**
 * Dependencies for category manager.
 *
 * `onRefresh` is the registration route, not a courtesy. It resolves to the application's full
 * server refresh, which re-walks every prompt root and rebuilds the `Category[]` it publishes —
 * so for categories, exactly as for prompts and unlike gates and frameworks, the full refresh IS
 * the registry update. `validate:registry-coherence` carries that statement as a declared rule
 * rather than leaving it to be inferred from the absence of a per-id reload.
 */
export interface CategoryManagerDependencies {
  logger: Logger;
  configManager: ConfigManager;
  onRefresh?: () => Promise<void>;
}

/**
 * What the writer takes: the resolved `category.yaml` document.
 *
 * `id` is present and required even though the LOADER ignores it — the directory name is what
 * names a category at load. It is written anyway because `CategorySchema` requires it and
 * because a file that does not say what it is cannot be validated against its own directory;
 * `validateCategorySchema(doc, id)` is what refuses a document whose `id` has drifted.
 */
export interface CategoryCreationData {
  id: string;
  name: string;
  description: string;
  /**
   * Keys `buildCategoryYaml` builds no value for, carried here under their `category.yaml`
   * spelling so `resolvePreservedCategoryYamlFields` finds a supplied value by the same name it
   * preserves. Mirrors `GateCreationData`'s tail exactly.
   */
  registerWithMcp?: boolean | undefined;
  mcpPromptMode?: 'expand' | 'launch' | undefined;
}
