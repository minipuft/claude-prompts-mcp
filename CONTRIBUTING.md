# Contributing to Claude Prompts

Thank you for contributing to the Claude Prompts MCP server. This guide covers everything from your first PR to advanced contribution workflows.

## Quick Start

```bash
# 1. Fork and clone
git clone https://github.com/<your-fork>/claude-prompts.git
cd claude-prompts-mcp/server

# 2. Install (hooks auto-configure via Husky)
npm install

# 3. Build and verify
npm run build && npm test

# 4. Create a branch
git checkout -b feat/my-change

# 5. Make changes, then commit with conventional format
git add <files>
git commit -m "feat(server): add new capability"
```

> [!TIP]
> First time? Start with a docs fix or a small bug. The hooks will lint, format, and typecheck your staged files automatically.

## Development Environment

| Surface / requirement                | Version                    | Notes                                            |
| ------------------------------------ | -------------------------- | ------------------------------------------------ |
| **MCP server and desktop extension** | Node.js >=22.13.0          | CI tests the minimum and Node 24                 |
| **Standalone CPM CLI runtime**       | Node.js >=18.18.0          | Separate self-contained compatibility surface    |
| **Local development and publishing** | Node.js 24                 | `.node-version` is the repository pin            |
| **npm**                              | Bundled with Node          | Run `npm ci` inside `server/`                    |
| **Python tooling**                   | See `requirements-dev.txt` | `npm run setup:python` installs the pins CI uses |
| **Git**                              | Any recent                 | Required for Husky hooks                         |

The server uses `node:sqlite` without an experimental flag, which sets its runtime floor. Use Node 24 for repository development so local builds match the publish workflows — every CI job except the test matrix now reads the same `.node-version`, and the matrix is the only place 22.13.0 appears.

Install with `npm ci`, not `npm install`: `ci` reproduces `package-lock.json` exactly, and a tree that has drifted from the lockfile makes every local `validate:*` result describe a toolchain CI will not use. `npm run validate:lockfile-sync` reports that drift by name and runs inside `validate:all`. `npm run setup:python` does the same job for Ruff, Pyrefly, Pytest, and PyYAML, whose pins live in `requirements-dev.txt` — the same file CI installs from.

<details>
<summary><strong>Repo Structure</strong></summary>

```
repo/
├── server/
│   ├── src/            # TypeScript sources
│   ├── dist/           # Compiled runtime (SSOT for behavior)
│   ├── prompts/        # Prompt registry and markdown templates
│   ├── resources/      # Gates, frameworks, styles
│   ├── config.json     # Runtime configuration
│   └── package.json    # Scripts + dependencies
├── docs/               # Canonical documentation (Diataxis)
├── plans/              # Living migration plans + guardrails
├── AGENTS.md           # Agent automation rules
└── CONTRIBUTING.md     # This file
```

</details>

<details>
<summary><strong>Available Scripts</strong> (run inside <code>server/</code>)</summary>

| Command                                     | Description                                 |
| ------------------------------------------- | ------------------------------------------- |
| `npm run build`                             | esbuild bundle to `dist/index.js`           |
| `npm run typecheck`                         | Strict TypeScript checks without emit       |
| `npm run lint` / `lint:fix`                 | ESLint validation + autofix                 |
| `npm run lint:ratchet`                      | Fail if ESLint violations increased         |
| `npm run validate:format`                   | Prettier check on repo-level JSON/MD/YAML   |
| `npm run validate:all`                      | Full validation suite (deps + architecture) |
| `npm run validate:arch`                     | Dependency Cruiser architecture rules       |
| `npm test`                                  | Unit suite only (see `test:integration`)    |
| `npm run test:integration`                  | Integration tests only                      |
| `npm run test:coverage`                     | Coverage report (target: >80%)              |
| `npm run generate:contracts`                | Regenerate MCP schemas from contracts       |
| `npm run start:stdio` / `start:development` | STDIO / Streamable HTTP for manual testing  |

</details>

## Documentation Standards

Root-level `README.md` is governed by the [README Charter](docs/portfolio/readme-charter.md) — audience, voice rules, line budgets, Diátaxis section markers, and forbidden-word list. README PRs run `npm run validate:readme` and answer the charter block in the PR template.

Docs under `docs/` follow the Diátaxis split documented in [docs/README.md](docs/README.md): tutorials (learning), how-to (problem-solving), reference (lookup), concepts (understanding).

## How to Contribute

### Contribution Types

Choose the path that matches your change:

