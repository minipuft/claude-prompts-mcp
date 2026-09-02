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

### Working in a second worktree

Step 2 above wires the git hooks, and it wires them **per worktree**. `core.hooksPath` is the
relative path `.husky/_`, which husky generates and self-ignores, so `git worktree add` produces a
worktree where that path does not resolve — and git skips every hook silently, with no warning and
no failing exit code. Commits and pushes from there run no local validation at all.

Create additional worktrees with the bootstrap script, which adds the worktree, wires husky inside
it, links both `node_modules` trees, and then verifies the hooks are executable before reporting
success:

```bash
npm run worktree:create -- ../claude-prompts-mcp-featurex feat/my-change --from origin/main
```

To repair a worktree that already exists, run husky from inside it:

```bash
npx --prefix /path/to/main-worktree husky
```

`npm run validate:git-hooks-active` reports which case you are in. It is part of `validate:all`,
and it passes without inspecting anything outside a linked worktree, so CI and plain clones are
unaffected.

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

A [PR template](.github/pull_request_template.md) auto-fills when you open a PR. Generate it
pre-filled from your branch instead of typing into it -- the session that did the work should
**edit** the reader's artifact, not author it from inside its own reasoning:

```bash
cd server
npm run pr:body -- --out /tmp/pr-body.md           # skeleton: commit subjects, plan link, open rows, largest diffs
$EDITOR /tmp/pr-body.md                              # fill every ___ and empty table cell
node ../scripts/validate-pr-body.mjs --body-file /tmp/pr-body.md --title "feat(scope): outcome"
gh pr create --title "feat(scope): outcome" --body-file /tmp/pr-body.md
```

**Note**: `gh pr create --body "..."` BYPASSES the template silently. Use `--body-file`.

The `PR Conventions` workflow runs the same validator on every PR and lints the title with the
repo's own `commitlint.config.mjs`. It is a **required** context (since 2026-09-02) on every
non-bot PR; bot PRs (renovate, release-please) are exempt from the authored-body checks because
their bodies are machine-owned. The validator fails on surviving `___` placeholders, unfilled
verification rows, and a non-finalized `Plan:` footer. CI also auto-comments a validation summary
and the changed-file list -- never maintain those by hand.

**The body is a two-register document.** Reader voice above the fold (the 400-word budget counts
only this -- fenced blocks, tables, and `<details>` content are exempt); below it, an optional
collapsed appendix:

```markdown
<details><summary>Appendix -- session archive (not review material)</summary>
 ... deviation-log excerpts, captured drive transcripts, extended verification ...
</details>
```

Because the squash commit carries the PR body, the appendix lands **greppable in main's history**
-- it replaces the per-commit bodies squash discards. `npm run pr:body` seeds it from your
implementation-notes' `## Deviations`. Commit bodies are therefore ephemeral working notes: keep
them one-concern and short (commitlint warns past 1,500 characters).

**Plan footer contract.** A PR executing a plan ends its body with exactly one line --
`` Plan: `plans/<path>.md` `` -- and mentions the plan nowhere else (no row ids, no plan
vocabulary). The gate fails while that plan's `status:` is non-final: finalize the plan (every
row terminal, retired) in the same PR, or the PR does not merge.

**The squash-merge commit carries the PR title and body, verbatim.** That is a repository setting
(`squash_merge_commit_title: PR_TITLE`, `squash_merge_commit_message: PR_BODY`, set 2026-09-01;
`delete_branch_on_merge: true`, set 2026-09-02).
Before it, GitHub concatenated every commit body: #254 landed on `main` as a 4,615-word commit
message. The `PR Conventions` workflow asserts their effect on every PR (the newest squash on
`main` must carry a PR-shaped body); if they drift, reapply:

```bash
gh api -X PATCH repos/minipuft/claude-prompts-mcp \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true
```

#### Write for the reader, not the session

Measured 2026-09-01 on #254 and #255: both PRs satisfied the template and were still unreadable at
a glance -- 651 and 866 words, Summary bullets packing four facts each in plan-internal vocabulary
(`OQ-A2b`, `stage 06 remains the single producer`), a verification section that was a wall of test
counts with no baseline, and no demonstration of a feature that shipped a state machine. The
CHANGELOG entry and every commit body were written at the same register. The defect was not the
template; it was that one session wrote every artifact in its own voice.

Each reader question has ONE owning artifact. The PR body **links** to the others; it never re-tells them.

