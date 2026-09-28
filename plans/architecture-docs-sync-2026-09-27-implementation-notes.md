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

## 2026-09-27 · handoff 1.1 (sonnet)

- Accepted after spot-read: two boxes gone, two sentences in, count 11 → 12 at one site (the other `11` was inside a deleted box). Committed `0d1e31dd3`.
- Finding F1: `overview.md` held THREE ASCII boxes, not two — the planner's inventory came from the `23 stg` grep, which found the two that carried a stale count and missed the one that carried none. The verification phrase on row 1.1 ("only the stage box remains") was therefore unfalsifiable as written. Folded into row 1.5 as a delete-or-keep decision with its evidence named.
- Finding F2 (worker): "internally uses **5 specialized managers**" is an uncounted claim in the same section. Folded into row 1.5.
- Feedback accepted: an inventory built from the symptom's grep is a list, not an enumeration — the enumeration predicate for "hand-drawn diagram" is `┌`, and the row should have been cut from that count.

## 2026-09-27 · handoff 1.3 (opus)

- Accepted after spot-read of the rendered section: 14 rows, legend derived from the file's own comments, views render `—` where `ViewContract` has no field rather than inventing one. Committed `75622c808`.
- DEV-T1-3: a third file changed — `server/.knip-ratchet-baseline.json` (`types` 637 → 636, `findings` 1103 → 1102). The row's file bound was 2. Accepted: the change is a lowering, the worker ran the positive control (HEAD generator swapped back → ratchet OK at 1103), and the rejected alternative (un-exporting a type to keep the count) would have gamed the ratchet. The brief should have listed the baseline up front — a row that gives a previously unused exported type its first consumer moves the knip baseline every time (worker feedback, accepted; matches memory `feedback_validator_edit_row_checks`).
- Finding F3: `TableContract` also declares `readers[]` and `finding` — the two facts a catalog reader most wants ("who reads this" and "what is known wrong") — and the row did not render them. Cut as row 1.7 (after 1.4 so the two do not race on the generator). `rebuiltFrom` / `acceptedForeignWriters` / `acceptedPhantomColumns` stay unrendered: exception ledgers owned by `validate:table-contracts`, recorded on the row so the decision is not re-derived.
- Finding F4: the old self-test printed `7/7` over 6 assertions. Fixed in place by the worker; noted because a wrong pass-count label is the same shape as a stale `✓`.
