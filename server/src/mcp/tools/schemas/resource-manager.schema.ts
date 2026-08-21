// @lifecycle canonical - Hand-written Zod schema for resource_manager MCP tool (SSOT for validation).
/**
 * Resource Manager Input Schema
 *
 * Hand-written replacement for the generated resourceManagerSchema in mcp-schemas.ts.
 * Uses .passthrough() to allow framework fields to flow through for advanced scenarios.
 */

import { z } from 'zod/v4';

import { PATCH_TARGET_FIELDS } from '../resource-manager/prompt/operations/template-patch.js';

import {
  ArgumentValidationSchema,
  ChainStepSchema,
  PromptComposerMetadataSchema,
  PromptInjectionConfigSchema,
} from '#modules/prompts/prompt-schema.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * One argument definition/overlay — shared by `arguments` (full replace) and `argument_updates`
 * (Fix D per-field overlay by `name`, tier-b-settability-proposal §2). `name` is required in both
 * uses (authored identity for `arguments`, the match key for `argument_updates`); every other
 * field is optional in both — a full `arguments` entry may omit a field just as an overlay may.
 * Mirrors `PromptArgumentSchema` (prompt-schema.ts) field for field, deliberately — see the
 * `arguments` parameter comment below for why every field stays optional rather than defaulted.
 */
const promptArgumentSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  /**
   * Also the switch that arms required-enforcement: `ArgumentParser.enrichResult` runs schema
   * validation (which is what throws on a missing required argument) only when some argument
   * declares `minLength`/`maxLength`/`pattern`. Unsettable through the tool until now, so a
   * tool-authored `required: true` had no reachable enforcement path.
   */
  validation: ArgumentValidationSchema.optional(),
});

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
    resource_type: z.enum(['prompt', 'gate', 'framework']),
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
    ]),
    /** Resource identifier. Required for create, update, delete, inspect, reload, switch. */
    id: z.string().optional(),
    /** Human-friendly name for the resource (create/update). */
    name: z.string().optional(),
    /** Resource description explaining its purpose (create/update). */
    description: z.string().optional(),
    /** Filter list to enabled resources only. Default: true. */
    enabled_only: z.boolean().optional(),
    /**
     * Required `true` for destructive actions: `delete` and `rollback`. Both refuse without it.
     * Delete cannot be undone — rollback cannot restore a deleted prompt.
     */
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
    /**
     * [Prompt] Argument definitions for the prompt.
     *
     * Mirrors `PromptArgumentSchema` (prompt-schema.ts) field for field, deliberately. Until
     * 2026-08-12 this accepted only `{name, type, description}`, all three required, with `type`
     * as a free `z.string()`. Zod strips unknown keys, so `required`, `defaultValue` and
     * `validation` were discarded at the FIRST boundary — before the router, the processor or the
     * writer ever saw them. The contract (`resource-manager.json`), `core/types.ts` and the loader
     * all already declared `required`; this schema was the one layer that did not, which is why a
     * prompt authored through the tool could never carry it (P7-D1).
     *
     * Every field stays OPTIONAL rather than mirroring the loader's `required: z.boolean()
     * .default(false)`. A default here would materialise `required: false` into the YAML of every
     * argument on every update — writing a default is the failure mode the widening exists to
     * avoid. The loader applies the default at load time, where it belongs.
     *
     * Explicit fields, not `.passthrough()` (OQ-P7-2). The sibling `chain_steps` ten lines below
     * IS passthrough because a step is an opaque object; an argument is a typed contract, and
     * passthrough would admit arbitrary keys into persisted YAML.
     *
     * The element shape is shared with `argument_updates` below (Fix D,
     * tier-b-settability-proposal §2) via `promptArgumentSchema` — `name` is required in both
     * uses (authored identity here, match key there) and every other field is optional in both.
     */
    arguments: z.array(promptArgumentSchema).optional(),
    /** [Prompt] Explicit mapping from a client composer draft to a declared text argument. */
    composer: PromptComposerMetadataSchema.optional(),
    /**
     * [Prompt] Update-only structured per-field overlay onto EXISTING arguments, addressed by
     * `name` (Fix D, tier-b-settability-proposal §2 / P6-F16). `name` must match an argument this
     * prompt already declares — there is no upsert, so adding/removing/renaming an argument still
     * requires the full `arguments` array. Every other field overlays onto the matched entry only
     * when supplied; an omitted field leaves that entry's existing value untouched. Mutually
     * exclusive with `arguments` in the same call — both would make the result depend on an
     * evaluation order the caller cannot see. Rejected on `create` (nothing exists yet to overlay
     * onto). `dry_run` previews it like any other update.
     */
    argument_updates: z.array(promptArgumentSchema).optional(),
    /**
     * [Prompt] Anchored replacements applied server-side to a prompt's text bodies (P7 Tier 3).
     *
     * Additive union member — a caller that never sends `patch` sees the previous behaviour
     * unchanged. Operations apply IN ORDER, each against the previous one's output. `old_string`
     * must match exactly and (without `replace_all`) uniquely; an ambiguous anchor is a typed
     * rejection rather than a best-effort edit. `field` names a tool parameter, and the vocabulary
     * comes from `PATCH_TARGET_FIELDS` so the schema cannot drift from the applier.
     */
    patch: z
      .array(
        z.object({
          field: z.enum(PATCH_TARGET_FIELDS),
          old_string: z.string().min(1),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
        })
      )
      .optional(),
    /**
     * [Prompt] Render and diff the update without writing it — no file change, no version row.
     * Applies to a full update as well as a patch; it is how an operator confirms an anchor
     * matched before spending a version.
     */
    dry_run: z.boolean().optional(),
    /**
     * Read version history belonging to a DIFFERENT workspace.
     *
     * `state.db` is one file shared by every project on the machine, isolated by workspace id
     * alone — so another checkout's history is already present and merely filtered out. Valid on
     * `history` and `compare` only. `rollback` REJECTS it rather than ignoring it: a snapshot from
     * another workspace describes files that may not exist here, and silently scoping the
     * parameter back to local would leave the caller believing they had restored it.
     */
    source_workspace: z.string().min(1).optional(),
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
    // ── Prompt parameters the writer preserves rather than builds (OQ-P7-8) ─────
    //
    // Tier 1 made these five SURVIVE an update by reading them off the on-disk `prompt.yaml`
    // (`PRESERVED_PROMPT_YAML_KEYS`), which left them authorable only by hand — a state the
    // project's MCP-tooling-only constraint forbids (P7-F7). Owner ruling 2026-08-13: all five
    // become settable. Additive union members, non-breaking per the Public API Contract.
    //
    // Every shape here mirrors `PromptYamlSchema` (prompt-schema.ts:465-487) exactly — same
    // optionality, same enum members — because the value goes straight into the YAML the loader
    // reads back. A wider shape tool-side would be accepted at the call and rejected at load.
    //
    // Parameter names are the snake_case form of the YAML keys, matching the 70/70 snake_case
    // convention across every tool contract; `UPDATE_FIELDS` owns the one mapping, exactly as it
    // already does for `gate_configuration` → `gateConfiguration`.
    /**
     * [Prompt] Prompt-level injection control. Resolved between step and chain config: a prompt's
     * declaration about itself outranks the chain or category it runs inside. Omitting this leaves
     * whatever the file declares untouched.
     */
    injection: PromptInjectionConfigSchema.optional(),
    /**
     * [Prompt] Whether this prompt registers as a native MCP prompt.
     *
     * FREEZE HAZARD: this value is resolved through prompt → category → global → default `true`,
     * and setting it writes an explicit prompt-level value that outranks all three PERMANENTLY —
     * the prompt stops following any later change to the category or global default. Omit it
     * unless this prompt specifically needs to differ from its category.
     */
    register_with_mcp: z.boolean().optional(),
    /**
     * [Prompt] Native MCP prompt behaviour: 'expand' (plain template text) or 'launch' (route
     * through prompt_engine).
     *
     * FREEZE HAZARD: resolved through prompt → category → default `'expand'`; an explicit value
     * outranks both PERMANENTLY and the prompt stops following any later change to the category
     * default. Omit it unless this prompt specifically needs to differ from its category.
     */
    mcp_prompt_mode: z.enum(['expand', 'launch']).optional(),
    /** [Prompt] Client-agnostic capability hint for `==>` delegated steps. */
    subagent_model: z.enum(['heavy', 'standard', 'fast']).optional(),
    /** [Prompt] Default host agent for this prompt's `==>` delegated steps (a step may override). */
    agent_type: z.string().min(1).optional(),

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
