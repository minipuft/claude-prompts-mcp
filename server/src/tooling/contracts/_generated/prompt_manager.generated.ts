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

export type prompt_managerParamName =
  | 'action'
  | 'id'
  | 'name'
  | 'description'
  | 'user_message_template'
  | 'system_message'
  | 'category'
  | 'arguments'
  | 'chain_steps'
  | 'execution_hint'
  | 'section'
  | 'section_content'
  | 'filter'
  | 'format'
  | 'detail'
  | 'confirm'
  | 'reason';
export const prompt_managerParameters: ToolParameter[] = [
  {
    name: 'action',
    type: 'enum[create|update|delete|reload|list|inspect|analyze_type|analyze_gates|guide]',
    description:
      'The operation to perform: create (new prompt), update (modify existing), delete (remove), list (discover IDs), inspect (view details), analyze_type/analyze_gates (get recommendations), reload (refresh from disk), guide (get action suggestions).',
    required: true,
    status: 'working',
    compatibility: 'canonical',
    examples: [
      'prompt_manager({"action":"create","id":"demo","name":"Demo","description":"Greeting","user_message_template":"Hello {{name}}"})',
      'prompt_manager({"action":"update","id":"demo","section":"user_message_template","section_content":"Updated {{name}}"})',
      'prompt_manager({"action":"list","filter":"category:analysis","format":"table"})',
      'prompt_manager({"action":"reload","reason":"refresh prompts"})',
    ],
    notes: [
      'Single-shot operations; chain multiple calls when sequencing edits or reloads.',
      'Required fields per action: create (id, name, description, user_message_template, optional arguments/chain_steps), update (id + section/section_content or fields), delete (id + confirm), reload (reason optional), list/inspect/analyze/guide use filters/detail as needed.',
    ],
  },
  {
    name: 'id',
    type: 'string',
    description: 'Prompt identifier (required for most actions).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'name',
    type: 'string',
    description: 'Human-friendly name (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'description',
    type: 'string',
    description: 'Prompt description (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'user_message_template',
    type: 'string',
    description: 'Prompt body/template (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'system_message',
    type: 'string',
    description: 'Optional system message (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'category',
    type: 'string',
    description: 'Category tag (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'arguments',
    type: 'array<{name,required?,description?,type?}>',
    description: 'Prompt arguments metadata (create/update).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'chain_steps',
    type: 'array<step>',
    description: 'Chain steps definition (create/update for chains).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'execution_hint',
    type: 'enum[single|chain]',
    description: 'Hint for execution type on creation.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'section',
    type: 'enum[name|description|system_message|user_message_template|arguments|chain_steps]',
    description: 'Targeted update section.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'section_content',
    type: 'string',
    description: 'Content for targeted section updates.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'filter',
    type: 'string',
    description: 'List filter query (list action).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'format',
    type: 'enum[table|json|text]',
    description: 'Output format for list/inspect.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'detail',
    type: 'enum[summary|full]',
    description: 'Inspect detail level.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'confirm',
    type: 'boolean',
    description: 'Safety confirmation (delete).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'reason',
    type: 'string',
    description: 'Audit reason (reload/delete).',
    status: 'working',
    compatibility: 'canonical',
  },
];

export const prompt_managerCommands: ToolCommand[] = [
  {
    id: 'create',
    summary: 'Create a prompt/chain with metadata and arguments.',
    parameters: [
      'action',
      'id',
      'name',
      'user_message_template',
      'execution_hint',
      'arguments',
      'chain_steps',
    ],
    status: 'working',
  },
  {
    id: 'update',
    summary: 'Update prompt fields or targeted sections.',
    parameters: ['action', 'id', 'section', 'section_content'],
    status: 'working',
  },
  {
    id: 'list',
    summary: 'List prompts with filters.',
    parameters: ['action', 'filter', 'format'],
    status: 'working',
  },
  {
    id: 'inspect',
    summary: 'Inspect a prompt with optional detail level.',
    parameters: ['action', 'id', 'detail', 'format'],
    status: 'working',
  },
  {
    id: 'analyze_type',
    summary: 'Semantic analysis for execution type recommendation.',
    parameters: ['action', 'id'],
    status: 'working',
  },
  {
    id: 'analyze_gates',
    summary: 'Gate configuration suggestions.',
    parameters: ['action', 'id'],
    status: 'working',
  },
  {
    id: 'reload',
    summary: 'Reload prompt registry after edits.',
    parameters: ['action', 'reason'],
    status: 'working',
  },
  {
    id: 'delete',
    summary: 'Delete a prompt (with confirmation).',
    parameters: ['action', 'id', 'confirm'],
    status: 'working',
  },
];

export const prompt_managerMetadata = { tool: 'prompt_manager', version: 1 };
