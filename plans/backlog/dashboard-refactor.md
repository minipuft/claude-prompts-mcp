---
title: "Observability Dashboard — Refactor Plan"
date: 2026-05-14
status: backlog
tags: []
---

# Observability Dashboard — Refactor Plan

**Status**: Archived — awaiting refactor
**Owner**: minipuft
**Created**: 2026-05-14

## Where the work lives now

| Location                                          | What's there                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `backup/dashboard-work-2026-05-13` (local branch) | Three commits preserving the full feature: `22e6fee9` (initial), `0989ab59` (merge), `94c7702c` (eslint baseline) |
| Local `main` (unpushed)                           | Same three commits — never pushed to `origin/main`                                                                |
| `server/dashboard/` (working tree)                | **Removed** from this branch. Available via `git checkout backup/dashboard-work-2026-05-13 -- server/dashboard/`  |

The work is **not** on `origin/main`. Pushing it requires a deliberate decision after refactor.

## Why it's archived (not deleted)

The dashboard feature is valuable — chain visualization is exactly what an MCP server benefits from. Composition needs cleanup before public ship. Six issues identified during the v2.2.0 rebase session:

## Issues identified

### 1. Layer boundary violation (BLOCKING)

```
mcp/http/dashboard-routes.ts → infra/observability/dashboard/index.ts
```

Violates dep-cruiser `mcp-no-infra-static`. MCP layer reaching directly into infra. Caught by `validate:arch` during the rebase.

**Fix paths**:

- Define `SpanQueryPort` in `shared/types/`, implement in `infra/observability/dashboard/`, inject into routes
- OR relocate the dashboard module out of `infra/` (it's a feature, not infrastructure)

### 2. No service layer between routes and persistence (HIGH)

Routes import `dashboard/index.ts` directly. Domain Ownership Matrix in CLAUDE.md mandates service layers for every other subsystem; dashboard skipped this.

**Fix**: Extract `SpanQueryService` that owns query logic. Routes become thin orchestration, calling `spanQueryService.queryByTrace()` etc.

### 3. `telemetry_spans` schema in main `state.db` (MEDIUM-HIGH)

Observability data has very different lifecycle (write-heavy, queried for visualization) vs operational state (read-heavy, transactional). Mixed concerns in the schema.

**Also overlaps with OTel collector** — the project already emits OpenTelemetry traces to an external collector. The `telemetry_spans` SQLite table is a parallel path that needs justification.

**Decision needed before refactor**:

| Option                                                           | Look                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **A. Keep `telemetry_spans` in state.db**                        | Dashboard reads from SQLite directly. Simple, no external dependencies. Cost: state.db pollution, no production-scale querying.  |
| **B. Drop `telemetry_spans`, dashboard reads from OTel backend** | Routes call Jaeger/Tempo/etc. Clean schema, real scale. Cost: requires backend infra, latency on reads, more deployment surface. |
| **C. Hybrid — `telemetry_spans` for local dev, OTel for prod**   | Adapter pattern, dashboard reads from `SpanQueryPort` whose implementation differs by env. Most flexible. Most complex.          |

This is the most important decision. It cascades into module layout, schema retention, and which services to define.

### 4. Server + UI in one tree (MEDIUM)

`server/dashboard/src/*.tsx` (React UI) sits inside the server package. The server is a TS Node bundle; React is a browser bundle. Mixing inflates dependency graph (`@react-three/drei` etc. in `server/package.json`) and complicates build orchestration.

**Fix**: Move UI to its own workspace or top-level `dashboard/` package. Server publishes API contract; UI consumes it.

### 5. Single mega-commit (MEDIUM)

`22e6fee9 feat(runtime): add observability dashboard with telemetry persistence` is the kitchen-sink commit — schema + backend + routes + UI + types — all in one. Hard to review, hard to revert in pieces.

**Fix during refactor**: Split into:

- schema + types (DB + interfaces)
- service layer (`SpanQueryService`)
- HTTP routes (consumer)
- React UI (separate workspace)

### 6. No migration intent for `telemetry_spans` vs OTel collector (SUBJECTIVE)

Either OTel suffices and `telemetry_spans` is dead weight, or this is a stopgap that needs a clear migration intent. Currently unspecified.

**Fix**: Document the decision from issue #3 in `docs/architecture/overview.md`.

## Suggested refactor sequence

1. **Decide #3** (telemetry_spans vs OTel) — 30 min decision + 0-2 hours action
2. **Fix #1** (port definition, layer fix) — 30 min
3. **Fix #2** (extract service layer) — 1 hour
4. **Fix #4** (UI workspace separation) — 30 min
5. **Fix #5** (split commits) — done naturally during refactor
6. **Document #6** — 15 min

**Total estimate**: 3-5 hours focused work. Target release: **v2.3.0**.

## How to resume

```bash
# Create refactor branch from current main
git checkout main && git pull
git checkout -b feat/observability-dashboard-refactor

# Pull in dashboard work file-by-file (don't cherry-pick the mega-commit;
# we want to redo the composition)
git checkout backup/dashboard-work-2026-05-13 -- server/src/infra/observability/dashboard/
git checkout backup/dashboard-work-2026-05-13 -- server/src/mcp/http/dashboard-routes.ts
git checkout backup/dashboard-work-2026-05-13 -- server/src/mcp/http/dashboard-html.ts
git checkout backup/dashboard-work-2026-05-13 -- server/dashboard/

# Then refactor in sequence per the plan above
```

## Notes

- This plan is **untracked** (personal reference)
- `backup/dashboard-work-2026-05-13` should not be deleted until refactor lands
- The `22e6fee9` commit's content is the "original code" — refactor will reshape it, not preserve it commit-by-commit
- Pattern reference from this session: gate ↔ consumer pairing (`feedback_gate_consumer_pairing_pattern.md` in agent memory) — applies broadly, not just to dashboard
