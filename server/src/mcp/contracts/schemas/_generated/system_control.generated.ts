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
  resolvesPendingRun?: boolean; // True when supplying this param resolves a run pending a review (failed gate or unknown interrupt)
}

export interface ToolCommand {
  id: string;
  summary: string;
  parameters?: string[];
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental'; // Required with default value
  notes?: string[];
}

export type system_controlParamName =
  | 'action'
  | 'operation'
  | 'session_id'
  | 'framework'
  | 'reason'
  | 'persist'
  | 'show_details'
  | 'include_history'
  | 'include_metrics'
  | 'topic'
  | 'include_planned'
  | 'search_query'
  | 'confirm'
  | 'limit'
  | 'config'
  | 'backup_path'
  | 'type'
  | 'enabled'
  | 'scope'
  | 'scope_id'
  | 'expires_in_ms'
  | 'source'
  | 'since'
  | 'resource_type'
  | 'client'
  | 'id'
  | 'prune'
  | 'preview'
  | 'preview_detail'
  | 'output'
  | 'file'
  | 'category'
  | 'force';
export const system_controlParameters: ToolParameter[] = [
  {
    name: 'action',
    type: 'enum[status|framework|gates|analytics|config|maintenance|guide|injection|session|changes|execution_history|skills_sync]',
    description:
      'The operation to perform: status (runtime overview), framework (switch/enable/disable frameworks), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations), injection (session overrides for injected guidance), session (manage execution sessions — list/clear/inspect; cancel moved to prompt_engine), changes (resource change audit log), execution_history (chain execution ledger, newest first), skills_sync (export canonical resources to client skill packages — set operation to status|export|sync|diff|pull|clone).',
    required: true,
    status: 'working',
    compatibility: 'canonical',
    examples: [
      'system_control({"action":"status","show_details":true})',
      'system_control({"action":"framework","operation":"switch","framework":"CAGEERF","reason":"enable framework"})',
      'system_control({"action":"gates","operation":"disable","reason":"maintenance","persist":true})',
      'system_control({"action":"session","operation":"clear","session_id":"chain-123"})',
      'system_control({"action":"injection","operation":"override","type":"system-prompt","enabled":false})',
      'system_control({"action":"skills_sync","operation":"export","client":"claude-code","preview":true})',
    ],
    notes: ['Single-call operations; sequence multiple admin steps with separate requests.'],
  },
  {
    name: 'operation',
    type: 'string',
    description:
      'Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list; analytics view/reset/history; config restore/validate; maintenance restart; injection status/override/reset; session list/clear/inspect; changes list; execution_history list; skills_sync status/export/sync/diff/pull/clone).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'session_id',
    type: 'string',
    description: 'Target session ID or chain ID for session operations.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'framework',
    type: 'string',
    description:
      "Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'reason',
    type: 'string',
    description: 'Audit reason for framework/gate toggles or admin actions.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'persist',
    type: 'boolean',
    description:
      'When true, gate/framework enable/disable changes are also written to config.json.',
    status: 'working',
    compatibility: 'canonical',
    notes: [
      'Applies to gate operations (enable/disable) and framework system enable/disable.',
      'Uses SafeConfigWriter; falls back to runtime-only if unavailable.',
    ],
  },
  {
    name: 'show_details',
    type: 'boolean',
    description: 'Include detailed output (status/analytics/framework/gate reports).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'include_history',
    type: 'boolean',
    description: 'Include recorded history where supported.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'include_metrics',
    type: 'boolean',
    description: 'Include detailed metrics output (where supported).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'topic',
    type: 'string',
    description: 'Guide topic when requesting guidance.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'include_planned',
    type: 'boolean',
    description: 'For guide: set false to leave out operations marked planned. Default: true.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'search_query',
    type: 'string',
    description:
      'Filter gates by keyword (matches ID, name, or description). Use with gates:list action.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'confirm',
    type: 'boolean',
    description:
      'Required `true` for operations that replace or discard state: config restore, analytics reset and maintenance restart. Each refuses without it.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'limit',
    type: 'number',
    description:
      'Maximum entries to return, for analytics history, changes list and execution_history list.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'config',
    type: 'object',
    description:
      'For config: `{ key, value?, operation }`, where `operation` is get, set, list or validate and `value` is the string to set or check. Omit it to list the configuration.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'backup_path',
    type: 'string',
    description:
      'For config restore: path of the backup file to restore. Requires `confirm: true`.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'type',
    type: 'enum[system-prompt|gate-guidance|style-guidance]',
    description: 'For injection override: the injection type to override.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'enabled',
    type: 'boolean',
    description:
      'For injection override: `true` turns the injection on, `false` turns it off. Required.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'scope',
    type: 'enum[user|project|session|chain|step]',
    description:
      "Read by two actions with different values. skills_sync: `user` (default) or `project` client directories. injection override: `session` (default), `chain` or `step`. Each action refuses the other's values.",
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'scope_id',
    type: 'string',
    description:
      'For injection override: the chain or step id a `chain` or `step` scoped override applies to.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'expires_in_ms',
    type: 'number',
    description:
      'For injection override: milliseconds until the override expires. Omit it to keep the override until reset.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'source',
    type: 'enum[filesystem|mcp-tool|external]',
    description:
      'For changes list: only changes from this source — filesystem (a file edit hot reload detected), mcp-tool (a resource_manager write) or external (a change made while the server was down).',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'since',
    type: 'string',
    description: 'For changes list: only changes recorded since this ISO 8601 timestamp.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'resource_type',
    type: 'enum[prompt|gate|framework|style]',
    description:
      'Resource type filter. skills_sync accepts prompt, gate, framework or style; changes list records prompt and gate only.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'client',
    type: 'string',
    description:
      'For skills_sync: target client id. Use one of: claude-code, cursor, codex, opencode, or all.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'id',
    type: 'string',
    description:
      'For skills_sync: resource id filter, or for clone the id of the resource to create.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'prune',
    type: 'boolean',
    description:
      'For skills_sync sync: when true (default), remove stale managed skills not present in current registrations.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'preview',
    type: 'boolean',
    description:
      'For skills_sync export/sync/pull/clone: report every file, prune and registration change the run would make, and make none of them.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'preview_detail',
    type: 'enum[summary|diff]',
    description:
      'For skills_sync: how much `preview` shows. `summary` (default) lists the planned changes; `diff` adds unified diffs and is valid for `pull` only, the one command that computes prose changes. Requires `preview: true` — on its own it would not be read, so it is refused by name.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'output',
    type: 'string',
    description:
      'For skills_sync diff: write .patch files to this directory instead of stdout only.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'file',
    type: 'string',
    description: 'For skills_sync clone: path to the source SKILL.md file. Required for clone.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'category',
    type: 'string',
    description: 'For skills_sync clone: target category for prompt resources. Default: general.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'force',
    type: 'boolean',
    description: 'For skills_sync clone: overwrite an existing resource directory.',
    status: 'working',
    compatibility: 'canonical',
  },
];

