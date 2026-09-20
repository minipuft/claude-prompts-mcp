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
| `--config`               | Also validate your config file's keys and values      |
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

Prompts are listed exactly as the server loads them: a directory (`{category}/{id}/prompt.yaml`) or a single file (`{category}/{id}.yaml`), at any depth below the category, under the id the server serves — the path below the category, so a chain step is `deep_analysis/deep_dive`. Every command that takes a prompt id takes that id.

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

Creates a `resources/prompts/` directory with example prompts (`quick_review`, `explain`, `improve`) and a `config.jsonc` with every setting commented out (see [Configuration](#config) below). Prints setup instructions for Claude Desktop configuration.

If a `config.jsonc` or `config.json` already exists, it is preserved. By default, `init` validates generated prompt YAML before returning success. Use `--no-validate` only if you intentionally need to bypass this guard.

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

Without `--force`, prints what would be deleted and exits 1. A directory prompt is deleted with its directory (a chain with its steps); a single-file prompt is deleted as that one file, never the category around it. Exit codes: `0` deleted, `1` missing `--force` or error.

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

Rename a resource (changes its directory or file name and the `id:` field in YAML together).

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

Only the last segment of an id can change: `cpm rename prompt deep_analysis/deep_dive deep_analysis/dive` renames the step in place, while a new id under another chain is refused. The target is checked before anything is written, so a refused rename leaves the resource untouched. `--json` reports `oldPath`/`newPath`, which name a file for a single-file prompt.

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

Only prompts have categories — other resource types should use `rename` instead. A single-file prompt moves as a file; a prompt nested inside a chain is refused, because it moves with its chain. `--json` reports `oldPath`/`newPath`. Prints a warning about chain step references (`category/id` format). Exit codes: `0` moved, `1` error.

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

Manage your workspace config file — `config.jsonc` by default, `config.json` still read if that is what your workspace has (read, write, validate, reset).

```bash
cpm config list --workspace server                  # Display full config
cpm config get gates.enabled -w server              # Get a single value
cpm config set logging.level debug -w server        # Set a value (backup + edit in place)
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

Every message names the file it acted on, by its real name (`config.jsonc` or `config.json`, whichever your workspace has): `cpm config get` on a missing key reports `Key '<key>' not found in <file>`, `validate` reports `<file> is valid` (or `validation failed:` with the list of problems), and `reset` reports `<file> reset to defaults`.

Exit codes: `0` success, `1` error or validation failure.

#### config.jsonc

`config.jsonc` accepts `//` and `/* */` comments and a trailing comma before `}`/`]` — nothing else beyond JSON. A plain `config.json` is still read if that is what you have; it stays strict JSON, so a comment inside one is a parse error. Within a workspace, `config.jsonc` is tried first, then `config.json`.

`cpm init` writes `config.jsonc` with `$schema` and `"version": 5` live, and every other setting commented out, showing its current value, its default and its permitted values — generated straight from the schema, so the file can never describe a setting the server does not have. An excerpt:

```jsonc
{
//   — JSON Schema reference for IDE validation.
  "$schema": "https://cdn.jsdelivr.net/npm/claude-prompts@5/config.schema.json",

//   — Which shape this config file is written in. `5` is the current format...
  "version": 5,

//   — Server identity and transport settings.
//   "server": {
//     — Server name reported to MCP clients.
//     — default: "claude-prompts"
//     "name": "claude-prompts",
//   },
```

To change a setting, uncomment its line and the braces of the section it sits in — every example line already ends with a comma, so uncommenting a single line still parses. A file with nothing uncommented behaves exactly like no file at all.

`cpm config set` edits the file's text in place: only the one key's own characters change, so your comments, key order and formatting all survive. Setting a key that exists only as a commented-out example in the template inserts the live key and leaves the commented example where it was — nothing tries to remove or uncomment it. A persisted `gates`/`framework` toggle from `system_control` (`persist: true`) edits in place the same way.

`cpm config reset --force` backs up the current file first (`config.jsonc.backup.<timestamp>`, or `config.json.backup.<timestamp>`), then writes fresh defaults into the **same file name** — the commented template for a `config.jsonc`, or the minimal `{$schema, version}` document for a `config.json`. It never renames a file.

A workspace holding both `config.jsonc` and `config.json` refuses every `config` subcommand (and server startup) rather than silently preferring one:

```
Two config files in one directory: <path>/config.jsonc and <path>/config.json. Keep one —
config.jsonc is the 5.0 name, config.json is still read.
```

Delete whichever file you are not using to resolve it.

For the full file lookup order, how a single value resolves across defaults, the file, environment
variables and CLI flags, and what the `$schema` line validates, see the [Configuration
Reference](../reference/configuration.md).

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
> **Removed in 5.0: the `analysis` section itself.** It is gone from `config.schema.json`, not just
> unsettable. A `config.json` with no `version` key that still carries
> `analysis.semanticAnalysis.llmIntegration.*` is read as a 4.x file and translated on load: the
> section is dropped, and named in the one-time notice alongside every other renamed or dropped
> key. A file already declaring `"version": 5` that still carries `analysis` is flagged by the
> ordinary schema check instead. Delete the section (or add `"version": 5` and drop it) to silence
> either warning.

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
│   │   ├── init.ts            # Workspace initialization (+ config.jsonc)
│   │   ├── config.ts          # Config file management (6 subcommands)
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

The `server/src/cli-shared/` barrel re-exports validation schemas, YAML utilities, version-history functions, resource scaffolding, and config operations. It reaches schema and utility modules in `shared/`, `engine/`, and `modules/` through the usual `#`-subpath specifiers; what it may not reach, at any depth, is `infra/`, `runtime/`, or `mcp/` — transport, config loading, and logging would otherwise land in the CLI's own bundle. The dependency-cruiser rule `cli-shared-no-runtime` enforces that as a `reachable` rule over the whole closure, and `tests/unit/cli-shared/import-isolation.test.ts` cruises the barrel on its own. The rule was added 2026-09-15; this paragraph and the barrel's header had cited it by name before it existed, and described the barrel as using only relative imports, which it never did.

Config validation logic (`CONFIG_VALID_KEYS`, `validateConfigInput`) lives in `cli-shared/config-input-validator.ts`, which the CLI's `config` commands read — 59 keys today. The server's `mcp/tools/config-utils.ts` is not a re-export of that file: it defines its own separate `CONFIG_VALID_KEYS`/`validateConfigInput`, a smaller, strict subset (19 keys) used only by the `system_control` config action's per-key `validate` check. A later release generates one list from the `ConfigFile` type instead of hand-maintaining both. Config file operations (`readConfig`, `setConfigValue`, `initConfig`, etc.) live in `cli-shared/config-operations.ts` using only `node:fs` and `node:path`.

Versioning types (`VersionEntry`, `HistoryFile`, etc.) from `modules/versioning/types.ts` are pure interfaces — safe to re-export. Standalone functions in `cli-shared/version-history.ts` mirror `VersionHistoryService` against SQLite state and avoid runtime imports from MCP server modules.
