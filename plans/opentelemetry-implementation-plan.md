# OpenTelemetry Telemetry & Logging Upgrade — Implementation Plan

**Status**: Ready for Implementation (baseline verified clean 2026-03-15)
**Created**: 2026-02-15
**Last Updated**: 2026-03-15
**Methodology**: `prompt_engine >>implementation_plan`
**Readiness Review**: Passed with 5 conditions — all incorporated below

---

## Phase 1.0: Scope Alignment

**Work Type**: feature + refactor (observability foundation)
**Confidence**: medium-high (baseline verified, gaps quantified)
**Scope**: `engine/execution`, `infra/observability`, runtime wiring, config/schema, docs, tests
**Risk Level**: medium-high (cross-cutting runtime behavior)

### Problem Statement

Current observability is primarily in-memory metrics (`MetricsCollector`) plus logs/notifications. We need production-grade tracing + policy-governed telemetry that preserves existing pipeline/stage semantics and transport behavior.

### Desired State

- OpenTelemetry traces for full `prompt_engine` lifecycle with stage-preserving spans.
- Business-context events for gate/shell/chain lifecycle without raw prompt/response payload leakage.
- Existing analytics resources (`resource://metrics/pipeline`) remain compatible during rollout.
- Sampling + attribute policies are explicit, test-covered, and operationally documented.
- Hook system actively wired to pipeline (currently defined but unused).

### Acceptance Criteria

1. Root + stage spans emitted for all executed pipeline stages (including early exits and errors).
2. Gate + shell verification lifecycle is visible as trace events with stable, non-sensitive attributes.
3. No high-cardinality IDs in metric labels; rich identifiers remain trace-only.
4. No raw command text, raw user response, or rendered prompt/model output in default telemetry attributes/events.
5. Runtime works across `stdio`, `sse`, and `streamable-http` modes.
6. Pipeline hook emissions (`emitBeforeStage`/`emitAfterStage`/`emitStageError`) are called for every stage execution.

---

## Phase 2.0: Existing Systems Audit

