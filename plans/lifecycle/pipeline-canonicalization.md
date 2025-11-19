# Pipeline Canonicalization & Stage Migration Plan

## Objective

Make the execution pipeline (`server/src/execution/pipeline/**/*`) the single source of truth for prompt execution, retire the legacy `ConsolidatedPromptEngine` (replaced by the pipeline-backed `PromptExecutionService`), and ensure every MCP request flows through the staged architecture with reversible, testable steps.

## Principles

- **Pipeline First** – All execution logic (routing, planning, framework injection, gate handling, formatting) must live in discrete stages. `engine.ts` becomes a thin shim until it is deleted.
- **Small, Reversible Diffs** – Migrate responsibilities stage-by-stage; keep each PR scoped so reverts are trivial.
- **Parity Before Deletion** – Do not remove legacy code until the new stage covers the same behavior with tests/metrics proving equivalence.
- **Documentation & Plans** – Update this plan and related docs (`plans/lifecycle/*`, `plans/file-size-plan/*`) after each milestone so the migration state is obvious.

## Milestones & Tasks

### Stage 0 – Request & Lifecycle Bootstrap

Modern pipelines front-load the lifecycle work before parsing. We’ll mirror that with three sub-stages:

- **Stage 0.1: Request Normalization** – Wrap `McpToolRequestValidator`, CLI trimming, and tool-routing (`help`, `list`, `framework`) so every `ExecutionContext` starts normalized. Capture resume identifiers, gate overrides, and timeout/options. Add targeted tests in `tests/unit/execution/validation`.
- **Stage 0.2: Dependency Injection** – Provide a stage that wires analytics, gate systems, framework state, and parsing components and stashes them in context metadata. This replaces the constructor-time wiring in `core/engine.ts` and matches how modern codebases keep DI localized.
- **Stage 0.3: Execution Lifecycle** – Manage scoped setup/teardown (temporary gate scopes, logging start/end, cleanup hooks) per request. Move the cleanup responsibilities currently in `PromptExecutionService.cleanup()` here.

When these sub-stages land, the MCP tool simply instantiates the pipeline—no bespoke “engine” wrapper required.

> 2025-05-26: Stage 0.1 (`RequestNormalizationStage`), 0.2 (`DependencyInjectionStage`), and 0.3 (`ExecutionLifecycleStage`) now live under `server/src/execution/pipeline/stages/00-*`. The pipeline executes these canonical stages ahead of parsing, stores dependency snapshots/metadata, and registers cleanup handlers that `PromptExecutionPipeline` executes automatically. Integration logic (chain management routing, help/list forwarding, CLI validation) has been removed from `core/engine.ts`, so the engine now builds the pipeline and delegates directly.

> 2025-05-23: Stage 01 (CommandParsing), Planning, Session, Execution, and Formatting now own symbolic execution end-to-end; `ChainOperatorExecutor` renders every chain step and `ChainExecutor` has been removed. Remaining work is unit coverage.

> 2025-11-18: Retired the `tests/integration/symbolic-chain-integration.test.ts` and `framework-selector-integration.test.ts` suites now that SessionManagement, FrameworkResolution, and ResponseFormatting stages have focused unit coverage for chain lifecycles, inline gate verdicts, and framework overrides. Pipeline behavior is validated through `tests/unit/execution/pipeline/*`, keeping the staged architecture as the single execution surface.
> 2025-11-18 Update: Finished decommissioning the remaining integration/performance suites (`tests/integration/inline-gate-prompt.test.ts`, `mcp-tools.test.ts`, `server-startup.test.ts`, `unified-parsing-integration.test.ts`, plus `tests/performance/parsing-system-benchmark.test.ts` and `server-performance.test.ts`). Their useful assertions now live in `tests/unit/gates/guidance/gate-guidance-renderer.test.ts`, `tests/unit/mcp-tools/consolidated-tools.test.ts`, `tests/unit/execution/parsing-system.test.ts`, and `tests/unit/runtime/application-startup.test.ts` so `npx jest` no longer loads the legacy dist-based suites.

