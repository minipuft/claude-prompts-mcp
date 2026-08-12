# Claude Prompts MCP -- Operator Handbook

**Source of Truth**: `server/dist/**`. Confirm behavior there before describing or modifying functionality.

## Core Principles

1. **MCP Tooling Only** -- Prompts, templates, chains flow through MCP tools. Manual edits under `server/prompts/**` forbidden.
2. **Contracts as SSOT** -- Schemas generated from `tooling/contracts/*.json`. Run `npm run generate:contracts`, never edit `_generated/`.
3. **Transport Parity** -- Runtime changes must work in STDIO and Streamable HTTP. The two differ in instance lifetime, and that difference is load-bearing: STDIO pins one `McpServer` per connection, while HTTP builds a fresh one per request. A change that mutates a registered instance passes STDIO and silently no-ops over HTTP. HTTP+SSE was removed in the SDK v2 upgrade.
4. **Docs/Code Lockstep** -- Update relevant doc in `docs/` when behavior changes.
5. **Validation Discipline** -- `npm run typecheck && npm run lint:ratchet && npm run typecheck:tests:ratchet && npm run test:ci` minimum. Add `validate:arch` for module boundaries. **`typecheck:tests:ratchet` is not optional**: `tsconfig.json` excludes `tests/`, so `typecheck` is blind to every call site a signature change breaks, and `validate:all` -- which CI runs whole -- runs the ratchet second. Omitting it locally means CI fails on work that passed every gate you ran.

## Node.js Support Boundaries

| Surface                          | Supported Node.js | Enforcement                                                  |
| -------------------------------- | ----------------- | ------------------------------------------------------------ |
| MCP server and desktop extension | >=22.13.0         | `server/package.json`, `manifest.json`, CI on 22.13.0 and 24 |
| Standalone CPM CLI               | >=18.18.0         | `cli/package.json` and CLI runtime validation                |
| Local development and publishing | 24                | `.node-version` and publish workflows                        |

The server floor is where `node:sqlite` is available without an experimental flag. The standalone CLI remains a separate, self-contained compatibility surface.

## Validation Gates (one contract, impact-aware subsets)

**CI is the contract; every other gate is a documented strict subset of it.**

The three gates once ran three different suites with no subset relation, so a green
`pre-push` did not predict CI, and neither did the local full-validation wrapper that
existed at the time -- that is how a pyrefly failure reached `main` from a clean local
push. That wrapper was deleted once the subset relation made it redundant.

`scripts/classify-validation-scope.js` is the changed-path SSOT for local push and CI.
It recognizes two narrow safe scopes and sends every empty, mixed, executable,
configuration, dependency, deleted-unknown, or unrecognized change to `full`.

| Scope   | Trigger                                                                                 | Pre-push                                                                                              | CI                                                                                               |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `docs`  | documented root handbooks, `docs/**/*.md`, `plans/**/*.md`, and server/CLI READMEs only | changed-line hygiene + Prettier on existing changed files                                             | classifier hygiene; four protected jobs report intentional lightweight passes                    |
| `hooks` | only `hooks/**` plus optional docs                                                      | docs checks + `validate:python`                                                                       | pinned Ruff/Pyrefly/Pytest/PyYAML; other protected jobs report intentional lightweight passes    |
| `full`  | everything else; empty/unknown input                                                    | typecheck · lint ratchet · format · conditional Python · unit tests · architecture · versions · build | typecheck · `validate:all` · CLI · build/smoke/schema · Node 22/24 unit/coverage/integration/E2E |

The CI workflow remains unconditional. Do not add workflow-level `paths` or
`paths-ignore`: a required workflow skipped before jobs exist leaves its context
pending. Routing happens inside the workflow while the literal `Lint & Validate`,
`CLI`, `Build`, and `Test Suite` job names remain stable.

`.husky/pre-commit` remains the fast contract-regeneration, staged-lint, conditional
Python, and typecheck gate. Every local route remains a subset of CI.

**`lint:ratchet` does NOT run at pre-commit** (since `a5d8cb51`). It is a whole-project
DIRECTION measure, and direction is a push concern; per-commit conformance is `lint:staged`,
which lints exactly what is staged. Running it per-commit also meant an unrelated violation
anywhere in `src` blocked every commit -- in a shared worktree, blocking on work that is not
yours. Coverage is unchanged: `pre-push` runs it and CI runs it. Pre-commit floor measured
4.4s against the `ci-release.md` <10s budget.

**Adding a step to a hook that CI does not run breaks the contract** -- add it to
`validate:all` first, which CI runs whole. Removing a step CI depends on breaks it too.
\* conditional on `hooks/` changes.

Formatting is covered by `validate:format` in the full route. `pre-push` checks existing
repo-level JSON/MD/YAML files in the push range. Anything a generator owns belongs in
`.prettierignore` with a reason -- otherwise the generator and Prettier disagree.