| System                        | File(s)                                                                                                                                                                              | Current Capability                                                                                                                                                                   | Gap for OTel                                                                                                                                                                                        | Reuse Decision                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pipeline orchestrator         | `server/src/engine/execution/pipeline/prompt-execution-pipeline.ts` (471 lines)                                                                                                      | Stage order, timing/memory metrics via `metricsProvider` supplier, command metrics, early exit handling                                                                              | No spans/trace context; **no hook emissions** despite hooks being injected                                                                                                                          | Extend in place (canonical stage boundaries)                                                    |
| Pipeline dependency injection | `server/src/engine/execution/pipeline/stages/00-dependency-injection-stage.ts` (~80 lines)                                                                                           | Injects metrics/hooks/notifications into context metadata                                                                                                                            | No telemetry runtime handle                                                                                                                                                                         | Extend in place                                                                                 |
| Stage 00 substages            | `00-request-normalization-stage.ts`, `00-execution-lifecycle-stage.ts`, `00-identity-resolution-stage.ts`                                                                            | Request normalization, lifecycle init, identity resolution                                                                                                                           | Included in span model automatically (pipeline loop covers all stages)                                                                                                                              | No changes needed                                                                               |
| Execution context + state     | `server/src/engine/execution/context/execution-context.ts`, `server/src/engine/execution/context/internal-state.ts`                                                                  | Rich request/session/gate/runtime state                                                                                                                                              | No typed telemetry bridge surface                                                                                                                                                                   | Reuse with minimal typed additions                                                              |
| Gate verdict lifecycle        | `server/src/engine/gates/services/gate-verdict-processor.ts`                                                                                                                         | Emits gate hook + notification events (`passed/failed/retryExhausted/responseBlocked`)                                                                                               | Not connected to trace events                                                                                                                                                                       | Reuse as canonical gate-event source                                                            |
| Shell verification lifecycle  | `server/src/engine/execution/pipeline/stages/08b-shell-verification-stage.ts`                                                                                                        | attempt/fail/pass/escalation flow                                                                                                                                                    | No trace events                                                                                                                                                                                     | Extend stage minimally                                                                          |
| Hook event surface            | `server/src/infra/hooks/hook-registry.ts` (448 lines)                                                                                                                                | 10 hook event types defined (3 pipeline, 4 gate, 3 chain), async emission, EventEmitter                                                                                              | **CRITICAL: Zero hook calls in production code** — `emitBeforeStage`/`emitAfterStage`/`emitStageError` never called; `registerPipelineHooks`/`registerGateHooks`/`registerChainHooks` never invoked | Reuse + **wire pipeline calls first** (Phase 1.3b) + add telemetry hook adapter                 |
| Notification surface          | `server/src/infra/observability/notifications/mcp-notification-emitter.ts`                                                                                                           | MCP client notifications for gate/framework/chain                                                                                                                                    | Not correlated with traces                                                                                                                                                                          | Keep as client-facing path; don't replace                                                       |
| Metrics collector             | `server/src/infra/observability/metrics/analytics-service.ts` (714 lines)                                                                                                            | In-memory analytics + summaries + stage/command history                                                                                                                              | Not OTel metrics/export                                                                                                                                                                             | Keep as compatibility layer; bridge selectively                                                 |
| Metrics wiring path           | `module-initializer.ts` → `McpToolsManager` → `PromptExecutor.analyticsService` → `PipelineBuilder.deps.getAnalyticsService` → `Pipeline.metricsProvider`                            | **Functional**: lazy supplier passes `InMemoryMetricsCollector` to pipeline; pipeline calls `recordPipelineStageMetric()` per stage + `recordCommandExecutionMetric()` at completion | Wiring exists but metric data stays in-memory; no OTel export                                                                                                                                       | Reuse supplier pattern for telemetry recorder injection                                         |
| Performance monitor           | `server/src/infra/observability/performance/monitor.ts` (469 lines)                                                                                                                  | `startMonitoring()`/`stopMonitoring()`/`collectMetrics()` defined                                                                                                                    | **Dead code**: never instantiated, never called anywhere in codebase                                                                                                                                | **Exclude** from OTel plan; mark for separate dead-code cleanup                                 |
| Observability resources       | `server/src/modules/resources/handlers/observability-resources.ts`                                                                                                                   | `resource://session/*`, `resource://metrics/pipeline`, logs resources                                                                                                                | No telemetry runtime health/config view                                                                                                                                                             | Extend minimally                                                                                |
| Runtime bootstrap             | `server/src/runtime/application.ts` (1303 lines), `server/src/runtime/module-initializer.ts` (249 lines)                                                                             | Composes HookRegistry, notification emitter, metrics collector, tools; 19 lifecycle methods                                                                                          | **application.ts is 1303 lines** (Critical severity per size advisory); no telemetry startup/shutdown lifecycle                                                                                     | Extend with dedicated `telemetry-lifecycle.ts` extraction; application.ts gets thin wiring only |
| Config/schema                 | `server/src/shared/types/core-config.ts` (547 lines), `server/config.schema.json` (464 lines), `server/src/cli-shared/config-input-validator.ts`, `server/src/infra/config/index.ts` | Resource observability toggles (`observability.enabled/sessions/metrics`); no telemetry/tracing config                                                                               | No dedicated telemetry/tracing config section                                                                                                                                                       | Extend with separate `telemetry` config surface                                                 |
| Tooling/contracts             | `server/tooling/contracts/*.json`                                                                                                                                                    | SSOT for tool params/descriptions                                                                                                                                                    | Plan must avoid ad-hoc runtime params                                                                                                                                                               | No contract changes required for initial telemetry rollout                                      |

### Audit Findings — Readiness Review (2026-03-15)

**Baseline health verified clean**:

