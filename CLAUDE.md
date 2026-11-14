# Claude Prompts MCP -- Operator Handbook

**Source of Truth**: `server/dist/**`. Confirm behavior there before describing or modifying functionality.

## Core Principles

1. **MCP Tooling** -- Prompts, templates, chains flow through MCP tools.
2. **Contract ownership** -- Hand-written schemas in `src/mcp/tools/schemas/` own runtime validation; `tooling/contracts/*.json` own descriptions/parameter metadata generated into `src/mcp/contracts/schemas/_generated/`. Run `npm run generate:contracts`, never edit `_generated/`. `config.schema.json` <- `ConfigFile` (`generate:config-schema`).
3. **Transport Parity** -- Runtime changes must work in STDIO and Streamable HTTP. The two differ in instance lifetime, and that difference is load-bearing: STDIO pins one `McpServer` per connection, while HTTP builds a fresh one per request. A change that mutates a registered instance passes STDIO and silently no-ops over HTTP. HTTP+SSE was removed in the SDK v2 upgrade.
4. **Docs/Code Lockstep** -- Update relevant doc in `docs/` when behavior changes.
5. **Validation Discipline** -- **CI owns the full test suite; local checks are a subset chosen by who is running them.** A change's own check (the test, validator or probe that reads what the change wrote) runs with the change, and nothing wider. Before a push: `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run validate:all`. `test:all` (unit, integration and e2e) runs once, in CI, at the pull request; a red run is fixed on the branch, never merged around. Run `test:all` locally only to reproduce a CI failure or when no pull request will carry the change. `typecheck:tests:ratchet` is not optional: `tsconfig.json` excludes `tests/`, so `typecheck` is blind to every call site a signature change breaks. `test:ci` is an alias for `test:unit` and says nothing about the integration or e2e jobs. Owner ruling 2026-10-05, after a profile measured the full suite running three times in series per change while CI was green on 32 of 33 pull requests. *(flips when a defect reaches `main` that a local `test:all` would have caught and the pull request's CI did not)*

## Node.js Support Boundaries

| Surface                          | Supported Node.js | Enforcement                                                  |
| -------------------------------- | ----------------- | ------------------------------------------------------------ |
| MCP server and desktop extension | >=22.13.0         | `server/package.json`, `manifest.json`, CI on 22.13.0 and 24 |
| Standalone CPM CLI               | >=18.18.0         | `cli/package.json` and CLI runtime validation                |
| Local development and publishing | 24                | `.node-version` and publish workflows                        |

The server floor is where `node:sqlite` is available without an experimental flag. The standalone CLI remains a separate, self-contained compatibility surface.

## Validation Gates (one contract, impact-aware subsets)

**CI is the contract; every other gate is a documented strict subset of it.**

*(Not projected into `AGENTS.md`: CI-routing detail a Codex or OpenCode reader does not act on.
`CONTRIBUTING.md` §Testing and §Git Hooks carry the commands those readers run.)*

`scripts/classify-validation-scope.js` is the changed-path SSOT for CI routing. It recognizes two
narrow safe scopes and sends every empty, mixed, executable, configuration, dependency,
deleted-unknown, or unrecognized change to `full`.

