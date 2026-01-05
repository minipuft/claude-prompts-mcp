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

export type resource_managerParamName = 'resource_type' | 'action' | 'id' | 'name' | 'description' | 'enabled_only' | 'confirm' | 'reason' | 'category' | 'user_message_template' | 'system_message' | 'arguments' | 'chain_steps' | 'tools' | 'gate_configuration' | 'execution_hint' | 'section' | 'section_content' | 'filter' | 'format' | 'detail' | 'search_query' | 'gate_type' | 'guidance' | 'pass_criteria' | 'activation' | 'retry_config' | 'methodology' | 'system_prompt_guidance' | 'phases' | 'gates' | 'tool_descriptions' | 'enabled' | 'persist' | 'version' | 'from_version' | 'to_version' | 'limit' | 'skip_version';
export const resource_managerParameters: ToolParameter[] = [
  {
    "name": "resource_type",
    "type": "enum[prompt|gate|methodology]",
    "description": "Type of resource to manage. Routes to appropriate handler.",
    "required": true,
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "action",
    "type": "enum[create|update|delete|reload|list|inspect|analyze_type|analyze_gates|guide|switch|history|rollback|compare]",
    "description": "Operation to perform. Type-specific: analyze_type/guide (prompt), switch (methodology). Versioning: history/rollback/compare (all types).",
    "required": true,
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "id",
    "type": "string",
    "description": "Resource identifier. Required for create, update, delete, inspect, reload, switch.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "name",
    "type": "string",
    "description": "Human-friendly name for the resource (create/update).",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "description",
    "type": "string",
    "description": "Resource description explaining its purpose (create/update).",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "enabled_only",
    "type": "boolean",
    "description": "Filter list to enabled resources only. Default: true.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "confirm",
    "type": "boolean",
    "description": "Safety confirmation for delete operation.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "reason",
    "type": "string",
    "description": "Audit reason for reload/delete/switch operations.",
    "status": "working",
    "compatibility": "canonical"
  },
  {
    "name": "category",
    "type": "string",
    "description": "[Prompt] Category tag for the prompt.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "user_message_template",
    "type": "string",
    "description": "[Prompt] Prompt body/template with Nunjucks placeholders.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "system_message",
    "type": "string",
    "description": "[Prompt] Optional system message for the prompt.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "arguments",
    "type": "array<{name,required?,description?,type?}>",
    "description": "[Prompt] Argument definitions for the prompt.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "chain_steps",
    "type": "array<step>",
    "description": "[Prompt] Chain steps definition for multi-step prompts.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "tools",
    "type": "array<{id,name,script,description?,runtime?,schema?,trigger?,confirm?,strict?,timeout?}>",
    "description": "[Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python|node|shell|auto), schema (JSON Schema object), trigger (schema_match|explicit|always|never), confirm, strict, timeout.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "gate_configuration",
    "type": "object",
    "description": "[Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean).",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "execution_hint",
    "type": "enum[single|chain]",
    "description": "[Prompt] Hint for execution type on creation.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "section",
    "type": "enum[name|description|system_message|user_message_template|arguments|chain_steps]",
    "description": "[Prompt] Targeted update section.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "section_content",
    "type": "string",
    "description": "[Prompt] Content for targeted section updates.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "filter",
    "type": "string",
    "description": "[Prompt] List filter query.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "format",
    "type": "enum[table|json|text]",
    "description": "[Prompt] Output format for list/inspect.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "detail",
    "type": "enum[summary|full]",
    "description": "[Prompt] Inspect detail level.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "search_query",
    "type": "string",
    "description": "[Prompt] Search query for filtering (list action).",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "gate_type",
    "type": "enum[validation|guidance]",
    "description": "[Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "guidance",
    "type": "string",
    "description": "[Gate] Gate guidance content - the criteria or instructions.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "pass_criteria",
    "type": "array<string>",
    "description": "[Gate] Structured pass criteria definitions.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "activation",
    "type": "object",
    "description": "[Gate] Activation rules: prompt_categories, frameworks, explicit_request.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "retry_config",
    "type": "object",
    "description": "[Gate] Retry configuration: max_attempts, improvement_hints.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "methodology",
    "type": "string",
    "description": "[Methodology] Methodology type identifier. Use action:'list' to see registered methodologies.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "system_prompt_guidance",
    "type": "string",
    "description": "[Methodology] System prompt guidance injected when active.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "phases",
    "type": "array<object>",
    "description": "[Methodology] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (methodology_gates, processing_steps, execution_steps, etc.) are also accepted.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "gates",
    "type": "object",
    "description": "[Methodology] Gate configuration: include, exclude arrays.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "tool_descriptions",
    "type": "object",
    "description": "[Methodology] Tool description overlays when active.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "enabled",
    "type": "boolean",
    "description": "[Methodology] Whether the methodology is enabled.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "persist",
    "type": "boolean",
    "description": "[Methodology] For switch: persist the change to config. Default: false.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "version",
    "type": "number",
    "description": "[Versioning] Target version number for rollback action.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "from_version",
    "type": "number",
    "description": "[Versioning] Starting version number for compare action.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "to_version",
    "type": "number",
    "description": "[Versioning] Ending version number for compare action.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "limit",
    "type": "number",
    "description": "[Versioning] Max versions to return in history. Default: 10.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  },
  {
    "name": "skip_version",
    "type": "boolean",
    "description": "[Versioning] Skip auto-versioning on update. Default: false.",
    "status": "working",
    "compatibility": "canonical",
    "includeInDescription": false
  }
];

export const resource_managerCommands: ToolCommand[] = [
  {
    "id": "prompt:create",
    "summary": "Create a prompt/chain with metadata and arguments.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "name",
      "description",
      "category",
      "user_message_template",
      "system_message",
      "arguments",
      "chain_steps",
      "tools",
      "gate_configuration",
      "execution_hint"
    ],
    "status": "working"
  },
  {
    "id": "prompt:update",
    "summary": "Update prompt fields or targeted sections.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "section",
      "section_content",
      "name",
      "description",
      "user_message_template",
      "tools"
    ],
    "status": "working"
  },
  {
    "id": "prompt:list",
    "summary": "List prompts with filters.",
    "parameters": [
      "resource_type",
      "action",
      "filter",
      "format",
      "search_query"
    ],
    "status": "working"
  },
  {
    "id": "prompt:analyze_type",
    "summary": "Semantic analysis for execution type recommendation.",
    "parameters": [
      "resource_type",
      "action",
      "id"
    ],
    "status": "working"
  },
  {
    "id": "prompt:analyze_gates",
    "summary": "Gate configuration suggestions for a prompt.",
    "parameters": [
      "resource_type",
      "action",
      "id"
    ],
    "status": "working"
  },
  {
    "id": "prompt:guide",
    "summary": "Get action suggestions for prompt management.",
    "parameters": [
      "resource_type",
      "action"
    ],
    "status": "working"
  },
  {
    "id": "gate:create",
    "summary": "Create a new gate with YAML configuration and guidance.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "name",
      "gate_type",
      "description",
      "guidance",
      "pass_criteria",
      "activation",
      "retry_config"
    ],
    "status": "working"
  },
  {
    "id": "gate:update",
    "summary": "Update existing gate configuration or guidance.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "name",
      "gate_type",
      "description",
      "guidance",
      "pass_criteria",
      "activation",
      "retry_config"
    ],
    "status": "working"
  },
  {
    "id": "gate:list",
    "summary": "List all registered gates.",
    "parameters": [
      "resource_type",
      "action",
      "enabled_only"
    ],
    "status": "working"
  },
  {
    "id": "methodology:create",
    "summary": "Create a new methodology with YAML configuration.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "name",
      "methodology",
      "description",
      "system_prompt_guidance",
      "phases",
      "gates",
      "tool_descriptions"
    ],
    "status": "working"
  },
  {
    "id": "methodology:update",
    "summary": "Update existing methodology configuration.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "name",
      "methodology",
      "description",
      "system_prompt_guidance",
      "phases",
      "gates",
      "tool_descriptions",
      "enabled"
    ],
    "status": "working"
  },
  {
    "id": "methodology:list",
    "summary": "List all available methodologies.",
    "parameters": [
      "resource_type",
      "action",
      "enabled_only"
    ],
    "status": "working"
  },
  {
    "id": "methodology:switch",
    "summary": "Switch the active framework/methodology.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "persist",
      "reason"
    ],
    "status": "working"
  },
  {
    "id": "common:inspect",
    "summary": "Inspect resource details.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "detail",
      "format"
    ],
    "status": "working"
  },
  {
    "id": "common:reload",
    "summary": "Hot-reload a specific resource from disk.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "reason"
    ],
    "status": "working"
  },
  {
    "id": "common:delete",
    "summary": "Delete a resource (with confirmation).",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "confirm",
      "reason"
    ],
    "status": "working"
  },
  {
    "id": "common:history",
    "summary": "View version history for a resource.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "limit"
    ],
    "status": "working"
  },
  {
    "id": "common:rollback",
    "summary": "Rollback a resource to a previous version.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "version",
      "reason"
    ],
    "status": "working"
  },
  {
    "id": "common:compare",
    "summary": "Compare two versions of a resource.",
    "parameters": [
      "resource_type",
      "action",
      "id",
      "from_version",
      "to_version"
    ],
    "status": "working"
  }
];

export const resource_managerMetadata = { tool: 'resource_manager', version: 1 };