#### Stage 0 Guardrails

- [x] `scripts/validate-legacy-imports.js` (invoked via `npm run validate:all`) now fails CI if any source file references `ChainExecutor`, ensuring contributors cannot add new non-pipeline entry points.

### 2. Symbolic Execution Stage

- [x] Promote the legacy `executeSymbolicCommand` logic into the canonical pipeline stages (parsing → planning → session) and delete the unused helper in `prompt-engine/core/engine.ts`.
- [x] Add stage-specific unit tests (e.g., `tests/unit/execution/pipeline/symbolic-stage.test.ts`).
  - _2025-05-23 Update:_ Added coverage in `tests/unit/chain-session/chain-session-manager.test.ts` and `tests/unit/execution/operators/chain-operator-executor.test.ts` to guarantee the pipeline’s chain metadata + instruction banners remain the source of truth after the executor deletion. `ChainOperatorExecutor` now relies exclusively on pipeline-supplied metadata/framework context (no legacy `enhancePromptContent`), so GateEnhancement + Framework stages stay the only place that mutate instructions. We still need a dedicated `symbolic-stage` suite and per-stage golden tests to ensure inline gates/framework overrides never regress.
  - _2025-05-27 Update:_ Created `tests/unit/execution/pipeline/symbolic-stage.test.ts` to exercise Stage 2 responsibilities directly (inline gate extraction + operator validation + session blueprint cloning). The suite proves that symbolic chains seed inline gates, normalize framework overrides, and persist gate metadata solely through pipeline stages.
  - _2025-05-31 Update:_ `GateGuidanceRenderer` now reuses the pipeline’s `GateLoader` plus a framework identifier provider, so Stage 5 guidance injection no longer ships its own file-watching/cache logic.

### 3. Temporary Gate Lifecycle

- [x] Add a post-formatting stage that calls `TemporaryGateRegistry.cleanupScope(...)`, ensuring inline/temporary gates do not leak between executions.
      _2025-05-26:_ Added `PostFormattingCleanupStage` (Stage 12) to persist gate instructions back into the session blueprint, store inline gate IDs, and clean all recorded temporary gate scopes. Inline gate extraction + GateEnhancement stages now track every scope, so cleanup runs immediately after formatting rather than relying solely on Stage 0.3 hooks.
- [x] Persist inline/temporary gates in session blueprints so resumes rebuild them before gate enhancement runs.
      _2025-05-26:_ `PostFormattingCleanupStage` now clones the latest `ParsedCommand` + `ExecutionPlan` (including inline gate metadata) back into each session blueprint and updates `inlineGateIds` so `ChainSessionManager.getChainContext` surfaces the same data on resume.
- [x] Extend `ChainSessionManager` tests to assert gates are recreated/cleaned.
      _2025-05-27 Update:_ Removed the legacy `session.inlineGateIds` property, so inline criteria now live exclusively in the stored blueprint. Added unit coverage proving `ChainSessionManager.getChainContext` reads inline gates from the blueprint snapshot, and updated the post-formatting stage tests to assert blueprint persistence + cleanup flows.

### 4. Gate Review & CTA Stages

- [x] Extract gate-review rendering (currently in `ChainOperatorExecutor`) into a `GateReviewStage` that runs when `context.hasPendingReview()` is true.
      _2025-05-27:_ Added `GateReviewStage` + StepExecution guard so pending reviews skip normal rendering. The new stage uses `ChainOperatorExecutor.renderStep(... executionType: 'gate_review')` and writes the result into `context.executionResults`, isolating review logic from normal steps.
- [x] Create a `CallToActionStage` that appends standardized CTA/retry footers, keeping the execution stage focused on rendering content only.
      _Notes:_ `CallToActionStage` normalizes CTA footers for both normal steps and gate reviews using the metadata produced by Stage 9/10. Execution stage now just sets metadata, and CTA messaging is centralized.
