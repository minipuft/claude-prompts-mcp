// Auto-generated from tooling/contracts/*.json. Do not edit manually.
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';
  required?: boolean;
  default?: unknown;
  compatibility: 'canonical' | 'deprecated' | 'legacy'; // Required with default value
  examples?: string[];
  notes?: string[];
  enum?: string[]; // For enum types with explicit values
  includeInDescription?: boolean; // If false, param is in schema but not tool description
}

export interface ToolCommand {
  id: string;
  summary: string;
  parameters?: string[];
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental'; // Required with default value
  notes?: string[];
}

export type prompt_engineParamName =
  | 'command'
  | 'chain_id'
  | 'user_response'
  | 'gate_verdict'
  | 'gate_action'
  | 'gates'
  | 'force_restart'
  | 'options'
  | 'observations';
export const prompt_engineParameters: ToolParameter[] = [
  {
    name: 'command',
    type: 'string',
    description:
      'Prompt ID to expand. Format: >>prompt_id key="value" | Chains: >>s1 --> >>s2 | Modifiers first: ^Framework :: "criteria" %clean/%lean | Shell verify: :: verify:"cmd" :preset',
    required: false,
    status: 'working',
    compatibility: 'canonical',
    examples: [
      "@CAGEERF #analytical >>analyze topic:'metrics' --> >>report :: 'cite sources'",
      ">>fix-bug :: verify:'npm test' :full loop:true",
      ">>brainstorm * 5 topic:'product ideas'",
      ">>strategicImplement * 3 plan_path:'./plan.md'",
      ">>research topic:'A' --> >>research topic:'B' --> >>compare",
      ">>validate input:'step1' --> >>validate input:'step2' --> >>synthesize",
    ],
    notes: [
      'Every step needs prompt ID prefix (>> or /). Modifiers apply to whole chain.',
      'Script tools: tool:<id> to invoke; confirm:true tools need approval.',
      'Shell verification: :: verify:"cmd" with :fast/:full/:extended presets, loop:true for autonomous.',
      'REPETITION (* N): Repeats with SAME arguments. For different args per step, use explicit --> chain syntax.',
      "CONTEXT: Each chain step receives previous step's output automatically. Arguments are optional per step.",
    ],
  },
  {
    name: 'chain_id',
    type: 'string',
    description:
      'Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'user_response',
    type: 'string',
    description:
      'Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'gate_verdict',
    type: 'string',
    description:
      "Gate review result. PREFERRED structured object: {overall:'PASS'|'FAIL', rationale:'...', per_gate:[{index:1, passed:true, rationale:'...'}]} — validated by the schema, so it cannot be malformed. Legacy string still accepted: 'GATE_REVIEW: PASS|FAIL - reason' (also 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason').",
    status: 'working',
    compatibility: 'canonical',
    notes: [
      'State-conditional: advertised only while the gate system is enabled. Part of the declared union surface regardless — see CLAUDE.md §Public API Contract.',
      'Rationales are single-line and trimmed. Multi-line is rejected rather than collapsed: only the first non-empty line is parsed, so the remainder would be lost silently.',
      'The legacy string branch and the four non-primary verdict patterns are retired once no client has submitted a string verdict for one release cycle, measured via the `source` field on ParsedGateVerdict.',
    ],
  },
  {
    name: 'gate_action',
    type: 'enum',
    description:
      "User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely.",
    status: 'working',
    compatibility: 'canonical',
    notes: [
      'State-conditional: advertised only while the gate system is enabled. Part of the declared union surface regardless — see CLAUDE.md §Public API Contract.',
    ],
    enum: ['retry', 'skip', 'abort'],
  },
  {
    name: 'gates',
    type: 'array<string|{name,description}|gate>',
    description:
      "Quality gates for output validation. Four formats supported:\n\n**1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.\n\n**2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.\n\n**3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows.\n\n**4. Shell Verification** (ground-truth validation): `:: verify:\"command\"` runs shell commands; exit 0 = PASS.\n   - **Presets**: `:fast` (1 attempt, 30s), `:full` (5 attempts, 5min), `:extended` (10 attempts, 10min)\n   - **Options**: `max:N` (attempts), `timeout:N` (seconds), `loop:true` (autonomous Stop hook)\n   - **Example**: `>>fix-bug :: verify:\"npm test\" :full loop:true`",
    status: 'working',
    compatibility: 'canonical',
    examples: [
      '[{"name": "Source Quality", "description": "All sources must be official docs"}]',
      ':: verify:"npm test" :full loop:true',
    ],
    notes: [
      'RECOMMENDED: Quick Gates {name, description} auto-default to severity:medium, type:validation.',
      'Full schema: id, name, severity, criteria[], pass_criteria[], guidance, apply_to_steps[].',
      "Chain step targeting: target_step_number (1-based position) or target_step_id (stable node id, e.g. 'draft-outline' or 'n2'). Either addresses one step; supply whichever you have.",
      'Shell Verification: Use presets for common patterns. loop:true enables autonomous retry until pass.',
      'State-conditional: advertised only while the gate system is enabled. Part of the declared union surface regardless — see CLAUDE.md §Public API Contract.',
    ],
  },
  {
    name: 'force_restart',
    type: 'boolean',
    description:
      "Start a new execution instead of resuming one. Cannot be combined with 'chain_id' (that pair is rejected). Redundant with a plain 'command', which already starts a new chain; it matters only when the command text itself carries a chain id.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'options',
    type: 'record',
    description: 'Execution options forwarded downstream.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'observations',
    type: 'array<{type,id,statement,blocking?,resolution?}>',
    description:
      "Declare typed unknowns discovered or resolved this step, feeding the per-run unknowns ledger. Two shapes: `{type:'unknown_discovered', id:'kebab-case-slug', statement:'...', blocking?:true|false}` opens a ledger entry; `{type:'unknown_resolved', id:'kebab-case-slug', statement:'...', resolution:'answered'|'irrelevant'}` closes one (statement carries the resolution statement).",
    status: 'working',
    compatibility: 'canonical',
    examples: [
      '[{"type": "unknown_discovered", "id": "cache-ttl-unknown", "statement": "TTL for the new cache layer is undecided", "blocking": false}]',
      '[{"type": "unknown_resolved", "id": "cache-ttl-unknown", "statement": "TTL confirmed at 300s per ops runbook", "resolution": "answered"}]',
    ],
    notes: [
      'Tier 1: type + schema only. No runtime ledger mutation yet — the parameter validates but is not yet consumed by the pipeline.',
      '`id` must be kebab-case and stable within the run so re-discovery of the same id updates rather than duplicates.',
      "`resolution` is required when type is 'unknown_resolved'; omitted for 'unknown_discovered'.",
    ],
  },
];

export const prompt_engineCommands: ToolCommand[] = [
  {
    id: 'chain-resume',
    summary: 'Resume chain via chain_id + user_response/gate_verdict/gate_action',
    parameters: ['chain_id', 'user_response', 'gate_verdict', 'gate_action', 'observations'],
    status: 'working',
  },
];

export const prompt_engineMetadata = { tool: 'prompt_engine', version: 1 };
