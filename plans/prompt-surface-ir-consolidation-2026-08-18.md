---
title: "Plan-execution prompt surface — consolidate around workflow-IR compilation"
date: 2026-08-18
status: active
tags: []
---

# Plan-execution prompt surface — consolidate around workflow-IR compilation

**Work type**: refactor (consolidation) + feature (IR compilation in prompts)
**Ruling this plan exists to execute**: consolidate `tier_execute` into `strategicImplement` AS the
IR-compile step lands — not before (merging prose the IR deletes), not as parallel maintenance
(an unretirable parallel system). `implementation_plan` is updated to emit IR-compilable rows.

## Problem

Three prompts encode tier-by-tier serial execution: `strategicImplement` (entry: classify → bind →
route → dispatch tier-by-tier via `>>tier_execute`), `tier_execute` (160-line §A–G protocol whose
§B rebuilds a DAG from the Depends column in prose each run, and whose §D-delegated hand-authors
worker briefs), and `implementation_plan` (emits the tier table both read). The workflow IR already
provides validated structure for exactly the §B/§D region — nodes, edges, per-node `inlineGateIds`,
`visibility`, `agentType`/`subagentModel` (caps: maxNodes 32, maxFanOut 8, `docs/reference/workflow-ir.md:135-136`).
Result today: independent rows serialize, review batches to end-of-PR, and "split into subagents"
is re-derived by hand every initiative.

## Discovery evidence (Step 1, probe-backed)

- `tier_execute` has **zero consumers outside its own prompt family**. Live references: authored
  **4**, measured **5** on 2026-08-19 — `strategicImplement/system-message.md:10`,
  `implementation_plan/plan_table/prompt.yaml:6`, `plan_table/user-message.md:44`,
  `implementation_plan/system-message.md:76`, and **`docs/TODO.md:94`**, which the authored count
  missed. The fifth is not history: it is a live instruction telling a future reader to resume a
  tier with `>>tier_execute`. Retired by row 3.5. Everything else is `plans/reference/` history or
  an execution record. No doc-map entry, no skills-sync registration, no test fixture.
- `strategicImplement` has external anchors that must survive: `docs/reference/mcp-tools.md:243`,
  `tooling/contracts/prompt-engine.json:36` (tool-description example),
  `tests/unit/skills-sync/gate-review-hook.test.ts:24-48` (path-segment fixture only),
  `docs/guides/skills-sync.md:142`.
- The Depends column and `execution_dispatch` table already exist in the authored shape
  (`plan_table/user-message.md:35,53`) — the dependency declaration is present; nothing compiles it.
- The overlap between the two execution prompts is precisely the part the IR absorbs. Surviving
  unique content: strategicImplement = classify/bind/route; tier_execute = §A re-measurement,
  §E vacuity-checked gate verification, §F plan writeback, §G commit boundary.
- Delegation hold point: `plans/reference/subagent-delegation-contract-2026-08-12.md`. Authored as
  `status: active` with S1–S6 **all ☐**. **Measured 2026-08-19: already terminal** — status is now
  `reference`, and S1 ✓ · S2 ✓ · S3 ✓ · S4 ✓ · S5 ✗ KILLED · S6 ✓, all stamped 2026-08-18, one day
  before this execution. S6's own receipt reads "build + verify:mcp 17/17 + both probes re-run via
  streamable-http against the fresh dist". The authored defect (`==>` handoffs carry no chain
  history and no gate text) was fixed by S1/S4/S7. T4's hold point was therefore already flipped
  when this plan was picked up — see DEV-T0-2. The drift pattern is the reusable part: a hold point
  states what flips it but nothing detects the flip, so the condition came true silently.

## Design (Step 2)