## Documentation Map

| Topic                                        | Doc                                      |
| -------------------------------------------- | ---------------------------------------- |
| Architecture & runtime                       | `docs/architecture/overview.md`          |
| MCP tools & symbolic commands                | `docs/reference/mcp-tools.md`            |
| Prompt authoring                             | `docs/tutorials/build-first-prompt.md`   |
| Chains lifecycle                             | `docs/concepts/chains-lifecycle.md`      |
| Gates                                        | `docs/guides/gates.md`                   |
| Injection control                            | `docs/guides/injection-control.md`       |
| Identity & scope                             | `docs/guides/identity-scope.md`          |
| Skills Sync                                  | `docs/guides/skills-sync.md`             |
| Telemetry & observability                    | `docs/guides/telemetry-observability.md` |
| Troubleshooting                              | `docs/guides/troubleshooting.md`         |
| Contributing & PR process                    | `CONTRIBUTING.md`                        |
| README charter (root README authoring rules) | `docs/portfolio/readme-charter.md`       |
| Release highlights                           | `CHANGELOG.md`                           |

Read the relevant doc before editing. Update docs when behavior changes.

## Command Reference (run inside `server/`)

| Command                           | Purpose                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                   | esbuild bundle -> `dist/index.js`                                                                                                                                                |
| `npm run verify:mcp`              | Spawn a server from `dist/` and prove all 3 MCP tools answer — **use instead of restarting Claude Code to check a build**. Refuses to run against a stale `dist/`                |
| `npm run typecheck`               | Strict TS type validation — **`src/` only**, `tsconfig.json` excludes `tests/`                                                                                                   |
| `npm test`                        | Full Jest suite                                                                                                                                                                  |
| `npm run lint:ratchet`            | Fail if ESLint violations increased                                                                                                                                              |
| `npm run typecheck:tests:ratchet` | Fail if `tests/` type errors increased. Covers the call sites `typecheck` cannot see — a constructor change can otherwise land green against a test file that no longer compiles |
| `npm run generate:contracts`      | Regenerate MCP schemas from contracts                                                                                                                                            |
| `npm run validate:all`            | Full validation suite                                                                                                                                                            |
| `npm run validate:arch`           | Dependency Cruiser architecture rules                                                                                                                                            |
| `npm run validate:contracts`      | Verify generated artifacts in sync                                                                                                                                               |
| `npm run test:integration`        | FIRST for new features                                                                                                                                                           |
| `npm run test:coverage`           | Baseline coverage (target: >80%)                                                                                                                                                 |
| `npm run skills:export`           | Export skills from `skills-sync.yaml`                                                                                                                                            |

## Domain Ownership Matrix (ENFORCED)

**Stages are thin orchestration. Domain logic lives in owner services.**

| If you need...          | Owner Service                                                        | Stage May Only                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate normalization      | GateService (`gates/services/`)                                      | Call `gateService.normalize()`                                                                                                                |
| Gate enhancement        | GateEnhancementService                                               | Call `enhancementService.enhance*()`                                                                                                          |
| Gate selection          | GateManager (`gates/gate-manager.ts`)                                | Call `gateManager.selectGates()`                                                                                                              |
| Gate enforcement mode   | `resolveEnforcementMode` (`execution/pipeline/decisions/gates/`)     | Call `resolveEnforcementMode(mode)` -- a pure import, because `context.gateEnforcement` is optional and `?.` would silently relax enforcement |
| Gate verdict processing | GateVerdictProcessor (`gates/services/`)                             | Call `processor.handleGateAction()`                                                                                                           |
| Inline gate parsing     | InlineGateProcessor (`gates/services/`)                              | Call `processor.processInlineGates()`                                                                                                         |
| Prompt resolution       | PromptRegistry (`prompts/registry.ts`)                               | Call `registry.get()`                                                                                                                         |
| Command parsing         | CommandParser (`execution/parsers/`)                                 | Call `parser.parseCommand()`                                                                                                                  |
| Step capture            | StepCaptureService (`execution/capture/`)                            | Call `captureService.captureStep()`                                                                                                           |
| Response assembly       | ResponseAssembler (`execution/formatting/`)                          | Call `assembler.format*()`                                                                                                                    |
| Framework selection     | FrameworkManager (`frameworks/`)                                     | Call `frameworkManager.selectFramework()`                                                                                                     |
| Framework validity      | FrameworkManager                                                     | Call `frameworkManager.getFramework(id)` -- never hardcode                                                                                    |
| Injection decisions     | InjectionDecisionService (`execution/pipeline/decisions/injection/`) | Call `service.decide()`                                                                                                                       |
| Style resolution        | StyleManager (`styles/style-manager.ts`)                             | Call `styleManager.getStyle()`                                                                                                                |

