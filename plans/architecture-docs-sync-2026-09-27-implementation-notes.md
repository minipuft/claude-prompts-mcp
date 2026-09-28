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

## 2026-09-27 · handoff 1.2 (opus)

- Accepted after running the validator (OK, 21) and its self-test (9/9) on the tree; registrations confirmed at `server/package.json:128`, `run-validation-suite.js:288`, `ci.yml:190`. Committed `350ffa5c7` with six files; the four `server/scripts/lib/*` and `module.yaml` modifications in the tree belong to 1.4 and were left unstaged.
- DEV-T1-4: sixth file `docs/guides/telemetry-observability.md` — the brief allowed a correction over an allowlist entry and the worker took it: "18-22 stages depending on pipeline config" was false (one span per stage that RUNS, never above the array's 21, fewer after an early `context.response`). The allowlist stays empty, which is the better state: a gate with zero exceptions has nothing to rot.
- Finding F5 (doc claims the code contradicts, folded into row 1.5): `### Pipeline Behavior` **Sequential** says "no skipping" beside an **Early exit** row that says the opposite; **Recovery** claims errors "can trigger cleanup" while `runStages` logs, records, and RETHROWS — only `finally` handlers run; the optional-stages footnote omits stage 12, which `createFrameworkStage()` replaces with an inert stub when no framework manager is wired.
- Finding F6 (recorded, no row): `08-`/`09-` stage files export factories the builder does not use; file-name stems differ from class names at 04/05/16/18/21. R3 deliberately checks exports, not stems; a stem convention would be a second convention. The unused factories are a `knip`/lifecycle question for a later sweep, not this slice.
- Feedback accepted: `reads` cannot be predicted by a brief — `suite-membership` derives `walk` from any `readdirSync` — so "run it and set what it demands" is the right brief wording; keep it.

## 2026-09-27 · handoff 1.4 (opus)

- Accepted after re-running `validate:module-catalog` (35 boundaries, 14 state rows, 3 extension points) and `validate:module-descriptors` (35) and reading the rendered section and one authored `module.yaml` entry. Committed `64bb5d34f`.
- DEV-T1-5: `--metrics` is opt-in (`metrics: true`) rather than always-on as the brief said. Accepted with the worker's reason: always-on would have added the metrics pass to `validate:arch`, which does not read it. The plan's R5 wording ("passes `-m`") is satisfied where it matters.
- DEV-T1-6: `server/scripts/lib/domain-ownership.ts` edited to extract `describeDefinitionProblem`, shared by `owns` and `extension`. Accepted: one statement of the rule over two copies, `owns` messages byte-identical, self-test 8/8 unchanged.
- DEV-T1-7: folder metric counts made optional in the schema after the first generate FAILED — folders outside `src` (`node_modules/…`, builtins) appear in `folders[]` without counts. Worker feedback accepted: a brief that quotes a measured shape should also state the shape of entries OUTSIDE the cruised tree; the planner's probe printed only `folders[0..2]`, all inside `src`.
- Finding F7: `system-control/handlers` is NOT an extension point — dispatch is a `switch` in `ConsolidatedSystemControl.getActionHandler` and adding an action edits `SYSTEM_CONTROL_ACTION_IDS`, the schema and `tool-routing.ts`. The planner's candidate list carried it as if it were one; the test "a contributor adds without editing the consumer" is the right predicate and it correctly rejected it.
- Finding F8 (candidates not authored, evidence recorded for a later row, none cut now): `formatting`/`StyleDefinitionLoader.discoverStyles` (same shape as gates — strongest), `prompts`/`PromptLoader` (unit is a category), `automation`/`ScriptToolDefinitionLoader` (unprobed), `infra-hooks`/`HookRegistry` (runtime API — passes only if registration is outside its consumers, unprobed). Revive as a row when a contributor asks where to add one of these.
- Finding F9: parent-module Instability aggregates children (`mcp-boundary` 0.97, `shared` 0.07). Folded into row 1.7's legend clause.
- Finding F10: `pipeline-builder.ts:13` and `:93` comments say "22 stages" / "23+ stages" — the 1.2 numeral class in a `.ts` comment its `docs/**` scan does not read. Cut as row 1.8 (after 1.2; no file conflict with 1.5/1.7).
- Only `engine-interfaces` has no folder metrics row (renders `—`); it has no source files that import anything, so dependency-cruiser emits no folder for it.