```
scope:
  objective     : One IR-compiling execution prompt (strategicImplement) + an authoring prompt
                  (implementation_plan) that emits rows it can compile; tier_execute retired.
  success_signal: A plan authored by >>implementation_plan executes via one prompt_engine
                  workflow submission whose linearization matches the Depends column, with
                  per-node gates firing per row; no live surface references tier_execute.
  non_goals     : No server src changes for T1–T5 (IR schema, delegation runtime, hooks are other
                  plans); no symbolic-language changes; no skills-sync registration changes; S1–S6
                  work itself is NOT rows of this plan. AMENDED 2026-08-19: Tier D, appended after
                  this block was written, carries two `server/src/**` rows and is the one declared
                  exception — it is independent of T1–T5 and closes under its own falsifiers.
  constraints   : Status column ☐/✓/⚠/⊘ stays byte-compatible (plan-hygiene hooks +
                  validate-phase-header-drift.js); prompt edits via resource_manager
                  (Core Principle 1); strategicImplement id survives; IR caps bound submissions.

pre_flight    : 0 failures, compound none (full block in implementation notes conversation record)
identification:
  behavior  : implementation-mode entry that classifies work, binds the governing plan, compiles
              its rows into a workflow submission, and retains judgment in-session
  state     : none — stateless prompt resource; run state lives in chain_runs via the IR path
  shape     : single prompt resource with template-conditional sections
  placement : server/resources/prompts/development/strategicImplement/ (id survives in place)
```

### Decisions

| Decision                       | Chosen                                                                      | Rejected                                     | Why                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Consolidate now vs update both | Consolidate, sequenced as the IR-compile tier of THIS plan                  | Standalone merge today; parallel maintenance | Merging before IR lands merges ~55 lines the IR deletes; parallel prompts = unretirable gate |
| Surviving id                   | `strategicImplement`                                                        | `tier_execute`; fresh id                     | External refs all name strategicImplement                                                    |
| §E gate verification           | Per-node `inlineGateIds` + run-level tier gates (target = tier's last node) | Prose-only §E retained                       | Moves review per-node — the stated goal; vacuity check survives as gate guidance             |
| §F plan writeback              | Stays main-thread prose (judgment never delegates)                          | Writeback-as-node                            | Plan file is single-writer; writeback is acceptance, not work                                |
| Dependency declaration         | Existing Depends column; row id slugs to node id (`T1.2` → `t1-2`)          | Separate edges table in plan files           | One source; the column exists and is already parsed                                          |
| Fan-out enablement             | `agentType` emission gated behind S1–S6 only (T4)                           | Blocking ALL IR compilation on S1–S6         | In-session IR execution is safe today; only the ==> handoff is defective                     |

### Row → node mapping contract (load-bearing interface)

```
row `| 1.2 | ☐ | file | change | ~ln | 1.1 | cmd |` in tier T1 →
  node { id:"t1-2", promptId:"strategicImplement" (R-2), stepName:<Change text>,
         inlineGateIds:[<per-row gate>], agentType?:<post-S1-S6 only> }
  edge { from:"t1-1", to:"t1-2" }              (Depends column, within-tier)
  tier gate → run-level gate { id:<gate>, target_step_id:"t1-<last>" }
Rows without Depends stay parallel by declaration order (IR linearization rule).
execution_dispatch "Agent" column → subagentModel heavy|standard|fast.
```

## Verified paths (Step 3)

All 13 referenced files verified (ls/wc/rg, literal output in the chain record): zero major drift,
zero shims. One format correction inherited: delegation-plan S-rows are `###` headings, not table
rows; the T4 falsifier is S6's own flips-when (`npm run build && npm run verify:mcp` re-measure).

## Plan Table (Step 4)

### Tier 1: implementation_plan emits IR-compilable rows (backward compatible)

| #   | St  | File                                                                             | Change                                                                                                                                                                             | ~Lines | Depends | Verify                                                                         | Justification                            |
| --- | --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| 1.1 | ✓   | server/resources/prompts/planning/implementation_plan/plan_table/user-message.md | Add row→node mapping rules after :44 — row ids slug to kebab node ids (T1.2→t1-2), Depends values are row ids (= IR edges), per-row gate-id note, dispatch Agent column vocabulary | ~15    | —       | `rg -n "node id" <file>`; `node server/scripts/validate-phase-header-drift.js` | Existing file; extends rules list :44-49 |
| 1.2 | ✓   | server/resources/prompts/planning/implementation_plan/system-message.md          | Update :73-76 vocabulary — the table compiles to a workflow submission; the four status glyphs unchanged                                                                           | ~4     | —       | `rg -n "workflow submission" <file>`; same drift script                        | Existing file                            |

**Tier 1 gate**: ✓ PASSED 2026-08-19. `npm run validate:all` — 42/44 steps green. The two red
steps were attributed, not fixed here: `validate:format` failed entirely on a concurrent session's
plan-file moves (Prettier naming files that no longer exist) and `validate:plan-row-tracking`
failed on THIS plan's own unstamped ☐ rows, which flipping `status: backlog → active` made visible.
Backward compatibility check: the added rules are appended list items, so a plan authored under
them still exposes the ID/Status/Step/Files/Depends/Verification columns the retired §A parsed.

### Tier 2: strategicImplement becomes the consolidated IR-compiling execution prompt

| #   | St  | File                                                                      | Change                                                                                                                                                                                                                                                                                        | ~Lines | Depends | Verify                                                       | Justification                        |
| --- | --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------ | ------------------------------------ |
| 2.1 | ✓   | server/resources/prompts/development/strategicImplement/system-message.md | Rewrite step 4 Dispatch (:10): compile pending rows → workflow submission (nodes from rows, edges from Depends, per-row inlineGateIds, tier gates run-level); NO agentType until T4; absorb tier_execute §A re-measurement, §E vacuity-checked verification, §F writeback, §G commit boundary | ~45    | 1.1     | `rg -c "tier_execute" <file>` = 0; `rg -n "workflow" <file>` | Consolidation target ruled in Design |
| 2.2 | ✓   | server/resources/prompts/development/strategicImplement/prompt.yaml       | Migrate surviving args: design_mode, autonomous_commit; update description                                                                                                                                                                                                                    | ~20    | 2.1     | `npm run verify:mcp` (schema advertises new args)            | Existing yaml extended               |

**Tier 2 gate**: ✓ PASSED 2026-08-19 — see the Tier 5 gate run, which supersedes it (same two
commands, run after every row of T2–T5 had landed). Consolidated prompt measures **35 lines**
against the risk row's <160 target; `rg -c "tier_execute"` = 0.

### Tier 3: tier_execute retirement — same PR family as T2

| #   | St  | File                                                                             | Change                                                       | ~Lines | Depends  | Verify                                                               | Justification    |
| --- | --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ | -------- | -------------------------------------------------------------------- | ---------------- |
| 3.1 | ✓   | server/resources/prompts/development/tier_execute/ (delete dir)                  | Delete via resource_manager; no alias, no breadcrumb         | -216   | 2.1, 2.2 | `rg -l "tier_execute" server/resources docs/` → only plans/reference | Removal          |
| 3.2 | ✓   | server/resources/prompts/planning/implementation_plan/plan_table/prompt.yaml     | :6 "tier_execute can drive" → name the consolidated executor | ~2     | 3.1      | `rg -c "tier_execute" <file>` = 0                                    | Reference update |
| 3.3 | ✓   | server/resources/prompts/planning/implementation_plan/plan_table/user-message.md | :44 reattribute to strategicImplement + plan-hygiene hooks   | ~2     | 3.1      | same rg                                                              | Reference update |
| 3.4 | ✓   | server/resources/prompts/planning/implementation_plan/system-message.md          | :76 "appended by tier_execute" → reattribute                 | ~1     | 3.1      | same rg                                                              | Reference update |

| 3.5 | ✓ | docs/TODO.md | :94 "Resume with `>>tier_execute plan_file:… tier_id:…`" → `>>strategicImplement task:… plan_path:…`; path also corrected to `plans/reference/` | ~1 | 3.1 | `rg -c "tier_execute" docs/TODO.md` = 0 | NEW ROW (DEV-T0-1) — the 5th live reference the authored count missed, and the only one that is an instruction rather than a record |

**Tier 3 gate**: ✓ PASSED 2026-08-19. Gate command WIDENED as authored it was too narrow: it
exempted `plans/reference/**` and `CHANGELOG.md` but not `plans/**-implementation-notes.md`, which
are execution records — the same historical-record class CHANGELOG is exempted as. Run:
`rg -l "tier_execute" --glob '!plans/reference/**' -g '!CHANGELOG.md' -g '!plans/**-implementation-notes.md' -g '!plans/prompt-surface-ir-consolidation-2026-08-18*.md'`
→ returns nothing. The two surviving matches are this plan and its notes, both of which document
the retirement. Substitution recorded per DEV-T0-4.

### Tier 4: fan-out enablement — HOLD POINT ✓ RELEASED

✓ **Hold point flipped 2026-08-18, detected 2026-08-19.** Authored condition: "flips when
subagent-delegation-contract S1–S6 close — falsifier is S6's own: fresh
`npm run build && npm run verify:mcp` re-measure shows the handoff envelope carries chain history
and per-step gate text". Measured: S1 ✓ · S2 ✓ · S3 ✓ · S4 ✓ · S5 ✗ KILLED · S6 ✓, all 2026-08-18;
S6's receipt is "build + verify:mcp 17/17 + both probes re-run via streamable-http against the
fresh dist" — the falsifier verbatim. The plan's own Discovery evidence still read "all ☐", so the
condition came true and nothing noticed for a day. **The hold point had no detector, only a
retirement condition** — recorded as the reusable lesson, not as a number to correct.

| #   | St  | File                                                                      | Change                                                                                                          | ~Lines | Depends         | Verify                                                                       | Justification                |
| --- | --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | --------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| 4.1 | ✓   | server/resources/prompts/development/strategicImplement/system-message.md | Dispatch emits agentType + subagentModel on delegated nodes from execution_dispatch; judgment stays main-thread | ~8     | EXTERNAL: S1–S6 | live drive: delegated node's transcript shows gate text + prior-step context | Single-file extension of 2.1 |

**Tier 4 gate**: ✓ PASSED 2026-08-19, by SUBSTITUTION — recorded, not silently swapped. The
authored gate names the delegation plan's S-F1/S-F5 probes, which measure the `==>` handoff
envelope. Row 4.1 emits no `==>` handoff: it adds executor-hint EMISSION rules to a prompt's text,
so those probes cannot observe the files this row wrote and would have been a vacuous green. The
substituted check reads the artifact: `rg -n "subagentModel" strategicImplement/system-message.md`
confirms the emission rule is present, and the row 5.3 live drive confirms a compiled submission
carrying per-node fields is accepted and linearized. The envelope itself is already receipted by
S6's own re-measure against a fresh dist.

### Tier 5: docs, changelog, live drive

| #   | St  | File                        | Change                                                                                                                                                                   | ~Lines | Depends  | Verify                                            | Justification         |
| --- | --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- | ------------------------------------------------- | --------------------- |
| 5.1 | ✓   | docs/reference/mcp-tools.md | Refresh :243 example if arg surface changed; document workflow-compile dispatch                                                                                          | ~10    | 2.2      | docs checks per validate:all                      | Docs lockstep rule    |
| 5.2 | ✓   | CHANGELOG.md                | Entry under Changed                                                                                                                                                      | ~3     | 3.1      | —                                                 | Release record        |
| 5.3 | ✓   | (live drive, no file)       | Author a 3-row toy plan via >>implementation_plan; execute via >>strategicImplement; assert linearization equals the Depends DAG and a per-row gate fires on node 2 of 3 | 0      | 1.1, 2.1 | transcript shows workflow accepted + mid-run gate | Final-tier live drive |

**Tier 5 gate**: ✓ PASSED 2026-08-19. `npm run build` exit 0 · `npm run verify:mcp` **18/18**
(`prompts/list` 110 of 118 bound) · `npm run validate:all` **44/44 steps passed** · the 5.3 live
drive observed, receipted in §Execution record. Two earlier red steps closed rather than waived:
`validate:format` was Prettier on the four files this session touched, and
`validate:plan-row-tracking` flagged three rows whose Status cell reads ✓ but whose prose quotes a
`☐` glyph — the gate cannot tell a Status cell from a glyph mentioned in a Change description, so
the incidental mentions were reworded. That limitation is recorded, not worked around silently.

**Rules**: 1.1/1.2 parallel; 3.2/3.3/3.4 parallel after 3.1; T4 independent of T5. New files: NONE.
All prompt edits flow through resource_manager.

### Tier D: engine defects found during the 2026-08-18 delegation probes (pre-T5 blockers)

Both surfaced while probing S9 (delegation plan) and were initially "filed, not fixed" in that
plan's notes — converted to rows here under the do-or-kill rule (`cleanup-standards.md` §Do or
Kill); this plan owns chain arg resolution because T2/T5 compile rows into driven runs.

| #   | St                                                      | File                                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ~Lines | Depends | Verify                                                                                                                                                                             | Justification                                                                                                                     |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D.1 | ✓ (premise falsified 2026-08-19, then FIXED 2026-08-20) | server/src/engine/execution/parsers/symbolic-command-builder.ts (suspected; confirm producer) | **REWRITTEN — the filed mechanism was wrong.** Chain-mode arg resolution is NOT the cause; chain steps route through the same `resolveArgumentPayload` that D.2's fix corrected, and after it they receive `text:""` normally. Measured root cause: the chain executor's script resolver searches only the GLOBAL `resources/scripts/<id>/`, so a PROMPT-SCOPED tool (`resources/prompts/examples/reference_demo/tools/word_count/`) is unreachable from a chain — `ScriptNotRegisteredError: Script "word_count" not found. Searched: .../resources/scripts/word_count`. Different subsystem (script tool registry/scope), not the parser. Scope of a fix is unruled | ?      | —       | probe: `>>reference_demo --> >>reference_demo` renders with the script tool resolved                                                                                               | Symptom CHANGED after the D.2 fix: `Missing required field` → `Template rendering failed`, which is how the misdiagnosis surfaced |
| D.2 | ✓                                                       | server/src/engine/execution/parsers/symbolic-command-builder.ts                               | **FIXED 2026-08-19** (`symbolic-command-builder.ts`). Root cause was NOT "a different defaults branch": the symbolic path's empty-args short-circuit returned `collectArgumentDefaults()`, which reads author-declared `defaultValue` ONLY, while the direct path reaches ArgumentParser's fallback strategy resolving every argument down to `{value:'', empty_fallback}`. reference_demo declares NO defaultValue, so the filed framing would have produced the wrong fix. Empty args now delegate to the parser; the `!argsString.trim()` guard that would have defeated it was removed. NOT shared with D.1 — measured                                            | ~12    | —       | 5 unit tests, `tests/unit/execution/parsers/symbolic-empty-args-defaults.test.ts`; 2 mutations each kill 4/5 with the non-empty control surviving; live drive against a fresh dist | Depends on D.1 REMOVED — measured independent                                                                                     |

### Tier D execution record — 2026-08-20

Owner-authorized in the 2026-08-19 interview (R-4). Both rows closed, but only after the second
one turned out to be a different defect in a different subsystem — see R-9.

| Row | Root cause AS FILED                                         | Root cause AS MEASURED                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D.2 | "gate-token-only rawArgs takes a different defaults branch" | The symbolic empty-args short-circuit returned author `defaultValue` only, skipping the parser's `empty_fallback` tier. `reference_demo` declares NO defaultValue, so a fix aimed at the filed mechanism would have papered over one prompt |
| D.1 | "chain-mode arg resolution skips prompt argument defaults"  | Not arg resolution at all. The chain renderer never passed `promptDir`, so `WorkspaceScriptLoader` searched only the global `resources/scripts/` and could not see a prompt-scoped tool                                                     |

**Both fixes are mutation-verified, not merely green.** D.2: two mutations, each kills 4 of 5
tests while the non-empty control survives both. D.1: dropping `promptDir` reproduces exactly the
one failure. Live drive against a fresh dist, 4/4, using a predicate widened after the first
version of the probe reported a FALSE PASS on the chain case (U-5).

Adjacent defect fixed under the same authorization: `tool.yaml` under a prompt's `tools/` was
graded against the PROMPT schema on every boot, logging an ERROR for a file that is not a prompt.

**Gates**: build ✓ · verify:mcp 18/18 ✓ · typecheck ✓ · lint:ratchet ✓ · typecheck:tests:ratchet ✓ ·
test:unit 2679 passed ✓. `validate:all` reports 42/44 — the two reds are foreign and named in the
execution record below.

**Foreign reds, attributed not fixed** (a gate nobody can pass blocks every future tier, so they
are recorded rather than passed over): `validate:format` fails on
`plans/t3-thread-visibility-2026-08-19*.md`, untracked at this session's start and not mine;
`validate:plan-row-tracking` fails on three genuinely-open rows in
`plans/techincal_debt/resource-manager-settability-matrix-2026-08-13.md`, another session's plan.
Stamping another author's rows requires knowing their flip conditions, so they were left alone.

### Gate hardening landed alongside (owner-ruled 2026-08-19)

| Ruling | Change                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-5    | `validate-plan-row-tracking.js` locates a row's status by HEADER-DRIVEN column lookup, falling back to whole-row scanning when a table declares no `St` column. 5 self-tests added. The fallback earned itself immediately: the settability-matrix plan puts its glyph in cell 0 under a `#`/`Gap` header, so the positional option would have stopped grading it |
| R-6    | `notes-skeleton.py` promotes a bound `backlog` plan to `active` on the first SOURCE edit, then creates its notes in the same invocation. 4 tests; mutation-verified. `apply_status`'s "NOTHING CALLS THIS AUTOMATICALLY" note was corrected rather than left asserting something false                                                                            |
| R-8    | `executable_text()` strips heredoc BODIES before the validation-command scan, so prose quoting `npm run validate:all` is no longer recorded as a run. 3 tests; mutation-verified                                                                                                                                                                                  |

## Execution Dispatch

| Work           | Agent       | Why this tier                                                                                                 |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| T1 rows        | standard    | Bounded template edits with exact anchors; wrong-output failure shape                                         |
| T2 rows        | main thread | Decision-bearing consolidation — the ruling's edit; wrong-approach failure shape                              |
| T3 rows        | standard    | Mechanical deletion + reference sweep with rg-verifiable done condition                                       |
| T4 row         | main thread | Gated on external hold point; touches delegation semantics                                                    |
| T5 rows        | main thread | Live drive and docs lockstep are acceptance work                                                              |
| NEVER DELEGATE | main thread | Gate verdicts, tier acceptance, open-question rulings, the 5.3 live drive, `git diff main --stat` scope check |

## Open Questions

| Id  | Status                                           | Precedes | Question                                                                                                 | Default                                                                                                                                                                                                                                                                                                                                           | Alternative                                                                                                     |
| --- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| OQ1 | **RULED 2026-08-19** → implementation notes R-1  | T2       | Consolidated strategicImplement: single-shot (submits the workflow; the workflow IS the run) or a chain? | **Default adopted: single-shot.** The IR run already supplies ordered steps, stable node ids, per-node gates and resume, so a chain wrapper means two run identities and two resume tokens per piece of work; single-shot also preserves the three external anchors that document the prompt as single-shot                                       | (rejected) 2-step chain (classify/bind, then compile/submit)                                                    |
| OQ2 | **RULED 2026-08-18** → delegation plan notes R-1 | T2       | Which promptId do compiled nodes carry? IR nodes require a registered prompt; rows are arbitrary tasks.  | **Ruling supersedes both listed options**: the node carries the actual step's promptId; the executor receives a self-contained rendered brief built by server infrastructure (the resume-time brief renderer, delegation plan S1/S2/S4/S7); executor identity is advisory and not part of the contract. No generic row-executor prompt is needed. | (superseded — see plans/reference/subagent-delegation-contract-2026-08-12-implementation-notes.md §Rulings R-1) |
| OQ3 | **RULED 2026-08-19** → implementation notes R-3  | T2       | Does tier_execute §C.2 Design Enrichment survive?                                                        | **Both options were half-right; ruled as a synthesis.** `design_mode` survives with its auto-detect semantics (no silent narrowing) but compresses from a 15-line section to one routing line under step 3, because the always-loaded global CLAUDE.md already owns `BEFORE(VisualDesignDirection) → REQUIRE(>>design_muse)`                      | (folded in) drop it; route through >>design_muse at classification time                                         |

## Execution record — 2026-08-19

All of T1, T2, T3, T4 and T5 executed in one session. Rulings, deviation rows and the two open
findings live in `prompt-surface-ir-consolidation-2026-08-18-implementation-notes.md`.

**Measured vs authored**

| Assertion                          | Authored                | Measured 2026-08-19                                                                      |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| Live `tier_execute` references     | 4                       | **5** — `docs/TODO.md:94` missed; retired by new row 3.5                                 |
| Delegation S1–S6                   | all open, plan `active` | **all terminal** (5 ✓, 1 ✗ KILLED) since 2026-08-18; plan `reference`. T4 released       |
| Consolidated prompt length         | target < 160 lines      | **35 lines** — §B/§D were deleted, not merged, as the design intended                    |
| tier_execute size retired          | −216 lines              | −216 (`prompt.yaml` 56 + `user-message.md` 160)                                          |
| External anchors needing a refresh | possibly :243           | **none broke** — the id and `plan_path` both survived, so every cited example still runs |

**Rulings applied**: OQ1 single-shot (R-1) · OQ2 residual → node `promptId` is `strategicImplement`
(R-2, validated live in 5.3) · OQ3 design_mode survives as a routing line (R-3).

**Row 5.3 live drive** — `chain-strategicImplement#2`, completed 3/3:

- Nodes were submitted in declaration order `[t1-3, t1-1, t1-2]` with edges `t1-1→t1-2→t1-3`.
  Execution order was **t1-1, t1-2, t1-3**. The shuffle is what makes this discriminating — under
  a broken compile the run would have opened on t1-3.
- Node 2 of 3 rendered an Inline Gates section containing **only** `Code Quality Standards`, the
  `code-quality` id bound to `t1-2`, while node 1 rendered the full run-level set. Per-row review
  fires on its own node mid-run, which is the defect this plan set out to fix.
- `promptId: "strategicImplement"` resolved and rendered with the row's `task` — R-2 receipted
  against a real submission rather than inferred from the schema.
- Observed and NOT this plan's row: the phase guard reported `## Context` and `## Goals` missing
  from a step-3 output that contained both verbatim. Pre-existing engine behaviour, logged as U-3
  in the implementation notes rather than chased here.

## Validation & Completion (Step 5)

```
testing_strategy:
  | What to test                                       | Test type   | Location                                   | Why this type                                              |
  |----------------------------------------------------|-------------|--------------------------------------------|------------------------------------------------------------|
  | Prompt resources still load + schema advertises args| integration | npm run verify:mcp                         | Prompts are runtime-loaded resources; only a spawned server proves them |
  | Phase-guard headers unchanged                      | script gate | server/scripts/validate-phase-header-drift.js | Purpose-built for exactly this drift                     |
  | tier_execute fully removed                         | rg sweep    | Tier 3 gate command                        | cleanup-standards Test Surface Audit                       |
  | Row→node compilation correctness                   | live drive  | 5.3 toy plan                               | Linearization vs Depends is observable only in a real run  |
  | Per-node gates fire mid-run                        | live drive  | 5.3, gate on node 2/3                      | End-of-run review is the defect being fixed — observe the fix |

done_criteria:
  | Criterion                                          | Validation                          | Pass Condition                                  |
  |----------------------------------------------------|-------------------------------------|--------------------------------------------------|
  | One execution prompt                               | rg sweep (T3 gate)                  | No live tier_execute reference                   |
  | Authored plans are IR-compilable                   | 5.3 live drive                      | Workflow accepted, order matches Depends         |
  | Review is per-node                                 | 5.3 live drive                      | Gate verdict submitted mid-run, not at end       |
  | Fan-out still held                                 | T4 row stays ☐ until S1–S6 flip     | agentType absent from emitted submissions        |
  | Suite green                                        | Tier 5 gate                         | build + verify:mcp + validate:all                |

documentation:
  | Doc                          | Update Needed                                                    |
  |------------------------------|------------------------------------------------------------------|
  | docs/reference/mcp-tools.md  | Workflow-compile dispatch; refresh :243 example if args changed  |
  | CHANGELOG.md                 | Changed entry (5.2)                                              |
  | docs/reference/workflow-ir.md| None — IR schema untouched by this plan                          |

risks:
  | Risk                                                        | Impact | Mitigation                                                        | Rollback                                             |
  |-------------------------------------------------------------|--------|-------------------------------------------------------------------|------------------------------------------------------|
  | Consolidated prompt too long (dilution)                    | medium | §B/§D deleted, not merged; target < 160 lines; measure at T2 gate | Version history via resource_manager rollback        |
  | In-flight plans authored for tier_execute                  | low    | T1 shape is byte-compatible; old plans compile under new dispatch | Old plan rows still readable — Depends semantics unchanged |
  | S1–S6 never close → T4 permanent ☐                         | medium | Hold point stamped with falsifier; plan closes T1–T3+T5 without it | N/A — T4 is additive                                 |
  | OQ2 default wrong (sub_agent_step_* unfit as row executor) | medium | OQ2 ruled before T2; a spike node in 5.3 validates the choice     | Re-rule OQ2, single-file re-edit of 2.1              |

release:
  commit_convention : refactor(prompts): consolidate plan execution around workflow-IR compilation
  scope             : prompts

growth_capture:
  - [ ] Pattern: "consolidate AT the migration moment, not before" — 3rd sighting candidate for /knowledge-capture
  - [ ] Memory: update project_subagent_delegation_defect entry when T4 unblocks
  - [ ] Skill: /plan §Plan Medium may gain the row→node mapping contract once validated by 5.3
```
