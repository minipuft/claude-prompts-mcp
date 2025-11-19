# Baselining & Guardrails Record

**Created:** 2025-11-14  
**Owner:** Runtime integrity & guardrails working group  
**Status:** Active - used to keep validation commands and component lifecycle tags canonical.

## Validation Baseline (Canonical Commands)

These commands remain the required guardrail suite for MCP server changes. Re-run them whenever touching execution, gates, or tooling layers and capture deltas here.

| Command | Purpose | Last Run |
| --- | --- | --- |
| `npm run validate:dependencies` | Confirms we only ship the consolidated runtime + MCP architecture described in `scripts/validate-dependencies.js` (execution/analysis/runtime/tooling overlap detection plus canonical component presence). | PASS (2025-11-14) - all consolidation checks reported single canonical systems and full architecture coverage. |
| `npm run validate:circular` | Uses `madge` to detect circular imports under `src/`, preventing regressions that break hot-reload and pipeline determinism. | PASS (2025-11-14) - 140 files scanned, zero circular dependencies. |
| `npm run validate:filesize` | Enforces 500-line module boundary standard per REFACTORING.md. Warns on new violations (files over 500 lines without `@lifecycle canonical` annotation or grandfathered exemption). | PASS (2025-11-15) - 32 grandfathered files tracked in `/plans/file-size-baseline.md`, zero new violations. Warning-level enforcement (does not block CI). |
| `npm run typecheck` | Runs `tsc --noEmit` so the published package and runtime build remain type-safe under Node 16/18/20. | FAIL (2025-11-14) - `src/frameworks/methodology/framework-registry.ts` imports `./types/methodology-registry-types.js`, which no longer exists, and the fallback casting omits required `executionGuidelines` fields. Need to restore the missing type module or inline the definitions before typecheck can pass. |
| `npm test` | Canonical Jest suite that protects gate services, planners, MCP tools, and runtime wiring. | PASS (2025-11-15) - Request validation, execution context, planner, gate-enhancement, and symbol parsing suites all green after aligning with the SessionManagementStage + semantic planner updates. Keep re-running on behavioral changes so regressions stay visible. |

### Open Validation Follow-Ups
- Rebuild the `framework-registry` type module (or inline the schema) so `npm run typecheck` can resolve `FrameworkDefinition` correctly.

## Component Lifecycle Snapshot (Logging / Analysis / Gates)

Every component listed below is currently referenced by the running server. Use these lifecycle tags before adding dependencies so we do not accidentally wire new work into legacy modules.

### Logging Components
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| `EnhancedLogger` | `server/src/logging/index.ts` (`createLogger`) | **Canonical** | Primary transport-aware logger that backs runtime, MCP tools, and gate services; supports configurable log levels and CI-safe behavior. |
| `createSimpleLogger` utilities | `server/src/logging/index.ts` | **Canonical** | Minimal console logger used during bootstrap/worker contexts when the enhanced logger is unavailable; honors `--verbose/--quiet` flags. |
| `setupConsoleRedirection` / `setupProcessEventHandlers` | `server/src/logging/index.ts` | **Canonical** | Required to keep STDIO transport clean and to persist crash telemetry. No alternative logging shims remain. |

### Analysis Components
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| `ContentAnalyzer` (Configurable Semantic Analyzer) | `server/src/semantic/configurable-semantic-analyzer.ts` | **Canonical** | The only sanctioned analyzer - consolidates structural + semantic modes, cache, and LLM integration toggles. The legacy `analysis/semantic-analyzer.ts` path no longer exists. |
| `PromptAnalyzer` | `server/src/mcp-tools/prompt-manager/analysis/prompt-analyzer.ts` | **Canonical** | Wraps `ContentAnalyzer` for prompt inventory intelligence; handles fallback messaging when LLMs are disabled. |
| `ComparisonEngine` | `server/src/mcp-tools/prompt-manager/analysis/comparison-engine.ts` | **Canonical** | Tracks before/after analysis changes for prompt reviews; only depends on logger. |
| `GateAnalyzer` | `server/src/mcp-tools/prompt-manager/analysis/gate-analyzer.ts` | **Canonical** | Delegates to `ExecutionPlanner` so guardrail heuristics match runtime behavior; no legacy gate recommenders remain. |

### Gate Components
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| `LightweightGateSystem` + core loaders/validators | `server/src/gates/core/*.ts` | **Canonical** | Active gate runtime (loader, validator, temporary registry) used by execution pipeline and MCP tooling. |
| `GateSystemManager` | `server/src/gates/gate-state-manager.ts` | **Canonical** | Persists enable/disable state + health metrics under `runtime-state`; required for runtime toggles. |
| `TemporaryGateRegistry` | `server/src/gates/core/temporary-gate-registry.ts` | **Canonical** | Single source for inline/temporary gates. Delete inline gate helpers elsewhere instead of re-adding new registries. |
| `GateInstructionInjector` & guidance renderers | `server/src/frameworks/prompt-guidance/gate-instruction-injector.ts`, `server/src/gates/guidance/*` | **Canonical** | Sole pathway for injecting gate instructions into prompts/chains. |
| `CompositionalGateService` | `server/src/gates/services/compositional-gate-service.ts` | **Canonical** | Actively used to render gate instructions (no validation baked in). |
| `SemanticGateService` | `server/src/gates/services/semantic-gate-service.ts` | **Migrating** | Shares compositional injection but semantic validation is unimplemented until external LLM integration ships. Keep dependencies behind the existing feature flag. |
| `GateServiceFactory` + `GatePerformanceAnalyzer` | `server/src/gates/services/gate-service-factory.ts`, `server/src/gates/intelligence/GatePerformanceAnalyzer.ts` | **Canonical** | Factory selects compositional vs semantic services; analyzer feeds telemetry to `system-control`. |