| Scope   | Trigger                                                                                 | CI                                                                                                |
| ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs`  | documented root handbooks, `docs/**/*.md`, `plans/**/*.md`, and server/CLI READMEs only | classifier hygiene · CONTRIBUTING commands · plan row tracking · README charter · documented options · guidance projection; protected jobs report intentional lightweight passes |
| `hooks` | only `hooks/**` plus optional docs                                                      | pinned Ruff/Pyrefly/Pytest/PyYAML · the same documentation checks as `docs`                  |
| `full`  | everything else; empty/unknown input                                                    | typecheck · `validate:all` · CLI · build/smoke/schema · Node 22/24 unit/coverage/integration/E2E   |

Invariants, each of which has been broken once and is now enforced:

- **The workflow stays unconditional.** No workflow-level `paths` or `paths-ignore`: a required
  workflow skipped before jobs exist leaves its context pending. Routing happens inside the
  workflow and the `Lint & Validate`, `CLI`, `Build`, and `Test Suite` job names stay stable.
- **Hooks are subsets of CI.** `.husky/pre-commit` runs contract regeneration, staged lint,
  conditional Python, and typecheck. `.husky/pre-push` runs `typecheck` and `lint:ratchet` only, on
  every push regardless of scope. A step added to a hook that CI does not run breaks the contract:
  add it to `validate:all` first. `lint:ratchet` is a whole-project direction measure, so it runs at
  push and in CI, never per commit, where an unrelated violation would block a shared worktree.
- **A local gate is only as trustworthy as its toolchain.** `validate:lockfile-sync` (inside
  `validate:all`) and `setup:python` (`requirements-dev.txt`) read the same files CI installs from;
  every job reads `.node-version`, and the test matrix is the only place 22.13.0 appears.
- **Every formatting gate CHECKS; none writes.** A gate that rewrites a file after validating it
  commits bytes nothing checked and silently breaks anchored edits. Format at authoring time:
  `npm --prefix server run format` covers the same combined set `validate:format` reads
  (repo-level `*.json`/`*.md`/`*.yml` outside `server/**` against the root Prettier config at
  printWidth 80; every tracked file under `server/**` against `server/.prettierrc.json` at 100).
  Anything a generator owns belongs in `.prettierignore` with a reason.

## Pull Request Boundary

**`npm run pr:check` is the whole local gate, and it is a subset of CI by construction.**

`PR Conventions` is a required context whose gating steps on a non-bot PR are: three positive
controls, the body against `.github/pull_request_template.md`, the squash commit against the parser
release-please reads it with, and `commitlint` on the title. Run every one of them before
`gh pr create`, from the repo root:

```bash
TITLE="feat(scope): outcome"
npm run pr:body -- --out /tmp/pr-body.md     # seed it; never author a body from scratch
$EDITOR /tmp/pr-body.md
npm run pr:check -- --body-file /tmp/pr-body.md --title "$TITLE"
```

The template requires `## Demonstration` (consumer-observable before/after, or `n/a: <reason>`), a
`## How it was verified` TABLE (claim · probe · baseline -> measured · the mutation that fails it --
a count with no baseline is noise), and `## Notes for Reviewers`, under a 400-word above-the-fold
budget that fenced blocks, tables and `<details>` do not count against. The `Plan:` footer is the
ONLY sanctioned plan mention and it asserts that this PR advances the plan it names: the gate FAILS
when the PR closes none of that plan's open rows, when it closes the last row without retiring the
plan in the same PR, or when the file does not exist. The footer is also the join key a reader greps
to assemble a multi-PR initiative (ADR 0003); a `Decision: ADR-NNNN` trailer must name an existing
ADR. The scripts that enforce this are managed by the fleet delivery contract
(`.delivery-contract.json`); `validate:delivery-contract` fails on any local edit to them, and a
newer contract is adopted with `delivery-contract update` (CONTRIBUTING.md §Pull Request Process).

The squash check exists because release-please leaves out, silently, any commit its parser rejects
-- no changelog line, no version bump, no BREAKING CHANGE note -- and what it parses is not the body
as written: GitHub re-flows the body at 72 columns, so a long line can open `name(` and close it on
the next line. That dropped #501 (a breaking change) and #503 from a release although both bodies
passed every other check. On a refusal, put the example on one line inside a fenced block, reword
the line, or add a `BEGIN_COMMIT_OVERRIDE` block to the body -- the marker counts anywhere in the
body, even quoted in backticks, so never mention it in prose.

One more step warns and never gates: `scripts/warn-contract-lag.mjs` annotates a PR when
`.delivery-contract.json` trails a repository-standards release that changed the contract template.
Leave it to an adoption PR.

Parity is enforced rather than documented: `scripts/pr-check.mjs` names each workflow step it
mirrors and `server/tests/unit/scripts/pr-check-ci-parity.test.ts` reads `pr-conventions.yml` and
fails when the two sets diverge. Both exist because following the documented steps once still
shipped an unchecked title (#283) and a hand-written body cost a second CI run (#312).

This section is projected into `AGENTS.md` (`PROJECTED_HANDBOOK_SECTIONS` in
`scripts/sync-project-guidance.js`); Codex and OpenCode also reach it through `CONTRIBUTING.md`
§Pull Request Process and the usage text `pr-check.mjs` prints without arguments.

## Fleet Standards Upstream (`minipuft/repository-standards`)

**Look there before writing any check that reads another repository, or any plan-status or dependency-policy rule.**

It owns the consumer-contract workflow + profiles, the shared Renovate preset, the plan
frontmatter/status vocabulary and `retire-done-plans`, and the **fleet drift audit** — which
already compares every downstream's resolved `claude-prompts` lock version, weekly, exiting
non-zero. This repo is the fleet's `upstream`, not a member; it consumes the standards as a pinned
tarball, a SHA-pinned action, a `$schema`, and a doc link.

A local downstream-version check was deleted here 2026-08-13 _because_ the fleet auditor does it
better (`validate-versions.js` records why). Re-adding one re-splits a settled decision — the
mistake was made and reverted on 2026-08-15. Two gates keep the relationship honest:
`validate:standards-pins` (all four references name one version) and
`validate:renovate-preset-agreement` (every preset key matches, or is a declared override).

## Documentation Map

| Topic                                        | Doc                                       |
| -------------------------------------------- | ----------------------------------------- |
| Architecture & runtime                       | `docs/architecture/overview.md`           |
| SQLite persistence                           | `docs/architecture/sqlite-persistence.md` |
| Configuration file, precedence, startup refusals | `docs/reference/configuration.md`      |
| Workspaces, overlays, resource paths         | `docs/guides/custom-resources.md`         |
| MCP tools & symbolic commands                | `docs/reference/mcp-tools.md`             |
| MCP contract maintenance                     | `docs/guides/mcp-contract-maintenance.md` |
| Prompt authoring                             | `docs/tutorials/build-first-prompt.md`    |
| Chains lifecycle                             | `docs/concepts/chains-lifecycle.md`       |
| Gates                                        | `docs/guides/gates.md`                    |
| Injection control                            | `docs/guides/injection-control.md`        |
| Identity & scope                             | `docs/guides/identity-scope.md`           |
| Skills Sync                                  | `docs/guides/skills-sync.md`              |
| Telemetry & observability                    | `docs/guides/telemetry-observability.md`  |
| Troubleshooting                              | `docs/guides/troubleshooting.md`          |
| Contributing & PR process                    | `CONTRIBUTING.md`                         |
| README charter (root README authoring rules) | `docs/portfolio/readme-charter.md`        |
| Release highlights                           | `CHANGELOG.md`                            |

Read the relevant doc before editing. Update docs when behavior changes.

## Command Reference (run inside `server/`)

| Command                           | Purpose                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                   | esbuild bundle -> `dist/index.js`                                                                                                                                                |
| `npm run verify:mcp`              | Spawn a server from `dist/` and prove all 3 MCP tools answer — **use instead of restarting Claude Code to check a build**. Refuses to run against a stale `dist/`                |
| `npm run typecheck`               | Strict TS type validation — **`src/` only**, `tsconfig.json` excludes `tests/`                                                                                                   |
| `npm test`                        | Full Jest suite                                                                                                                                                                  |
| `npm run lint:ratchet`            | Fail if ESLint violations increased or decreased without lowering the baseline                                                                                                   |
| `npm run typecheck:tests:ratchet` | Fail if `tests/` type errors increased or decreased without a baseline update. Covers call sites `typecheck` misses — a broken test file can otherwise land green                |
| `npm run generate:contracts`      | Regenerate MCP schemas from contracts                                                                                                                                            |
| `npm run validate:lockfile-sync`  | Fail when a tracked `package-lock.json` (root or `server/`) has drifted from its installed `node_modules` — compares npm's own `node_modules/.package-lock.json`, so no output parsing |
| `npm run setup:python`            | Install the pinned Ruff/Pyrefly/Pytest/PyYAML from `requirements-dev.txt` — the same file CI installs from                                                                       |
| `npm run validate:all`            | Full validation suite                                                                                                                                                            |
| `npm run validate:arch`           | Dependency Cruiser architecture rules                                                                                                                                            |
| `npm run validate:contracts`      | Verify generated artifacts in sync                                                                                                                                               |
| `npm run validate:domain-ownership` | Check the Domain Ownership Matrix against every module's `owns` declaration, both directions                                                                                    |
| `npm run validate:tool-parameter-reads` | Fail when a tool command declares a parameter its code never reads, or its code reads a parameter the command does not declare, on all three tools. A read is a property read reaching the handler, processor or pipeline stage — never a name in a string, and never a destructured key that is not used |
| `npm run test:integration`        | FIRST for new features                                                                                                                                                           |
| `npm run test:coverage`           | Baseline coverage (target: >80%)                                                                                                                                                 |
| `npm run skills:export`           | Export skills from `skills-sync.yaml`                                                                                                                                            |

## Domain Ownership Matrix (ENFORCED)

**Stages are thin orchestration. Domain logic lives in owner services.**

`validate:domain-ownership` checks this table both ways against each module's `module.yaml` `owns` block -- a row and its declaration must change together, and a row naming a symbol nobody exports, or a path the symbol is not defined in, fails.

| If you need...          | Owner Service                                                        | Stage May Only                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate normalization      | GateService (`gates/services/`)                                      | Call `gateService.normalize()`                                                                                                                |
| Gate enhancement        | GateEnhancementService                                               | Call `enhancementService.enhance*()`                                                                                                          |
| Gate selection          | GateManager (`gates/gate-manager.ts`)                                | Call `gateManager.selectGates()`                                                                                                              |
| Gate enforcement mode   | `resolveEnforcementMode` (`execution/pipeline/decisions/gates/`)     | Call `resolveEnforcementMode(mode)` -- a pure import, because `context.gateEnforcement` is optional and `?.` would silently relax enforcement |
| Gate verdict processing | GateVerdictProcessor (`gates/services/`)                             | Call `processor.handleGateAction()`                                                                                                           |
| Inline gate parsing     | InlineGateProcessor (`gates/services/`)                              | Call `processor.processInlineGates()`                                                                                                         |
| Prompt resolution       | PromptRegistry (`prompts/registry.ts`)                               | Call `registry.get()`                                                                                                                         |
| Command parsing         | UnifiedCommandParser (`execution/parsers/command-parser.ts`)         | Call `parser.parseCommand()`                                                                                                                  |
| Step capture            | StepCaptureService (`execution/capture/`)                            | Call `captureService.captureStep()`                                                                                                           |
| Response assembly       | ResponseAssembler (`execution/formatting/`)                          | Call `assembler.format*()`                                                                                                                    |
| Framework selection     | FrameworkManager (`frameworks/`)                                     | Call `frameworkManager.selectFramework()`                                                                                                     |
| Framework validity      | FrameworkManager                                                     | Call `frameworkManager.getFramework(id)` -- never hardcode                                                                                    |
| Injection decisions     | InjectionDecisionService (`execution/pipeline/decisions/injection/`) | Call `service.decide()`                                                                                                                       |
| Style resolution        | StyleManager (`modules/formatting/style-manager.ts`)                 | Call `styleManager.getStyle()`                                                                                                                |
| Delegation handoff evidence | `resolveHandoffEvidence` (`execution/delegation/handoff-contract.ts`) | Call `resolveHandoffEvidence(input)` -- a pure import, never re-parse the `HANDOFF RESULT` trailer inline                                    |
| Detached report routing | `resolveDetachedReport` (`execution/delegation/detached.ts`) | Call `resolveDetachedReport(input)` -- a pure import; a late result lands on the node its trailer names, never on the current step |

## MCP Tool Layer Structure

**Thin handlers route to domain processors. CRUD logic lives in processors, not handlers.**

```
prompt_engine  → PromptExecutor → PipelineBuilder → Pipeline (21 stages)
resource_manager → Router → Handler (≤125 lines) → Processors (lifecycle/discovery/versioning)
system_control → SystemControl Router → 12 action handlers
```

| Tool                           | Handler                     | Processors                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource_manager` (prompt)    | `PromptResourceHandler`     | `PromptLifecycleProcessor`, `PromptDiscoveryProcessor`, `PromptVersioningProcessor`                                                                                                                                                                                                           |
| `resource_manager` (gate)      | `GateToolHandler`           | `GateLifecycleProcessor`, `GateDiscoveryProcessor`, `GateVersioningProcessor`                                                                                                                                                                                                                 |
| `resource_manager` (framework) | `FrameworkToolHandler`      | `FrameworkLifecycleProcessor`, `FrameworkDiscoveryProcessor`, `FrameworkVersioningProcessor`, `FrameworkValidator`                                                                                                                                                                            |
| `resource_manager` (category)  | `CategoryToolHandler`       | `CategoryLifecycleProcessor`, `CategoryDiscoveryProcessor`, `CategoryVersioningProcessor`, `CategoryFileWriter`. Its resource is `category.yaml`, NOT the directory of prompts around it, which is why its mutation transaction targets the file and its `delete` leaves every prompt in place |
| `prompt_engine`                | `PromptExecutor`            | `PipelineBuilder` (factory), `ChainSessionRouter`                                                                                                                                                                                                                                             |
| `system_control`               | `ConsolidatedSystemControl` | 12 action handlers in `system-control/handlers/` (`analytics`, `changes`, `config`, `execution_history`, `framework`, `gates`, `guide`, `injection`, `maintenance`, `session`, `skills_sync`, `status`) |

## Runtime State (SQLite -- never commit `state.db`)

| Table               | Purpose                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv_state`          | Consolidated key-value store (`key='framework'` active framework + switch history, `key='gates'` enable/disable, `key='arg_history'` argument tracking, `key='resource_hashes'` content hash cache)                                                                             |
| `chain_runs`        | One row per live chain run (header facts: chain id, run owner, status, current node id, residual document). Primary SSOT for active runs -- replaces the retired `chain_run_registry` blob (schema v22)                                                                         |
| `chain_run_nodes`   | One row per step of a run (position, prompt id, step lifecycle, `origin`/`origin_unknown_id` provenance for nodes the adaptive mutation policy inserted, schema v23). Sibling to `chain_runs`; together they are what `chain_run_registry` used to serialize into one JSON blob |
| `chain_sessions`    | Derived read-projection of `chain_runs` + `chain_run_nodes`, rebuilt in the same transaction, for Python hook + cross-language consumers                                                                                                                                        |
| `execution_records` | SEP-1686 append-only per-step execution log (ULID-sorted); source for `v_execution_status` view                                                                                                                                                                                 |
| `resource_index`    | Resource discovery cache                                                                                                                                                                                                                                                        |

State stores using `kv_state` pass `tableName: 'kv_state'` + a discriminator `key` to `SqliteStateStoreConfig`. **`state.db` is mixed-posture, not ephemeral.** A `SCHEMA_VERSION` bump drops and recreates every table, but the four durable ones (`version_history`, `skills_sync_manifests`, `objects`, `version_entries`) are carried across: `ensureSchema()` snapshots their rows, applies the `DURABLE_MIGRATIONS` steps for the version range (pure transforms, `infra/database/durable-migrations.ts`), recreates, and restores strictly -- a column that vanishes without a step's `droppedColumns` entry throws and rolls the whole upgrade back, so a new `NOT NULL` column with no default needs a step that supplies it. A file below `MIGRATION_FLOOR` is refused at startup, unchanged; every upgrade is first backed up to `<db>.v<version>.bak`; `validate:table-contracts` fails a durable schema change that has no step or no `durable-schema.lock.json` update (`-- --update`). Per-table owner, posture, scope, and retention are declared in `src/infra/database/table-contracts.ts`, which is the SSOT.

**`state.db` is shared across projects, and two columns compete to isolate it.** `workspace_id`
has four readers, but for `version_history`, `execution_records` and `resource_changes` the column
that isolates is `tenant_id`, resolved by `resolveContinuityScopeId` to `workspaceId ?? organizationId
?? 'default'`; there `workspace_id` is a redundant second channel. `tenant_id` carries three
meanings across the schema (server PID, workspace id, literal `'default'`). Choosing one scope column
per table is open work, not a defect to patch. Consequences an agent meets:

- Isolation tightened on 2026-08-27, with no bulk backfill on purpose. State written earlier under
  `'default'` is unreachable from a scoped read, except that active framework and gate enablement
  copy a legacy `'default'` row into the launch workspace once, when it has no row of its own.
- Gate enablement loads every persisted `gates` row at startup, one per scope (since 2026-09-14);
  before that, every restart silently re-advertised disabled runtime gates.
- A `kv_state` scope with no row falls back to `frameworks.defaultFramework`. The scope id derives
  from `CLAUDE_PROJECT_DIR`, then cwd basename, unless `--workspace-id` is passed; pass a scope
  explicitly only when one process serves several workspaces (HTTP).
- A process that resolves no workspace shares the `'default'` bucket with every other such process.
  That is the whole residual exposure; an earlier version of this handbook claimed rollback history
  was shared across every project, which was false.

-> `docs/architecture/sqlite-persistence.md` §`tenant_id` Means Three Things · `docs/guides/identity-scope.md`
## Public API Contract (what a major version protects)

**Declared surface over "anything that feels significant"; consumer-observable over internal.**

Semver is defined relative to a declared API. Without one, every incidental change reads as
breaking and major versions inflate until they carry no information.

| In the contract -- break it, bump major                                                                       | Not in the contract -- change freely                                                               |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| MCP tool surface: `prompt_engine`, `resource_manager`, `system_control` names, parameters, and response shape | Internal TypeScript exports, including `src/index.ts`                                              |
| CLI surface: `claude-prompts` and `cpm` commands and flags                                                    | `package.json` packaging fields (`types`, `exports`, `files`)                                      |
| Resource formats: prompt/gate/framework YAML schema, `config.json`                                            | `src/` layer structure, module layout, import style                                                |
| Python hook contract consumed by downstream plugins -- **durable surface only**, see below                    | Which files land in the published tarball                                                          |
|                                                                                                               | **PID-scoped derived projections**: `chain_sessions`, `chain_runs`, `chain_run_nodes` column names |
| Symbolic command language (`>>`, `==>`)                                                                       | Build tooling, validation scripts, CI                                                              |

**The Python hook contract covers the durable surface, not every table a hook can open.**
`chain_sessions`, `chain_runs` and `chain_run_nodes` are per-PID projections, deleted at cleanup and
dropped by any `SCHEMA_VERSION` bump; nothing a hook reads there survives a restart. What IS
protected: the module API of `hooks/lib/*` that plugins import (`load_active_chain_state`,
`load_prompts`, their return shapes), the `hooks-state.db` schema, and the JSON payload contract
hooks exchange with Claude Code. Renaming `chain_sessions.tenant_id` -> `run_owner_pid` (schema v20)
is the worked example: in-contract, both sides in one commit, no dual-write. The constraint on a
hook-side change is atomicity, not a version bump.

**The tool surface is a union, not a snapshot.** `prompt_engine` builds its `inputSchema` from
runtime state: `gates` and `gate_verdict` are runtime-feature-gated; `gate_action` is core with its
widest enum. The contract is the union of every reachable shape (`tooling/contracts/prompt-engine.json`).
Narrowing within the union is not breaking; adding or removing a member is. A narrowed-away gate
parameter is REFUSED with its own "declared, but not advertised right now" message, never stripped
and never called "not a parameter".

**`gate_verdict` accepts one shape, the structured object** (`{overall, rationale, per_gate?,
reminders?}`); a string is refused at the schema with the object to resend. Other text channels keep
their own grammar: an exported skill's Stop hook reads a `GATE_REVIEW:` line, a delegated worker's
trailer carries `Proposed Gate Review:`. Abort (`gate_action:"abort"` with `chain_id`) is whole-run
control: it exits before parsing, needs no node or report, is idempotent, and terminal, missing or
out-of-scope runs receive a truthful non-applied result. The public `cancel` property is gone from
the union. -> `docs/reference/mcp-tools.md`

**This package is a binary distribution** -- an MCP server, the `cpm` CLI, and Python hooks. It
publishes no library API: `src/index.ts` exports only the server lifecycle (`startServer`,
`gracefulShutdown`, `getApplicationHealth`, `getDetailedDiagnostics`). Adding a library surface is a
deliberate act -- restore `types`, `exports["."].types`, `declaration: true` and `src` in `files`
together, which `validate:package-entries` enforces.

-> `CONTRIBUTING.md` §Breaking Changes for how to mark one.
## Key Constraints

- **MCP Contract Dev**: Verify upstream first (`rg "paramName" src/mcp/tools src/modules src/engine`). Contract, schema, generated metadata, router, manager/types, and service must agree.
- **The server executes shell commands, under operator-held controls.** `shell_verify` gate criteria and the inline `:: verify:"..."` operator run through `sh -c` (`shared/utils/process.ts`); script tools run an author-supplied file through a fixed interpreter. Ground-truth verification by exit code is the feature. What bounds it: `MCP_SHELL_VERIFY_ALLOWLIST` over WHICH command (unset refuses every shell verification with a message naming the variable; never a degrade-to-advisory), `MCP_SHELL_VERIFY_ALLOWED_DIRS` over WHERE (unset means the server's own directory), and an unconditional refusal of resource-supplied environment keys that decide what a command resolves to (`PATH`, `LD_*`, `NODE_OPTIONS`, `PYTHONPATH`, `BASH_ENV`, `IFS` and siblings). Both transports reach the same sink. Entry format, the `UNSAFE_ALLOW_ALL` sentinel and the refused-key list: `docs/guides/gates.md` §`shell_verify`.
- **Instruction surface (accepted, documented)**: a prompt's `systemMessage`, `userMessageTemplate`, `description` and argument descriptions ARE instruction to the client LLM. Two surfaces deliver that text before anyone invokes anything: `prompts/list` (fetched at connect) carries every description, and `resource_manager list detail:"full"` returns every `systemMessage`. Treat a prompt pack as a dependency, not a config file. The HTTP catalog route is credential-gated; the MCP surface is not, because the operator chose the client.
- **Guidance owner**: `PromptGuidanceService` remains the central framework-guidance service. Do not introduce a parallel coordinator/orchestrator with overlapping responsibility.
- **Framework validity**: Always `frameworkManager.getFramework(id)` -- never hardcode framework lists.
- **Consolidation over addition**: Enhance existing systems vs creating new ones.
- **Pipeline state**: Use `context.gates`, `context.frameworkAuthority`, `context.diagnostics` -- never mutate arrays directly.
- **Module organization**: import the defining module directly. Banned is the compat re-export shim -- a file whose whole body is `export ... from` AND which carries a back-compat marker, giving a symbol a second import path `rg` misses (ESLint `claude/no-compat-reexport-shim`). A markerless barrel is not banned (~60 exist) but prefer direct imports: `validate:arch` expresses layer and cycle boundaries as paths, and a barrel spanning layers launders the real edge. Dead barrels are found by `npx knip`, not `validate:arch`. Use `internal/` for a genuinely private region.
- **Concurrent sessions**: work in a linked worktree created with `npm run worktree:create -- <path> <branch> --from origin/main`, never a second session in this checkout and never Claude Code's `--worktree`/`EnterWorktree` (`CONTRIBUTING.md` §Working in a second worktree records why, including the shared `node_modules` symlinks). Set a distinct `PORT` if two trees run servers.
- **Commit convention**: Conventional Commits enforced. Scopes (`commitlint.config.mjs` is the enforced list; keep this and `CONTRIBUTING.md` in lockstep with it): `server`, `cli`, `runtime`, `pipeline`, `gates`, `frameworks`, `prompts`, `chains`, `styles`, `scripts`, `hooks`, `resources`, `mcp-tools`, `contracts`, `parsers`, `ci`, `deps`, `config`, `logging`, `metrics`, `docs`, `tests`, `semantic`, `execution`.
- **Environment (paths)**: `MCP_WORKSPACE` roots resources and state; `MCP_RUNTIME_ROOT`/`MCP_CONFIG_PATH` override theirs. One ordered list per type, earlier wins (`getResourceLocations`): project `.claude-prompts/` (STDIO), the workspace folder or `MCP_RESOURCES_PATH` in its place (the write root without a project folder), `paths.resources` entries with `"bundled"` where listed (no list: last; left out: no shipped content). Unusable paths refuse startup; the plugin sets no path env, Codex's `mcp.json` keeps `${PLUGIN_ROOT}`. -> `docs/reference/configuration.md` · `docs/guides/custom-resources.md`
- **Environment (secrets)**: `MCP_CATALOG_READ_TOKEN` gates executable prompt detail/history/compare; `MCP_CATALOG_WRITE_TOKEN` independently gates preview/apply/rollback and every legacy `/api/v1/tools/*` mutation. Either unset value refuses its surface (`503`), equal read/write values disable writes, and authentication runs before prompt lookup/body parsing. `MCP_HTTP_ALLOWED_ORIGINS` is a comma-separated allowlist for requests carrying `Origin`; absent `Origin` remains valid for server-side clients. HTTP transport only — STDIO reads none of these values.

-> `.claude/rules/mcp-contracts.md` for critical contract constraints (path-loaded)
-> `.claude/rules/sqlite-persistence.md` for critical persistence constraints (path-loaded)
-> `docs/guides/mcp-contract-maintenance.md` for the full contract procedure
-> `docs/architecture/sqlite-persistence.md` for the table map, scope split, and schema history
-> `docs/architecture/overview.md` for architecture, pipeline stages, subsystems
-> `docs/reference/mcp-tools.md` for MCP tool workflows, symbolic command language
-> `docs/guides/injection-control.md` for injection types, frequency, hierarchy
-> `docs/guides/gates.md` for gate/framework structure and hot-reload
-> `/testing` skill for test patterns and project-specific coverage
