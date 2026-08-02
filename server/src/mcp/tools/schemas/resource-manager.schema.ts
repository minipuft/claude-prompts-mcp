// @lifecycle canonical - Hand-written Zod schema for resource_manager MCP tool (SSOT for validation).
/**
 * Resource Manager Input Schema
 *
 * Hand-written replacement for the generated resourceManagerSchema in mcp-schemas.ts.
 * Uses .passthrough() to allow framework fields to flow through for advanced scenarios.
 */

import { z } from 'zod/v4';

import { ChainStepSchema } from '#modules/prompts/prompt-schema.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Resource Manager input schema.
 *
 * Unlike prompt_engine/system_control, resource_manager descriptions come from
 * the contract JSON and are not rebuilt per-framework at registration time.
 * The ToolDescriptionLoader handles framework overlay for the tool-level description.
 */
export const resourceManagerInputSchema = z
  .object({
    // ── Core parameters ──────────────────────────────────────────────────
    /** Type of resource to manage. Routes to appropriate handler. */
    resource_type: z.enum(['prompt', 'gate', 'framework', 'checkpoint']),
    /** Operation to perform. */
    action: z.enum([
      'create',
      'update',
      'delete',
      'reload',
      'list',
      'inspect',
      'analyze_type',
      'analyze_gates',
      'guide',
      'switch',
      'history',
      'rollback',
      'compare',
      'clear',
    ]),
    /** Resource identifier. Required for create, update, delete, inspect, reload, switch. */
    id: z.string().optional(),
    /** Human-friendly name for the resource (create/update). */
    name: z.string().optional(),
    /** Resource description explaining its purpose (create/update). */
    description: z.string().optional(),
    /** Filter list to enabled resources only. Default: true. */
    enabled_only: z.boolean().optional(),
    /** Safety confirmation for delete operation. */
    confirm: z.boolean().optional(),
    /** Audit reason for reload/delete/switch operations. */
    reason: z.string().trim().optional(),

    // ── Prompt parameters ────────────────────────────────────────────────
    /** [Prompt] Category tag for the prompt. */
    category: z.string().optional(),
    /** [Prompt] Prompt body/template with Nunjucks placeholders. */
    user_message_template: z.string().optional(),
    /** [Prompt] Optional system message for the prompt. */
    system_message: z.string().optional(),
    /** [Prompt] Argument definitions for the prompt. */
    arguments: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
        })
      )
      .optional(),
    /** [Prompt] Chain steps definition for multi-step prompts. */
    chain_steps: z.array(ChainStepSchema.passthrough()).optional(),
    /** [Prompt] Step-level operation for chain updates (default: replace entire array). */
    chain_step_operation: z.enum(['add', 'remove', 'reorder', 'replace']).optional(),
    /** [Prompt] Target index for add (insertion point) or remove (step to delete). */
    chain_step_index: z.number().int().nonnegative().optional(),
    /** [Prompt] Step definition for add operation. */
    chain_step_data: ChainStepSchema.passthrough().optional(),
    /** [Prompt] New index order for reorder operation (permutation of [0..n-1]). */
    chain_step_order: z.array(z.number().int().nonnegative()).optional(),
    /** [Prompt] Script tools to create with the prompt. */
    tools: z.array(z.unknown()).optional(),
    /** [Prompt] Gate configuration: include, exclude, framework_gates. */
    gate_configuration: z.record(z.string(), z.unknown()).optional(),
    /** [Prompt] Hint for execution type on creation. */
    execution_hint: z.enum(['single', 'chain']).optional(),
    /** [Prompt] List filter query. */
    filter: z.string().optional(),
    /** [Prompt] Output format for list/inspect. */
    format: z.enum(['table', 'json', 'text']).optional(),
    /** [Prompt] Detail level for list/inspect. */
    detail: z.enum(['summary', 'full']).optional(),
    /** [Prompt] Search query for filtering (list action). */
    search_query: z.string().optional(),

    // ── Gate parameters ──────────────────────────────────────────────────
    /** [Gate] Gate type: validation (pass/fail) or guidance (advisory). */
    gate_type: z.enum(['validation', 'guidance']).optional(),
    /** [Gate] Gate guidance content. */
    guidance: z.string().optional(),
    /** [Gate] Structured pass criteria definitions. */
    pass_criteria: z.array(z.unknown()).optional(),
    /** [Gate] Activation rules. */
    activation: z.record(z.string(), z.unknown()).optional(),
    /** [Gate] Retry configuration. */
    retry_config: z.record(z.string(), z.unknown()).optional(),

    // ── Framework parameters ─────────────────────────────────────────────
    /** [Framework] Framework type identifier (e.g. 'CAGEERF', 'ReACT'). */
    framework: z.string().optional(),
    /** [Framework] System prompt guidance injected when active. */
    system_prompt_guidance: z.string().optional(),
    /** [Framework] Phase definitions. */
    phases: z.array(z.unknown()).optional(),
    /** [Framework] Gate configuration: include, exclude arrays. */
    gates: z.record(z.string(), z.unknown()).optional(),
    /** [Framework] Tool description overlays when active. */
    tool_descriptions: z.record(z.string(), z.unknown()).optional(),
    /** [Framework] Whether the framework is enabled. */
    enabled: z.boolean().optional(),
    /** [Framework] For switch: persist the change to config. */
    persist: z.boolean().optional(),

    // ── Versioning parameters ────────────────────────────────────────────
    /** [Versioning] Target version number for rollback action. */
    version: z.number().optional(),
    /** [Versioning] Starting version number for compare action. */
    from_version: z.number().optional(),
    /** [Versioning] Ending version number for compare action. */
    to_version: z.number().optional(),
    /** [Versioning] Max versions to return in history. */
    limit: z.number().optional(),
    /** [Versioning] Skip auto-versioning on update. */
    skip_version: z.boolean().optional(),
  })
  .passthrough();

/** Inferred input type */
export type ResourceManagerInput = z.infer<typeof resourceManagerInputSchema>;
