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
  resolvesPendingGate?: boolean; // True when supplying this param resolves a pending gate review
}

export interface ToolCommand {
  id: string;
  summary: string;
  parameters?: string[];
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental'; // Required with default value
  notes?: string[];
}

export type resource_managerParamName =
  | 'resource_type'
  | 'action'
  | 'id'
  | 'name'
  | 'description'
  | 'enabled_only'
  | 'confirm'
  | 'reason'
  | 'category'
  | 'user_message_template'
  | 'system_message'
  | 'arguments'
  | 'argument_updates'
  | 'patch'
  | 'source_workspace'
  | 'dry_run'
  | 'chain_steps'
  | 'tools'
  | 'gate_configuration'
  | 'composer'
  | 'injection'
  | 'register_with_mcp'
  | 'mcp_prompt_mode'
  | 'subagent_model'
  | 'agent_type'
  | 'execution_hint'
  | 'filter'
  | 'format'
  | 'detail'
  | 'search_query'
  | 'gate_type'
  | 'guidance'
  | 'pass_criteria'
  | 'activation'
  | 'retry_config'
  | 'framework'
  | 'system_prompt_guidance'
  | 'phases'
  | 'gates'
  | 'tool_descriptions'
  | 'enabled'
  | 'persist'
  | 'version'
  | 'from_version'
  | 'to_version'
  | 'limit'
  | 'skip_version'
  | 'expected_version';