- `npm run typecheck` — PASS
- `npm run lint:ratchet` — PASS (3632 errors, 1511 warnings, stable)
- `npm run test:ci` — PASS (128 suites, 1413 tests)

**Critical findings from readiness review**:

| #   | Finding                                                                    | Impact                                                                                                                                    | Resolution                                                                         |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Hook system defined but **never called** by pipeline                       | Phase 1.4 assumed hooks work as fan-out — they don't today                                                                                | Added Phase 1.3b: wire pipeline hook emissions before OTel consumers               |
| 2   | MetricsCollector IS wired to pipeline (via `getAnalyticsService` supplier) | Previous assumption of isolation was wrong — wiring path exists through `PromptExecutor` → `PipelineBuilder` → `Pipeline.metricsProvider` | Update audit; reuse supplier pattern for telemetry                                 |
| 3   | `docs/architecture/overview.md` does not exist                             | Plan marked "Extend" but file is missing                                                                                                  | Changed to "New" in Phase 1.6                                                      |
| 4   | `application.ts` is 1303 lines (Critical severity)                         | Adding telemetry to oversized file risks compounding debt                                                                                 | Plan's extraction approach confirmed sound; `telemetry-lifecycle.ts` absorbs logic |
| 5   | `PerformanceMonitor` (469 lines) is dead code                              | Never instantiated or called anywhere                                                                                                     | Excluded from OTel plan; flagged for separate cleanup                              |
| 6   | Stage 00 is 4 substages (A-D) not 1 file                                   | All 4 get spans automatically via pipeline loop                                                                                           | No plan change needed; updated stage inventory                                     |
| 7   | 23 stage files total (not 22)                                              | Accurate span count matters for testing                                                                                                   | Updated telemetry semantics contract                                               |

### Stage Inventory (23 files, all receive spans)

```
00-A  request-normalization-stage       00-B  dependency-injection-stage
00-C  execution-lifecycle-stage         00-D  identity-resolution-stage
01    parsing-stage                     02    inline-gate-stage
03    operator-validation-stage         04    planning-stage
04b   script-execution-stage (opt)      04c   script-auto-execute-stage (opt)
05    gate-enhancement-stage            06    framework-stage
06a   judge-selection-stage             06b   prompt-guidance-stage
07    session-stage                     07b   injection-control-stage
08    response-capture-stage            08b   shell-verification-stage (opt)
09    execution-stage                   09b   phase-guard-verification-stage (opt)
10-A  formatting-stage                  10-B  gate-review-stage
12    post-formatting-cleanup-stage
```

---

## Phase 3.0: Reuse-First Design

### Compound Diagnosis

**Weakest point**: The plan assumed hook infrastructure was functional; the readiness review proved hooks are defined but completely unwired. A stage-by-stage direct OTel implementation without first wiring hooks would bypass the existing event surface and create a parallel instrumentation path.

**Diagnosis**: implement a **three-step approach**:

1. **Wire existing hooks** to pipeline (Phase 1.3b) — activate the dormant infrastructure.
2. **Build telemetry runtime + policy layer** on top of working hooks (Phase 1.2 → 1.3).
3. **Register telemetry consumers** that listen to hook events for span/event emission (Phase 1.4).

This ensures the hook system is the single event fan-out point, not a dead abstraction.

### Design Principles

- Stage-preserving spans; do not collapse into opaque "phase" spans.
- Trace richness + metric cardinality discipline.
- Typed policy layer for attribute allowlist/redaction.
- Extraction-first for oversized entrypoints; keep `application.ts` wiring-thin.
- No dual long-lived observability stacks: compatibility bridge is temporary and scoped.
- **Hook-first**: Wire existing hooks before adding telemetry consumers — no parallel event paths.
- **Supplier pattern reuse**: Thread telemetry via the same lazy-supplier injection that metrics already uses.

---

## Phase 4.0: Implementation Plan

### Phase Legend

