# CPM CLI Guide

Manage your prompt workspace from the terminal — create resources, validate schemas, version history, and configure settings without starting the MCP server.

Use the CLI for automation, CI pipelines, and offline workspace management. Use the MCP server for interactive prompt execution and real-time workflows.

## When to Use What

| I want to...                                   | Use                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Execute prompts, run chains, switch frameworks | MCP server (`prompt_engine`, `resource_manager`, `system_control`) |
| Scaffold a new workspace or resource           | CLI (`cpm init`, `cpm create`)                                     |
| Validate resources in CI                       | CLI (`cpm validate --all`)                                         |
| View or rollback version history               | CLI (`cpm history`, `cpm rollback`)                                |
| Manage config without restarting               | CLI (`cpm config set`)                                             |

The CLI and MCP server share validation logic but operate independently — the CLI never starts the server process.

## Installation

The CLI ships as the `cpm` bin of the `claude-prompts` npm package — no clone required, and no MCP server needs to be installed or running.

```bash
# One-off, from any directory
npx -p claude-prompts cpm validate --all -w ./my-workspace

# Or install globally
npm install -g claude-prompts
cpm validate --all -w ./my-workspace
```

The npm installation follows the package's Node.js requirement. For CLI-only use on Node.js >=18.18.0, download the checksummed standalone bundle from the matching GitHub Release:

```bash
VERSION=3.1.1
curl -LO "https://github.com/minipuft/claude-prompts-mcp/releases/download/v${VERSION}/cpm-${VERSION}.js"
curl -LO "https://github.com/minipuft/claude-prompts-mcp/releases/download/v${VERSION}/cpm-${VERSION}.js.sha256"
sha256sum --check "cpm-${VERSION}.js.sha256"
node "cpm-${VERSION}.js" --version
```

Both forms are the same self-contained CLI bundle and report the `claude-prompts` release version. The CLI works against any workspace directory on disk without starting the MCP server.

<details>
<summary><strong>Building from source (contributors)</strong></summary>

```bash
npm install            # from repo root — installs the cli workspace
npm -w cli run build   # produces cli/dist/cpm.js
node cli/dist/cpm.js --help
```

`npm --prefix server run build` also emits `server/dist/cpm.js` from the same source; that is the copy published to npm.
`server/package.json#version` is the release identity for both builds; `cli/package.json` remains private build metadata.

</details>

## Commands

### validate

Validate workspace resources against their Zod schemas.

```bash
cpm validate --all --workspace ./my-workspace
cpm validate --prompts -w server
cpm validate --gates --json
cpm validate --styles
```

| Flag                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `--prompts`              | Validate prompts only                                 |
| `--gates`                | Validate gates only                                   |
| `--frameworks`           | Validate frameworks only                              |
| `--styles`               | Validate styles only                                  |
| `--all`                  | Validate all resource types (default)                 |
| `--config`               | Also validate `config.json` keys and values           |
| `-w, --workspace <path>` | Workspace directory (default: `MCP_WORKSPACE` or cwd) |
| `--json`                 | JSON output                                           |

Exit codes: `0` all valid, `1` errors found.

### list

List resources by type.

```bash
cpm list prompts --workspace server
cpm list gates --json
cpm list frameworks -w ./my-workspace
cpm list styles
```

Displays a table with id, name, category (prompts only), and description. Use `--json` for machine-readable output.

### inspect

Inspect a specific resource by type and ID.

```bash
cpm inspect prompt action_plan --workspace server
cpm inspect gate code-quality --json
cpm inspect framework cageerf -w server
cpm inspect style analytical
```

Accepts both singular and plural type names (`prompt`/`prompts`, `gate`/`gates`, `framework`/`frameworks`, `style`/`styles`).

### init

Initialize a new workspace with starter prompts.

```bash
cpm init ./my-workspace
cpm init --json
```

Creates a `resources/prompts/` directory with example prompts (`quick_review`, `explain`, `improve`) and a `config.json` with sensible defaults. Prints setup instructions for Claude Desktop configuration.

If `config.json` already exists, it is preserved. By default, `init` validates generated prompt YAML before returning success. Use `--no-validate` only if you intentionally need to bypass this guard.

