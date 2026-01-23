# CLI Tool Roadmap (cpm - Claude Prompts Manager)

**Status**: Planned
**Created**: 2026-01-23
**Target**: Modern CLI for prompt/gate/methodology management

---

## Summary

Create `cpm` (Claude Prompts Manager) - a modern CLI tool as a monorepo sibling package that reuses server validation infrastructure and provides developer tooling for prompt/gate/methodology management.

## Architecture Decision

**Approach**: Modern Turborepo monorepo with pnpm
- **Turborepo**: Build caching, parallel tasks, task pipelines
- **pnpm**: Fast package manager with strict dependency hoisting
- **Changesets**: Monorepo-native versioning and changelog automation
- Future-ready for consolidating other plugins/repositories

## Directory Structure

```
claude-prompts-mcp/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml       # Workspace packages definition
├── turbo.json                # Turborepo pipeline config
├── .changeset/               # Changesets config
│   └── config.json
├── cli/                      # New CLI package
│   ├── package.json
│   ├── tsconfig.json
│   ├── esbuild.config.mjs
│   ├── src/
│   │   ├── index.ts          # Entry with shebang
│   │   ├── cli.ts            # Commander setup
│   │   ├── commands/
│   │   │   ├── prompt.ts     # prompt create|validate|list|inspect
│   │   │   ├── gate.ts       # gate create|validate|list|inspect
│   │   │   ├── methodology.ts # methodology validate|list|inspect
│   │   │   ├── server.ts     # server start|status|stop|logs
│   │   │   ├── config.ts     # config init|get|set|validate
│   │   │   └── validate.ts   # Global validation command
│   │   ├── lib/
│   │   │   ├── imports.ts    # Re-exports from server
│   │   │   ├── workspace.ts  # Workspace detection
│   │   │   ├── output.ts     # Colored output (chalk)
│   │   │   └── spinner.ts    # Async feedback (ora)
│   │   └── templates/        # Handlebars scaffolding templates
│   └── tests/
└── server/                   # Existing (unchanged)
```

## Command Structure

```
cpm <command> [options]

  prompt create              Interactive prompt scaffolding
  prompt validate [path]     Validate prompt YAML files
  prompt list                List prompts with filtering
  prompt inspect <id>        Show prompt details

  gate create                Interactive gate scaffolding
  gate validate [path]       Validate gate YAML files
  gate list                  List gates
  gate inspect <id>          Show gate details

  methodology validate       Validate methodology files
  methodology list           List methodologies
  methodology inspect <id>   Show methodology details

  server start               Launch MCP server
  server status              Check server health
  server stop                Stop running server

  config init [path]         Initialize workspace
  config get <key>           Get config value
  config set <key> <value>   Set config value
  config validate            Validate config.json

  validate                   Run full validation suite
    --prompts                Prompts only
    --gates                  Gates only
    --methodologies          Methodologies only

Global Options:
  -w, --workspace <path>     Override workspace path
  -q, --quiet                Minimal output
  -v, --verbose              Detailed output
  --json                     JSON output for scripting
  --no-color                 Disable colors
```

## Server Module Reuse

```typescript
// cli/src/lib/imports.ts - Re-export server internals
export {
  validatePromptYaml,
  PromptYamlSchema,
} from '../../server/src/prompts/prompt-schema.js';

export {
  validateGateSchema,
  GateDefinitionSchema,
} from '../../server/src/gates/core/gate-schema.js';

export {
  validateMethodologySchema,
} from '../../server/src/frameworks/methodology/methodology-schema.js';

export { parseYaml, formatYamlError } from '../../server/src/utils/yaml/yaml-parser.js';
export { ServerRootDetector } from '../../server/src/runtime/startup.js';
export { ConfigManager } from '../../server/src/config/index.js';
```

## Dependencies

### CLI Package Dependencies

| Package | Purpose |
|---------|---------|
| commander@^12 | Command parsing |
| chalk@^5 | Terminal colors (ESM) |
| ora@^8 | Spinners |
| inquirer@^9 | Interactive prompts |
| cli-table3@^0.6 | Table output |
| handlebars@^4.7 | Template scaffolding |
| glob@^10 | File patterns |

### Root DevDependencies (Monorepo Tooling)

| Package | Purpose |
|---------|---------|
| turbo | Build orchestration & caching |
| @changesets/cli | Versioning & changelog automation |

## Turborepo Configuration

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["build"]
    },
    "validate": {
      "dependsOn": ["build", "typecheck", "lint", "test"]
    }
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "server"
  - "cli"