export const resource_managerParameters: ToolParameter[] = [
  {
    name: 'resource_type',
    type: 'enum[prompt|gate|framework]',
    description: 'Type of resource to manage. Routes to appropriate handler.',
    required: true,
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'action',
    type: 'enum[create|validate|update|delete|reload|list|inspect|analyze_type|analyze_gates|guide|switch|history|rollback|compare]',
    description:
      'Operation to perform. Prompt-only: validate/analyze_type/analyze_gates/guide. validate checks a creation draft without writing. Framework-only: switch. Versioning: history/rollback/compare.',
    required: true,
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'id',
    type: 'string',
    description:
      'Resource identifier. Required for create, update, delete, inspect, reload, switch.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'name',
    type: 'string',
    description: 'Human-friendly name for the resource (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'description',
    type: 'string',
    description: 'Resource description explaining its purpose (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'enabled_only',
    type: 'boolean',
    description: 'Filter list to enabled resources only. Default: true.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'confirm',
    type: 'boolean',
    description:
      'Required `true` for destructive actions — `delete` and `rollback` both refuse without it. Deletion cannot be undone: rollback cannot restore a deleted prompt.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'reason',
    type: 'string',
    description: 'Audit reason for reload/delete/switch operations.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'category',
    type: 'string',
    description: '[Prompt] Category tag for the prompt.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'user_message_template',
    type: 'string',
    description: '[Prompt] Prompt body/template with Nunjucks placeholders.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'system_message',
    type: 'string',
    description: '[Prompt] Optional system message for the prompt.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'arguments',
    type: 'array<{name,required?,description?,type?,defaultValue?,validation?}>',
    description:
      "[Prompt] Argument definitions for the prompt. `type` is one of string|number|boolean|array|object. `required` and `defaultValue` are persisted to the prompt's YAML; `validation` accepts pattern/minLength/maxLength and is what arms required-argument enforcement at execution.",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'argument_updates',
    type: 'array<{name,description?,type?,required?,defaultValue?,validation?}>',
    description:
      "[Prompt] Update-only: per-field overlay onto EXISTING arguments, addressed by `name`. `name` must match an argument this prompt already declares — no upsert, so adding/removing/renaming an argument still requires the full `arguments` array. Every other field overlays onto the matched entry only when supplied; an omitted field leaves that entry's current value untouched. Mutually exclusive with `arguments` in the same call. Rejected on `create`. Combine with `dry_run: true` to preview.",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'patch',
    type: 'array<{field,old_string,new_string,replace_all?}>',
    description:
      '[Prompt] Anchored edits applied server-side on `update`, so one section can be changed without resending the rest. `field` is user_message_template|system_message|description; `old_string` must match the current text EXACTLY (whitespace included) and uniquely, otherwise the update is rejected naming the anchor and its occurrence count; `new_string` may be empty to delete. Operations apply in order. Pass `replace_all: true` to accept a multi-occurrence anchor. Mutually exclusive with `user_message_template`/`system_message` in the same call. Combine with `dry_run: true` to preview.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'source_workspace',
    type: 'string',
    description:
      "[Versioning] Read version history belonging to a DIFFERENT workspace. `state.db` is one file shared by every project on the machine, isolated by workspace id alone, so another checkout's history is already present and merely filtered out. READ-ONLY and scope-local-on-write: honoured by `history` and `compare`; every other action REJECTS it rather than ignoring it, because a snapshot recorded elsewhere describes files that may not exist here and version numbering is per-workspace. Inspect with it, then apply the change in that workspace.",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'dry_run',
    type: 'boolean',
    description:
      'Preview a mutation instead of performing it — nothing is written and no version is recorded. `update` (prompt): returns the resulting text bodies and the diff, for a full update or a `patch`. `rollback` (prompt|gate|framework): returns the diff between the current state and the version you would restore, and still refuses a version whose snapshot is incomplete. `delete` (prompt|gate|framework): reports what would be removed, including the prompts that reference it. Not valid on `create` — there is nothing to diff against.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'chain_steps',
    type: 'array<step>',
    description: '[Prompt] Chain steps definition for multi-step prompts.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'tools',
    type: 'array<{id,name,script,description?,runtime?,schema?,trigger?,confirm?,strict?,timeout?}>',
    description:
      '[Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python|node|shell|auto), schema (JSON Schema object), trigger (schema_match|explicit|always|never), confirm, strict, timeout.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'gate_configuration',
    type: 'object',
    description:
      '[Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean).',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'composer',
    type: 'object<{inputArgument:string}>',
    description:
      '[Prompt] Interactive composer metadata. inputArgument must name a declared string argument; clients may map their current draft only when this field is present.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'injection',
    type: 'object',
    description:
      "[Prompt] Prompt-level injection control. Keys: system-prompt, gate-guidance, style-guidance; each takes {enabled?: boolean, frequency?: {mode: every|first-only|never, interval?: number}, target?: steps|gates|both}. A prompt's own declaration outranks the chain or category it runs inside. Omit to leave the prompt's existing block untouched.",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'register_with_mcp',
    type: 'boolean',
    description:
      '[Prompt] Whether this prompt registers as a native MCP prompt. FREEZE HAZARD: this value is normally resolved prompt -> category -> global -> default true; setting it writes an explicit prompt-level value that overrides all three permanently, so the prompt stops following any later change to its category or global default. Omit unless this prompt must differ from its category.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'mcp_prompt_mode',
    type: 'enum[expand|launch]',
    description:
      '[Prompt] Native MCP prompt behaviour: expand (plain template text) or launch (route through prompt_engine). FREEZE HAZARD: normally resolved prompt -> category -> default expand; an explicit value overrides both permanently and the prompt stops following any later change to its category default. Omit unless this prompt must differ from its category.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'subagent_model',
    type: 'enum[heavy|standard|fast]',
    description: "[Prompt] Client-agnostic capability hint for this prompt's ==> delegated steps.",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'agent_type',
    type: 'string',
    description:
      "[Prompt] Default host agent for this prompt's ==> delegated steps. A step's own agentType overrides it; neither present leaves the choice to the client (Claude Code: general-purpose).",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'execution_hint',
    type: 'enum[single|chain]',
    description: '[Prompt] Hint for execution type on creation.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'filter',
    type: 'string',
    description: '[Prompt] List filter query.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'format',
    type: 'enum[table|json|text]',
    description: '[Prompt] Output format for list/inspect.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'detail',
    type: 'enum[summary|full]',
    description:
      '[Prompt] Detail level for list/inspect. summary=IDs only, full=complete prompt content.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'search_query',
    type: 'string',
    description: '[Prompt] Search query for filtering (list action).',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'gate_type',
    type: 'enum[validation|guidance]',
    description:
      '[Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'guidance',
    type: 'string',
    description: '[Gate] Gate guidance content - the criteria or instructions.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'pass_criteria',
    type: 'array<string>',
    description: '[Gate] Structured pass criteria definitions.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'activation',
    type: 'object',
    description: '[Gate] Activation rules: prompt_categories, frameworks, explicit_request.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'retry_config',
    type: 'object',
    description: '[Gate] Retry configuration: max_attempts, improvement_hints.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'framework',
    type: 'string',
    description:
      "[Framework] Framework type identifier. Use action:'list' to see registered frameworks.",
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'system_prompt_guidance',
    type: 'string',
    description: '[Framework] System prompt guidance injected when active.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'phases',
    type: 'array<object>',
    description:
      '[Framework] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (framework_gates, processing_steps, execution_steps, etc.) are also accepted.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'gates',
    type: 'object',
    description: '[Framework] Gate configuration: include, exclude arrays.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'tool_descriptions',
    type: 'object',
    description: '[Framework] Tool description overlays when active.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'enabled',
    type: 'boolean',
    description: '[Framework] Whether the framework is enabled.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'persist',
    type: 'boolean',
    description: '[Framework] For switch: persist the change to config. Default: false.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'version',
    type: 'number',
    description: '[Versioning] Target version number for rollback action.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'from_version',
    type: 'number',
    description: '[Versioning] Starting version number for compare action.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'to_version',
    type: 'number',
    description: '[Versioning] Ending version number for compare action.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'limit',
    type: 'number',
    description: '[Versioning] Max versions to return in history. Default: 10.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'skip_version',
    type: 'boolean',
    description: '[Versioning] Skip auto-versioning on update. Default: false.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: false,
  },
  {
    name: 'expected_version',
    type: 'number',
    description:
      '[Prompt update] Optimistic concurrency token. Refuses the update before any write/version when the current recorded version differs. Read it from inspect/validate/create/update structured receipts. Cannot be combined with skip_version:true and requires versioning enabled.',
    status: 'working',
    compatibility: 'canonical',
    includeInDescription: true,
  },
];