### create

Create a new resource with template YAML.

```bash
cpm create prompt my-analysis --name "My Analysis" --description "Analyze code" --category tools
cpm create gate code-review --name "Code Review"
cpm create framework my-method --name "My Method" --json
cpm create style analytical --name "Analytical" --description "Structured analytical responses"
```

| Flag                     | Purpose                              |
| ------------------------ | ------------------------------------ |
| `--name <name>`          | Display name (defaults to id)        |
| `--description <text>`   | Resource description                 |
| `--category <cat>`       | Prompt category (default: `general`) |
| `--no-validate`          | Skip post-create schema validation   |
| `-w, --workspace <path>` | Workspace directory                  |
| `--json`                 | JSON output                          |

Exit codes: `0` created, `1` already exists or error.

### delete

Delete a resource and its version history.

```bash
cpm delete prompt my-analysis --force --workspace server
cpm delete gate code-review -f
cpm delete style analytical --force
```

| Flag                     | Purpose                      |
| ------------------------ | ---------------------------- |
| `-f, --force`            | Required — confirms deletion |
| `-w, --workspace <path>` | Workspace directory          |
| `--json`                 | JSON output                  |

Without `--force`, prints what would be deleted and exits 1. Exit codes: `0` deleted, `1` missing `--force` or error.

### history

Show version history for a resource.

```bash
cpm history prompt action_plan --workspace server
cpm history gate code-quality --limit 5 --json
```

| Flag                     | Purpose                                |
| ------------------------ | -------------------------------------- |
| `--limit <n>`            | Limit displayed versions               |
| `-w, --workspace <path>` | Workspace directory                    |
| `--json`                 | JSON output (raw `HistoryFile` object) |

Reads SQLite version history from `runtime-state/state.db`. Exit codes: `0` success (including "no history"), `1` resource not found.

### compare

Compare two resource versions.

```bash
cpm compare prompt action_plan 1 3 --workspace server
cpm compare gate code-quality 2 4 --json
```

Shows key-level differences between two version snapshots. JSON mode returns `{ from: VersionEntry, to: VersionEntry }`.

Exit codes: `0` success, `1` version not found or invalid arguments.

### rollback

Restore a previous resource version.

```bash
cpm rollback prompt action_plan 2 --workspace server
cpm rollback gate code-quality 1 --json
```

Saves the current state as a new version before restoring the target version (matching server behavior). The restored snapshot is written back to the resource YAML file.

Exit codes: `0` success, `1` version not found or error.

### rename

Rename a resource (changes directory name and `id:` field in YAML).

```bash
cpm rename prompt old-name new-name --workspace server
cpm rename gate code-review quality-gate --json
cpm rename framework old-method new-method
```

| Flag                     | Purpose                            |
| ------------------------ | ---------------------------------- |
| `--no-validate`          | Skip post-rename schema validation |
| `-w, --workspace <path>` | Workspace directory                |
| `--json`                 | JSON output                        |

Prints a warning with an `rg` command to help find cross-references that may need updating. Exit codes: `0` renamed, `1` not found or target exists.

### move

Move a prompt to a different category.

```bash
cpm move prompt my-prompt --category tools --workspace server
cpm move prompt helper --category development --json
```

| Flag                     | Purpose                          |
| ------------------------ | -------------------------------- |
| `--category <cat>`       | Target category (required)       |
| `--no-validate`          | Skip post-move schema validation |
| `-w, --workspace <path>` | Workspace directory              |
| `--json`                 | JSON output                      |

Only prompts have categories — other resource types should use `rename` instead. Prints a warning about chain step references (`category/id` format). Exit codes: `0` moved, `1` error.

### toggle

Toggle the `enabled` field for frameworks or styles.

```bash
cpm toggle framework cageerf --workspace server
cpm toggle style analytical --json
```

| Flag                     | Purpose                            |
| ------------------------ | ---------------------------------- |
| `--no-validate`          | Skip post-toggle schema validation |
| `-w, --workspace <path>` | Workspace directory                |
| `--json`                 | JSON output                        |

Flips `enabled: true` to `false` (or vice versa). Only frameworks and styles have an `enabled` field. Exit codes: `0` toggled, `1` error.

