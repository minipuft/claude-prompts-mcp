// Auto-generated from tooling/contracts/*.json. Do not edit manually.
import { z } from 'zod';

/**
 * Zod schema for prompt_engine MCP tool
 * Generated from contract version 1
 */
export const promptEngineSchema = z
  .object({
    /** Prompt ID to expand. Format: >>prompt_id key="value" | Chains: >>s1 --> >>s2 | Modifiers first: @Framework :: "criteria" %clean/%lean */
    command: z.string().trim().optional(),
    /** Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. */
    chain_id: z
      .string()
      .regex(
        /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/,
        'Chain ID must follow format: chain-{prompt}[#runNumber]'
      )
      .optional(),
    /** Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. */
    user_response: z.string().trim().optional(),
    /** Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). */
    gate_verdict: z
      .string()
      .regex(
        /^GATE_REVIEW:\s(PASS|FAIL)\s-\s.+$/,
        'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
      )
      .optional(),
    /** User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. */
    gate_action: z.enum(['retry', 'skip', 'abort']).optional(),
    /** Quality gates for output validation. Three formats supported:  **1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.  **2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.  **3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows. */
    gates: z
      .array(
        z.union([
          z.string(),
          z.object({ name: z.string(), description: z.string() }),
          z.object({
            id: z.string().optional(),
            name: z.string().optional(),
            description: z.string().optional(),
            criteria: z.array(z.string()).optional(),
            severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
            type: z.enum(['validation', 'guidance']).optional(),
            scope: z.enum(['execution', 'session', 'chain', 'step']).optional(),
            template: z.string().optional(),
            pass_criteria: z.array(z.string()).optional(),
            guidance: z.string().optional(),
            context: z.record(z.unknown()).optional(),
            source: z.enum(['manual', 'automatic', 'analysis']).optional(),
            target_step_number: z.number().int().positive().optional(),
            apply_to_steps: z.array(z.number().int().positive()).optional(),
          }),
        ])
      )
      .optional(),
    /** Restart chain from step 1, ignoring cached state. */
    force_restart: z.boolean().optional(),
    /** Execution options forwarded downstream. */
    options: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type promptEngineInput = z.infer<typeof promptEngineSchema>;

/**
 * Zod schema for resource_manager MCP tool
 * Generated from contract version 1
 */
export const resourceManagerSchema = z
  .object({
    /** Type of resource to manage. Routes to appropriate handler. */
    resource_type: z.enum(['prompt', 'gate', 'methodology']),
    /** Operation to perform. Type-specific: analyze_type/guide (prompt), switch (methodology). Versioning: history/rollback/compare (all types). */
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
    /** Safety confirmation for delete operation. */
    confirm: z.boolean().optional(),
    /** Audit reason for reload/delete/switch operations. */
    reason: z.string().trim().optional(),
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
    chain_steps: z.array(z.unknown()).optional(),
    /** [Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python|node|shell|auto), schema (JSON Schema object), trigger (schema_match|explicit|always|never), confirm, strict, timeout. */
    tools: z.array(z.unknown()).optional(),
    /** [Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean). */
    gate_configuration: z.record(z.unknown()).optional(),
    /** [Prompt] Hint for execution type on creation. */
    execution_hint: z.enum(['single', 'chain']).optional(),
    /** [Prompt] Targeted update section. */
    section: z
      .enum([
        'name',
        'description',
        'system_message',
        'user_message_template',
        'arguments',
        'chain_steps',
      ])
      .optional(),
    /** [Prompt] Content for targeted section updates. */
    section_content: z.string().optional(),
    /** [Prompt] List filter query. */
    filter: z.string().optional(),
    /** [Prompt] Output format for list/inspect. */
    format: z.enum(['table', 'json', 'text']).optional(),
    /** [Prompt] Inspect detail level. */
    detail: z.enum(['summary', 'full']).optional(),
    /** [Prompt] Search query for filtering (list action). */
    search_query: z.string().optional(),
    /** [Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation. */
    gate_type: z.enum(['validation', 'guidance']).optional(),
    /** [Gate] Gate guidance content - the criteria or instructions. */
    guidance: z.string().optional(),
    /** [Gate] Structured pass criteria definitions. */
    pass_criteria: z.array(z.unknown()).optional(),
    /** [Gate] Activation rules: prompt_categories, frameworks, explicit_request. */
    activation: z.record(z.unknown()).optional(),
    /** [Gate] Retry configuration: max_attempts, improvement_hints. */
    retry_config: z.record(z.unknown()).optional(),
    /** [Methodology] Methodology type identifier. Use action:'list' to see registered methodologies. */
    methodology: z.string().optional(),
    /** [Methodology] System prompt guidance injected when active. */
    system_prompt_guidance: z.string().optional(),
    /** [Methodology] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (methodology_gates, processing_steps, execution_steps, etc.) are also accepted. */
    phases: z.array(z.unknown()).optional(),
    /** [Methodology] Gate configuration: include, exclude arrays. */
    gates: z.record(z.unknown()).optional(),
    /** [Methodology] Tool description overlays when active. */
    tool_descriptions: z.record(z.unknown()).optional(),
    /** [Methodology] Whether the methodology is enabled. */
    enabled: z.boolean().optional(),
    /** [Methodology] For switch: persist the change to config. Default: false. */
    persist: z.boolean().optional(),
    /** [Versioning] Target version number for rollback action. */
    version: z.number().optional(),
    /** [Versioning] Starting version number for compare action. */
    from_version: z.number().optional(),
    /** [Versioning] Ending version number for compare action. */
    to_version: z.number().optional(),
    /** [Versioning] Max versions to return in history. Default: 10. */
    limit: z.number().optional(),
    /** [Versioning] Skip auto-versioning on update. Default: false. */
    skip_version: z.boolean().optional(),
  })
  .passthrough();

export type resourceManagerInput = z.infer<typeof resourceManagerSchema>;

/**
 * Zod schema for system_control MCP tool
 * Generated from contract version 1
 */
export const systemControlSchema = z
  .object({
    /** The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations), session (manage execution sessions). */
    action: z.enum([
      'status',
      'framework',
      'gates',
      'analytics',
      'config',
      'maintenance',
      'guide',
      'injection',
      'session',
    ]),
    /** Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list; session list/clear/inspect). */
    operation: z.string().optional(),
    /** Target session ID or chain ID for session operations. */
    session_id: z.string().optional(),
    /** Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks. */
    framework: z.string().optional(),
    /** Audit reason for framework/gate toggles or admin actions. */
    reason: z.string().trim().optional(),
    /** When true, gate/framework enable/disable changes are also written to config.json. */
    persist: z.boolean().optional(),
    /** Include detailed output (status/analytics/framework/gate reports). */
    show_details: z.boolean().optional(),
    /** Include recorded history where supported. */
    include_history: z.boolean().optional(),
    /** Guide topic when requesting guidance. */
    topic: z.string().optional(),
    /** Filter gates by keyword (matches ID, name, or description). Use with gates:list action. */
    search_query: z.string().optional(),
  })
  .passthrough();

export type systemControlInput = z.infer<typeof systemControlSchema>;
