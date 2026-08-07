import { parseArgs } from 'node:util';
import { validate } from './commands/validate.js';
import { list } from './commands/list.js';
import { inspect } from './commands/inspect.js';
import { init } from './commands/init.js';
import { create } from './commands/create.js';
import { del } from './commands/delete.js';
import { history } from './commands/history.js';
import { compare } from './commands/compare.js';
import { rollback } from './commands/rollback.js';
import { rename } from './commands/rename.js';
import { move } from './commands/move.js';
import { toggle } from './commands/toggle.js';
import { linkGateCmd } from './commands/link-gate.js';
import { guide } from './commands/guide.js';
import { config } from './commands/config.js';
import { enableDisable } from './commands/enable-disable.js';
import { output } from './lib/output.js';

const VERSION = process.env['CPM_VERSION'] ?? 'development';

const COMMANDS = [
  'validate',
  'list',
  'inspect',
  'init',
  'create',
  'delete',
  'history',
  'compare',
  'rollback',
  'rename',
  'move',
  'toggle',
  'link-gate',
  'guide',
  'config',
  'enable',
  'disable',
] as const;
type CommandName = (typeof COMMANDS)[number];

interface GlobalOptions {
  help: boolean;
  version: boolean;
  workspace?: string;
  json: boolean;
}

interface ParsedArgs {
  global: GlobalOptions;
  command?: CommandName;
  positionals: string[];
  flags: Record<string, string | boolean | undefined>;
}

function parseCliArgs(args: string[] = process.argv.slice(2)): ParsedArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      workspace: { type: 'string', short: 'w' },
      json: { type: 'boolean' },
      // validate flags
      prompts: { type: 'boolean' },
      gates: { type: 'boolean' },
      frameworks: { type: 'boolean' },
      styles: { type: 'boolean' },
      config: { type: 'boolean' },
      all: { type: 'boolean' },
      // create flags
      name: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string' },
      // delete flags
      force: { type: 'boolean', short: 'f' },
      // history flags
      limit: { type: 'string' },
      // link-gate flags
      remove: { type: 'boolean' },
      'no-validate': { type: 'boolean' },
      // config flags
      value: { type: 'string' },
    },
    strict: true,
    allowPositionals: true,
  });

  const [commandName, ...rest] = positionals;
  const command = COMMANDS.includes(commandName as CommandName)
    ? (commandName as CommandName)
    : undefined;

  return {
    global: {
      help: Boolean(values.help),
      version: Boolean(values.version),
      workspace: values.workspace as string | undefined,
      json: Boolean(values.json),
    },
    command,
    positionals: command ? rest : positionals,
    flags: {
      prompts: values.prompts as boolean | undefined,
      gates: values.gates as boolean | undefined,
      frameworks: values.frameworks as boolean | undefined,
      styles: values.styles as boolean | undefined,
      config: values.config as boolean | undefined,
      all: values.all as boolean | undefined,
      name: values.name as string | undefined,
      description: values.description as string | undefined,
      category: values.category as string | undefined,
      force: values.force as boolean | undefined,
      limit: values.limit as string | undefined,
      remove: values.remove as boolean | undefined,
      noValidate: values['no-validate'] as boolean | undefined,
      value: values.value as string | undefined,
    },
  };
}