- **1.0** Baseline preflight (DONE ✅)
- **1.1** Config + dependency baseline
- **1.2** Telemetry runtime + policy layer
- **1.3** Runtime wiring + lifecycle
- **1.3b** Pipeline hook wiring (NEW — prerequisite for OTel consumers)
- **1.4** Pipeline + event instrumentation (OTel consumers)
- **1.5** Test coverage + rollout checks
- **1.6** Resource visibility + docs

### 1.0 Baseline Preflight — COMPLETE ✅

Verified 2026-03-15 from `server/`:

- `npm run typecheck` — PASS
- `npm run lint:ratchet` — PASS (3632/1511 stable)
- `npm run test:ci` — PASS (128 suites, 1413 tests)

No regressions. Telemetry diffs will be attributable.

### 1.1 Config + Dependency Baseline

| File                                              | Change Type | Est. Lines | Phase | Depends On       | Justification                                                                                                                                                                                      |
| ------------------------------------------------- | ----------- | ---------- | ----- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/package.json`                             | Extend      | +20        | 1.1   | —                | Add `@opentelemetry/sdk-node`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/api` |
| `server/src/shared/types/core-config.ts`          | Extend      | +45        | 1.1   | —                | Add dedicated `telemetry` config section (separate from `resources.observability`): `{ enabled, mode, exporterEndpoint, samplingRate, attributePolicy }`                                           |
| `server/config.schema.json`                       | Extend      | +90        | 1.1   | —                | Schema validation for telemetry mode/exporter/sampling/attribute policy                                                                                                                            |
| `server/src/cli-shared/config-input-validator.ts` | Extend      | +55        | 1.1   | 1.1 config types | CLI set/get validation for telemetry keys                                                                                                                                                          |
| `server/src/infra/config/index.ts`                | Extend      | +70        | 1.1   | 1.1 config types | Defaults + normalization helpers for telemetry config                                                                                                                                              |

### 1.2 Telemetry Runtime + Policy Layer