### link-gate

Link or unlink a gate to a prompt.

```bash
cpm link-gate my-prompt code-quality --workspace server
cpm link-gate my-prompt code-quality --remove
cpm link-gate my-prompt code-quality --json
```

| Flag                     | Purpose                                |
| ------------------------ | -------------------------------------- |
| `--remove`               | Remove the gate link instead of adding |
| `--no-validate`          | Skip post-link schema validation       |
| `-w, --workspace <path>` | Workspace directory                    |
| `--json`                 | JSON output                            |

Modifies the prompt's `gateConfiguration.include` array. When adding, validates that the gate exists. When removing with `--remove`, the gate may already be deleted. Exit codes: `0` linked/unlinked, `1` error.

### config

Manage workspace `config.json` (read, write, validate, reset).

```bash
cpm config list --workspace server                  # Display full config
cpm config get gates.enabled -w server              # Get a single value
cpm config set logging.level debug -w server        # Set a value (backup + validate)
cpm config validate -w server                       # Validate all keys/values
cpm config reset --force -w server                  # Reset to defaults
cpm config keys                                     # List all valid config keys
```

| Subcommand | Usage                          | Description                            |
| ---------- | ------------------------------ | -------------------------------------- |
| `list`     | `cpm config list`              | Display full config as formatted JSON  |
| `get`      | `cpm config get <key>`         | Get value by dot-notation key          |
| `set`      | `cpm config set <key> <value>` | Set value with backup + validation     |
| `validate` | `cpm config validate`          | Validate all config keys and values    |
| `reset`    | `cpm config reset --force`     | Reset to defaults (requires `--force`) |
| `keys`     | `cpm config keys`              | List all valid keys with types         |

Keys use dot-notation (e.g., `gates.enabled`, `server.port`, `logging.level`). The `set` subcommand creates a timestamped backup before writing and warns when a key requires server restart. The `--json` and `-w` flags work with all subcommands.

Exit codes: `0` success, `1` error or validation failure.

### enable / disable

Shorthand for toggling a subsystem's boolean switch.

```bash
cpm enable gates                    # gates.enabled = true
cpm disable frameworks -w server    # frameworks.enabled = false
cpm enable resources --json         # resources.registerWithMcp = true (JSON output)
```

| Subsystem                 | Config Key                        |
| ------------------------- | --------------------------------- |
| `gates`                   | `gates.enabled`                   |
| `frameworks`              | `frameworks.enabled`              |
| `resources`               | `resources.registerWithMcp`       |
| `resources.prompts`       | `resources.prompts.enabled`       |
| `resources.gates`         | `resources.gates.enabled`         |
| `resources.frameworks`    | `resources.frameworks.enabled`    |
| `resources.observability` | `resources.observability.enabled` |
| `resources.logs`          | `resources.logs.enabled`          |
| `verification`            | `verification.isolation.enabled`  |

Reports "already enabled/disabled" without writing when the value is unchanged. Exit codes: `0` success, `1` unknown subsystem or error.

> **Removed in 3.1.2: the `analysis` subsystem.** It switched on an outbound LLM side client that
> has been deleted, so `cpm enable analysis` now reports `Unknown subsystem`, and
> `cpm config set analysis.semanticAnalysis.…` reports `Unknown configuration key`. Gate evaluation
> by a model is served by the [`%judge` modifier](./judge-mode.md) and `gates.evaluation.defaultMode`,
> which run in the client's own subagent rather than through an outbound API call — so no API key
> is configured or stored.
>
> **A `config.json` that still carries the `analysis` section keeps loading.** The section is
> parsed and ignored for one deprecation cycle, and the server warns once at startup naming the
> replacement. Only the ability to _set_ it from `cpm` or `system_control` is withdrawn. Delete the
> section to silence the warning; it is removed entirely in the next major.

> **Changed in 3.1.2.** These nine keys were previously `*.mode` holding `"on"`/`"off"`, which no
> reader consulted — the command reported success and changed nothing. A `config.json` still
> carrying a `*.mode` key is adopted into the boolean on load, so no edit is required; `cpm config
set` no longer accepts the old spelling. `telemetry.mode`, `phaseGuards.mode` and `identity.mode`
> are unaffected — those are read, and none of them is an on/off toggle.