const COMMAND_HELP: Record<CommandName, string> = {
  validate: `cpm validate - Validate workspace resources

Usage: cpm validate [options]

Options:
      --prompts           Validate prompts only
      --gates             Validate gates only
      --frameworks     Validate frameworks only
      --styles            Validate styles only
      --config            Also validate config.json
      --all               Validate all types + config.json
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output (exit 0 = valid, 1 = errors)

Examples:
  cpm validate --all --workspace ./my-project
  cpm validate --prompts --json
  cpm validate --config -w server`,

  list: `cpm list - List resources by type

Usage: cpm list <prompts|gates|frameworks|styles> [options]

Accepts singular or plural type names (prompt/prompts, gate/gates, framework/frameworks, style/styles).

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm list prompts --workspace server
  cpm list gates --json
  cpm list framework -w ./my-workspace`,

  inspect: `cpm inspect - Inspect a specific resource

Usage: cpm inspect <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm inspect prompt action_plan --workspace server
  cpm inspect gate code-quality --json
  cpm inspect framework cageerf -w server`,

  init: `cpm init - Initialize a new workspace

Usage: cpm init [path] [options]

Creates a resources/prompts/ directory with starter prompts.
If path is omitted, initializes in the current directory.

Options:
      --json              JSON output
      --no-validate       Skip post-init schema validation

Examples:
  cpm init ./my-workspace
  cpm init`,

  create: `cpm create - Create a new resource

Usage: cpm create <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Creates a resource directory with template YAML and companion file.
Prompts are grouped by category (default: general).

Options:
      --name <name>       Resource display name (default: id)
      --description <desc> Resource description
      --category <cat>    Prompt category (default: general, prompts only)
      --no-validate       Skip post-create schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm create prompt my-analysis --name "My Analysis" --description "Analyze code"
  cpm create gate code-review --name "Code Review" -w server
  cpm create framework my-method --category tools`,

  delete: `cpm delete - Delete a resource

Usage: cpm delete <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Removes the resource directory and its version history.
Requires --force to confirm deletion.

Options:
  -f, --force             Confirm deletion (required)
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm delete prompt my-analysis --force
  cpm delete gate code-review -f -w server`,

  history: `cpm history - Show version history

Usage: cpm history <type> <id> [options]

Types: prompt, gate, framework, style (singular or plural)

Displays the SQLite-backed version log for a resource.

Options:
      --limit <n>         Max entries to show (default: 10)
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output (raw HistoryFile object)

Examples:
  cpm history prompt quick_review -w server
  cpm history gate code-quality --limit 5 --json`,

  compare: `cpm compare - Compare two resource versions

Usage: cpm compare <type> <id> <from> <to> [options]

Types: prompt, gate, framework, style (singular or plural)

Shows differences between two version snapshots from SQLite history.

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output (both version entries)

Examples:
  cpm compare prompt quick_review 1 3 -w server
  cpm compare gate code-quality 2 4 --json`,

  rollback: `cpm rollback - Restore a previous version

Usage: cpm rollback <type> <id> <version> [options]

Types: prompt, gate, framework, style (singular or plural)

Saves current state as a new version, then restores the target version.

Options:
      --no-validate       Skip post-rename schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm rollback prompt quick_review 2 -w server
  cpm rollback gate code-quality 1 --json`,

  rename: `cpm rename - Rename a resource

Usage: cpm rename <type> <old-id> <new-id> [options]

Types: prompt, gate, framework, style (singular or plural)

Renames the resource directory and updates the id field in YAML.
Warns about cross-references that may need manual updating.

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm rename prompt old-name new-name -w server
  cpm rename gate code-review quality-gate --json`,

  move: `cpm move - Move a prompt to a different category

Usage: cpm move prompt <id> --category <new-category> [options]

Only prompts have categories. Use 'rename' for other types.

Options:
      --category <cat>    Target category (required)
      --no-validate       Skip post-move schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm move prompt my-analysis --category tools -w server
  cpm move prompt helper --category development --json`,

  toggle: `cpm toggle - Toggle enabled state

Usage: cpm toggle <framework|style> <id> [options]

Flips the 'enabled' field between true and false.
Only frameworks and styles have an enabled field.

Options:
      --no-validate       Skip post-toggle schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm toggle framework cageerf -w server
  cpm toggle style analytical --json`,

  'link-gate': `cpm link-gate - Link or unlink a gate to a prompt

Usage: cpm link-gate <prompt-id> <gate-id> [options]

Adds or removes a gate from the prompt's gateConfiguration.include array.

Options:
      --remove            Remove the gate link instead of adding
      --no-validate       Skip post-link schema validation
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm link-gate my-prompt code-quality -w server
  cpm link-gate my-prompt code-quality --remove
  cpm link-gate my-prompt code-quality --json`,

  guide: `cpm guide - Command discovery and help

Usage: cpm guide [goal] [options]

Shows available CLI commands ranked by relevance to an optional goal.
Without a goal, shows all commands grouped by category.

Options:
      --json              JSON output

Examples:
  cpm guide
  cpm guide create
  cpm guide "version history"
  cpm guide --json`,

  enable: `cpm enable - Enable a subsystem

Usage: cpm enable <subsystem> [options]

Shorthand for 'cpm config set <key> on'.

Subsystems:
  gates                     Quality gates (gates.enabled)
  frameworks                Framework system (frameworks.enabled)
  resources                 MCP resource registration (resources.registerWithMcp)
  resources.prompts         Prompt resources (resources.prompts.enabled)
  resources.gates           Gate resources (resources.gates.enabled)
  resources.frameworks      Framework resources (resources.frameworks.enabled)
  resources.observability   Observability resources (resources.observability.enabled)
  resources.logs            Log resources (resources.logs.enabled)
  verification              Verification isolation (verification.isolation.enabled)

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm enable gates
  cpm enable resources -w server
  cpm disable frameworks --json`,

  disable: `cpm disable - Disable a subsystem

Usage: cpm disable <subsystem> [options]

Shorthand for 'cpm config set <key> off'. See 'cpm enable --help' for subsystem list.

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              JSON output

Examples:
  cpm disable gates
  cpm disable resources.logs -w server`,

  config: `cpm config - Manage workspace configuration

Usage: cpm config <subcommand> [options]

Subcommands:
  list                    Display full config.json
  get <key>               Get a specific config value
  set <key> <value>       Set a config value (with backup + validation)
  validate                Validate config.json
  reset                   Reset config to defaults (requires --force)
  keys                    List all valid config keys with types

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
  -f, --force             Confirm destructive operations (reset)
      --value <value>     Alternative way to provide value for set
      --json              JSON output

Examples:
  cpm config list -w server
  cpm config get gates.mode
  cpm config set frameworks.mode on
  cpm config set server.port 8080 --json
  cpm config validate -w server
  cpm config reset --force
  cpm config keys`,
};