| File                                                             | Change Type | Est. Lines | Phase | Depends On                  | Justification                                                                                                                                         |
| ---------------------------------------------------------------- | ----------- | ---------- | ----- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/infra/observability/telemetry/types.ts`              | New         | +120       | 1.2   | 1.1                         | Typed telemetry contracts: `TelemetryRuntime`, `TelemetryRecorder`, event attribute shapes. Required — no existing type surface for OTel abstractions |
| `server/src/infra/observability/telemetry/attribute-policy.ts`   | New         | +220       | 1.2   | 1.2 types                   | Allowlist/redaction + cardinality policy enforcement. Required — enforces acceptance criteria #3 and #4 (no sensitive data, low cardinality)          |
| `server/src/infra/observability/telemetry/metric-view-policy.ts` | New         | +120       | 1.2   | 1.2 types                   | Low-cardinality metric views/attribute filtering. Required — metric label policy needs typed enforcement                                              |
| `server/src/infra/observability/telemetry/runtime.ts`            | New         | +240       | 1.2   | 1.1 deps                    | NodeSDK startup/shutdown, exporter setup, graceful failure behavior. Required — no existing OTel runtime                                              |
| `server/src/infra/observability/telemetry/hook-observer.ts`      | New         | +160       | 1.2   | 1.2 types, 1.3b hooks wired | Bridges hook events (`gate/*`, `chain/*`, stage events) into OTel trace events. Required — the telemetry consumer that registers with `HookRegistry`  |
| `server/src/infra/observability/telemetry/index.ts`              | New         | +25        | 1.2   | 1.2 all                     | Barrel exports                                                                                                                                        |

**New file justification**: `infra/observability/telemetry/*` isolates OTel runtime + policy from orchestration layers. Cannot be added to existing `metrics/` (different concern: OTel SDK vs in-memory analytics) or `notifications/` (MCP client notifications, not traces). Follows existing `observability/` subdirectory pattern.

### 1.3 Runtime Wiring + Lifecycle

| File                                        | Change Type | Est. Lines | Phase | Depends On    | Justification                                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------- | ---------- | ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/runtime/telemetry-lifecycle.ts` | New         | +110       | 1.3   | 1.2           | Extract telemetry startup/shutdown orchestration. Required — `application.ts` is 1303 lines (Critical severity); adding telemetry logic inline would compound the debt. This file owns: SDK init, hook observer registration, graceful shutdown flush |
| `server/src/runtime/module-initializer.ts`  | Extend      | +60        | 1.3   | 1.2           | Create telemetry runtime instance, connect hook observer to HookRegistry. Follows existing pattern of service composition in this file                                                                                                                |
| `server/src/runtime/application.ts`         | Extend      | +20        | 1.3   | 1.3 lifecycle | Thin lifecycle wiring only: call `telemetryLifecycle.start()` in `startup()`, `telemetryLifecycle.shutdown()` in `shutdown()`. No embedded logic                                                                                                      |
| `server/src/shared/types/index.ts`          | Extend      | +25        | 1.3   | 1.2 types     | Re-export minimal telemetry port types for wiring boundaries                                                                                                                                                                                          |

### 1.3b Pipeline Hook Wiring (NEW — Review Finding #1)

**Rationale**: The hook system has 10 event types defined in `hook-registry.ts` but **zero calls** exist in production code. The pipeline loop must emit hook events before telemetry consumers can listen. This phase activates the dormant infrastructure.

| File                                                                | Change Type | Est. Lines | Phase | Depends On    | Justification                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ----------- | ---------- | ----- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/engine/execution/pipeline/prompt-execution-pipeline.ts` | Extend      | +40        | 1.3b  | 1.3           | Add `emitBeforeStage(stage, context)`, `emitAfterStage(stage, context)`, `emitStageError(stage, error, context)` calls in the stage execution loop. HookRegistry is already injected via Stage 00-B dependency injection — this wires the calls |
| `server/tests/unit/execution/pipeline/pipeline-hooks.test.ts`       | New         | +180       | 1.3b  | 1.3b pipeline | Verify hook emissions fire for each stage, including error and early-exit paths. Separate from telemetry tests — validates the hook infrastructure itself                                                                                       |

**Validation checkpoint**: After Phase 1.3b, run `npm run test:ci` to confirm hook wiring doesn't break existing pipeline behavior. Hook callbacks default to no-ops, so no functional change unless consumers register.

### 1.4 Pipeline + Event Instrumentation (OTel Consumers)

| File                                                                           | Change Type | Est. Lines | Phase | Depends On         | Justification                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ----------- | ---------- | ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/engine/execution/pipeline/prompt-execution-pipeline.ts`            | Extend      | +180       | 1.4   | 1.3b, 1.3          | Root span (`prompt_engine.request`) wrapping full pipeline execution + per-stage child spans. Uses trace context from telemetry runtime. Estimate reduced from +220 → +180 because hook emissions are now in Phase 1.3b |
| `server/src/engine/execution/pipeline/stages/00-dependency-injection-stage.ts` | Extend      | +25        | 1.4   | 1.3                | Attach telemetry recorder handle to pipeline dependencies via same supplier pattern as `getAnalyticsService`                                                                                                            |
| `server/src/infra/hooks/hook-registry.ts`                                      | Extend      | +35        | 1.4   | 1.2                | Optional telemetry-aware event payload normalization (sanitize attributes before emission)                                                                                                                              |
| `server/src/engine/gates/services/gate-verdict-processor.ts`                   | Extend      | +45        | 1.4   | 1.3b hooks wired   | Enrich gate events with trace-safe metadata (`cpm.gates.applied_count`, verdict type)                                                                                                                                   |
| `server/src/engine/execution/pipeline/stages/08b-shell-verification-stage.ts`  | Extend      | +55        | 1.4   | 1.3b hooks wired   | Emit shell verification attempt/pass/fail/escalation trace events via hook system                                                                                                                                       |
| `server/src/engine/execution/pipeline/stages/01-parsing-stage.ts`              | Extend      | +30        | 1.4   | 1.4 pipeline spans | Add safe business attrs (`cpm.prompt.id`, `cpm.operator.types`) via attribute policy mapper                                                                                                                             |
| `server/src/engine/execution/pipeline/stages/04-planning-stage.ts`             | Extend      | +25        | 1.4   | 1.4 pipeline spans | Add safe planning attrs (`cpm.gates.applied_count`, `cpm.chain.total_steps`, chain flags)                                                                                                                               |

### 1.5 Test Coverage + Rollout Validation

| File                                                                       | Change Type | Est. Lines | Phase | Depends On | Justification                                                                                |
| -------------------------------------------------------------------------- | ----------- | ---------- | ----- | ---------- | -------------------------------------------------------------------------------------------- |
| `server/tests/unit/infra/observability/telemetry/attribute-policy.test.ts` | New         | +220       | 1.5   | 1.2        | Enforce no raw payload attrs + allowlist behavior. Critical gate for acceptance criterion #4 |
| `server/tests/unit/infra/observability/telemetry/runtime.test.ts`          | New         | +220       | 1.5   | 1.2        | Runtime bootstrap/shutdown, exporter wiring, graceful degradation when disabled              |
| `server/tests/unit/execution/pipeline/pipeline-telemetry.test.ts`          | New         | +260       | 1.5   | 1.4        | Root/stage spans for all 23 stages, early exit paths, error status propagation               |
| `server/tests/unit/execution/pipeline/parsing-stage-telemetry.test.ts`     | New         | +140       | 1.5   | 1.4        | Prompt/operator safe attribute coverage, policy enforcement on business attrs                |
| `server/tests/integration/observability/telemetry-smoke.test.ts`           | New         | +220       | 1.5   | 1.4        | End-to-end trace emission + resource visibility + metrics compatibility                      |

### 1.6 Resource Visibility + Documentation

| File                                                               | Change Type | Est. Lines | Phase | Depends On | Justification                                                                                                                           |
| ------------------------------------------------------------------ | ----------- | ---------- | ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/modules/resources/handlers/observability-resources.ts` | Extend      | +50        | 1.6   | 1.3        | Expose telemetry runtime health/config as `resource://telemetry/status` (no sensitive payload)                                          |
| `docs/architecture/overview.md`                                    | **New**     | +120       | 1.6   | 1.4        | Architecture map with telemetry runtime + 23-stage pipeline + observability subsystems. **Changed from "Extend" — file does not exist** |
| `docs/guides/telemetry-observability.md`                           | New         | +260       | 1.6   | 1.4        | Canonical operator guide: config, policy, troubleshooting, attribute reference                                                          |
| `docs/reference/otel-collector-tail-sampling.yaml`                 | New         | +150       | 1.6   | 1.4        | Tail sampling policy artifact (error/latency/gate/shell priority)                                                                       |

---

## Phase 5.0: Telemetry Semantics Contract

### Span Model

- Root span: `prompt_engine.request`
- Stage spans: `pipeline.stage.<StageName>` for every executed stage (23 possible stages)
- Trace status:
  - `OK` on normal completion/expected early response
  - `ERROR` on thrown exceptions or error response paths

### Event Model

- Gate lifecycle: `gate.passed`, `gate.failed`, `gate.retry_exhausted`, `gate.response_blocked`
- Shell verify lifecycle: `shell_verify.attempt`, `shell_verify.passed`, `shell_verify.failed`, `shell_verify.escalated`
- Optional chain lifecycle (from hooks): `chain.step_complete`, `chain.complete`, `chain.failed`

### Business Context Attributes (trace attrs)

- `cpm.command.type`
- `cpm.execution.mode`
- `cpm.prompt.id`
- `cpm.operator.types`
- `cpm.chain.current_step`
- `cpm.chain.total_steps`
- `cpm.gates.applied_count`
- `cpm.gates.temporary_count`
- `cpm.framework.id`
- `cpm.framework.enabled`
- `cpm.scope.continuity_source`

### Explicitly Excluded (default telemetry)

- raw `command`
- raw `user_response`
- rendered prompt/template bodies
- raw model outputs
- free-form unbounded text fields

---

## Phase 6.0: Sampling + Metric Label Policy

### Tail Sampling Policy (Collector)

- Keep 100%: error traces.
- Keep 100%: gate-blocked/retry-exhausted traces.
- Keep 100%: shell verification failures/timeouts/escalations.
- Keep 100%: slow traces (`root > 5s` OR any stage span `> 1.5s`).
- Keep 25%: successful chain executions.
- Keep 5%: successful single executions.
- Optional rollout window: temporary 100% for first 10 minutes post-deploy.

### Metric Label Policy

Allowed labels:

- `stage_name`
- `stage_type`
- `status`
- `execution_mode`
- `is_chain`

Disallowed labels:

- `prompt_id`
- `chain_id`
- `continuity_scope_id`
- `operator_types`
- any user-supplied free-form text

---

## Phase 7.0: Completion Criteria

| #   | Acceptance Criterion                           | Validation                                      | Test/Command                                                                                                                      |
| --- | ---------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Root + stage spans emitted for all 23 stages   | Unit + integration span assertions              | `pipeline-telemetry.test.ts`, `telemetry-smoke.test.ts`                                                                           |
| 2   | Gate/shell lifecycle visible in traces         | Event assertions for pass/fail/escalation paths | gate/shell telemetry tests                                                                                                        |
| 3   | No sensitive raw payload attrs                 | Attribute policy unit tests                     | `attribute-policy.test.ts`                                                                                                        |
| 4   | Low-cardinality metric labels only             | Metric view + policy tests                      | telemetry runtime/policy tests                                                                                                    |
| 5   | Existing analytics resource remains compatible | Resource integration checks                     | `resource://metrics/pipeline` assertions                                                                                          |
| 6   | Pipeline hook emissions fire for all stages    | Hook wiring unit tests                          | `pipeline-hooks.test.ts`                                                                                                          |
| 7   | Type safety passes                             | Typecheck                                       | `cd server && npm run typecheck`                                                                                                  |
| 8   | Lint ratchet unchanged                         | Lint ratchet                                    | `cd server && npm run lint:ratchet`                                                                                               |
| 9   | Unit/integration regression safety             | Test suite                                      | `cd server && npm run test:ci`                                                                                                    |
| 10  | Transport parity                               | Runtime smoke checks                            | `cd server && npm run start:stdio`, `cd server && npm run start:sse`, `cd server && npm run start -- --transport=streamable-http` |
| 11  | Docs/code parity                               | Manual review checklist                         | architecture + telemetry guide + collector policy                                                                                 |

---

## Phase 8.0: Legacy Removal & Exit Criteria

No permanent dual-observability path is allowed.

Mandatory removal tasks before marking complete:

- Remove temporary telemetry debug exporters/flags used only during rollout.
- Remove any duplicate event emission path introduced only for migration.
- If compatibility shims are added around `MetricsCollector`, mark with explicit guard and remove within same milestone where OTel-backed path is validated.

Exit condition:

- Telemetry runtime is canonical for trace emission.
- `MetricsCollector` remains for resource summaries only (or is intentionally bridged with explicit ownership), with no duplicated business-event logic.
- Hook system is the single fan-out point for pipeline/gate/chain events (no parallel event paths).

---

## Phase 9.0: New Code Justification

| New File                                               | Justification                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `infra/observability/telemetry/types.ts`               | No existing type surface for OTel abstractions; `metrics/types.ts` covers in-memory analytics only |
| `infra/observability/telemetry/attribute-policy.ts`    | Enforces acceptance criteria #3/#4; no existing policy mechanism                                   |
| `infra/observability/telemetry/metric-view-policy.ts`  | Metric label cardinality enforcement; distinct from attribute policy (trace vs metric)             |
| `infra/observability/telemetry/runtime.ts`             | OTel NodeSDK lifecycle; cannot be added to existing `analytics-service.ts` (different concern)     |
| `infra/observability/telemetry/hook-observer.ts`       | Bridges hook → trace events; single-responsibility consumer of HookRegistry                        |
| `infra/observability/telemetry/index.ts`               | Barrel export; follows existing observability subdirectory pattern                                 |
| `runtime/telemetry-lifecycle.ts`                       | Extracts telemetry startup/shutdown from `application.ts` (1303 lines, Critical severity)          |
| `tests/unit/execution/pipeline/pipeline-hooks.test.ts` | Validates hook wiring independently from telemetry; Phase 1.3b gate                                |
| `docs/architecture/overview.md`                        | Architecture doc did not exist; needed for OTel integration context                                |
| `docs/guides/telemetry-observability.md`               | Operational runbook for deploy/debug policy                                                        |
| `docs/reference/otel-collector-tail-sampling.yaml`     | Executable policy artifact for collector configuration                                             |
| New telemetry tests (5 files)                          | Prevent policy drift and sensitive-data regressions                                                |

---

## Phase 10.0: Over-Engineering Check

- [x] No replacement of existing stage pipeline model.
- [x] No new storage backend introduced for telemetry state.
- [x] No broad always-on payload capture of prompt/response content.
- [x] No high-cardinality metric label expansion.
- [x] No transport-specific behavior fork.
- [x] No revival of dead code (`PerformanceMonitor`) — excluded, flagged for separate cleanup.
- [x] No parallel event emission path — hooks are single fan-out point.
- [x] No logic added to `application.ts` — extraction to `telemetry-lifecycle.ts` keeps it wiring-thin.

---

## Phase 11.0: Dependency Graph

```
Phase 1.0 (DONE) ──► Phase 1.1 (Config + Deps)
                           │
                     ┌─────┴─────┐
                     ▼           ▼
              Phase 1.2      (parallel: config
              (Telemetry      validator + defaults
               Runtime)        can start)
                     │
                     ▼
              Phase 1.3 (Runtime Wiring)
                     │
                     ▼
              Phase 1.3b (Hook Wiring) ◄── NEW
                     │
               ┌─────┴─────┐
               ▼           ▼
        Phase 1.4      Phase 1.5 (Tests)
        (OTel             (can start after
         Consumers)        1.2 for policy tests)
               │           │
               └─────┬─────┘
                     ▼
              Phase 1.6 (Docs + Resources)
```

**Critical path**: 1.0 → 1.1 → 1.2 → 1.3 → 1.3b → 1.4 → 1.6
**Parallel track**: 1.5 tests can start after 1.2 (attribute-policy, runtime tests) and expand after 1.4 (pipeline telemetry tests)

---

## Phase 12.0: Excluded Items (Deferred)

| Item                                 | Reason                                                                                  | When to Address                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PerformanceMonitor` revival/removal | Dead code (469 lines, never instantiated)                                               | Separate dead-code cleanup PR                                                                                                                |
| `application.ts` decomposition       | 1303 lines (Critical severity) but telemetry extraction is additive, not a prerequisite | After OTel rollout stabilizes; consider extracting `initializeFoundation`, `loadAndProcessData`, `registerMcpResources` into focused modules |
| `analytics-service.ts` size          | 714 lines (above 600-line advisory)                                                     | After OTel bridge validates; may shrink if bridged methods are replaced                                                                      |
| OTel metrics (beyond traces)         | Traces are primary deliverable; OTel Metrics SDK is separate scope                      | Phase 2 of observability roadmap                                                                                                             |
