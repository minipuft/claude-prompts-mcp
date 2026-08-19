---
title: "Plan-execution prompt surface — consolidate around workflow-IR compilation"
date: 2026-08-18
status: backlog
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

- `tier_execute` has **zero consumers outside its own prompt family**. Live references: 4 —
  `strategicImplement/system-message.md:10`, `implementation_plan/plan_table/prompt.yaml:6`,
  `plan_table/user-message.md:44`, `implementation_plan/system-message.md:76`. Everything else is
  `plans/reference/` history. No doc-map entry, no skills-sync registration, no test fixture.
- `strategicImplement` has external anchors that must survive: `docs/reference/mcp-tools.md:243`,
  `tooling/contracts/prompt-engine.json:36` (tool-description example),
  `tests/unit/skills-sync/gate-review-hook.test.ts:24-48` (path-segment fixture only),
  `docs/guides/skills-sync.md:142`.
- The Depends column and `execution_dispatch` table already exist in the authored shape
  (`plan_table/user-message.md:35,53`) — the dependency declaration is present; nothing compiles it.
- The overlap between the two execution prompts is precisely the part the IR absorbs. Surviving
  unique content: strategicImplement = classify/bind/route; tier_execute = §A re-measurement,
  §E vacuity-checked gate verification, §F plan writeback, §G commit boundary.
- Delegation hold point: `plans/reference/subagent-delegation-contract-2026-08-12.md` `status: active`,
  S1–S6 as `###` headings (lines 78/87/93/103/109/131), **all ☐** with as-of + flips-when stamps.
  Measured defect: `==>` handoffs carry no chain history and no gate text.

## Design (Step 2)

