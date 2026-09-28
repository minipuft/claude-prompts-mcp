---
title: "Architecture docs sync — implementation notes (append-only)"
date: 2026-09-27
status: backlog
tags: []
---

# Architecture docs sync — implementation notes (append-only)

Plan: `plans/architecture-docs-sync-2026-09-27.md`. Rulings live in the plan's table; this file carries deviations and findings as handoffs land.

## 2026-09-27 · planner turn 1

- Classify: work_type `feature` · strategy discovery → pre-flight → implement → validate · scope `docs/architecture/overview.md`, `server/scripts/**`, `docs/reference/module-catalog.md`, `module.yaml` files, `.github/workflows/ci.yml` · skip_gates none (decision-bearing: new validator, new descriptor field) · primary_skill `/search` → `/refactoring`.
- Measured before cutting rows: `stages` array 21 · stage files 21 · doc box 21 rows matching in order · `(23 stg)` at `overview.md:87` and `:300` · `11 action handlers` at `overview.md:313` and `11 specialized action handlers` at `:322` against 12 files on disk · stage numerals also at `CLAUDE.md:239`, `overview.md:35/112/121`, and `docs/guides/telemetry-observability.md:58` ("18-22 stages depending on pipeline config" — a different claim, about spans emitted; row 1.2 decides allowlist vs correction and reports it).
- DEV-T1-1: the planner prompt routes public documentation through `>>documentation_change`; row 1.5 is dispatched under `>>strategic_worker` instead (R7). Reason recorded in the plan.
- DEV-T1-2: `>>tech_recommendation` said "TypeScript compiler API" for the stage parser; R2 overrides it to node builtins because the docs CI route has no `node_modules`. The recommendation did not know that constraint.
- Dependency-cruiser `--metrics` probed on main: JSON gains a top-level `folders[]` with `name` (e.g. `src/cli-shared`), `afferentCouplings`, `efferentCouplings`, `instability`; modules gain `instability`. `src/cli-shared` measured I = 0.86 (Ca 12, Ce 75).
