# Claude Prompts MCP -- Operator Handbook

**Source of Truth**: `server/dist/**`. Confirm behavior there before describing or modifying functionality.

## Core Principles

1. **MCP Tooling Only** -- Prompts, templates, chains flow through MCP tools. Manual edits under `server/prompts/**` forbidden.
2. **Contracts as SSOT** -- Schemas generated from `tooling/contracts/*.json`. Run `npm run generate:contracts`, never edit `_generated/`.
3. **Transport Parity** -- Runtime changes must work in STDIO and SSE.
4. **Docs/Code Lockstep** -- Update relevant doc in `docs/` when behavior changes.
5. **Validation Discipline** -- `npm run typecheck && npm run lint:ratchet && npm run test:ci` minimum. Add `validate:arch` for module boundaries.

## Node.js Support Boundaries

| Surface | Supported Node.js | Enforcement |
|---------|-------------------|-------------|
| MCP server and desktop extension | >=22.13.0 | `server/package.json`, `manifest.json`, CI on 22.13.0 and 24 |
| Standalone CPM CLI | >=18.18.0 | `cli/package.json` and CLI runtime validation |
| Local development and publishing | 24 | `.node-version` and publish workflows |

The server floor is where `node:sqlite` is available without an experimental flag. The standalone CLI remains a separate, self-contained compatibility surface.

## Validation Gates (one contract, impact-aware subsets)

**CI is the contract; every other gate is a documented strict subset of it.**

The three gates once ran three different suites with no subset relation, so a green
`pre-push` did not predict CI and `validate:full` did not either -- that is how a pyrefly
failure reached `main` from a clean local push.

`scripts/classify-validation-scope.js` is the changed-path SSOT for local push and CI.
It recognizes two narrow safe scopes and sends every empty, mixed, executable,
configuration, dependency, deleted-unknown, or unrecognized change to `full`.

| Scope | Trigger | Pre-push | CI |
|------|---------|----------|----|
| `docs` | documented root handbooks, `docs/**/*.md`, `plans/**/*.md`, and server/CLI READMEs only | changed-line hygiene + Prettier on existing changed files | classifier hygiene; four protected jobs report intentional lightweight passes |
| `hooks` | only `hooks/**` plus optional docs | docs checks + `validate:python` | pinned Ruff/Pyrefly/Pytest/PyYAML; other protected jobs report intentional lightweight passes |
| `full` | everything else; empty/unknown input | typecheck · lint ratchet · format · conditional Python · unit tests · architecture · versions · build | typecheck · `validate:all` · CLI · build/smoke/schema · Node 22/24 unit/coverage/integration/E2E |

The CI workflow remains unconditional. Do not add workflow-level `paths` or
`paths-ignore`: a required workflow skipped before jobs exist leaves its context
pending. Routing happens inside the workflow while the literal `Lint & Validate`,
`CLI`, `Build`, and `Test Suite` job names remain stable.

`.husky/pre-commit` remains the fast contract-regeneration, staged-lint, conditional
Python, lint-ratchet, and typecheck gate. Every local route remains a subset of CI.

**Adding a step to a hook that CI does not run breaks the contract** -- add it to
`validate:all` first, which CI runs whole. Removing a step CI depends on breaks it too.
\* conditional on `hooks/` changes.

Formatting is covered by `validate:format` in the full route. `pre-push` checks existing
repo-level JSON/MD/YAML files in the push range. Anything a generator owns belongs in
`.prettierignore` with a reason -- otherwise the generator and Prettier disagree.

## Documentation Map

| Topic | Doc |
|-------|-----|
| Architecture & runtime | `docs/architecture/overview.md` |
| MCP tools & symbolic commands | `docs/reference/mcp-tools.md` |
| Prompt authoring | `docs/tutorials/build-first-prompt.md` |
| Chains lifecycle | `docs/concepts/chains-lifecycle.md` |
| Gates | `docs/guides/gates.md` |
| Injection control | `docs/guides/injection-control.md` |
| Identity & scope | `docs/guides/identity-scope.md` |
| Skills Sync | `docs/guides/skills-sync.md` |
| Telemetry & observability | `docs/guides/telemetry-observability.md` |
| Troubleshooting | `docs/guides/troubleshooting.md` |
| Contributing & PR process | `CONTRIBUTING.md` |
| README charter (root README authoring rules) | `docs/portfolio/readme-charter.md` |
| Release highlights | `CHANGELOG.md` |