function printHelp(command?: CommandName): void {
  if (command) {
    console.log(COMMAND_HELP[command]);
    return;
  }

  const help = `cpm - Claude Prompts MCP workspace CLI

Usage: cpm <command> [options]

Commands:
  validate   Validate workspace resources (prompts, gates, frameworks, styles)
  list       List resources by type
  inspect    Inspect a specific resource
  init       Initialize a new workspace with starter prompts
  create     Create a new resource with template YAML
  delete     Delete a resource (requires --force)
  history    Show version history for a resource
  compare    Compare two resource versions
  rollback   Restore a previous resource version
  rename     Rename a resource (directory + YAML id)
  move       Move a prompt to a different category
  toggle     Toggle enabled state (frameworks, styles)
  link-gate  Link or unlink a gate to a prompt
  guide      Command discovery and help
  config     Manage workspace configuration (config.json)
  enable     Enable a subsystem (shorthand for config set)
  disable    Disable a subsystem (shorthand for config set)

Options:
  -w, --workspace <path>  Workspace directory (default: MCP_WORKSPACE or cwd)
      --json              Output as JSON
      --no-validate       Skip post-mutation/create/init schema validation
  -h, --help              Show this help (use 'cpm <command> --help' for command details)
  -v, --version           Show version

Examples:
  cpm validate --all --workspace ./my-project
  cpm list prompts --json
  cpm inspect prompt quick_review
  cpm create prompt my-analysis --name "My Analysis"
  cpm history prompt quick_review -w server
  cpm guide create`;

  console.log(help);
}