export const system_controlCommands: ToolCommand[] = [
  {
    id: 'status',
    summary: 'Runtime status overview (framework, gates, health).',
    parameters: ['action', 'show_details', 'include_history', 'include_metrics'],
    status: 'working',
  },
  {
    id: 'framework:switch',
    summary: 'Switch active framework with audit reason.',
    parameters: ['action', 'framework', 'reason'],
    status: 'working',
  },
  {
    id: 'framework:enable',
    summary: 'Enable framework system (with optional persistence to config).',
    parameters: ['action', 'operation', 'reason', 'persist'],
    status: 'working',
  },
  {
    id: 'framework:disable',
    summary: 'Disable framework system (with optional persistence to config).',
    parameters: ['action', 'operation', 'reason', 'persist'],
    status: 'working',
  },
  {
    id: 'framework:list',
    summary: 'List available frameworks.',
    parameters: ['action', 'operation', 'show_details'],
    status: 'working',
  },
  {
    id: 'framework:list_frameworks',
    summary: 'List framework guides.',
    parameters: ['action', 'operation', 'show_details'],
    status: 'working',
  },
  {
    id: 'gates:enable',
    summary: 'Enable gate system (with optional persistence to config).',
    parameters: ['action', 'operation', 'reason', 'persist'],
    status: 'working',
  },
  {
    id: 'gates:disable',
    summary: 'Disable gate system (with optional persistence to config).',
    parameters: ['action', 'operation', 'reason', 'persist'],
    status: 'working',
  },
  {
    id: 'gates:status',
    summary: 'Gate system status overview.',
    parameters: ['action', 'operation'],
    status: 'working',
  },
  {
    id: 'gates:health',
    summary: 'Gate system health details.',
    parameters: ['action', 'operation'],
    status: 'working',
  },
  {
    id: 'gates:list',
    summary:
      'List available canonical gates with optional search filtering. Shortcut: >>gates [search]',
    parameters: ['action', 'operation', 'search_query'],
    status: 'working',
  },
  {
    id: 'analytics',
    summary:
      'Retrieve analytics summary with optional detail/history; history lists framework switches, reset clears metrics.',
    parameters: ['action', 'operation', 'show_details', 'include_history', 'limit', 'confirm'],
    status: 'working',
  },
  {
    id: 'config',
    summary: 'Configuration operations (list/get/set/restore/validate).',
    parameters: ['action', 'operation', 'config', 'backup_path', 'confirm', 'reason'],
    status: 'working',
  },
  {
    id: 'maintenance',
    summary: 'Maintenance operations (restart).',
    parameters: ['action', 'operation', 'reason', 'confirm'],
    status: 'working',
  },
  {
    id: 'guide',
    summary: 'Guidance on available system operations.',
    parameters: ['action', 'topic', 'include_planned'],
    status: 'working',
  },
  {
    id: 'injection:status',
    summary: 'Show injection configuration and active session overrides.',
    parameters: ['action', 'operation'],
    status: 'working',
  },
  {
    id: 'injection:override',
    summary: 'Set a session override for one injection type.',
    parameters: ['action', 'operation', 'type', 'enabled', 'scope', 'scope_id', 'expires_in_ms'],
    status: 'working',
  },
  {
    id: 'injection:reset',
    summary: 'Clear every session override.',
    parameters: ['action', 'operation'],
    status: 'working',
  },
  {
    id: 'session:list',
    summary: 'List active chain sessions.',
    parameters: ['action', 'operation', 'show_details'],
    status: 'working',
  },
  {
    id: 'session:clear',
    summary: 'Clear a specific session or chain history.',
    parameters: ['action', 'operation', 'session_id'],
    status: 'working',
  },
  {
    id: 'session:inspect',
    summary: 'Inspect session details.',
    parameters: ['action', 'operation', 'session_id'],
    status: 'working',
  },
  {
    id: 'changes:list',
    summary: 'List recorded resource changes, newest first.',
    parameters: ['action', 'operation', 'source', 'resource_type', 'since', 'limit'],
    status: 'working',
  },
  {
    id: 'execution_history:list',
    summary: 'List recent chain executions from the execution ledger.',
    parameters: ['action', 'operation', 'limit'],
    status: 'working',
  },
  {
    id: 'skills_sync:status',
    summary: 'Show sync config and manifest availability.',
    parameters: ['action', 'operation'],
    status: 'working',
  },
  {
    id: 'skills_sync:export',
    summary: 'Export skills from canonical resources.',
    parameters: ['action', 'operation', 'client', 'scope', 'resource_type', 'id', 'preview'],
    status: 'working',
  },
  {
    id: 'skills_sync:sync',
    summary: 'Reconcile clients to registrations (export/update plus optional prune).',
    parameters: [
      'action',
      'operation',
      'client',
      'scope',
      'resource_type',
      'id',
      'prune',
      'preview',
    ],
    status: 'working',
  },
  {
    id: 'skills_sync:diff',
    summary: 'Compare canonical and exported outputs; optional .patch output.',
    parameters: ['action', 'operation', 'client', 'scope', 'resource_type', 'id', 'output'],
    status: 'working',
  },
  {
    id: 'skills_sync:pull',
    summary: 'Merge exported prose edits back into canonical YAML.',
    parameters: [
      'action',
      'operation',
      'client',
      'scope',
      'resource_type',
      'id',
      'preview',
      'preview_detail',
    ],
    status: 'working',
  },
  {
    id: 'skills_sync:clone',
    summary: 'Create canonical resources from external SKILL.md.',
    parameters: [
      'action',
      'operation',
      'file',
      'id',
      'category',
      'resource_type',
      'force',
      'preview',
    ],
    status: 'working',
  },
];

export const system_controlMetadata = { tool: 'system_control', version: 1 };
