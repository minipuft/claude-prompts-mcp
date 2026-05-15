# Contributing to Claude Prompts

Thank you for contributing to the Claude Prompts MCP server. This guide covers everything from your first PR to advanced contribution workflows.

## Quick Start

```bash
# 1. Fork and clone
git clone https://github.com/<your-fork>/claude-prompts.git
cd claude-prompts/server

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

| Requirement | Version           | Notes                              |
| ----------- | ----------------- | ---------------------------------- |
| **Node.js** | 18 -- 24          | `.nvmrc` pinned to 24              |
| **npm**     | Bundled with Node | Run `npm install` inside `server/` |
| **Git**     | Any recent        | Required for Husky hooks           |

<details>
<summary><strong>Repo Structure</strong></summary>

```
repo/
├── server/
│   ├── src/            # TypeScript sources
│   ├── dist/           # Compiled runtime (SSOT for behavior)
│   ├── prompts/        # Prompt registry and markdown templates
│   ├── resources/      # Gates, methodologies, styles
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

| Command                             | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `npm run build`                     | esbuild bundle to `dist/index.js`           |
| `npm run typecheck`                 | Strict TypeScript checks without emit       |
| `npm run lint` / `lint:fix`         | ESLint validation + autofix                 |
| `npm run lint:ratchet`              | Fail if ESLint violations increased         |
| `npm run format` / `format:fix`     | Prettier checks/auto-format                 |
| `npm run validate:all`              | Full validation suite (deps + architecture) |
| `npm run validate:arch`             | Dependency Cruiser architecture rules       |
| `npm test` / `test:jest`            | Jest suite (unit + integration)             |
| `npm run test:integration`          | Integration tests only                      |
| `npm run test:coverage`             | Coverage report (target: >80%)              |
| `npm run generate:contracts`        | Regenerate MCP schemas from contracts       |
| `npm run start:stdio` / `start:sse` | Launch transports for manual testing        |

</details>

## Documentation Standards

Root-level `README.md` is governed by the [README Charter](docs/portfolio/readme-charter.md) — audience, voice rules, line budgets, Diátaxis section markers, and forbidden-word list. README PRs run `npm run validate:readme` and answer the charter block in the PR template.

Docs under `docs/` follow the Diátaxis split documented in [docs/README.md](docs/README.md): tutorials (learning), how-to (problem-solving), reference (lookup), concepts (understanding).

## How to Contribute

### Contribution Types

Choose the path that matches your change:

| I want to...                  | Path                                                    | Key docs                                                        |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Fix a bug or add a feature    | [Code changes](#code-changes)                           | [Architecture](docs/architecture/overview.md)                   |
| Create or edit a prompt/chain | [Prompt contributions](#prompt--chain-contributions)    | [Build Your First Prompt](docs/tutorials/build-first-prompt.md) |
| Add or modify a quality gate  | [Gate contributions](#gate-contributions)               | [Gates Guide](docs/guides/gates.md)                             |
| Add or modify a methodology   | [Methodology contributions](#methodology-contributions) | [Methodologies Guide](docs/guides/methodologies.md)             |
| Improve documentation         | [Documentation](#documentation)                         | [Docs Index](docs/README.md)                                    |

### Code Changes

1. Read [Architecture Overview](docs/architecture/overview.md) for the pipeline, transports, and runtime model.
2. Identify the correct domain from the ownership matrix in `CLAUDE.md` -- stages are thin orchestration, domain logic lives in services.
3. Make focused, reversible changes. Respect [AGENTS.md](AGENTS.md) guardrails.
4. Keep STDIO and SSE behavior in parity.
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

### Methodology Contributions

- Add methodology definitions under `server/resources/methodologies/{id}/`
- Follow the structure: `methodology.yaml` + `phases.yaml` + optional `system-prompt.md` and `judge-prompt.md`
- See [Methodologies Guide](docs/guides/methodologies.md) for configuration

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

`server` `runtime` `pipeline` `gates` `frameworks` `prompts` `chains` `styles` `scripts` `hooks` `resources` `mcp-tools` `contracts` `parsers` `ci` `deps` `config` `docs` `tests` `execution`

### Examples

```bash
git commit -m "feat(gates): add shell verification timeout option"
git commit -m "fix(pipeline): correct framework authority resolution order"
git commit -m "docs(guides): update injection control frequency table"
git commit -m "refactor(runtime): extract module initialization to dedicated service"
```

> [!NOTE]
> Breaking changes: add `!` after type/scope (e.g., `feat(mcp-tools)!: redesign resource_manager schema`) and include a `BREAKING CHANGE:` footer.

## Testing

### Decision Matrix

Run validations that match what you changed:

| I changed...               | Run this                                                   | Required? |
| -------------------------- | ---------------------------------------------------------- | --------- |
| Server source code         | `npm run typecheck && npm test`                            | Yes       |
| Pipeline stages            | `npm test` + smoke test both transports                    | Yes       |
| MCP tool schemas/contracts | `npm run generate:contracts && npm run validate:contracts` | Yes       |
| A prompt or chain template | Execute via `prompt_engine`, describe results in PR        | Yes       |
| A gate definition          | Execute via `resource_manager`, verify gate triggers       | Yes       |
| Transport/runtime behavior | Smoke test `npm run start:stdio` and `start:sse`           | Yes       |
| Documentation only         | Verify references against `server/dist/**`                 | Yes       |
| Dependencies               | `npm audit` + full test suite                              | Yes       |

### Minimum Validation (before any commit)

```bash
npm run typecheck && npm run lint:ratchet && npm test
```

### Full Validation (before pushing)

```bash
npm run typecheck && npm run lint:ratchet && npm test && npm run validate:all
```

> [!TIP]
> Pre-push hooks run this automatically. If a push is blocked, fix the issue -- don't bypass hooks.

## Issues & Pull Requests

### Opening an Issue

Use the [issue templates](https://github.com/minipuft/claude-prompts/issues/new/choose) -- they provide structured forms for bug reports and feature requests. Check [Troubleshooting](docs/guides/troubleshooting.md) before filing a bug.

### Pull Request Process

A [PR template](.github/pull_request_template.md) auto-fills when you open a PR. Fill in each section -- CI will also auto-comment a validation summary.

**What reviewers look for:**

1. **Focused scope** -- one concern per PR. Split large changes into reviewable chunks.
2. **Tests** -- new behavior has tests; changed behavior has updated tests.
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

1. `npm run typecheck`
2. `npm run lint`
3. `npm run format`
4. `npm run test:jest`
5. `npm run validate:all`

Pushes are blocked if any command fails.

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
context.gates.addAll(methodologyGates, "methodology");
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

| Need                              | Where                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| Understand the architecture       | [Architecture Overview](docs/architecture/overview.md)             |
| Look up MCP tool syntax           | [MCP Tools Reference](docs/reference/mcp-tools.md)                 |
| Debug a common error              | [Troubleshooting](docs/guides/troubleshooting.md)                  |
| Understand agent automation       | [AGENTS.md](AGENTS.md)                                             |
| Find any doc by topic             | [Docs Index](docs/README.md)                                       |
| Report a bug or request a feature | [GitHub Issues](https://github.com/minipuft/claude-prompts/issues) |

---

_If anything in this guide becomes outdated, fix it alongside your change so future contributors avoid drift._
