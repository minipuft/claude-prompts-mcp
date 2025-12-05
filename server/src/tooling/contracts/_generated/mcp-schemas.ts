// Auto-generated from tooling/contracts/*.json. Do not edit manually.
import { z } from 'zod';

/**
 * Zod schema for prompt_engine MCP tool
 * Generated from contract version 1
 */
export const promptEngineSchema = z.object({
  /** Prompt ID to expand with optional arguments. Format: >>prompt_id key="value".  Chains: >>step1 --> >>step2 (N-1 arrows for N steps). Modifiers (place before ID): @Framework | :: "criteria" | %clean/%lean.  Do NOT invent IDs - use prompt_manager(action:"list") to discover valid prompts. */
  command: z.string().trim().optional(),
  /** Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command. */
  chain_id: z.string().regex(/^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/, 'Chain ID must follow format: chain-{prompt}[#runNumber]').optional(),
  /** Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming. */
  user_response: z.string().trim().optional(),
  /** Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal). */
  gate_verdict: z.string().regex(/^GATE_REVIEW:\s(PASS|FAIL)\s-\s.+$/, 'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"').optional(),
  /** User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely. */
  gate_action: z.enum(['retry', 'skip', 'abort']).optional(),
  /** Quality gates for output validation. Three formats supported:  **1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.  **2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.  **3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows. */
  gates: z.array(z.union([
        z.string(),
        z.object({ name: z.string(), description: z.string() }),
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          description: z.string().optional(),
          criteria: z.array(z.string()).optional(),
          severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
          type: z.enum(['validation', 'approval', 'condition', 'quality', 'guidance']).optional(),
          scope: z.enum(['execution', 'session', 'chain', 'step']).optional(),
          template: z.string().optional(),
          pass_criteria: z.array(z.string()).optional(),
          guidance: z.string().optional(),
          context: z.record(z.unknown()).optional(),
          source: z.enum(['manual', 'automatic', 'analysis']).optional(),
          target_step_number: z.number().int().positive().optional(),
          apply_to_steps: z.array(z.number().int().positive()).optional(),
        }),
      ])).optional(),
  /** Restart chain from step 1, ignoring cached state. */
  force_restart: z.boolean().optional(),
  /** Experimental: Advanced LLM-based semantic validation for prompt quality. Currently blocked pending architectural design. */
  llm_validation: z.boolean().optional(),
  /** Execution options forwarded downstream. */
  options: z.record(z.unknown()).optional(),
  // session_id: hidden/blocked - not included in schema
});

export type promptEngineInput = z.infer<typeof promptEngineSchema>;

/**
 * Zod schema for prompt_manager MCP tool
 * Generated from contract version 1
 */
export const promptManagerSchema = z.object({
  /** The operation to perform: create (new prompt), update (modify existing), delete (remove), list (discover IDs), inspect (view details), analyze_type/analyze_gates (get recommendations), reload (refresh from disk), guide (get action suggestions). */
  action: z.enum(['create', 'update', 'delete', 'reload', 'list', 'inspect', 'analyze_type', 'analyze_gates', 'guide']),
  /** Prompt identifier (required for most actions). */
  id: z.string().optional(),
  /** Human-friendly name (create/update). */
  name: z.string().optional(),
  /** Prompt description (create/update). */
  description: z.string().optional(),
  /** Prompt body/template (create/update). */
  user_message_template: z.string().optional(),
  /** Optional system message (create/update). */
  system_message: z.string().optional(),
  /** Category tag (create/update). */
  category: z.string().optional(),
  /** Prompt arguments metadata (create/update). */
  arguments: z.array(z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
      })).optional(),
  /** Chain steps definition (create/update for chains). */
  chain_steps: z.array(z.unknown()).optional(),
  /** Hint for execution type on creation. */
  execution_hint: z.enum(['single', 'chain']).optional(),
  /** Targeted update section. */
  section: z.enum(['name', 'description', 'system_message', 'user_message_template', 'arguments', 'chain_steps']).optional(),
  /** Content for targeted section updates. */
  section_content: z.string().optional(),
  /** List filter query (list action). */
  filter: z.string().optional(),
  /** Output format for list/inspect. */
  format: z.enum(['table', 'json', 'text']).optional(),
  /** Inspect detail level. */
  detail: z.enum(['summary', 'full']).optional(),
  /** Safety confirmation (delete). */
  confirm: z.boolean().optional(),
  /** Audit reason (reload/delete). */
  reason: z.string().trim().optional(),
});

export type promptManagerInput = z.infer<typeof promptManagerSchema>;

/**
 * Zod schema for system_control MCP tool
 * Generated from contract version 1
 */
export const systemControlSchema = z.object({
  /** The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations). */
  action: z.enum(['status', 'framework', 'gates', 'analytics', 'config', 'maintenance', 'guide', 'injection']),
  /** Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list). */
  operation: z.string().optional(),
  /** Target framework for switch operations (CAGEERF, ReACT, 5W1H, SCAMPER). */
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
});

export type systemControlInput = z.infer<typeof systemControlSchema>;