| The reader asks                                              | Owner                                                                          | Voice                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| What can I now do / what no longer happens?                  | `CHANGELOG.md` `[Unreleased]`                                                  | consumer; one behavior per bullet, two sentences max  |
| Show me                                                      | PR body `## Demonstration`                                                     | transcript, `mermaid`, before/after table, screenshot |
| Where do I look, what do I distrust?                         | PR body `## Notes for Reviewers`                                               | reviewer; three pointers at most                      |
| Why this diff?                                               | commit body                                                                    | one concern; the why, not a restated diff             |
| Why did the session decide X? Falsified rulings, deviations? | plan + `*-implementation-notes.md`, excerpted into the PR's collapsed Appendix | session voice -- collapsed, never above the fold      |
| Did CI run, which files changed?                             | bot comment                                                                    | derived                                               |

**Boundary test**: if a sentence only makes sense to someone who was in the session, it goes in the
implementation-notes and the PR links it. Nothing is lost -- the notes are committed -- it is just not
duplicated into an artifact built for a different reader.

**Demonstrations for a headless server.** Images rarely apply here. What does: a tool-response
transcript before and after (this server's screenshot -- the `verify-*.mjs` drives already emit
them, capture rather than paraphrase); a ` ```mermaid ` `stateDiagram-v2` or `sequenceDiagram`
for a lifecycle or pipeline change (GitHub renders it natively); a before/after table for a
contract or output-shape change; a `vhs` GIF only when there is a terminal session worth watching.

**Verification is a table.** One row per property: claim · probe command · baseline -> measured ·
the mutation that makes it fail. `2823 tests` with no baseline tells the reader nothing;
`unit 2782 -> 2823 (+41)` does. A null result needs its positive control in the same row.

#### Titles name the outcome

The PR title becomes the squash-merge subject and the line release-please writes into the
changelog. It is the one sentence most readers ever see, so it names what is TRUE AFTER MERGE, not
what the session did. `commitlint` warns (never blocks) on the two most common misses.

| Strategy                           | Test                                                                                                                     | Before -> after                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Outcome over activity              | Complete "After this merges, ___" with the subject                                                                       | `execute the security review` -> `refuse gate commands outside the operator's allowlist`          |
| Release-notes test                 | Would it read correctly under **Fixed** / **Added** in a release?                                                        | `resource-surface consolidation` -> `resource writes land only inside the resource root`          |
| State verbs over session verbs     | refuse · interrupt · require · carry · stop · bound -- not implement · execute · consolidate · update · improve · harden | `harden the HTTP transport` -> `reject requests the MCP spec forbids`                             |
| One outcome                        | `and` or `-- a, b, and c` is two PRs, or one umbrella that has not been named                                            | `mid-chain unknown surfacing and adaptive consolidation` -> `blocking unknowns interrupt the run` |
| No plan names                      | A plan name says what you were doing; the body links the plan                                                            | `execute plan 2A` -> `a paused run can be claimed by another client`                              |
| Scope is where a reader would grep | The narrowest scope in `commitlint.config.mjs` the diff lives in                                                         | `fix(server)` -> `fix(gates)`                                                                     |
| `!` names the consumer's move      | A breaking title says what the consumer must change                                                                      | `fix(gates)!: shell_command is an argv array; a string fails to load`                             |
| Fits `git log --oneline`           | <=72 characters preferred; 100 enforced                                                                                  |                                                                                                   |

Commit subjects follow the same rules one level down: the revert test (below) decides the
boundary, and the subject names what is true after that one commit. A commit body past ~1,500
characters is a plan note wearing a commit -- `commitlint` warns; move the reasoning to the
implementation-notes and link it.

**Scope: a PR is one plan or goal; a commit is one concern.**

These are different units and conflating them is what makes a branch unreviewable. A PR that
executes a plan may legitimately carry a dozen commits -- what makes it reviewable is that each
one is separately understandable, not that there are few of them.

The operational test for "one concern" is the **revert test**: could this commit be reverted on
its own, without breaking the others? Its tests and its docs ship inside it, because reverting a
behavior without its test leaves a suite asserting something untrue. If a commit fails the revert
test it is two commits; if it can only be reverted together with its neighbour, it was one.

**What reviewers look for:**

1. **Focused scope** -- one goal per PR, one concern per commit (see above).
2. **Tests** -- new behavior has tests; changed behavior has updated tests.
   Unit tests live in `server/tests/unit/<domain>/`, integration tests in `server/tests/integration/`.
   Run the suite with `npm test`. To run one file directly, Jest needs the ESM flag:
   `NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/<path>`.
3. **Docs updated** -- code and docs ship together.
4. **Conventional commit** -- PR title follows commit conventions and names the outcome (squash-merge uses it).
5. **Demonstration and measured verification** -- a transcript, diagram, or before/after table; a
   verification table with baselines, not a count wall.
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
