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

export type skills_syncParamName =
  | 'action'
  | 'client'
  | 'scope'
  | 'resource_type'
  | 'id'
  | 'prune'
  | 'dry_run'
  | 'output'
  | 'file'
  | 'category'
  | 'preview'
  | 'force';
export const skills_syncParameters: ToolParameter[] = [
  {
    name: 'action',
    type: 'enum[status|export|sync|diff|pull|clone]',
    description:
      'Operation: status (inspect config/manifests), export (write skills), sync (reconcile to registrations with optional prune), diff (show drift and optional .patch output), pull (merge exported prose edits back to canonical YAML), clone (create canonical resources from SKILL.md).',
    required: true,
    status: 'working',
    compatibility: 'canonical',
    examples: [
      'skills_sync({"action":"status"})',
      'skills_sync({"action":"export","client":"claude-code","scope":"project"})',
      'skills_sync({"action":"sync","client":"claude-code","scope":"user","dry_run":true})',
      'skills_sync({"action":"diff","client":"all"})',
      'skills_sync({"action":"diff","client":"claude-code","output":"./patches"})',
      'skills_sync({"action":"pull","client":"claude-code","preview":true})',
      'skills_sync({"action":"clone","file":"~/.claude/skills/my-skill/SKILL.md","id":"my-skill","category":"tools"})',
    ],
  },
  {
    name: 'client',
    type: 'string',
    description: 'Target client id. Use one of: claude-code, cursor, codex, opencode, or all.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'scope',
    type: 'enum[user|project]',
    description: 'Output scope for client directories. Default: user.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'resource_type',
    type: 'enum[prompt|gate|framework|style]',
    description: 'Optional resource type filter.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'id',
    type: 'string',
    description: 'Optional resource id filter.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'prune',
    type: 'boolean',
    description:
      'For sync: when true (default), remove stale managed skills not present in current registrations.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'dry_run',
    type: 'boolean',
    description: 'For export/sync/pull/clone: show planned changes without writing files.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'output',
    type: 'string',
    description: 'For diff: write .patch files to this directory instead of stdout only.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'file',
    type: 'string',
    description: 'For clone: path to the source SKILL.md file. Required for clone action.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'category',
    type: 'string',
    description: 'For clone: target category for prompt resources. Default: general.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'preview',
    type: 'boolean',
    description: 'For pull: show unified diffs without writing changes.',
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'force',
    type: 'boolean',
    description: 'For clone: overwrite existing resource directory.',
    status: 'working',
    compatibility: 'canonical',
  },
];

export const skills_syncCommands: ToolCommand[] = [
  {
    id: 'status',
    summary: 'Show sync config and manifest availability.',
    parameters: ['action'],
    status: 'working',
  },
  {
    id: 'export',
    summary: 'Export skills from canonical resources.',
    parameters: ['action', 'client', 'scope', 'resource_type', 'id', 'dry_run'],
    status: 'working',
  },
  {
    id: 'sync',
    summary: 'Reconcile clients to registrations (export/update plus optional prune).',
    parameters: ['action', 'client', 'scope', 'resource_type', 'id', 'prune', 'dry_run'],
    status: 'working',
  },
  {
    id: 'diff',
    summary: 'Compare canonical and exported outputs; optional .patch output.',
    parameters: ['action', 'client', 'scope', 'resource_type', 'id', 'output'],
    status: 'working',
  },
  {
    id: 'pull',
    summary: 'Merge exported prose edits back into canonical YAML.',
    parameters: ['action', 'client', 'scope', 'resource_type', 'id', 'preview', 'dry_run'],
    status: 'working',
  },
  {
    id: 'clone',
    summary: 'Create canonical resources from external SKILL.md.',
    parameters: ['action', 'file', 'id', 'category', 'resource_type', 'force', 'dry_run'],
    status: 'working',
  },
];

export const skills_syncMetadata = { tool: 'skills_sync', version: 1 };