export const resource_managerCommands: ToolCommand[] = [
  {
    id: 'prompt:validate',
    summary: 'Validate and normalize a prompt creation draft without writing files or versions.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'description',
      'category',
      'user_message_template',
      'system_message',
      'arguments',
      'chain_steps',
      'tools',
      'gate_configuration',
      'composer',
      'injection',
      'register_with_mcp',
      'mcp_prompt_mode',
      'subagent_model',
      'agent_type',
      'execution_hint',
    ],
    status: 'working',
  },
  {
    id: 'prompt:create',
    summary: 'Create a prompt/chain with metadata and arguments.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'description',
      'category',
      'user_message_template',
      'system_message',
      'arguments',
      'chain_steps',
      'tools',
      'gate_configuration',
      'composer',
      'injection',
      'register_with_mcp',
      'mcp_prompt_mode',
      'subagent_model',
      'agent_type',
      'execution_hint',
    ],
    status: 'working',
  },
  {
    id: 'prompt:update',
    summary: 'Update prompt fields. Only provided fields change; omitted fields are preserved.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'description',
      'category',
      'user_message_template',
      'system_message',
      'arguments',
      'chain_steps',
      'tools',
      'gate_configuration',
      'composer',
      'injection',
      'register_with_mcp',
      'mcp_prompt_mode',
      'subagent_model',
      'agent_type',
      'expected_version',
    ],
    status: 'working',
  },
  {
    id: 'prompt:list',
    summary: 'List prompts with filters.',
    parameters: ['resource_type', 'action', 'filter', 'format', 'detail', 'search_query'],
    status: 'working',
  },
  {
    id: 'prompt:analyze_type',
    summary: 'Semantic analysis for execution type recommendation.',
    parameters: ['resource_type', 'action', 'id'],
    status: 'working',
  },
  {
    id: 'prompt:analyze_gates',
    summary: 'Gate configuration suggestions for a prompt.',
    parameters: ['resource_type', 'action', 'id'],
    status: 'working',
  },
  {
    id: 'prompt:guide',
    summary: 'Get action suggestions for prompt management.',
    parameters: ['resource_type', 'action'],
    status: 'working',
  },
  {
    id: 'gate:create',
    summary: 'Create a new gate with YAML configuration and guidance.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'gate_type',
      'description',
      'guidance',
      'pass_criteria',
      'activation',
      'retry_config',
    ],
    status: 'working',
  },
  {
    id: 'gate:update',
    summary: 'Update existing gate configuration or guidance.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'gate_type',
      'description',
      'guidance',
      'pass_criteria',
      'activation',
      'retry_config',
    ],
    status: 'working',
  },
  {
    id: 'gate:list',
    summary: 'List all registered gates.',
    parameters: ['resource_type', 'action', 'enabled_only'],
    status: 'working',
  },
  {
    id: 'framework:create',
    summary: 'Create a new framework with YAML configuration.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'framework',
      'description',
      'system_prompt_guidance',
      'phases',
      'gates',
      'tool_descriptions',
    ],
    status: 'working',
  },
  {
    id: 'framework:update',
    summary: 'Update existing framework configuration.',
    parameters: [
      'resource_type',
      'action',
      'id',
      'name',
      'framework',
      'description',
      'system_prompt_guidance',
      'phases',
      'gates',
      'tool_descriptions',
      'enabled',
    ],
    status: 'working',
  },
  {
    id: 'framework:list',
    summary: 'List all available frameworks.',
    parameters: ['resource_type', 'action', 'enabled_only'],
    status: 'working',
  },
  {
    id: 'framework:switch',
    summary: 'Switch the active framework.',
    parameters: ['resource_type', 'action', 'id', 'persist', 'reason'],
    status: 'working',
  },
  {
    id: 'common:inspect',
    summary: 'Inspect resource details.',
    parameters: ['resource_type', 'action', 'id', 'detail', 'format'],
    status: 'working',
  },
  {
    id: 'common:reload',
    summary: 'Hot-reload a specific resource from disk.',
    parameters: ['resource_type', 'action', 'id', 'reason'],
    status: 'working',
  },
  {
    id: 'common:delete',
    summary: 'Delete a resource (with confirmation).',
    parameters: ['resource_type', 'action', 'id', 'confirm', 'reason'],
    status: 'working',
  },
  {
    id: 'common:history',
    summary: 'View version history for a resource.',
    parameters: ['resource_type', 'action', 'id', 'limit'],
    status: 'working',
  },
  {
    id: 'common:rollback',
    summary: 'Rollback a resource to a previous version.',
    parameters: ['resource_type', 'action', 'id', 'version', 'reason'],
    status: 'working',
  },
  {
    id: 'common:compare',
    summary: 'Compare two versions of a resource.',
    parameters: ['resource_type', 'action', 'id', 'from_version', 'to_version'],
    status: 'working',
  },
];

export const resource_managerMetadata = { tool: 'resource_manager', version: 1 };