## MCP Tool Layer Structure

**Thin handlers route to domain processors. CRUD logic lives in processors, not handlers.**

```
prompt_engine  → PromptExecutor → PipelineBuilder → Pipeline (22 stages)
resource_manager → Router → Handler (≤125 lines) → Processors (lifecycle/discovery/versioning)
system_control → SystemControl Router → 11 action handlers
```

| Tool                           | Handler                     | Processors                                                                                                                                                                               |
| ------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource_manager` (prompt)    | `PromptResourceHandler`     | `PromptLifecycleProcessor`, `PromptDiscoveryProcessor`, `PromptVersioningProcessor`                                                                                                      |
| `resource_manager` (gate)      | `GateToolHandler`           | `GateLifecycleProcessor`, `GateDiscoveryProcessor`, `GateVersioningProcessor`                                                                                                            |
| `resource_manager` (framework) | `FrameworkToolHandler`      | `FrameworkLifecycleProcessor`, `FrameworkDiscoveryProcessor`, `FrameworkVersioningProcessor`, `FrameworkValidator`                                                                       |
| `prompt_engine`                | `PromptExecutor`            | `PipelineBuilder` (factory), `ChainSessionRouter`                                                                                                                                        |
| `system_control`               | `ConsolidatedSystemControl` | 11 action handlers in `system-control/handlers/` (`analytics`, `changes`, `config`, `execution_history`, `framework`, `gates`, `guide`, `injection`, `maintenance`, `session`, `status`) |

## Runtime State (SQLite -- never commit `state.db`)

| Table               | Purpose                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv_state`          | Consolidated key-value store (`key='framework'` active framework + switch history, `key='gates'` enable/disable, `key='arg_history'` argument tracking, `key='resource_hashes'` content hash cache)     |
| `chain_runs`        | One row per live chain run (header facts: chain id, run owner, status, current node id, residual document). Primary SSOT for active runs -- replaces the retired `chain_run_registry` blob (schema v22) |
| `chain_run_nodes`   | One row per step of a run (position, prompt id, step lifecycle, `origin`/`origin_unknown_id` provenance for nodes the adaptive mutation policy inserted, schema v23). Sibling to `chain_runs`; together they are what `chain_run_registry` used to serialize into one JSON blob |
| `chain_sessions`    | Derived read-projection of `chain_runs` + `chain_run_nodes`, rebuilt in the same transaction, for Python hook + cross-language consumers                                                                |
| `execution_records` | SEP-1686 append-only per-step execution log (ULID-sorted); source for `v_execution_status` view                                                                                                         |
| `resource_index`    | Resource discovery cache                                                                                                                                                                                |

State stores using `kv_state` pass `tableName: 'kv_state'` + a discriminator `key` to `SqliteStateStoreConfig`. **`state.db` is mixed-posture, not ephemeral.** A `SCHEMA_VERSION` bump drops and recreates, but `version_history` and `skills_sync_manifests` are durable: `ensureSchema()` snapshots their rows, recreates, and restores by column intersection. Adding a `NOT NULL` column with no default to either makes the restore throw by design -- that change needs a real migration. Per-table owner, posture, scope, and retention are declared in `src/infra/database/table-contracts.ts`, which is the SSOT.

**`state.db` is shared across projects, but workspace isolation is delivered by `kv_state` alone.** One file serves every project, so isolation would have to come from `workspace_id` -- and `kv_state` is the only table that writes it. Four others declare **and index** scope columns no writer populates, so their rows are global; for `version_history` that means rollback history is shared across every project on the machine. Which four, and what closes each: `.claude/rules/sqlite-persistence.md`. For `kv_state`: a scope with no row falls back to `frameworks.defaultFramework`; the scope id derives from `CLAUDE_PROJECT_DIR` → cwd (basename) unless `--workspace-id` is passed. Reading or writing without a scope resolves to the process default set at startup -- passing one explicitly is required only when serving several workspaces from one process (HTTP). -> `docs/guides/identity-scope.md`

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
`chain_sessions` is `derived`; `chain_runs` and `chain_run_nodes` are `ephemeral`. All three's rows are
`DELETE`d per-PID at cleanup, cleared when the owning process exits, and dropped outright by any
`SCHEMA_VERSION` bump. Nothing a hook reads there survives a restart -- they are a live-process
projection, closer to a cache than to an interface. Listing them as major-version-protected was a
mis-classification: it priced a rename of a column nobody can hold a durable reference to at the
same rate as breaking `prompt_engine`.

What IS protected on the hook side: the **module API** of `hooks/lib/*` that plugins import
(`load_active_chain_state`, `load_prompts`, and their return shapes), the `hooks-state.db` schema,
and the JSON payload contract hooks exchange with Claude Code. Those persist across restarts and
have no other source.

