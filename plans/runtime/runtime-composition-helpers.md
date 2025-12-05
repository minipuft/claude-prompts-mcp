# Runtime Composition Helpers Plan

## Objective
- Define and implement modular helpers for runtime startup that reuse existing utilities (logger, config/options, service manager, transport, health).
- Replace monolithic `Application` staging with clear phases (foundation, data load, module init, server start) while preserving behavior (transports, hot-reload, health).
- Prevent duplication by consolidating health/transport detection and path handling into shared helpers.

## Scope
- In scope: runtime startup (`server/src/runtime`), entrypoint health monitoring (`server/src/index.ts`), helpers for foundation, data load, module initialization, and server start; tests covering startup/health parity.
- Out of scope: MCP tool contract changes, prompt/framework/gate logic beyond wiring to the new helpers.

## Current State
- Composition root (`runtime/context.ts`) provides foundation (logger/config/options/service manager/transport).
- Health helper (`runtime/health.ts`) and server startup helper (`runtime/startup-server.ts`) exist; `Application` still contains data/module init logic inline.
- `server/src/index.ts` performs its own health checks; not yet reusing the shared health helper.

## Progress
- Added `runtime/data-loader.ts` and `runtime/module-initializer.ts` and wired `Application` to delegate prompt loading and module initialization to these helpers (using context-provided serverRoot/transport).
- `Application.startServer` delegates to `startup-server.ts`; health reporting uses `runtime/health.ts`; constructor null placeholders removed in prior refactor.
- Entrypoint health monitoring now aligns with the shared health helper by storing and exposing the full `HealthReport` plus last-check timestamp.
- Added health-focused unit tests (`tests/unit/runtime/application-health.test.ts`, `tests/unit/index-health.test.ts`) to validate shared health shapes; typecheck currently blocked by in-progress injection stage types.

## Deliverables
- `runtime/data-loader.ts`: prompt path normalization using cached `serverRoot`, prompt loading/conversion, hot-reload prep; returns `promptsData/categories/convertedPrompts/promptManager`.
- `runtime/module-initializer.ts`: framework state manager, MCP tools manager, tool description manager, methodology hot-reload registration, prompt hot-reload wiring; returns initialized managers.
- `Application` delegates to helpers (context, data loader, module initializer, startup-server) without re-detecting transport/paths/health.
- Entrypoint health monitoring uses `runtime/health.ts` (no duplicate health logic).
- Tests/smoke updated to cover startup/health/transport parity.

## Workstreams & Steps
1) Data loading helper
   - Extract prompt path normalization and load/convert pipeline into `runtime/data-loader.ts` using `serverRoot` from context.
   - Ensure hot-reload hook registration remains compatible with existing watchers.
2) Module initialization helper
   - Build framework state manager, MCP tools manager, tool description manager, methodology hot-reload registration in `runtime/module-initializer.ts`.
   - Return initialized managers; keep lifecycle labels (`canonical`) and avoid new singletons.
3) Application delegation
   - Update `Application` to call data/module helpers; keep existing signatures and hot-reload/transport behavior.
   - Remove residual transport detection/path logic now covered by helpers/context.
4) Entrypoint alignment
   - Point `server/src/index.ts` health checks to `runtime/health.ts` output; eliminate duplicate health calculation.
5) Validation & tests
   - `npm run typecheck`; targeted startup/health tests; manual smoke for STDIO/SSE start and prompt hot-reload.

## Exit Criteria
- `Application` contains no duplicated transport detection, config watch setup, or health logic; delegates to helpers.
- Data/module init lives in dedicated helpers with clear inputs/outputs and reuses context-provided state.
- Entrypoint health monitoring uses the shared health helper; behavior matches prior health shape.
- Transports, hot-reload, and prompt loading behave as before (smoke/targeted tests passing).

## Risks & Mitigations
- Behavior drift during extraction → keep helper APIs thin and run parity checks (typecheck + smoke).
- Hot-reload wiring gaps → ensure data/module helpers expose necessary callbacks and registration.
- Test churn → add focused startup/health tests to lock in expected shape and transport behavior.