Read the relevant doc before editing. Update docs when behavior changes.

## Command Reference (run inside `server/`)

| Command | Purpose |
|---------|---------|
| `npm run build` | esbuild bundle -> `dist/index.js` |
| `npm run verify:mcp` | Spawn a server from `dist/` and prove all 3 MCP tools answer — **use instead of restarting Claude Code to check a build**. Refuses to run against a stale `dist/` |
| `npm run typecheck` | Strict TS type validation — **`src/` only**, `tsconfig.json` excludes `tests/` |
| `npm test` | Full Jest suite |
| `npm run lint:ratchet` | Fail if ESLint violations increased |
| `npm run typecheck:tests:ratchet` | Fail if `tests/` type errors increased. Covers the call sites `typecheck` cannot see — a constructor change can otherwise land green against a test file that no longer compiles |
| `npm run generate:contracts` | Regenerate MCP schemas from contracts |
| `npm run validate:all` | Full validation suite |
| `npm run validate:arch` | Dependency Cruiser architecture rules |
| `npm run validate:contracts` | Verify generated artifacts in sync |
| `npm run test:integration` | FIRST for new features |
| `npm run test:coverage` | Baseline coverage (target: >80%) |
| `npm run skills:export` | Export skills from `skills-sync.yaml` |

## Domain Ownership Matrix (ENFORCED)

**Stages are thin orchestration. Domain logic lives in owner services.**

| If you need... | Owner Service | Stage May Only |
|----------------|---------------|----------------|
| Gate normalization | GateService (`gates/services/`) | Call `gateService.normalize()` |
| Gate enhancement | GateEnhancementService | Call `enhancementService.enhance*()` |
| Gate selection | GateManager (`gates/gate-manager.ts`) | Call `gateManager.selectGates()` |
| Gate enforcement | GateEnforcementAuthority (`execution/pipeline/decisions/gates/`) | Call `authority.resolveEnforcementMode()` |
| Gate verdict processing | GateVerdictProcessor (`gates/services/`) | Call `processor.handleGateAction()` |
| Inline gate parsing | InlineGateProcessor (`gates/services/`) | Call `processor.processInlineGates()` |
| Prompt resolution | PromptRegistry (`prompts/registry.ts`) | Call `registry.get()` |
| Command parsing | CommandParser (`execution/parsers/`) | Call `parser.parse()` |
| Step capture | StepCaptureService (`execution/capture/`) | Call `captureService.captureStep()` |
| Response assembly | ResponseAssembler (`execution/formatting/`) | Call `assembler.format*()` |
| Framework selection | FrameworkManager (`frameworks/`) | Call `frameworkManager.select()` |
| Framework validity | FrameworkManager | Call `frameworkManager.getFramework(id)` -- never hardcode |
| Injection decisions | InjectionDecisionService (`execution/pipeline/decisions/injection/`) | Call `service.decide()` |
| Style resolution | StyleManager (`styles/style-manager.ts`) | Call `styleManager.getStyle()` |

## MCP Tool Layer Structure

**Thin handlers route to domain processors. CRUD logic lives in processors, not handlers.**

```
prompt_engine  → PromptExecutor → PipelineBuilder → Pipeline (22 stages)
resource_manager → Router → Handler (≤125 lines) → Processors (lifecycle/discovery/versioning)
system_control → SystemControl Router → 10 action handlers
```

| Tool | Handler | Processors |
|------|---------|------------|
| `resource_manager` (prompt) | `PromptResourceHandler` | `PromptLifecycleProcessor`, `PromptDiscoveryProcessor`, `PromptVersioningProcessor` |
| `resource_manager` (gate) | `GateToolHandler` | `GateLifecycleProcessor`, `GateDiscoveryProcessor`, `GateVersioningProcessor` |
| `resource_manager` (methodology) | `FrameworkToolHandler` | `FrameworkLifecycleProcessor`, `FrameworkDiscoveryProcessor`, `FrameworkVersioningProcessor`, `MethodologyValidator` |
| `prompt_engine` | `PromptExecutor` | `PipelineBuilder` (factory), `ChainSessionRouter` |
| `system_control` | `ConsolidatedSystemControl` | 10 action handlers in `system-control/handlers/` |

