---
title: "Plan-execution prompt surface — consolidate around workflow-IR compilation — Implementation Notes"
plan: prompt-surface-ir-consolidation-2026-08-18.md
date: 2026-08-19
status: active
tags: []
---

# Implementation Notes

Deviations, discovered constraints, unknowns, and re-measurements found while
executing the plan. Conservative option taken, logged, work continued.

## Rulings

**R-1 — OQ1: the consolidated `strategicImplement` stays SINGLE-SHOT. RULED 2026-08-19 (default
adopted).** The IR run already supplies everything a chain wrapper would add: ordered steps, stable
node ids, per-node gates, resume via `chain_id`, and `chain_runs`/`chain_run_nodes` rows identical
to a YAML chain's (`docs/reference/workflow-ir.md` §"An accepted IR runs through the same
machinery"). A 2-step chain wrapper around a submission that is itself a run means two run
identities per execution and two resume tokens for one piece of work. Single-shot also preserves
the prompt's existing contract — `strategicImplement` is documented as single-shot in its own
description, in `docs/reference/mcp-tools.md:243`, and in the `prompt-engine.json` tool-description
example; turning it into a chain would break all three.

**R-2 — OQ2-residual: a compiled task-row node carries `promptId: strategicImplement`. RULED
2026-08-19.** OQ2 was already ruled in the delegation plan (R-1 there: "the node carries the actual
step's promptId … no generic row-executor prompt is needed"), but that ruling answers _executor
identity_, not _which registered prompt a bare file-edit row names_. The IR requires
`promptId` to resolve to a registered prompt (`workflow-ir.md` Node Schema: "Must be registered"),
and a row like "add row→node mapping rules after :44" routes through no prompt at all. Measured
alternatives:

- `sub_agent_step_define` / `sub_agent_step_delegate` — delegation **testing** fixtures
  (`prompt.yaml` descriptions say so verbatim). Unfit, exactly as the plan's risk row anticipated.
- A new generic row-executor prompt — forbidden by the ruling above and by CLAUDE.md
  §Consolidation over addition.
- `strategicImplement` itself — **chosen**. A task row IS an implementation-mode task: `task`
  (its only required arg) takes the row's Change text plus file and anchors, and `plan_path` takes
  the governing plan. No new resource, and the node's prompt is genuinely "the actual step's".

Self-reference is bounded, not recursive: step 4 Dispatch fires only when the governing plan
carries an Execution Dispatch section, and a compiled node's `task` is one row, not a plan. The
consolidated step 4 states this guard explicitly so the bound is in the text, not in an assumption.

**R-3 — OQ3: Design Enrichment survives as a ROUTING LINE, not as the 15-line `§C.2` block. RULED
2026-08-19.** Both listed options were half-right. Dropping it outright silently narrows a declared
argument (`design_mode`) that 2.2 migrates — the parity objection in the plan's default. Copying
`§C.2` across reproduces guidance the always-loaded global CLAUDE.md already owns
(`BEFORE(VisualDesignDirection) → REQUIRE(>>design_muse)`) and that the plan's own Design section
excludes from the surviving-unique list (which names only §A, §E, §F, §G). The ruling keeps the arg
and its auto-detect semantics and routes them through `>>design_muse` + the surface creative skills
in one line under step 3 Route. Parity preserved, duplication not.

## Deviations

| Id       | What the plan asserted                                                                          | What was measured (2026-08-19)                                                                                                                                                                                                                                | Action taken                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-T0-1 | "`tier_execute` … Live references: **4**" (Discovery evidence, plan:28)                         | **5.** The fifth is `docs/TODO.md:94`, a live _instruction_: "Resume with `>>tier_execute plan_file:… tier_id:\"T1.5\"`". Not history — a doc telling a future reader to invoke a prompt T3 deletes                                                           | New row **3.5** appended to Tier 3; T3 gate command widened to name it                                                                                                                    |
| DEV-T0-2 | Tier 4 HOLD POINT: "flips when subagent-delegation-contract S1–S6 close"; S1–S6 "**all open**"  | **Already flipped, 1 day before this execution.** S1 ✓, S2 ✓, S3 ✓, S4 ✓, S5 ✗ KILLED, S6 ✓ (all 2026-08-18); the delegation plan is now `status: reference`. S6's own falsifier reads "build + verify:mcp 17/17 + both probes re-run against the fresh dist" | T4 unblocked and executed in this session; hold-point stamp rewritten to record the flip and its receipt                                                                                  |
| DEV-T0-3 | (unstated) the plan is executable as authored                                                   | Frontmatter read `status: backlog`. `notes-skeleton.py` gates on `frontmatter_status(p) == "active"`, so **this file would never have been auto-created** and the Stop flush gate would not have armed                                                        | Flipped to `status: active` before the first edit. Hook-design finding — see §Unknowns                                                                                                    |
| DEV-T0-4 | T3 gate: `rg -l "tier_execute" --glob '!plans/reference/**' -g '!CHANGELOG.md'` returns nothing | Also matches `plans/phase-guard-declaration-contract-2026-08-15-implementation-notes.md:313` — an execution record, i.e. history, the same class CHANGELOG.md is exempted as                                                                                  | T3 gate command extended to exempt `plans/**-implementation-notes.md`; recorded rather than silently run                                                                                  |
| DEV-T0-5 | non_goals: "No server src changes"                                                              | Tier D (appended later) carries two `server/src/**` rows, contradicting non_goals in the same file                                                                                                                                                            | Tier D triaged separately — see §Unknowns; non_goals amended in place rather than left contradictory                                                                                      |
| DEV-T0-6 | (unstated) this session's rows land in this session's commit                                    | Row 3.5's `docs/TODO.md` edit was swept into a CONCURRENT session's commit `d17dfe1f` ("retire fifteen completed plans"), which touched the same file in the shared worktree while this work was in flight                                                    | Not undone — the change is at HEAD and correct (`git show HEAD:docs/TODO.md \| grep -c tier_execute` = 0). Attribution is wrong, the content is not. Second sighting of this failure mode |

## Unknowns / gaps found during execution

- **U-1 — the `notes-skeleton` / `backlog` gap is general, not local to this plan.** A plan is
  `status: backlog` right up to the moment someone starts executing it, and the hook that creates
  the deviation log fires on the first _source edit_ — which is after that moment. `plan_hygiene`
  already flips `backlog → active` once a row is ✓ (`lib/plan_hygiene.py:199-210`), i.e. one row
  too late to create the file that the first row's deviations belong in. Candidate fix belongs to
  the hook suite, not to this repo: arm `notes-skeleton` on `backlog` plans too, or have
  `plan-edit-tracker` flip status on the first _touch_ rather than the first ✓. Recorded here
  because it is exactly the "Deviation log has no gate" failure the hook was built to close.
- **U-2 — Tier D scope.** D.1/D.2 are `server/src/**` engine defects that contradict this plan's
  own `non_goals`. They were converted here under do-or-kill from the delegation plan's "filed, not
  fixed" findings. They are genuinely independent of T1–T5 (nothing in the prompt-surface work
  reads or writes symbolic arg resolution). Left as open rows; see the plan's Tier D note.
- **U-3 — phase guard reported two headers missing that were present.** During the row 5.3 live
  drive, the final step's output carried `## Context`, `## Analysis`, `## Goals` and `## Execution`
  as verbatim level-2 headings, and the structural review still emitted "Ensure your response
  includes the required `## Context` section" and the same for `## Goals`. Gate-independent,
  pre-existing, and outside this plan's non_goals (no server src changes for T1–T5). Not chased.
  Flips when a step output containing all four headers passes structural review with no
  improvement notice. Belongs to whichever plan owns the phase-guard evaluator.
