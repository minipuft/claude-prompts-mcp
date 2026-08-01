import { output } from '../lib/output.js';

interface GuideOptions {
  json: boolean;
  goal?: string;
}

interface CliAction {
  id: string;
  command: string;
  category: 'lifecycle' | 'discovery' | 'versioning' | 'workspace';
  description: string;
  keywords: string[];
}

const CLI_ACTIONS: CliAction[] = [
  {
    id: 'validate',
    command: 'cpm validate [--prompts|--gates|--frameworks|--styles|--all]',
    category: 'discovery',
    description: 'Validate workspace resources against Zod schemas',
    keywords: ['check', 'verify', 'lint', 'schema', 'valid'],
  },
  {
    id: 'list',
    command: 'cpm list <type>',
    category: 'discovery',
    description: 'List resources by type',
    keywords: ['show', 'catalog', 'discover', 'find', 'browse'],
  },
  {
    id: 'inspect',
    command: 'cpm inspect <type> <id>',
    category: 'discovery',
    description: 'Inspect a specific resource in detail',
    keywords: ['view', 'show', 'detail', 'read', 'examine'],
  },
  {
    id: 'init',
    command: 'cpm init [path]',
    category: 'workspace',
    description: 'Initialize a new workspace with starter prompts and config.json',
    keywords: ['setup', 'start', 'bootstrap', 'new', 'workspace', 'config'],
  },
  {
    id: 'config',
    command: 'cpm config <list|get|set|validate|reset|keys>',
    category: 'workspace',
    description: 'Manage workspace configuration (config.json)',
    keywords: ['config', 'settings', 'configure', 'setup', 'mode', 'toggle', 'transport'],
  },
  {
    id: 'create',
    command: 'cpm create <type> <id>',
    category: 'lifecycle',
    description: 'Create a new resource with template YAML',
    keywords: ['add', 'new', 'scaffold', 'make', 'generate'],
  },
  {
    id: 'delete',
    command: 'cpm delete <type> <id> --force',
    category: 'lifecycle',
    description: 'Delete a resource and its version history',
    keywords: ['remove', 'destroy', 'clean', 'purge'],
  },
  {
    id: 'history',
    command: 'cpm history <type> <id>',
    category: 'versioning',
    description: 'Show version history for a resource',
    keywords: ['versions', 'log', 'changelog', 'timeline'],
  },
  {
    id: 'compare',
    command: 'cpm compare <type> <id> <from> <to>',
    category: 'versioning',
    description: 'Compare two resource versions',
    keywords: ['diff', 'difference', 'changes', 'delta'],
  },
  {
    id: 'rollback',
    command: 'cpm rollback <type> <id> <version>',
    category: 'versioning',
    description: 'Restore a previous resource version',
    keywords: ['revert', 'undo', 'restore', 'recover', 'reset'],
  },
  {
    id: 'rename',
    command: 'cpm rename <type> <old-id> <new-id>',
    category: 'lifecycle',
    description: 'Rename a resource (directory + YAML id)',
    keywords: ['rename', 'change', 'refactor', 'name', 'id'],
  },
  {
    id: 'move',
    command: 'cpm move prompt <id> --category <cat>',
    category: 'lifecycle',
    description: 'Move a prompt to a different category',
    keywords: ['move', 'category', 'reorganize', 'relocate'],
  },
  {
    id: 'toggle',
    command: 'cpm toggle <framework|style> <id>',
    category: 'lifecycle',
    description: 'Toggle enabled state for a framework or style',
    keywords: ['toggle', 'enable', 'disable', 'activate', 'switch'],
  },
  {
    id: 'link-gate',
    command: 'cpm link-gate <prompt-id> <gate-id>',
    category: 'lifecycle',
    description: 'Link or unlink a gate to a prompt',
    keywords: ['gate', 'link', 'unlink', 'attach', 'quality'],
  },
  {
    id: 'enable',
    command: 'cpm enable <subsystem>',
    category: 'workspace',
    description: 'Enable a subsystem (shorthand for config set)',
    keywords: ['enable', 'on', 'activate', 'start', 'mode'],
  },
  {
    id: 'disable',
    command: 'cpm disable <subsystem>',
    category: 'workspace',
    description: 'Disable a subsystem (shorthand for config set)',
    keywords: ['disable', 'off', 'deactivate', 'stop', 'mode'],
  },
];

const CATEGORIES = ['lifecycle', 'discovery', 'versioning', 'workspace'] as const;

function scoreAction(action: CliAction, goal: string): number {
  const normalized = goal.toLowerCase();
  let score = 5; // base score

  // ID match
  if (normalized.includes(action.id)) {
    score += 4;
  }

  // Description match
  if (action.description.toLowerCase().includes(normalized)) {
    score += 3;
  }

  // Keyword match
  for (const keyword of action.keywords) {
    if (normalized.includes(keyword) || keyword.includes(normalized)) {
      score += 6;
      break;
    }
  }

  // Category match
  if (normalized.includes(action.category)) {
    score += 2;
  }

  return score;
}

export async function guide(options: GuideOptions): Promise<number> {
  const goal = options.goal?.trim() ?? '';

  if (options.json) {
    const data = goal
      ? CLI_ACTIONS.map((a) => ({ ...a, score: scoreAction(a, goal) })).sort((a, b) => b.score - a.score)
      : CLI_ACTIONS;
    output(data, { json: true });
    return 0;
  }

  const lines: string[] = [];
  lines.push('CPM CLI Guide');
  lines.push('');

  if (goal) {
    lines.push(`  Goal: "${goal}"`);
    lines.push('');

    const ranked = CLI_ACTIONS.map((a) => ({ action: a, score: scoreAction(a, goal) }))
      .sort((a, b) => b.score - a.score);

    const recommended = ranked.slice(0, 4);

    lines.push('  Recommended:');
    for (const { action } of recommended) {
      const padded = action.command.padEnd(48);
      lines.push(`    ${padded} ${action.description}`);
    }
    lines.push('');
  }

  lines.push('  All Commands:');
  for (const category of CATEGORIES) {
    const actions = CLI_ACTIONS.filter((a) => a.category === category);
    const ids = actions.map((a) => a.id).join(', ');
    lines.push(`    ${category.padEnd(14)} ${ids}`);
  }

  lines.push('');
  lines.push("  Use 'cpm <command> --help' for detailed usage.");

  console.log(lines.join('\n'));
  return 0;
}