| I want to...                  | Path                                                 | Key docs                                                        |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Fix a bug or add a feature    | [Code changes](#code-changes)                        | [Architecture](docs/architecture/overview.md)                   |
| Create or edit a prompt/chain | [Prompt contributions](#prompt--chain-contributions) | [Build Your First Prompt](docs/tutorials/build-first-prompt.md) |
| Add or modify a quality gate  | [Gate contributions](#gate-contributions)            | [Gates Guide](docs/guides/gates.md)                             |
| Add or modify a framework     | [Framework contributions](#framework-contributions)  | [Frameworks Guide](docs/guides/frameworks.md)                   |
| Improve documentation         | [Documentation](#documentation)                      | [Docs Index](docs/README.md)                                    |

### Code Changes

1. Read [Architecture Overview](docs/architecture/overview.md) for the pipeline, transports, and runtime model.
2. Identify the correct domain from the ownership matrix in `CLAUDE.md` -- stages are thin orchestration, domain logic lives in services.
3. Make focused, reversible changes. Respect [AGENTS.md](AGENTS.md) guardrails.
4. Keep STDIO and Streamable HTTP behavior in parity.
5. Register new modules through the `Application` orchestrator (`server/src/runtime/`).

> [!IMPORTANT]
> **TypeScript strict mode** is enforced. Prefer dependency injection for custom services, but use library globals directly (e.g., `trace.getTracer()`) when the library provides its own accessor.

### Prompt & Chain Contributions

All prompt/chain changes flow through MCP tools -- never edit files under `server/prompts/` directly.

- **Create/update/delete**: Use `resource_manager` with `resource_type:"prompt"`
- **Schema**: Follow [Prompt YAML Schema](docs/reference/prompt-yaml-schema.md)
- **Chains**: See [Chains Lifecycle](docs/concepts/chains-lifecycle.md) and [Chain Schema](docs/reference/chain-schema.md)
- **Test**: Execute via `prompt_engine` and include output in your PR

### Gate Contributions

- Add gate definitions under `server/resources/gates/{id}/gate.yaml`
- Follow [Gate Configuration](docs/reference/gate-configuration.md) for schema
- See [Quality Gates](docs/concepts/quality-gates.md) for precedence and verification types
- Update [Gates Guide](docs/guides/gates.md) when behavior changes

### Framework Contributions

- Add framework definitions under `server/resources/frameworks/{id}/`
- Follow the structure: `framework.yaml` + `phases.yaml` + optional `system-prompt.md` and `judge-prompt.md`
- See [Frameworks Guide](docs/guides/frameworks.md) for configuration

### Documentation

All docs live under `docs/` organized by [Diataxis](https://diataxis.fr/) intent:

| Quadrant  | Directory         | For                           |
| --------- | ----------------- | ----------------------------- |
| Tutorials | `docs/tutorials/` | Learning by doing             |
| How-to    | `docs/guides/`    | Solving specific problems     |
| Reference | `docs/reference/` | Looking up syntax/API details |
| Concepts  | `docs/concepts/`  | Understanding how things work |

- Update docs **in the same changeset** as code -- no deferred TODOs.
- Verify references against `server/dist/**` for behavioral accuracy.
- Consult [Docs Index](docs/README.md) before creating new files.

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by CI.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | When                                    |
| ---------- | --------------------------------------- |
| `feat`     | New feature or capability               |
| `fix`      | Bug fix                                 |
| `refactor` | Code restructuring (no behavior change) |
| `chore`    | Maintenance, deps, configs              |
| `docs`     | Documentation only                      |
| `test`     | Adding or updating tests                |
| `ci`       | CI/CD workflow changes                  |
| `perf`     | Performance improvement                 |

### Scopes

Use these project-specific scopes:

`server` `cli` `runtime` `pipeline` `gates` `frameworks` `prompts` `chains` `styles` `scripts` `hooks` `resources` `mcp-tools` `contracts` `parsers` `ci` `deps` `config` `logging` `metrics` `docs` `tests` `semantic` `execution`

### Examples

```bash
git commit -m "feat(gates): add shell verification timeout option"
git commit -m "fix(pipeline): correct framework authority resolution order"
git commit -m "docs(guides): update injection control frequency table"
git commit -m "refactor(runtime): extract module initialization to dedicated service"
```

### Breaking Changes

Add `!` after the type/scope (e.g. `feat(mcp-tools)!: redesign resource_manager schema`) **and** a
`BREAKING CHANGE:` footer. Release Please reads either one to cut a major.

**A change is breaking only if it alters the declared public API.** That surface is defined in
`CLAUDE.md` § Public API Contract — the MCP tool surface, the CLI commands, the resource formats,
the Python hook contract, and the symbolic command language. Internal TypeScript exports, package
manifest fields, `src/` layout and build tooling are explicitly outside it.

This distinction is the difference between a version number that means something and one that
climbs on every refactor. When unsure, ask: **can a user observe this without reading our source?**
If not, it is not breaking.

| Change                                          | Breaking?                                  |
| ----------------------------------------------- | ------------------------------------------ |
| Rename a `prompt_engine` parameter              | **Yes** — MCP tool surface                 |
| Remove a `cpm` flag                             | **Yes** — CLI surface                      |
| Change the gate YAML schema                     | **Yes** — resource format                  |
| Restructure `src/` layers, rewrite imports      | No — internal                              |
| Drop `types` / `src` from the published package | No — packaging, no library API is declared |
| Add a validation script or CI job               | No                                         |

## Testing

### Decision Matrix

Run validations that match what you changed:

| I changed...               | Run this                                                   | Required? |
| -------------------------- | ---------------------------------------------------------- | --------- |
| Server source code         | Minimum Validation below (all four)                        | Yes       |
| Pipeline stages            | `npm test` + smoke test both transports                    | Yes       |
| MCP tool schemas/contracts | `npm run generate:contracts && npm run validate:contracts` | Yes       |
| A prompt or chain template | Execute via `prompt_engine`, describe results in PR        | Yes       |
| A gate definition          | Execute via `resource_manager`, verify gate triggers       | Yes       |
| Transport/runtime behavior | Smoke test BOTH: `start:stdio` and `start:development`     | Yes       |
| Documentation only         | Verify references against `server/dist/**`                 | Yes       |
| Dependencies               | `npm audit` + full test suite                              | Yes       |

Push validation is impact-aware and fail-closed:

| Push contents                                                                             | Hosted/local route                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Canonical docs/plan Markdown only                                                         | Text hygiene and formatting; protected CI job names still report success/failure |
| `hooks/**` plus optional docs                                                             | Python validation plus text hygiene                                              |
| Source, tests, dependency files, workflows, configuration, mixed, empty, or unknown paths | Full validation, CLI, build, and Node test matrix                                |

The canonical routing rules live in `scripts/classify-validation-scope.js`. Do not add
a competing path list to a hook or required workflow.

### Minimum Validation (before any commit)

```bash
npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci
```

`typecheck:tests:ratchet` is not optional. `tsconfig.json` excludes `tests/`, so `npm run typecheck`
cannot see the call sites a signature change breaks, and Jest compiles per file without checking the
project. A test file can pass both while carrying type errors.

### Full Validation (before pushing)

```bash
npm run typecheck && npm run lint:ratchet && npm test && npm run validate:all
```

> [!TIP]
> Pre-push hooks select the appropriate route automatically. If a push is blocked, fix
> the issue -- don't bypass hooks.

## Issues & Pull Requests

### Opening an Issue

Use the [issue templates](https://github.com/minipuft/claude-prompts-mcp/issues/new/choose) -- they provide structured forms for bug reports and feature requests. Check [Troubleshooting](docs/guides/troubleshooting.md) before filing a bug.

### Pull Request Process

A [PR template](.github/pull_request_template.md) auto-fills when you open a PR. Fill in each section -- CI will also auto-comment a validation summary.

**What reviewers look for:**

1. **Focused scope** -- one concern per PR. Split large changes into reviewable chunks.
2. **Tests** -- new behavior has tests; changed behavior has updated tests.
   Unit tests live in `server/tests/unit/<domain>/`, integration tests in `server/tests/integration/`.
   Run the suite with `npm test`. To run one file directly, Jest needs the ESM flag:
   `NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/<path>`.
3. **Docs updated** -- code and docs ship together.
4. **Conventional commit** -- PR title follows commit conventions (squash-merge uses it).
5. **Validation proof** -- link test output, screenshots, or describe manual verification steps.
6. **No regressions** -- hooks pass, CI green, no new lint violations.

## Git Hooks

Hooks auto-install via `prepare` on first `npm install` inside `server/`.

<details>
<summary><strong>Pre-commit (staged files)</strong></summary>

Runs on staged files only:

1. `eslint --fix`
2. `prettier --write`
3. `npm run typecheck`

Commits are blocked if checks fail. Staged files may be auto-modified by formatters.

</details>

<details>
<summary><strong>Pre-push (full workspace)</strong></summary>

Runs before every `git push`:

On the full route, in order:

1. Lockfile sync (`validate:lockfile-sync`) — first, because every step below measures the installed tree
2. Type checking (`typecheck`, then `typecheck:committed`)
3. Linting (`lint:ratchet`)
4. Format checking
5. Python hook validation (`validate:python`, only when `hooks/**` changed)
6. Tests (`test:ci`)
7. Dependency validation (`validate:arch`)
8. Version consistency (`validate:versions`)
9. Build

Docs-only and `hooks/**`-only pushes take lighter routes. `scripts/classify-validation-scope.js`
decides which. Pushes are blocked if any step fails.

</details>

> [!CAUTION]
> **Emergency bypass only**: `HUSKY=0 git commit` or `HUSKY=0 git push`. Open a follow-up issue documenting why the bypass was needed.

<details>
<summary><strong>Pipeline State Management Patterns</strong></summary>

When modifying pipeline stages (`server/src/engine/execution/pipeline/stages/`), use centralized state management:

**Gates** -- use `context.gates` accumulator:

```typescript
// Correct: accumulator with source tracking
context.gates.add("research-quality", "registry-auto");
context.gates.addAll(frameworkGates, "framework-guide");
const finalGates = context.gates.getAll();
```

**Framework decisions** -- use `context.frameworkAuthority`:

```typescript
// Correct: authority for consistent resolution
const decision = context.frameworkAuthority.decide({
  modifiers: context.executionPlan?.modifiers,
  operatorOverride: context.parsedCommand?.executionPlan?.frameworkOverride,
  clientOverride: context.state.framework.clientOverride,
  globalActiveFramework: context.frameworkContext?.selectedFramework?.id,
});
```

**Diagnostics** -- use `context.diagnostics`:

```typescript
context.diagnostics.info(this.name, "Stage completed", { key: value });
context.diagnostics.warn(this.name, "Potential issue", { details });
```

See [Architecture Overview](docs/architecture/overview.md) for the full pipeline model.

</details>

## Release Process

```
Conventional commits --> Release-Please PR --> Merge --> GitHub Release --> npm publish
```

Releases are fully automated. Commit with conventional format and Release-Please handles versioning, changelogs, and publishing.

All version references must stay in sync across `server/package.json`, `manifest.json`, and `.claude-plugin/plugin.json`. The `validate:versions` script enforces this.

> [!TIP]
> See [Release Process Guide](docs/guides/release-process.md) for detailed workflows, troubleshooting, and token rotation procedures.

<details>
<summary><strong>Maintainer: Release Secrets & Manual Release</strong></summary>

**Required secrets** (Repository Settings > Secrets and variables > Actions):

| Secret                 | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `NPM_TOKEN`            | npm automation token for publishing      |
| `RELEASE_PLEASE_TOKEN` | GitHub PAT (Contents: Write, PRs: Write) |

**Manual release** (emergency only):

```bash
cd server
npm run build && npm test
npm version patch  # or minor/major
npm publish --access public
git push --tags
```

</details>

## Security & Dependencies

- Run `npm audit` when bumping dependencies; fix or document high/critical issues immediately.
- Keep hook configs (`.husky/`, `.lintstagedrc.json`, `.prettierrc.json`, ESLint) in sync when updating rules.
- Never commit secrets. Use environment variables for API keys.

## Architecture Decisions

Design decisions are recorded in `docs/adr/` using [ADR format](docs/adr/0000-template.md). Long-running migrations live in `plans/*.md` with checklists and blockers.

Check `plans/` before touching a subsystem -- there may be an active migration that affects your work.

## Getting Help

| Need                              | Where                                                                  |
| --------------------------------- | ---------------------------------------------------------------------- |
| Understand the architecture       | [Architecture Overview](docs/architecture/overview.md)                 |
| Look up MCP tool syntax           | [MCP Tools Reference](docs/reference/mcp-tools.md)                     |
| Debug a common error              | [Troubleshooting](docs/guides/troubleshooting.md)                      |
| Understand agent automation       | [AGENTS.md](AGENTS.md)                                                 |
| Find any doc by topic             | [Docs Index](docs/README.md)                                           |
| Report a bug or request a feature | [GitHub Issues](https://github.com/minipuft/claude-prompts-mcp/issues) |

---

_If anything in this guide becomes outdated, fix it alongside your change so future contributors avoid drift._