### Framework Components
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| `FrameworkManager` | `server/src/frameworks/framework-manager.ts` | **Canonical** | Source of truth for methodology selection + execution contexts; all MCP tooling/runtimes must integrate here instead of bespoke switches. |
| `FrameworkStateManager` | `server/src/frameworks/framework-state-manager.ts` | **Canonical** | Handles persisted framework state, cooldowns, and telemetry; only entrypoint for framework toggling logic. |
| `FrameworkValidator` | `server/src/frameworks/framework-validator.ts` | **Canonical** | Validates framework identifiers and ensures registry-aligned selections before execution. |
| Methodology registry + guides | `server/src/frameworks/methodology/**/*.ts` | **Canonical** | Registry + CAGEERF/ReACT/5W1H/SCAMPER guides provide canonical methodology data; remove older scattered guide definitions. |
| Prompt guidance services | `server/src/frameworks/prompt-guidance/**/*.ts` | **Canonical** | Unified prompt guidance service + injector templates; required for system prompt/gate instruction alignment. |
| Framework type exports | `server/src/frameworks/types/**/*.ts` | **Canonical** | Consolidated type contracts for frameworks/methodology/prompt guidance—depend on these instead of duplicating interfaces elsewhere. |
| Framework-semantic integration layer | `server/src/frameworks/integration/**/*.ts` | **Migrating** | Still stabilizing semantic-driven switching; keep dependencies behind existing feature flag until semantic telemetry + regression suite lands. Guard: promote to canonical once semantic analyzer parity and performance budgets are validated. |

### Execution Pipeline & Context
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| Execution pipeline stages | `server/src/execution/pipeline/**/*.ts` | **Canonical** | All stages (normalization → CTA) are the single supported execution path; annotate future stages immediately and avoid side channels. |
| PromptExecutionPipeline | `server/src/execution/pipeline/prompt-execution-pipeline.ts` | **Canonical** | Coordinates ordered stages and lifecycle handlers; any new orchestration must extend this pipeline instead of bypassing it. |
| Execution planner & parsers | `server/src/execution/parsers/**/*.ts`, `server/src/execution/planning/**/*.ts` | **Canonical** | Unified command parser + planner provide the only sanctioned operator translation; retire legacy parser shims instead of reintroducing them. |
| Execution context utilities | `server/src/execution/context/**/*.ts`, `server/src/execution/types.ts` | **Canonical** | Context resolver + shared types define the DI surface for stages and operators. |

### Runtime, Transports, Logging, API
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| Runtime application/startup/options | `server/src/runtime/**/*.ts` | **Canonical** | Startup pipeline + CLI option parser remain the authoritative bootstrap path; document any new flags here. |
| Transport + server entrypoints | `server/src/server/**/*.ts`, `server/src/api/index.ts` | **Canonical** | Transport adapters and HTTP server wiring are canonical; add new transports via the existing registry instead of ad-hoc listeners. |
| Logging system | `server/src/logging/index.ts` | **Canonical** | Enhanced logger + bootstrap fallbacks are the only approved logging path; no alternate console shims allowed. |

### Chain Session Lifecycle
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| Chain session manager/store/types | `server/src/chain-session/**/*.ts` | **Canonical** | Session manager + store form the canonical persistence path; continue annotating changes so lifecycle promotions remain auditable. |

### Prompt Infrastructure
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| Prompt loader/converter stack | `server/src/prompts/loader.ts`, `server/src/prompts/converter.ts`, `server/src/prompts/types.ts` | **Canonical** | Single path for reading markdown prompts, converting them to structured data, and exposing domain types; replace ad-hoc loaders with these modules. |
| Prompt registry + refresh service | `server/src/prompts/registry.ts`, `server/src/prompts/prompt-refresh-service.ts` | **Canonical** | Handles MCP prompt registration and reload orchestration; all hot-reload + MCP-manager flows must call through here. |
| File observer + hot reload manager | `server/src/prompts/file-observer.ts`, `server/src/prompts/hot-reload-manager.ts` | **Canonical** | Watches prompt/config directories and triggers reload workflows; no alternate filesystem watchers permitted. |
| Prompt filesystem utilities | `server/src/prompts/promptUtils.ts`, `server/src/prompts/prompt-writer.ts`, `server/src/prompts/category-maintenance.ts` | **Canonical** | Shared helpers for safe prompt IO and category maintenance; prevents drift in category metadata. |

### Configuration & Shared Utilities
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| Config manager | `server/src/config/index.ts` | **Canonical** | Responsible for loading, validating, and hot-watching `config.json`; inject this instead of reading JSON manually. |
| Utility exports | `server/src/utils/**/*.ts` | **Canonical** | Error handling, chain utilities, JSON escaping, and resource tracking live here; maintainers must extend these modules instead of creating duplicated helpers. |

### Shared Type Registry
| Component | Path | Lifecycle | Notes |
| --- | --- | --- | --- |
| Type index + execution types | `server/src/types.ts`, `server/src/types/**/*.ts` | **Canonical** | Central source of truth for config, prompt, and execution type definitions; downstream modules must import from this hub to keep schemas aligned. |

### Lifecycle Watchlist
- **Legacy components:** None remain under `src/logging`, `src/semantic`, or `src/gates`. Any discovery of `legacy` or `deprecated` namespaces should be removed immediately.
- **Migrating components:** `SemanticGateService` and the Framework-semantic integration layer remain gated until their semantic validation/telemetry deliverables land; annotate any new code that depends on them and keep usage behind the documented feature flags.
- **Canonical dependencies:** New code must wire into the modules listed above; using ad-hoc loggers/analyzers/gate registries is a review failure per AGENTS.md.