Renaming `chain_sessions.tenant_id` -> `run_owner_pid` was therefore **in-contract** — done at
schema v20, both sides in one commit, no dual-write. It is kept here as the worked example, provided the
reader lands in the same PR (verified 2026-08-05: zero readers of these columns exist across
`minipuft-plugins`, `gemini-prompts`, and `opencode-prompts`). A change here still requires the
Python side to move with it -- the constraint is atomicity, not a version bump.

**The tool surface is a union, not a snapshot.** `prompt_engine` builds its `inputSchema` from
runtime state: the three gate parameters (`gates`, `gate_verdict`, `gate_action`) are advertised
only while the gate system is enabled. The contract is the **union of every reachable shape** --
`tooling/contracts/prompt-engine.json`. Narrowing within that union is not breaking; adding or
removing a union member is. The alternative reading (contract = shape at current state) makes
every state change a major bump, which drains the major version of meaning.

**`gate_verdict` accepts two shapes, and one of them is retiring.** The structured object
(`{overall, rationale, per_gate[]}`) is schema-validated and cannot be malformed; the legacy
`"GATE_REVIEW: PASS - reason"` string is read back by five regexes and can fail to parse. Both are
in the union, so accepting the object was not breaking. **Retirement**: the string branch and the
four non-primary patterns in `resources/gates/config/verdict-patterns.yaml` are deleted once no
client has submitted a string verdict for one release cycle -- measurable via the `source` field
already on `ParsedGateVerdict`. That deletion IS breaking and needs a major bump.

**This package is a binary distribution** -- an MCP server, the `cpm` CLI, and Python hooks.
It publishes no library API: `src/index.ts` exports only `startServer`, `gracefulShutdown`,
`getApplicationHealth`, `getDetailedDiagnostics` (server lifecycle). Consumers run it; they do not
import it. Adding a library surface is a deliberate act -- restore `types`, `exports["."].types`,
`declaration: true` and `src` in `files` together, which `validate:package-entries` enforces.

-> `CONTRIBUTING.md` §Breaking Changes for how to mark one.

## Key Constraints

- **MCP Contract Dev**: Verify upstream first (`grep -rn "paramName" src/mcp-tools/*/core/manager.ts`). Layer alignment: Contract -> Generated -> Types -> Router -> Manager -> Service must agree.
- **Framework validity**: Always `frameworkManager.getFramework(id)` -- never hardcode framework lists.
- **Consolidation over addition**: Enhance existing systems vs creating new ones.
- **Pipeline state**: Use `context.gates`, `context.frameworkAuthority`, `context.diagnostics` -- never mutate arrays directly.
- **Module organization**: import the defining module directly. **Banned is the compat re-export shim** -- a file whose whole body is `export ... from` AND which carries a back-compat marker, giving a symbol a second import path so `rg` for the canonical one misses consumers (`validate:no-crosslayer-reexport` enforces exactly this). A markerless barrel is NOT banned and `src/` has ~60 of them; prefer direct imports anyway, because `validate:arch` expresses layer + cycle boundaries as **paths**, and a barrel spanning layers launders the real edge. Intra-layer barrels launder nothing -- judge by whether consumers cross a layer. A file that re-exports _and_ defines something is not a barrel (`infra/logging/index.ts`). Dead-barrel detection is `npx knip`; `validate:arch` cannot see it (`no-orphans` needs no incoming AND no outgoing edges, and a re-export always has outgoing). Use `internal/` for a genuinely private region.
- **Commit convention**: Conventional Commits enforced. Scopes: `server`, `runtime`, `pipeline`, `gates`, `frameworks`, `prompts`, `chains`, `styles`, `scripts`, `hooks`, `resources`, `mcp-tools`, `contracts`, `parsers`, `ci`, `deps`, `config`, `docs`, `tests`, `execution`.
- **Environment**: `MCP_WORKSPACE` (primary — SSOT for all paths), `MCP_RESOURCES_PATH` (resources base override), `MCP_CONFIG_PATH` (config file override). Workspace resources overlay bundled ones.

-> `.claude/rules/mcp-contracts.md` for full contract protocol (auto-loaded)
-> `.claude/rules/sqlite-persistence.md` for the table map, `tenant_id`/`run_owner_pid` split, and durable-table rules (glob-loaded)
-> `docs/architecture/overview.md` for architecture, pipeline stages, subsystems
-> `docs/reference/mcp-tools.md` for MCP tool workflows, symbolic command language
-> `docs/guides/injection-control.md` for injection types, frequency, hierarchy
-> `docs/guides/gates.md` for gate/framework structure and hot-reload
-> `/testing` skill for test patterns and project-specific coverage
