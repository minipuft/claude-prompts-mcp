# CPM CLI

Standalone workspace management tool for [Claude Prompts MCP](../README.md). Validates, lists, inspects, and initializes workspaces without starting the server.

Published as the `cpm` bin of the [`claude-prompts`](https://www.npmjs.com/package/claude-prompts) npm package — this directory is its source, not a separately published package.
The released CLI version comes from `server/package.json`; the private workspace version is not a distribution identity.

## Quick Start

```bash
# Use it without cloning anything
npx -p claude-prompts cpm validate --all -w ./my-workspace
```

## Developing

```bash
# From repo root
npm install            # installs the cli workspace
npm -w cli run build   # -> cli/dist/cpm.js
npm -w cli run test:ci

node cli/dist/cpm.js validate --all --workspace server
```

The published copy is emitted to `server/dist/cpm.js` by `npm --prefix server run build`, which imports this directory's esbuild config so the two bundles cannot drift.

## Commands

| Command    | Purpose                             | Example                             |
| ---------- | ----------------------------------- | ----------------------------------- |
| `validate` | Check resources against Zod schemas | `cpm validate --all -w ./workspace` |
| `list`     | List resources by type              | `cpm list prompts --json`           |
| `inspect`  | Show a specific resource            | `cpm inspect prompt action_plan`    |
| `init`     | Create a new workspace              | `cpm init ./my-workspace`           |

`cpm init --project` scaffolds `./.claude-prompts/` in the current directory with the same starter prompts and `config.jsonc`; resources placed there load above the user workspace and the bundled ones when the server runs in this project over STDIO. It takes no path (`cpm init <path>` is the custom-location form).

All commands support `--json` for machine-readable output and `-w`/`--workspace` for workspace selection.

## `cpm workspace`

Workspace profiles are folders that sit side by side under one parent. The registry is `workspaces.jsonc` in the parent of the workspace `cpm` resolves (`-w`, then `MCP_WORKSPACE`, then the current directory), never in your home directory. It maps each label to a folder beside it:

```jsonc
{ "dev": "./dev", "shared": "./shared" }
```

- `cpm workspace add <label> [dir]` registers a folder in the registry's parent, creating the file if needed; with no `dir` it takes the folder `MCP_RESOURCES_PATH` names (its parent when that folder is called `resources`).
- `cpm workspace remove <label>` drops the label and leaves the folder on disk.
- `cpm workspace list` prints each label and folder, marks the current one, and lists an `MCP_RESOURCES_PATH` folder no profile holds under `unregistered:`.
- `cpm workspace show <label>` prints the folder, its `config.jsonc` or `config.json`, and how many prompts, gates, frameworks and styles it holds.
- `cpm workspace use <label>` prints the `MCP_WORKSPACE=<folder>` line to put in your MCP client's server env; it writes nothing.

Edits to an existing registry keep its comments.

## Architecture

Self-contained esbuild bundle (~260KB) with zero runtime dependencies. Shares validation logic with the server via `server/src/cli-shared/` (Zod schemas, YAML utilities). A dependency-cruiser rule prevents transitive imports of server runtime modules.

See [CLI Guide](../docs/guides/cli.md) for full documentation.
