# Claude Prompts MCP -- Operator Handbook

**Source of Truth**: `server/dist/**`. Confirm behavior there before describing or modifying functionality.

## Core Principles

1. **MCP Tooling Only** -- Prompts, templates, chains flow through MCP tools. Manual edits under `server/prompts/**` forbidden.
2. **Contracts as SSOT** -- Schemas generated from `tooling/contracts/*.json`. Run `npm run generate:contracts`, never edit `_generated/`.
3. **Transport Parity** -- Runtime changes must work in STDIO and SSE.
4. **Docs/Code Lockstep** -- Update relevant doc in `docs/` when behavior changes.
5. **Validation Discipline** -- `npm run typecheck && npm run lint:ratchet && npm run test:ci` minimum. Add `validate:arch` for module boundaries.

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
| Release highlights | `CHANGELOG.md` |

Read the relevant doc before editing. Update docs when behavior changes.

## Command Reference (run inside `server/`)

| Command | Purpose |
|---------|---------|
| `npm run build` | esbuild bundle -> `dist/index.js` |
| `npm run typecheck` | Strict TS type validation |
| `npm test` | Full Jest suite |
| `npm run lint:ratchet` | Fail if ESLint violations increased |
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

## Key Constraints

- **MCP Contract Dev**: Verify upstream first (`grep -rn "paramName" src/mcp-tools/*/core/manager.ts`). Layer alignment: Contract -> Generated -> Types -> Router -> Manager -> Service must agree.
- **Framework validity**: Always `frameworkManager.getFramework(id)` -- never hardcode framework lists.
- **Consolidation over addition**: Enhance existing systems vs creating new ones.
- **Pipeline state**: Use `context.gates`, `context.frameworkAuthority`, `context.diagnostics` -- never mutate arrays directly.
- **Module organization**: <=7 files flat + barrel, >7 files use `internal/` subfolder.
- **Commit convention**: Conventional Commits enforced. Scopes: `server`, `runtime`, `pipeline`, `gates`, `frameworks`, `prompts`, `chains`, `styles`, `scripts`, `hooks`, `resources`, `mcp-tools`, `contracts`, `parsers`, `ci`, `deps`, `config`, `docs`, `tests`, `execution`.
- **Environment**: `MCP_WORKSPACE` (primary — SSOT for all paths), `MCP_RESOURCES_PATH` (resources base override), `MCP_CONFIG_PATH` (config file override). Workspace resources overlay bundled ones.

-> `.claude/rules/mcp-contracts.md` for full contract protocol (auto-loaded)
-> `docs/architecture/overview.md` for architecture, pipeline stages, subsystems
-> `docs/reference/mcp-tools.md` for MCP tool workflows, symbolic command language
-> `docs/guides/injection-control.md` for injection types, frequency, hierarchy
-> `docs/guides/gates.md` for gate/methodology structure and hot-reload
-> `/testing` skill for test patterns and project-specific coverage
