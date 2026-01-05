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

export type prompt_engineParamName = 'command' | 'chain_id' | 'user_response' | 'gate_verdict' | 'gate_action' | 'gates' | 'force_restart' | 'options';
export const prompt_engineParameters: ToolParameter[] = [
  {
    "name": "command",
    "type": "string",
    "description": "Prompt ID to expand. Format: >>prompt_id key=\"value\" | Chains: >>s1 --> >>s2 | Modifiers first: @Framework :: \"criteria\" %clean/%lean",
    "required": false,
    "status": "working",
    "compatibility": "canonical",
    "examples": [
      "@CAGEERF #analytical >>analyze topic:'metrics' --> >>report :: 'cite sources'"
    ],
    "notes": [
      "Every step needs prompt ID prefix (>> or /). Modifiers apply to whole chain.",
      "Script tools: tool:<id> to invoke; confirm:true tools need approval."
    ]
  },
  {
    "name": "chain_id",
    "type": "string",
    "description": "Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "user_response",
    "type": "string",
    "description": "Your completed output from executing the previous step. Paste your work here when resuming a chain. Use with chain_id; do not include command when resuming.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "gate_verdict",
    "type": "string",
    "description": "Gate review verdict with flexible format support. Primary: 'GATE_REVIEW: PASS|FAIL - reason'. Also accepts: 'GATE PASS - reason', 'GATE_REVIEW: FAIL: reason', 'PASS - reason' (minimal).",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "gate_action",
    "type": "enum",
    "description": "User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely.",
    "status": "working",
    "compatibility": "canonical",
    "enum": [
      "retry",
      "skip",
      "abort"
    ]
  },
  {
    "name": "gates",
    "type": "array<string|{name,description}|gate>",
    "description": "Quality gates for output validation. Three formats supported:\n\n**1. Registered IDs** (strings): Use predefined gates like 'code-quality', 'research-quality'.\n\n**2. Quick Gates** (RECOMMENDED for LLM-generated validation): `{name, description}` - Create named, domain-specific checks on the fly. Example: `{name: 'Source Quality', description: 'All sources must be official docs'}`.\n\n**3. Full Definitions**: Complete schema with severity, criteria[], pass_criteria[], guidance for production workflows.",
    "status": "working",
    "compatibility": "canonical",
    "examples": [
      "[{\"name\": \"Source Quality\", \"description\": \"All sources must be official docs\"}]"
    ],
    "notes": [
      "RECOMMENDED: Quick Gates {name, description} auto-default to severity:medium, type:validation.",
      "Full schema: id, name, severity, criteria[], pass_criteria[], guidance, apply_to_steps[]."
    ]
  },
  {
    "name": "force_restart",
    "type": "boolean",
    "description": "Restart chain from step 1, ignoring cached state.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "options",
    "type": "record",
    "description": "Execution options forwarded downstream.",
    "status": "working",
    "compatibility": "canonical"
  }
];

export const prompt_engineCommands: ToolCommand[] = [
  {
    "id": "chain-resume",
    "summary": "Resume chain via chain_id + user_response/gate_verdict/gate_action",
    "parameters": [
      "chain_id",
      "user_response",
      "gate_verdict",
      "gate_action"
    ],
    "status": "working"
  }
];

export const prompt_engineMetadata = { tool: 'prompt_engine', version: 1 };

