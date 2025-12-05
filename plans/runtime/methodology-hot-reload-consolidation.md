# Methodology Hot-Reload Consolidation Plan

## Objective
- Consolidate methodology hot-reload wiring into the prompt hot-reload manager so prompts and methodologies share one reload orchestration path.
- Use the framework manager as the single source for the methodology registry; avoid parallel access paths.
- Keep the design extensible so the gate system can register its own reload handlers via the same interface in the future.
- Remove ad-hoc methodology reload wiring from `Application`, aligning with the modular startup helpers.

## Scope
- In scope: prompt hot-reload manager (`server/src/prompts/hot-reload-manager.ts`), file observer, framework manager/registry access, `Application` wiring, runtime helpers.
- Out of scope: changing methodology definitions or prompt loading logic beyond wiring; no transport changes.

## Current State
- Prompt hot-reload is managed by `prompts/hot-reload-manager.ts` and `file-observer.ts` (canonical).
- Methodology hot-reload options are built inside `Application` via direct registry access through `mcpToolsManager`, bypassing the prompt hot-reload manager.
- `Application` still carries methodology hot-reload wiring inline, not through shared helpers; framework manager/registry should be the single source.

## Deliverables
- Shared hot-reload registration path (prompt + methodology) via the prompt hot-reload manager APIs.
- Helper to derive methodology hot-reload configuration from the framework manager/registry; no direct registry access in `Application`.
- `Application` delegates methodology reload registration to the consolidated helper (through existing startup helpers).
- Tests validating hot-reload registration invokes both prompt and methodology handlers.

## Workstreams & Steps
1) API alignment
   - Extend prompt hot-reload manager (or a small adapter) to accept optional auxiliary reload configs (directories + handler), not methodology-specific, so gate reload can plug in later.
   - Provide a helper to derive methodology reload config from the framework manager/registry (single source), and define a pattern to derive gate reload config from the gate registry when needed.
2) Wiring cleanup
   - Replace `Application`’s inline methodology reload builder with the shared helper; delegate registration through the prompt hot-reload manager.
   - Ensure framework manager access flows through existing managers; no new singletons or direct registry reach-ins. Keep the auxiliary hook generic to accommodate gate reload.
3) Tests
   - Add unit tests to verify prompt hot-reload registration accepts auxiliary handlers (methodology now; gate later) and invokes them on simulated change events; keep prompt reload behavior unchanged.
4) Validation
   - `npm run typecheck`
   - Targeted tests for hot-reload manager auxiliary handler invocation
   - (Optional) Manual smoke: trigger prompt hot-reload and confirm methodology handler runs.

## Exit Criteria
- `Application` no longer builds methodology hot-reload options inline; uses the consolidated helper via prompt hot-reload manager.
- Methodology registry/framework manager is the sole source for methodology reload config; no parallel access paths.
- Prompt + methodology hot-reload run through a unified registration path with passing tests; auxiliary hook supports future gate reload without API change.

## Progress
- Added auxiliary reload support to `HotReloadManager`/`PromptManager` and a shared helper (`runtime/methodology-hot-reload.ts`) so `Application` delegates methodology hot-reload via the auxiliary hook.
- Added unit coverage for auxiliary handlers (`tests/unit/prompts/hot-reload-auxiliary.test.ts`) alongside existing health tests; typecheck currently passes.

## Risks & Mitigations
- Regression in prompt reload behavior → additive handler design and targeted tests.
- Registry access drift → enforce helper to consume framework manager/registry only (no new global refs).
- Test brittleness → mock file observer and methodology handler in isolation; avoid real filesystem dependencies.