export async function run(args?: string[]): Promise<void> {
  const parsed = parseCliArgs(args);

  if (parsed.global.version) {
    output(VERSION, { json: parsed.global.json, raw: true });
    return;
  }

  if (!parsed.command) {
    if (parsed.positionals.length > 0 && !parsed.global.help) {
      console.error(`Unknown command: ${parsed.positionals[0]}\n`);
    }
    printHelp();
    if (!parsed.global.help && parsed.positionals.length > 0) {
      process.exit(1);
    }
    return;
  }

  if (parsed.global.help) {
    printHelp(parsed.command);
    return;
  }

  let exitCode: number;

  switch (parsed.command) {
    case 'validate':
      exitCode = await validate({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        flags: {
          prompts: parsed.flags['prompts'] as boolean | undefined,
          gates: parsed.flags['gates'] as boolean | undefined,
          frameworks: parsed.flags['frameworks'] as boolean | undefined,
          styles: parsed.flags['styles'] as boolean | undefined,
          config: parsed.flags['config'] as boolean | undefined,
          all: parsed.flags['all'] as boolean | undefined,
        },
      });
      break;
    case 'list':
      exitCode = await list({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
      });
      break;
    case 'inspect':
      exitCode = await inspect({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
      });
      break;
    case 'init':
      exitCode = await init({
        path: parsed.positionals[0],
        json: parsed.global.json,
        noValidate: parsed.flags['noValidate'] as boolean | undefined,
      });
      break;
    case 'create':
      exitCode = await create({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        name: parsed.flags['name'] as string | undefined,
        description: parsed.flags['description'] as string | undefined,
        category: parsed.flags['category'] as string | undefined,
        noValidate: parsed.flags['noValidate'] as boolean | undefined,
      });
      break;
    case 'delete':
      exitCode = await del({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        force: Boolean(parsed.flags['force']),
      });
      break;
    case 'history':
      exitCode = await history({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        limit: parsed.flags['limit'] as string | undefined,
      });
      break;
    case 'compare':
      exitCode = await compare({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        from: parsed.positionals[2],
        to: parsed.positionals[3],
      });
      break;
    case 'rollback':
      exitCode = await rollback({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        version: parsed.positionals[2],
      });
      break;
    case 'rename':
      exitCode = await rename({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        oldId: parsed.positionals[1],
        newId: parsed.positionals[2],
        noValidate: parsed.flags['noValidate'] as boolean | undefined,
      });
      break;
    case 'move':
      exitCode = await move({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        category: parsed.flags['category'] as string | undefined,
        noValidate: parsed.flags['noValidate'] as boolean | undefined,
      });
      break;
    case 'toggle':
      exitCode = await toggle({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        type: parsed.positionals[0],
        id: parsed.positionals[1],
        noValidate: parsed.flags['noValidate'] as boolean | undefined,
      });
      break;
    case 'link-gate':
      exitCode = await linkGateCmd({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        promptId: parsed.positionals[0],
        gateId: parsed.positionals[1],
        remove: parsed.flags['remove'] as boolean | undefined,
        noValidate: parsed.flags['noValidate'] as boolean | undefined,
      });
      break;
    case 'guide':
      exitCode = await guide({
        json: parsed.global.json,
        goal: parsed.positionals[0],
      });
      break;
    case 'config':
      exitCode = await config({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        subcommand: parsed.positionals[0],
        positionals: parsed.positionals.slice(1),
        force: Boolean(parsed.flags['force']),
        value: parsed.flags['value'] as string | undefined,
      });
      break;
    case 'enable':
      exitCode = await enableDisable({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        action: 'enable',
        subsystem: parsed.positionals[0],
      });
      break;
    case 'disable':
      exitCode = await enableDisable({
        workspace: parsed.global.workspace,
        json: parsed.global.json,
        action: 'disable',
        subsystem: parsed.positionals[0],
      });
      break;
    default: {
      const _: never = parsed.command;
      throw new Error(`Unexpected command: ${String(_)}`);
    }
  }

  process.exit(exitCode);
}