## Write Validation Behavior

- `create`, `init`, `rename`, `move`, `toggle`, and `link-gate` run post-write schema validation by default.
- When validation fails after a mutation, CLI reports a structured failure and restores previous files.
- JSON mode returns an object with `error`, `validation`, and `rollback.performed`.
- Use `--no-validate` for explicit bypass only.
- MCP `resource_manager` write actions now use the same service-layer verification contract and rollback semantics (parity with CLI safety behavior).

### guide

Keyword-ranked CLI help and command discovery.

```bash
cpm guide                          # Show all commands by category
cpm guide create                   # Rank commands for "create" goal
cpm guide "version history"        # Find versioning commands
cpm guide --json                   # JSON output
```

Without a goal, shows all commands grouped by category. With a goal, ranks commands by keyword relevance and shows the top 4 as recommendations.

## Workspace Resolution

The CLI resolves the workspace directory in this priority order:

1. `--workspace` / `-w` CLI flag
2. `MCP_WORKSPACE` environment variable
3. Current working directory

Within a workspace, it checks `resources/<type>/` first, then `<type>/` as a legacy fallback.

## Architecture

The CLI is an esbuild bundle (~306KB) that imports shared logic from `server/src/cli-shared/`. Most commands run self-contained; versioning commands (`history`, `compare`, `rollback`) require `python3`/`python` to query SQLite (`runtime-state/state.db`).

```
cli/
├── src/
│   ├── index.ts          # Shebang entrypoint
│   ├── cli.ts            # parseArgs + command routing (17 commands)
│   ├── commands/
│   │   ├── validate.ts        # Resource + config validation
│   │   ├── list.ts            # Resource listing
│   │   ├── inspect.ts         # Resource inspection
│   │   ├── init.ts            # Workspace initialization (+ config.json)
│   │   ├── config.ts          # Config.json management (6 subcommands)
│   │   ├── enable-disable.ts  # Subsystem mode shortcuts
│   │   ├── create.ts          # Resource creation (scaffold)
│   │   ├── delete.ts          # Resource deletion
│   │   ├── history.ts         # Version history display
│   │   ├── compare.ts         # Version comparison
│   │   ├── rollback.ts        # Version rollback
│   │   ├── rename.ts          # Resource renaming
│   │   ├── move.ts            # Prompt category change
│   │   ├── toggle.ts          # Enable/disable toggle (YAML)
│   │   ├── link-gate.ts       # Gate linking
│   │   └── guide.ts           # Keyword-ranked help
│   └── lib/
│       ├── output.ts     # JSON/table formatting
│       ├── types.ts      # Shared TYPE_MAP, TYPE_CONFIG
│       └── workspace.ts  # Workspace + resource dir resolution
├── tests/
│   ├── integration/      # CLI integration tests (exec child process)
│   └── fixtures/         # Test workspaces (including versioned-workspace)
├── esbuild.config.mjs    # Bundle config with @cli-shared alias
├── tsconfig.json         # Strict TS, @cli-shared path mapping
└── jest.config.cjs       # ts-jest ESM preset
```

### cli-shared Isolation

The `server/src/cli-shared/` barrel re-exports validation schemas, YAML utilities, version-history functions, resource scaffolding, and config operations using only relative imports. A dependency-cruiser rule (`cli-shared-no-runtime`) prevents any transitive dependency on server runtime modules (transport, config, logging).

Config validation logic (`CONFIG_VALID_KEYS`, `validateConfigInput`) is extracted to `cli-shared/config-input-validator.ts` and re-exported by the server's `config-utils.ts` for backward compatibility. Config file operations (`readConfig`, `setConfigValue`, `initConfig`, etc.) live in `cli-shared/config-operations.ts` using only `node:fs` and `node:path`.

Versioning types (`VersionEntry`, `HistoryFile`, etc.) from `modules/versioning/types.ts` are pure interfaces — safe to re-export. Standalone functions in `cli-shared/version-history.ts` mirror `VersionHistoryService` against SQLite state and avoid runtime imports from MCP server modules.
