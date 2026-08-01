# CPM CLI

Standalone workspace management tool for [Claude Prompts MCP](../README.md). Validates, lists, inspects, and initializes workspaces without starting the server.

Published as the `cpm` bin of the [`claude-prompts`](https://www.npmjs.com/package/claude-prompts) npm package — this directory is its source, not a separately published package.

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

All commands support `--json` for machine-readable output and `-w`/`--workspace` for workspace selection.

## Architecture

Self-contained esbuild bundle (~260KB) with zero runtime dependencies. Shares validation logic with the server via `server/src/cli-shared/` (Zod schemas, YAML utilities). A dependency-cruiser rule prevents transitive imports of server runtime modules.

See [CLI Guide](../docs/guides/cli.md) for full documentation.