```
scope:
  objective     : One IR-compiling execution prompt (strategicImplement) + an authoring prompt
                  (implementation_plan) that emits rows it can compile; tier_execute retired.
  success_signal: A plan authored by >>implementation_plan executes via one prompt_engine
                  workflow submission whose linearization matches the Depends column, with
                  per-node gates firing per row; no live surface references tier_execute.
  non_goals     : No server src changes (IR schema, delegation runtime, hooks are other plans);
                  no symbolic-language changes; no skills-sync registration changes; S1–S6 work
                  itself is NOT rows of this plan.
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
  node { id:"t1-2", promptId:<row executor — OQ2>, stepName:<Change text>,
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
| 1.1 | ☐   | server/resources/prompts/planning/implementation_plan/plan_table/user-message.md | Add row→node mapping rules after :44 — row ids slug to kebab node ids (T1.2→t1-2), Depends values are row ids (= IR edges), per-row gate-id note, dispatch Agent column vocabulary | ~15    | —       | `rg -n "node id" <file>`; `node server/scripts/validate-phase-header-drift.js` | Existing file; extends rules list :44-49 |
| 1.2 | ☐   | server/resources/prompts/planning/implementation_plan/system-message.md          | Update :73-76 vocabulary — the table compiles to a workflow submission; ☐/✓/⚠/⊘ unchanged                                                                                          | ~4     | —       | `rg -n "workflow submission" <file>`; same drift script                        | Existing file                            |

**Tier 1 gate**: `cd server && npm run validate:all`; a plan authored under the new rules still
parses under CURRENT tier_execute §A (manual check against its A.3 column list).

### Tier 2: strategicImplement becomes the consolidated IR-compiling execution prompt

| #   | St  | File                                                                      | Change                                                                                                                                                                                                                                                                                  | ~Lines | Depends | Verify                                                       | Justification                        |
| --- | --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------ | ------------------------------------ |
| 2.1 | ☐   | server/resources/prompts/development/strategicImplement/system-message.md | Rewrite step 4 Dispatch (:10): compile ☐ rows → workflow submission (nodes from rows, edges from Depends, per-row inlineGateIds, tier gates run-level); NO agentType until T4; absorb tier_execute §A re-measurement, §E vacuity-checked verification, §F writeback, §G commit boundary | ~45    | 1.1     | `rg -c "tier_execute" <file>` = 0; `rg -n "workflow" <file>` | Consolidation target ruled in Design |
| 2.2 | ☐   | server/resources/prompts/development/strategicImplement/prompt.yaml       | Migrate surviving args: design_mode, autonomous_commit; update description                                                                                                                                                                                                              | ~20    | 2.1     | `npm run verify:mcp` (schema advertises new args)            | Existing yaml extended               |

**Tier 2 gate**: `cd server && npm run validate:all && npm run verify:mcp`

### Tier 3: tier_execute retirement — same PR family as T2

| #   | St  | File                                                                             | Change                                                       | ~Lines | Depends  | Verify                                                               | Justification    |
| --- | --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ | -------- | -------------------------------------------------------------------- | ---------------- |
| 3.1 | ☐   | server/resources/prompts/development/tier_execute/ (delete dir)                  | Delete via resource_manager; no alias, no breadcrumb         | -216   | 2.1, 2.2 | `rg -l "tier_execute" server/resources docs/` → only plans/reference | Removal          |
| 3.2 | ☐   | server/resources/prompts/planning/implementation_plan/plan_table/prompt.yaml     | :6 "tier_execute can drive" → name the consolidated executor | ~2     | 3.1      | `rg -c "tier_execute" <file>` = 0                                    | Reference update |
| 3.3 | ☐   | server/resources/prompts/planning/implementation_plan/plan_table/user-message.md | :44 reattribute to strategicImplement + plan-hygiene hooks   | ~2     | 3.1      | same rg                                                              | Reference update |
| 3.4 | ☐   | server/resources/prompts/planning/implementation_plan/system-message.md          | :76 "appended by tier_execute" → reattribute                 | ~1     | 3.1      | same rg                                                              | Reference update |

**Tier 3 gate**: `rg -l "tier_execute" --glob '!plans/reference/**' -g '!CHANGELOG.md'` returns
nothing; `cd server && npm run validate:all`.

### Tier 4: fan-out enablement — HOLD POINT

☐ (as of 2026-08-18 · flips when subagent-delegation-contract S1–S6 close — falsifier is S6's own:
fresh `npm run build && npm run verify:mcp` re-measure shows the handoff envelope carries chain
history and per-step gate text)

| #   | St  | File                                                                      | Change                                                                                                          | ~Lines | Depends         | Verify                                                                       | Justification                |
| --- | --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | --------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| 4.1 | ☐   | server/resources/prompts/development/strategicImplement/system-message.md | Dispatch emits agentType + subagentModel on delegated nodes from execution_dispatch; judgment stays main-thread | ~8     | EXTERNAL: S1–S6 | live drive: delegated node's transcript shows gate text + prior-step context | Single-file extension of 2.1 |

**Tier 4 gate**: the S-F1/S-F5 probes from the delegation plan re-run green against the
consolidated prompt's own submission.

### Tier 5: docs, changelog, live drive

| #   | St  | File                        | Change                                                                                                                                                                   | ~Lines | Depends  | Verify                                            | Justification         |
| --- | --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- | ------------------------------------------------- | --------------------- |
| 5.1 | ☐   | docs/reference/mcp-tools.md | Refresh :243 example if arg surface changed; document workflow-compile dispatch                                                                                          | ~10    | 2.2      | docs checks per validate:all                      | Docs lockstep rule    |
| 5.2 | ☐   | CHANGELOG.md                | Entry under Changed                                                                                                                                                      | ~3     | 3.1      | —                                                 | Release record        |
| 5.3 | ☐   | (live drive, no file)       | Author a 3-row toy plan via >>implementation_plan; execute via >>strategicImplement; assert linearization equals the Depends DAG and a per-row gate fires on node 2 of 3 | 0      | 1.1, 2.1 | transcript shows workflow accepted + mid-run gate | Final-tier live drive |

**Tier 5 gate**: `cd server && npm run build && npm run verify:mcp && npm run validate:all` PLUS
the 5.3 live drive observed — green gates alone do not close this tier.

**Rules**: 1.1/1.2 parallel; 3.2/3.3/3.4 parallel after 3.1; T4 independent of T5. New files: NONE.
All prompt edits flow through resource_manager.

### Tier D: engine defects found during the 2026-08-18 delegation probes (pre-T5 blockers)

Both surfaced while probing S9 (delegation plan) and were initially "filed, not fixed" in that
plan's notes — converted to rows here under the do-or-kill rule (`cleanup-standards.md` §Do or
Kill); this plan owns chain arg resolution because T2/T5 compile rows into driven runs.

| #   | St                                                                                                                      | File                                                                                          | Change                                                                                                                                                                                                                                                                             | ~Lines | Depends | Verify                                                                                       | Justification                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D.1 | ☐ (as of 2026-08-18 · flips when a chain step with no args renders with the prompt's argument defaults applied)         | server/src/engine/execution/parsers/symbolic-command-builder.ts (suspected; confirm producer) | Chain-mode arg resolution skips prompt argument defaults that the single-prompt path applies — `>>reference_demo` renders single (text="") but fails as a chain step (word_count "Missing required field: text"). Every prompt with a defaulted arg is a latent chain-mode failure | ~10    | —       | probe: chain of reference_demo renders without template error; unit test on builder defaults | Measured 2026-08-18: all four probe generations failed identically, gated AND control — pre-existing, prompt-independent mechanism |
| D.2 | ☐ (as of 2026-08-18 · flips when `>>reference_demo :: code-quality` (single) renders with defaults instead of erroring) | server/src/engine/execution/parsers/symbolic-command-builder.ts                               | Gate-token-only rawArgs takes a different defaults branch than empty rawArgs — single control passes text="", single gated errors "Missing required field". Same family as D.1; may share the fix                                                                                  | ~5     | D.1     | probe: single gated renders; unit test on the gate-token-only branch                         | Measured 2026-08-18 (probe-s9-single.txt)                                                                                          |

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
| OQ1 | OPEN                                             | T2       | Consolidated strategicImplement: single-shot (submits the workflow; the workflow IS the run) or a chain? | Single-shot — the IR run already provides step structure, per-node gates, resume; a chain wrapper duplicates it                                                                                                                                                                                                                                   | 2-step chain (classify/bind, then compile/submit)                                                               |
| OQ2 | **RULED 2026-08-18** → delegation plan notes R-1 | T2       | Which promptId do compiled nodes carry? IR nodes require a registered prompt; rows are arbitrary tasks.  | **Ruling supersedes both listed options**: the node carries the actual step's promptId; the executor receives a self-contained rendered brief built by server infrastructure (the resume-time brief renderer, delegation plan S1/S2/S4/S7); executor identity is advisory and not part of the contract. No generic row-executor prompt is needed. | (superseded — see plans/reference/subagent-delegation-contract-2026-08-12-implementation-notes.md §Rulings R-1) |
| OQ3 | OPEN                                             | T2       | Does tier_execute §C.2 Design Enrichment survive?                                                        | Yes, as the same conditional section (both prompts declare design_mode; silent narrowing breaks parity)                                                                                                                                                                                                                                           | Drop it; route design work through >>design_muse at classification time                                         |

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
