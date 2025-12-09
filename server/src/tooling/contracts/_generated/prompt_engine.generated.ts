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
    "description": "Prompt ID to expand with optional arguments. Format: >>prompt_id key=\"value\".\n\nChains: >>step1 --> >>step2 (N-1 arrows for N steps).\nModifiers (place before ID): @Framework | :: \"criteria\" | %clean/%lean.\n\nDo NOT invent IDs - use prompt_manager(action:\"list\") to discover valid prompts.",
    "required": false,
    "status": "working",
    "compatibility": "canonical",
    "examples": [
      "%judge @CAGEERF #analytical >>analytical \"overview\" --> >>procedural \"edge cases\" --> >>creative \"JSON summary\" :: framework-compliance :: technical-accuracy",
      "@ReACT >>analysis_report topic:'AI safety' :: 'cite sources' #analytical",
      ">>analysis_report audience:'exec' --> >>summary #procedural"
    ],
    "notes": [
      "Operators: `-->` chain, `@` framework, `::` gates, `#id` style (e.g., #analytical), `%judge` menu; `%clean`/`%lean` disable framework injection. Modifiers belong at the front and apply to the whole chain.",
      "Every chain step must start with a prompt id prefix (`>>` or `/`). Plain text step labels are invalid; use prompt_manager(list/inspect) to find valid ids instead of fabricating them.",
      "Free text belongs after the prompt id, quoted (\"...\") or as key:value pairs. Avoid unquoted bare strings that look like prompt names.",
      "Two request shapes: execute (`command` required, optional gates/options); resume (`chain_id` with user_response and/or gate_verdict/gate_action, command optional).",
      "Chaining runs all steps back-to-back; issue separate calls if you need to pause between phases."
    ]
  },
  {
    "name": "chain_id",
    "type": "string",
    "description": "Resume token (chain-{prompt} or chain-{prompt}#runNumber). RESUME: chain_id + user_response only. Omit command.",
    "status": "working",
    "compatibility": "canonical",
    "notes": [
      "RESUME WORKFLOW: Provide chain_id + user_response (or gate_verdict). Do NOT re-send command parameter.",
      "Preferred resume path. Use with user_response or gate_verdict."
    ]
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
    "compatibility": "canonical",
    "notes": [
      "Multiple format variants supported (v3.1+)",
      "Case-insensitive matching with hyphen or colon separators",
      "Rationale required for all verdicts",
      "Takes precedence over verdicts parsed from user_response",
      "Minimal format ('PASS - reason') only accepted via this parameter, not from user_response"
    ]
  },
  {
    "name": "gate_action",
    "type": "enum",
    "description": "User choice after gate retry limit exhaustion. 'retry' resets attempt count for another try, 'skip' bypasses the failed gate and continues, 'abort' stops chain execution entirely.",
    "status": "working",
    "compatibility": "canonical",
    "notes": [
      "Only effective when gate retry limit is exceeded (default: 2 attempts)",
      "Use with chain_id to specify which chain session to apply the action to",
      "Blocking gates prompt for this choice; advisory/informational gates auto-continue"
    ],
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
      "[\"code-quality\", \"research-quality\"]",
      "[{\"name\": \"Source Verification\", \"description\": \"All claims must cite sources\"}]",
      "[{\"id\": \"security-gate\", \"severity\": \"critical\", \"criteria\": [\"No hardcoded secrets\", \"Input validation present\"]}]"
    ],
    "notes": [
      "RECOMMENDED: Use Quick Gates `{name, description}` when dynamically creating validation - simple to generate, properly named in output.",
      "Quick Gates auto-default to severity:medium, type:validation, scope:execution.",
      "Full schema supports: id, name, description, severity (critical|high|medium|low), type, scope, criteria[], pass_criteria[], guidance, apply_to_steps[].",
      "Supports mixed types in single array for maximum flexibility.",
      "Step-targeted gates: Use target_step_number or apply_to_steps in full gate definitions."
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