```

## Changesets Configuration

```json
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch"
}
```

**Workflow**:
1. `pnpm changeset` - Create changeset for a change
2. `pnpm changeset version` - Bump versions & update changelogs
3. `pnpm changeset publish` - Publish to npm

## Implementation Phases

### Phase 0: Monorepo Infrastructure

- [ ] Install pnpm globally if needed (`npm install -g pnpm`)
- [ ] Convert root to pnpm workspace
  - [ ] Create `pnpm-workspace.yaml`
  - [ ] Update root `package.json` (remove npm workspaces if any)
  - [ ] Run `pnpm import` to convert package-lock.json
- [ ] Add Turborepo
  - [ ] `pnpm add -Dw turbo`
  - [ ] Create `turbo.json` with task pipelines
- [ ] Add Changesets
  - [ ] `pnpm add -Dw @changesets/cli`
  - [ ] `pnpm changeset init`
- [ ] Update CI workflows for pnpm + turbo
- [ ] Verify existing server build works: `pnpm turbo build --filter=server`

### Phase 1: CLI Foundation (MVP)

- [ ] Create `cli/` package structure
- [ ] Configure TypeScript with server imports
- [ ] Set up esbuild bundling
- [ ] Implement `cpm validate` command (all resources)
- [ ] Implement `cpm prompt validate` with detailed output
- [ ] Implement `cpm gate validate`
- [ ] Implement `cpm methodology validate`
- [ ] Basic output formatting (chalk + tables)

### Phase 2: Server Control

- [ ] `cpm server start` with transport options
- [ ] `cpm server status` health check
- [ ] `cpm server stop`
- [ ] PID file management

### Phase 3: Configuration

- [ ] `cpm config init` (reuse server's initWorkspace)
- [ ] `cpm config validate`
- [ ] `cpm config get/set`

### Phase 4: Resource Listing

- [ ] `cpm prompt list` with filtering
- [ ] `cpm prompt inspect <id>`
- [ ] `cpm gate list/inspect`
- [ ] `cpm methodology list/inspect`

### Phase 5: Interactive Scaffolding

- [ ] `cpm prompt create` wizard
- [ ] `cpm gate create` wizard
- [ ] Handlebars templates

## Critical Files to Modify/Create

### Phase 0: Monorepo Infrastructure

| File | Change |
|------|--------|
| `/package.json` (root) | Update scripts for turbo, add devDeps |
| `/pnpm-workspace.yaml` | New - workspace definition |
| `/turbo.json` | New - task pipeline config |
| `/.changeset/config.json` | New - changesets config |
| `/.github/workflows/*.yml` | Update for pnpm + turbo |

### Phase 1: CLI Package

| File | Change |
|------|--------|
| `/cli/package.json` | New - CLI package config |
| `/cli/tsconfig.json` | New - extends server config |
| `/cli/esbuild.config.mjs` | New - bundle config |
| `/cli/src/index.ts` | New - entry point |
| `/cli/src/cli.ts` | New - commander setup |
| `/cli/src/commands/*.ts` | New - command implementations |

## Verification

### After Phase 0 (Monorepo Setup)

```bash
# Verify pnpm workspace
pnpm install
pnpm ls --depth 0

# Verify turbo runs server build
pnpm turbo build --filter=server

# Verify turbo caching works (second run should be cached)
pnpm turbo build --filter=server

# Verify changesets initialized
ls .changeset/config.json
```

### After Phase 1 (CLI Foundation)

```bash
# Build all packages
pnpm turbo build

# Test CLI directly
./cli/dist/cpm.js --help
./cli/dist/cpm.js validate --prompts
./cli/dist/cpm.js prompt validate server/resources/prompts/

# Test via pnpm
pnpm --filter cli exec cpm --help

# Test JSON output
./cli/dist/cpm.js prompt list --json | jq .

# Run full validation pipeline
pnpm turbo validate
```

## MCP Integration Path

Commands map to future MCP tool extensions:

| CLI | MCP Tool | Action |
|-----|----------|--------|
| `prompt list` | resource_manager | list (resource_type: "prompt") |
| `prompt validate` | resource_manager | validate (future) |
| `server status` | system_control | status |

The CLI provides the same functionality as MCP tools but accessible from terminal for CI/CD and local development.

## Future Considerations

- **Plugin consolidation**: This monorepo structure is designed to eventually house other plugins (minipuft-plugins, gemini-prompts, opencode-prompts)
- **Shared packages**: Extract common utilities to `packages/shared/` when patterns emerge
- **MCP tool wrappers**: CLI commands could be exposed as MCP tools for in-assistant workflows
