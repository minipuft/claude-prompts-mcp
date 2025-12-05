# Runtime Initialization Refactor Plan

## Objective
- Modernize runtime startup using existing shared utilities (logger, config/options, service wiring, transport setup, health) without recreating them per class.
- Establish a composition root that injects dependencies and removes legacy staging patterns.
- Preserve transport parity (STDIO/SSE) and hot-reload behavior while reducing duplication.

## Scope
- In scope: runtime startup (`server/src/runtime`), entrypoint (`server/src/index.ts`), shared logging/health wiring, DI/composition helpers, tests covering startup/health, and reuse of existing utilities (logger, config/options, service manager, transport manager, health shape).
- Out of scope: changing MCP tool contracts, prompt/framework/gate logic beyond wiring to the new context.

## Current Issues
- `Application` constructor initializes dependencies as `null as any` and re-creates logger/health logic internally instead of reusing `createLogger`/shared health helpers.
- Health checks live inside `Application.validateHealth` and are mirrored in `server/src/index.ts` instead of a shared helper.
- Startup phases (foundation → data → modules → server) live in a single monolithic file (~1.4k lines), making reuse/testing harder.

## Goals / Deliverables
- Composition root (e.g., `runtime/context.ts`) that constructs logger (via `createLogger`), config/options, and shared helpers once and injects them.
- `Application` accepts injected dependencies; fields become `readonly` (no null placeholders) while reusing `ServiceManager`, `ConfigManager`, and transport setup helpers.
- Shared health helper used by both `Application.validateHealth` and entrypoint monitoring; no duplicated health logic.
- Startup phases extracted into focused functions/modules while keeping behavior parity and hot-reload hooks.
- Parity tests ensuring transports, hot-reload, and health reporting still work.

## Workstreams & Steps
1) Context & DI foundation
   - Add `runtime/context.ts` (or similar) to build logger via `createLogger`, config via `ConfigManager`, options via `resolveRuntimeLaunchOptions`, and shared helpers (service manager, transport manager).
   - Define lifecycle labels (`canonical` for new context; mark old staging helpers `legacy` once replaced).
2) Application constructor cleanup
   - Update `Application` to take injected services; remove `null as any` placeholders.
   - Make dependencies `readonly` where possible; keep public surface compatible.
3) Health & monitoring reuse
   - Extract health reporting to a shared helper; point `Application.validateHealth` and entrypoint checks to it (no duplicate logic).
   - Keep existing health shape for callers; add minimal diagnostics if missing.
4) Startup orchestration split
   - Extract foundation/data/module/server init into small functions; `startApplication` sequences them using injected logger/config/service manager/transport manager.
   - Ensure transport parity and hot-reload registrations remain intact.
5) Validation & tests
   - Add/adjust tests for startup/health and DI wiring; run `npm run typecheck` and targeted runtime tests.

## Progress
- Replaced constructor null placeholders in `runtime/application.ts` with definite assignment to prep for DI without recreating instances.
- Centralized health reporting shape via `runtime/health.ts`, and `Application.validateHealth` now uses the shared helper to avoid duplicate health logic.
- Added `runtime/context.ts` as a composition root for foundation wiring (logger via `createLogger`, config/options, transport detection, config watcher via `ServiceManager`); `Application.initializeFoundation` now consumes it, reusing the same utilities instead of recreating them.
- Stored `serverRoot` in `Application` to avoid repeated detection during prompt path normalization.
- Split server startup into `runtime/startup-server.ts` so `Application.startServer` delegates to a shared helper (reuses transport detection and API manager wiring) and tracks transport type set by the composition root.
- Extracted prompt loading to `runtime/data-loader.ts` and module wiring to `runtime/module-initializer.ts`; `Application` now delegates to these helpers, removing inline path/transport duplication and double registration paths.
- Entry point health monitoring now stores the shared `HealthReport` shape (via `runtime/health.ts`) plus last-check timestamp instead of bespoke flags.

## Exit Criteria (mandatory)
- No `null as any` placeholders for core dependencies in runtime startup.
- Logger and health wiring are sourced from shared utilities; no parallel implementations remain.
- Monolithic `application.ts` startup flow is split into reusable modules without duplicate logic.
- Tests cover the new composition root and health checks; transports/hot-reload behavior validated.
- Docs/notes updated to mark the new context as `canonical` and any superseded helpers as `legacy`/`removed`.

## Validation Plan
- `npm run typecheck`
- Targeted runtime/health/startup tests (add or update as needed)
- Manual smoke: `npm run start:stdio` and `npm run start:sse` to confirm boot and hot-reload

## Risks & Mitigations
- Behavior drift during refactor → keep parity tests and migrate in small steps.
- DI churn impacting tests → provide test helpers/factories for the new context.
- Transport/hot-reload regressions → smoke both transports and verify prompt reload hooks remain wired.