- [x] Update chain step unit tests to assert stage outputs instead of executor internals.
      _Notes:_ Added `tests/unit/execution/pipeline/gate-review-stage.test.ts` and `tests/unit/execution/pipeline/call-to-action-stage.test.ts` to exercise the new stages directly, while `tests/unit/execution/operators/chain-operator-executor.test.ts` remains focused on template rendering.

### 5. Framework & Planning Enhancements

- [x] Ensure `ExecutionPlanningStage` always invokes `ExecutionPlanner` (even for chains) so framework overrides (symbolic `@SCAMPER`) and auto gates are respected.
- [x] Allow `FrameworkResolutionStage` to operate on chain contexts (per-step injection if framework gates are enabled).
- [x] Add integration tests that exercise multi-step symbolic commands with framework overrides.

> 2025-05-28 Update: `ExecutionPlanningStage` now plans every chain step and stores the per-step plans directly on `parsedCommand.steps`, enabling `GateEnhancementStage` to reuse the canonical auto-gate list. `FrameworkResolutionStage` consumes that metadata to generate per-step `frameworkContext` objects, which the chain executor injects when rendering each step. Added `symbolic-chain` integration coverage to confirm `@SCAMPER` overrides persist across multi-step chains, plus unit suites for planning, framework resolution, gate enhancement, and chain operator behavior.
>
> 2025-05-29 Update: Introduced a dedicated `PromptGuidanceStage` between framework resolution and gate enhancement so `PromptGuidanceService` (system prompt injection + template enhancement) runs as part of the pipeline instead of the legacy engine wiring. The stage mutates the parsed prompts/chain steps in-place, records guidance metadata for formatting, and reuses the framework contexts resolved earlier. Updated `ChainOperatorExecutor` to rely on those stored contexts and to skip emitting duplicate framework banners when the enhanced system message already contains methodology guidance. Added unit suites for `PromptGuidanceStage` and the executor’s guidance handling to lock in the new behavior.
> 2025-05-30 Update: `ExecutionPlanner` now exposes `createChainPlan`, so Stage 4 consumes planner-generated chain + per-step plans (auto gates + framework overrides) instead of aggregating manually. Stage 6 inspects step-level methodology gates/inline IDs to inject frameworks only where required, and new unit suites cover multi-step symbolic overrides plus gate-driven framework enforcement. `PromptExecutionService` replaced the legacy engine shim, and MCP tooling uses `createPromptExecutionService` to instantiate the pipeline directly.

### 6. Engine Retirement

- [x] Once stages cover all functionality:
  - Replace `createConsolidatedPromptEngine` (now `createPromptExecutionService`) inside `mcp-tools/index.ts` with a factory that wires `PromptExecutionPipeline` directly.
  - Remove unused helpers from `engine.ts` (routing, parsing, gate cleanup). ✅ Removed legacy parsing/chain execution helpers and the unused `ChainExecutor` shim so the engine is now a thin pipeline wrapper.
  - Delete `core/executor.ts` logic that has stage equivalents; shrink or remove `chainExecutor`. ✅ File removed; pipeline and `ChainOperatorExecutor` now serve as the only execution path.
- [x] Update docs (`docs/architecture.md`, `docs/mcp-tooling-guide.md`) to reflect the final pipeline topology.
- [x] Remove the legacy `engine.ts` shim entirely after confirming MCP tool registration, symbolic execution, and gate reviews run exclusively through stages (the pipeline is now surfaced via `prompt-execution-service.ts`).
  - ✅ `ChainManagementService` now intercepts `validate/list/gates chain` commands before the pipeline runs, ensuring a canonical management path that no longer references the deleted executor.
  - _2025-05-28 Update:_ Introduced `PromptExecutionService`, a thin wrapper that only builds the canonical pipeline and exposes the minimal MCP-facing APIs (setters + `executePromptCommand`). `engine.ts` was deleted, MCP wiring imports `createPromptExecutionService`, and all integration/unit helpers now reference the new service.