## Runtime State (SQLite -- never commit `state.db`)

| Table | Purpose |
|-------|---------|
| `kv_state` | Consolidated key-value store (`key='framework'` active framework + switch history, `key='gates'` enable/disable, `key='arg_history'` argument tracking, `key='resource_hashes'` content hash cache) |
| `chain_run_registry` | Blob-encoded chain run state (primary SSOT for active runs; will be retired post-Tier-10 in favor of per-row tables) |
| `chain_sessions` | Derived read-projection of `chain_run_registry` for Python hook + cross-language consumers |
| `execution_records` | SEP-1686 append-only per-step execution log (ULID-sorted); source for `v_execution_status` view |
| `resource_index` | Resource discovery cache |

State stores using `kv_state` pass `tableName: 'kv_state'` + a discriminator `key` to `SqliteStateStoreConfig`. `SCHEMA_VERSION` bump triggers drop-and-recreate; no migration code since `state.db` is ephemeral.

**Rows are workspace-scoped, and `state.db` is shared across projects.** One file serves every project, so isolation comes from `workspace_id`, not from separate databases. A scope with no row falls back to `frameworks.defaultFramework`; the scope id itself is derived from `CLAUDE_PROJECT_DIR` → cwd (basename) unless `--workspace-id` is passed. Reading or writing `kv_state` without a scope resolves to the process default set at startup -- passing one explicitly is required only when serving several workspaces from one process (HTTP). -> `docs/guides/identity-scope.md`

## Public API Contract (what a major version protects)

**Declared surface over "anything that feels significant"; consumer-observable over internal.**

Semver is defined relative to a declared API. Without one, every incidental change reads as
breaking and major versions inflate until they carry no information.

| In the contract -- break it, bump major | Not in the contract -- change freely |
|------------------------------------------|----------------------------------------|
| MCP tool surface: `prompt_engine`, `resource_manager`, `system_control` names, parameters, and response shape | Internal TypeScript exports, including `src/index.ts` |
| CLI surface: `claude-prompts` and `cpm` commands and flags | `package.json` packaging fields (`types`, `exports`, `files`) |
| Resource formats: prompt/gate/methodology YAML schema, `config.json` | `src/` layer structure, module layout, import style |
| Python hook contract consumed by downstream plugins | Which files land in the published tarball |
| Symbolic command language (`>>`, `==>`) | Build tooling, validation scripts, CI |

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
- **Module organization**: import the defining module directly. **Banned is the compat re-export shim** -- a file whose whole body is `export ... from` AND which carries a back-compat marker, giving a symbol a second import path so `rg` for the canonical one misses consumers (`validate:no-crosslayer-reexport` enforces exactly this). A markerless barrel is NOT banned and `src/` has ~60 of them; prefer direct imports anyway, because `validate:arch` expresses layer + cycle boundaries as **paths**, and a barrel spanning layers launders the real edge. Intra-layer barrels launder nothing -- judge by whether consumers cross a layer. A file that re-exports *and* defines something is not a barrel (`infra/logging/index.ts`). Dead-barrel detection is `npx knip`; `validate:arch` cannot see it (`no-orphans` needs no incoming AND no outgoing edges, and a re-export always has outgoing). Use `internal/` for a genuinely private region.
- **Commit convention**: Conventional Commits enforced. Scopes: `server`, `runtime`, `pipeline`, `gates`, `frameworks`, `prompts`, `chains`, `styles`, `scripts`, `hooks`, `resources`, `mcp-tools`, `contracts`, `parsers`, `ci`, `deps`, `config`, `docs`, `tests`, `execution`.
- **Environment**: `MCP_WORKSPACE` (primary — SSOT for all paths), `MCP_RESOURCES_PATH` (resources base override), `MCP_CONFIG_PATH` (config file override). Workspace resources overlay bundled ones.

-> `.claude/rules/mcp-contracts.md` for full contract protocol (auto-loaded)
-> `docs/architecture/overview.md` for architecture, pipeline stages, subsystems
-> `docs/reference/mcp-tools.md` for MCP tool workflows, symbolic command language
-> `docs/guides/injection-control.md` for injection types, frequency, hierarchy
-> `docs/guides/gates.md` for gate/methodology structure and hot-reload
-> `/testing` skill for test patterns and project-specific coverage