- [x] Retire the legacy symbolic operator executors (framework + inline gate variants) now that Stages 02 and 06 own those responsibilities. Tag `server/src/execution/operators/{framework,gate}-operator-executor.ts` as `legacy` and delete them (plus tests) once the pipeline exposes equivalent helpers so no contributor routes around the staged flow.
      _2025-05-31:_ Deleted `framework-operator-executor` and `gate-operator-executor` (and their unit suites + dist artifacts). `ChainOperatorExecutor` is now the only operator module exported, so contributors cannot bypass the staged pipeline for framework or gate handling.

## Validation Checklist (per Milestone)

- `npm run typecheck`
- `npm test` (or targeted stage/unit suites)
- `npm run validate:dependencies` (ensures canonical architecture)
- Update `plans/lifecycle/pipeline-canonicalization.md` with status notes
- Add/refresh documentation and changelog entries describing the migration stage

## Status Tracking

| Milestone                      | Owner | Status      | Notes                                                                                                                                                                                                     |
| ------------------------------ | ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request Normalization Stage    | Team  | Completed   | Stage 0.1/0.2/0.3 are active stages (request routing, dependency snapshot, lifecycle cleanup) with unit coverage in `tests/unit/execution/pipeline/*` and the engine now defers entirely to the pipeline. |
| Symbolic Execution Stage       | Team  | Completed   | Parser → planner → session own symbolic chains, and `tests/unit/execution/pipeline/symbolic-stage.test.ts` verifies inline gate + blueprint metadata stay confined to the canonical stages.               |
| Temporary Gate Lifecycle       | Team  | Completed   | Stage 11 persists blueprint snapshots, cleans recorded gate scopes, and the session manager now derives inline gate metadata directly from the blueprint with accompanying unit coverage.                 |
| Gate Review & CTA Stages       | Team  | Completed   | Added `GateReviewStage` + `CallToActionStage`, updated `StepExecutionStage` to skip when reviews are pending, and added stage-level unit tests so CTA/review duties live entirely in the pipeline.        |
| Planner/Framework Enhancements | Team  | Completed   | `ExecutionPlanningStage`, `FrameworkResolutionStage`, and `PromptGuidanceStage` now operate per-step with framework overrides + stored guidance metadata (`server/src/execution/pipeline/stages/04-06b`). |
| Engine Retirement              | Team  | Completed   | PromptExecutionService now builds the pipeline directly; legacy engine files were removed and MCP tooling imports the new factory so no wrapper code remains.                                          |

Keep this plan updated as each stage ships so the next contributor knows exactly what remains to fully canonize the pipeline.

### Stage 6b – API & Session Service Alignment

- [x] ApiManager prompt mutations now proxy through the canonical `prompt_manager` MCP tool so SSE clients cannot bypass the staged pipeline. Prompt reloads reuse the shared `prompt-refresh-service` helper, keeping HTTP data synchronized with pipeline context snapshots.
- [x] Added a shared prompt reload service that normalizes prompt file resolution for runtime watchers, API handlers, and MCP tooling. This removed duplicate path logic and ensures hot reload parity across transports.
- [x] Split `ChainSessionManager` into smaller persistence/service modules and add a typed interface so future session storage migrations remain reversible. _Note:_ Legacy gate/framework operator executors were removed on 2025-05-31, so this follow-up must proceed without those shims in place.

### Stage 6c – Runtime Bootstrap & Transport Alignment

- [x] Added `server/src/runtime/options.ts` to keep CLI flags (`--quiet`, `--verbose`, `--startup-test`) and test-environment detection in sync between the entrypoint and runtime orchestrator.
- [x] `Application`/`startApplication` now accept launch options so pipeline bootstrapping shares a single transport/verbosity source of truth; the CLI no longer re-parses the same flags inside `runtime/application.ts`.
- [x] Removed duplicate SIGINT/SIGTERM/exception handlers from `ServerManager`; global process lifecycle handling stays in `server/src/index.ts` while the manager logs system info once per start.
- [x] Centralized runtime-state persistence under `server/runtime-state` by passing the detected server root to `GateSystemManager` and deleting the orphaned repo-root directory so gate toggles share the same source of truth as sessions/framework state.
