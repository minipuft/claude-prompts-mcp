---
title: "Phase-Guard Declaration Contract — implementation notes"
date: 2026-08-17
status: reference
plan: plans/phase-guard-declaration-contract-2026-08-15.md
tags: []
---

# Implementation Notes — Phase-Guard Declaration Contract

Sibling deviation log for `plans/phase-guard-declaration-contract-2026-08-15.md`. Deviations are
written here as they happen, not at the end. Rulings live here in full; the plan file carries only
the one-line ruling and the `RULED` status.

## Rulings

### OQ-1 — Does single-prompt execution reach stage 19?

**RULED 2026-08-17: yes. Add the second injection point (tasks 2.5/2.6).**

The plan's chosen default ("assume chain-only") was overturned by measurement. Stage 19 skips only
when `context.sessionContext?.sessionId` is absent (`19-phase-guard-verification-stage.ts:73-78`),
and `sessionContext` is created whenever `executionPlan.requiresSession`. `execution-planner.ts:427-450`
returns true for three non-chain conditions: explicit `gates` on the MCP call, a `gate` operator, or
`prompt.chainSteps`. A gated single prompt therefore receives a session, and on the verdict turn it
carries a `user_response`, so it is graded against headers it was never given — the plan's own defect
in a second path the plan did not model.

Rejected alternatives: (a) chain-only Tier 2, letting the Tier 3 advisory rule cover the single-prompt
path — correct on the invariant, but it permanently forfeits enforcement there; (b) skipping stage 19
when `strategy !== 'chain'` — deletes a live capability and depends on F2 being fixed first.

Implementation constraint recorded with the ruling: the injection is a
`declaredSectionsProvider?: () => DeclaredSection[]` constructor parameter, not a registry or config
object. `response-assembler.ts:45-53` documents the narrow function-type seam as the deliberate
convention ("the assembler needs two facts about the run, not a session store").

### OQ-2 — Guarded phases with no `section_header`

**RULED 2026-08-17: fail at framework load (tasks 3.3/3.4).**

Measured 0 of 38 guarded phases across all seven frameworks, so the state is currently unreachable and
the ruling costs nothing today. The decisive fact is F1 below: the check already exists as an ERROR at
`framework-schema.ts:251-255`, naming the phase id. The task is wiring an existing validator, not
authoring a new one.

### OQ-3 — Keep-and-gate or generate the five hand-written tables?

**RULED 2026-08-17: keep the prose, strip the numbers, gate headers only (task 4.0 before 4.1).**

The tables carry per-header guidance, a phase-id anti-pattern warning, and measured-incident notes that
generation would lose, so keep-and-gate stands. But they also restate guard _values_, and that is the
part that rots — see F3. Deleting the `Min length` and `Enforced by` columns removes the drift class
rather than detecting it, and leaves the originally-planned header-only gate correct as designed.

### OQ-4 — How does "what the prompt actually declared" become observable to stage 19?

**RULED 2026-08-17 by the operator: record the rendered header set in session state (Tier 3.1).**

Raised during execution, not in the original plan. Tier 3.1 as written was circular: it asked for a
third case where a header "absent from the declared set" becomes advisory, but `evaluatePhaseGuards`
receives only the phases parsed from `phases.yaml`, and nothing anywhere records what a render
emitted (`rg` across the execution context and chain-session types finds only an injection _toggle_).
Implementing "declared set" as `resolveDeclaredSections(frameworkId)` would make declared and guarded
identical by construction, so the advisory branch would be unreachable the day it shipped — the same
dead-code shape as F1, which this plan exists to fix.

Rejected alternatives: (a) a boolean on the execution context — real but coarse, cannot express a
partially-declared render; (c) dropping 3.1 and relying on Tier 2 completeness — leaves no runtime
guard if a fourth render path is added later.

**The cross-session concern the operator raised is answered by the schema, not by new code.**
`chain_run_nodes` is declared `ephemeral` with scope `run-owner-pid`; its rows are DELETEd per-PID at
cleanup, cleared when the owning process exits, and dropped outright by any `SCHEMA_VERSION` bump. Per-session
isolation is therefore a property of the table. Its scope travels transitively through `session_id`
to the parent `chain_runs` row, so no scope columns are added — `.claude/rules/sqlite-persistence.md`
records that adding them on the theory the contract label implies them is a mistake.

**MCP notifications were considered and rejected as the channel.** A notification is transport-level
and addressed to the connected client, not to a run; under Streamable HTTP a fresh `McpServer` is
built per request, so it would not reliably arrive. The step prompt is already the per-session
channel — it is addressed to exactly one run by construction.

Consequences for implementation: a nullable column on `chain_run_nodes` (partial population BY ROW
TYPE, the reading already established by the v21 and v23 telemetry columns), a `SCHEMA_VERSION` bump,
a `TableContract` update, and no DDL `DEFAULT` — a default would hide a dropped writer from
`validate:no-phantom-columns`, which is the one gate built to catch exactly that.

## Findings

Status vocabulary: `OPEN` (still pending, bound to a live tier row) / `ACCEPTED` (explicitly out of
scope for this plan — not pending, not fixed) / `CLOSED` (resolved).

| id  | finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | status                                                                                                                                                                                                                                                          | binds    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F1  | `validatePhasesSchema` (`framework-schema.ts:221-296`; the plan named it `validatePhasesFile` — DEV-T3-4) has no PRODUCTION caller — one hit in `src/` at HEAD, its own definition — though it does have test callers in `framework-phase-guards-schema.test.ts`, and it is absent from the barrel. (The original wording said "zero callers" across tests too, which overstated it.) `runtime-framework-loader.ts:446-462` inlines `phases.yaml` raw. Every coherence check it performs is dead code | CLOSED — wired into `RuntimeFrameworkLoader.loadFromDir` (DEV-T3-5); a caller now exists and refuses on error                                                                                                                                                   | Tier 3.3 |
| F2  | `isChainExecution()` returns true for gated single prompts — `13-session-stage.ts:112,150` sets the flag unconditionally, so `prompt-execution-pipeline.ts:489` reports `cpm.execution.mode: chain` for a single prompt.                                                                                                                                                                                                                                                                              | ACCEPTED — plan text itself scopes this out ("Out of scope to fix here" at F2's own row, and the plan body at Tier 2.5 directs "never use `isChainExecution()` to branch"); fixing the flag is a separate defect from the declaration contract this plan closes | Tier 2.5 |
| F3  | `verification/user-message.md:20` states `## Execution` min_length 80; `cageerf/phases.yaml:51` declares 100. A header-only gate would not have caught it                                                                                                                                                                                                                                                                                                                                             | CLOSED — task 4.0 deleted the `Min length` / `Enforced by` columns and the inline "≥80 chars" claim from `verification/user-message.md`, so the drifted value no longer exists to be wrong. Verified in the diff: 7 insertions / 7 deletions, prose retained    | Tier 4.0 |
| F4  | `contains_all`, `matches_pattern` and `max_length` are implemented in `phase-guard-evaluator.ts` but declared by **zero** frameworks.                                                                                                                                                                                                                                                                                                                                                                 | ACCEPTED — "Dead capability, not blocking" is the finding's own verdict; no framework has adopted these three criteria and none of this plan's tiers add one, so there is no live consumer for this plan to bind                                                | none     |

### F5 — LIVE DRIVE: the chain declaration does not reach a real chain step (CLOSED 2026-08-17 — see DEV-T2-7)

Found by the Tier 5 live drive on 2026-08-17, against a server freshly spawned from the rebuilt
`dist/` (the in-session MCP server still holds pre-rebuild code, so driving through it would have
tested the old build and reported a false pass).

| command                                                   | `Required Sections` | `Required Response Format` | headers found                                           |
| --------------------------------------------------------- | ------------------- | -------------------------- | ------------------------------------------------------- |
| `>>content_analysis text:"probe"` (single prompt)         | **yes**             | no                         | `## Context`, `## Analysis`, `## Goals`, `## Execution` |
| `>>implementation_plan feature:"probe"` (declared chain)  | no                  | **no**                     | none                                                    |
| `>>notes topic:"probe"`                                   | no                  | **no**                     | none                                                    |
| `>>content_analysis --> >>deep_analysis` (symbolic chain) | no                  | **no**                     | none                                                    |

**Tier 2.5 (single-prompt) is verified working end to end.** Tier 2.1/2.2 (chain) is not.

The decisive evidence is the second column. `Required Response Format` is emitted unconditionally by
`renderNormalStep`, and its call site is unchanged from HEAD — this tier only added a parameter to
the function it calls. Its absence therefore says `renderNormalStep` never ran, which is a
PRE-EXISTING condition and not a regression introduced here: chains render through some path other
than `ChainOperatorExecutor.renderNormalStep`. The chain render is genuinely a chain step — the
output reads "Discovery & Triage (Step 1)" — so the step is rendering, just not there.

**Consequence for this plan.** Tier 2.1/2.2 are correctly implemented and unit-tested against the
function, but the function is not on the live chain path, so the chain half of the declaration
contract is not yet delivered. The Done criterion "a CAGEERF step prompt lists the four required
headers" holds for single prompts and fails for chains.

**Why every green gate missed it.** 2616 unit tests, 17 `verify:mcp` surface checks and 39 of 41
`validate:all` steps all passed on a build where this path is unreachable. The unit tests call
`buildResponseFormatSection` directly, so they prove the function renders correctly and say nothing
about whether anything calls it. This is the `feedback_surface_check_vs_end_to_end` pattern
recurring: call the new path before believing green.

**ROOT CAUSE (diagnosed 2026-08-17, same session).** `13-session-stage` calls
`createPendingGateReviewIfNeeded` and opens a pending gate review **upfront** for chain steps
carrying blocking gates — by design, so "chains pause until gate_verdict is submitted".
`18-execution-stage.ts:50-53` then returns early with `'Pending gate review detected'`. So on a
gated chain step, `renderNormalStep` — the ONLY caller of `buildResponseFormatSection` — never
runs. The render the model actually receives is produced by `renderGateReviewStep`, which emits
neither the Required Response Format block nor any declaration.

This also explains why the missing block is not a regression: `renderNormalStep` is simply not on
the live path for gated chains, and never was.

**The generalisable lesson.** Tier 2 chose its injection point by reading which function builds the
step prompt, not by observing which function runs. Those differed, and every offline gate agreed
with the reading rather than the reality. The single-prompt half (Tier 2.5) was verified live and
works; the chain half was verified only against the function it calls.

**Fix in progress**: declare from `renderGateReviewStep` as well, reusing the existing
`resolveDeclaredSections` + `buildResponseFormatSection` rather than adding a parallel block.
Acceptance is the live drive, not the unit suite.

## Deviations

### DEV-T1-1 — `resolveDeclaredSections` takes the narrow provider shape, not `FrameworkManager`

The Interfaces block types the first parameter as `frameworkManager: FrameworkManager`. Built it
against the narrower shape the stage already uses instead: `() => { getFrameworkGuide(id):
FrameworkGuide | undefined } | undefined` (exported as `FrameworkGuideProvider`). The private
method being replaced (`19-phase-guard-verification-stage.ts:228`, pre-extraction) was already
typed this way, and its sole real caller (`pipeline-builder.ts:346`) passes `() =>
deps.frameworkManager` — `FrameworkManager` satisfies the narrow shape structurally, so nothing
about widening was needed to keep that call site working. Keeping the narrow shape means
`declared-sections.ts` cannot reach unrelated `FrameworkManager` methods through this seam, and it
avoids introducing a new dependency on the wider type into a module the plan itself scopes as
"pure lookup + join".

### DEV-T1-2 — two exported functions, not one

The Interfaces block names a single export, `resolveDeclaredSections`, returning
`DeclaredSection[]`. `19-phase-guard-verification-stage.ts:117` feeds the fetched phases straight
into `evaluatePhaseGuards(outputText, phases)`, which needs the full `ProcessingStep.guards`
object — `min_length`, `max_length`, `contains_any`, `contains_all`, `matches_pattern`,
`forbidden_terms` — not just `required` (verified `phase-guard-evaluator.ts:76-211`).
`DeclaredSection` only carries `{header, required, phaseId}`, so it cannot serve as the
evaluation-stage input without losing those checks.

Exported `resolveGuardedProcessingSteps(provider, frameworkId): ProcessingStep[]` alongside
`resolveDeclaredSections`, with the latter implemented as a pure derivation of the former (map +
filter, no independent fetch). The stage's sole call site (`:88`) now calls
`resolveGuardedProcessingSteps`; Tier 2's prompt-time declaration consumers will call
`resolveDeclaredSections`. This keeps the "one source" invariant the plan states in the Interfaces
section intact — one phase-fetch implementation, not two — rather than having the stage keep its
own thin mapping (the task's other permitted option), which would have re-created the
`service`/`defined` pre-flight failures this tier exists to fix (a second, private phase-fetch
outside the frameworks module).

### DEV-T1-3 — every tier gate in the plan is weaker than the project minimum

Tier 1 was reported complete against the plan's stated gate (`npm run typecheck && npm run test:ci`)
and **failed `lint:ratchet` on the main thread's acceptance check**: `prettier/prettier` went
baseline=0 → current=1, from the `FrameworkGuideProvider` type formatting in
`declared-sections.ts:41-42`. Fixed with `npx prettier --write` on the two new files; ratchet now
reports 3191 errors / 1016 warnings with no regressions, and `typecheck:tests:ratchet` reports 375
errors in `tests/` with no regressions.

The root cause is the plan, not the executor: the project CLAUDE.md declares the minimum suite as
`typecheck && lint:ratchet && typecheck:tests:ratchet && test:ci`, and notes that omitting
`typecheck:tests:ratchet` locally means CI fails on work that passed every gate you ran. All five
of the plan's tier gates named only two of those four. **Corrected across all tiers in the plan
file** so the remaining tiers cannot repeat it. Any brief handed to a delegated tier must quote the
full suite rather than the tier-gate line alone.

### DEV-T4-1 — Task 4.0 scoped down to 1 of the 5 listed files; the literal verify regex does not fully return empty

Measured before editing: of the 5 "declaration copies," only
`implementation_plan/verification/user-message.md` actually contained a `Min length`/`Enforced by`
table plus one inline char-count claim (the F3 drift). `system-message.md`, `plan_table/user-message.md`,
and `completion/user-message.md` restate the header VOCABULARY (backtick-inline) but never restated
a numeric guard value — nothing to strip. `examples/create_framework/user-message.md` contains the
literal string `min_length` five times (lines 220, 232, 339, 359, 471), but every occurrence is
schema documentation for the `create_framework` MCP tool's OWN Zod schema (verified against
`framework-schema.ts:50`, `:259-264`) — teaching a framework AUTHOR what the `min_length` field
means when writing a NEW framework, not restating a value this prompt's own execution is graded
against. Stripping the field name there would misdocument a real, stable API key for no drift
benefit. Task 4.0's plan-stated verify command, `rg "Min length\|min_length" server/resources/prompts/`
→ 0, is therefore **not fully satisfied**: it also matches `examples/create_gate/user-message.md`
(same shape — `min_length` is a real field of the gate-authoring schema, not listed among the 5
files at all) in addition to the surviving `create_framework` occurrences. The narrower,
semantically correct check — `validate:phase-header-drift` finding zero header-string drift, and no
`Min length`/`Enforced by` TABLE column anywhere — passes clean. Judgment: leave create_framework
and create_gate untouched rather than degrade legitimate tool-schema documentation to satisfy a
substring grep whose scope is broader than Tier 4's stated intent (OQ-3: "restated guard _values_,"
not "the field name `min_length` appearing anywhere in `resources/prompts/`"). Flagged rather than
silently claimed as passing.

### DEV-T4-2 — 4.1's discriminator gained a third rule (corroboration) the plan did not specify

The plan's two-shape split (backtick/YAML declaration vs. bare-heading-outside-a-fence) was
insufficient on first measurement: treating every bare heading INSIDE a fence as a declaration
produced ~60 false positives, because dozens of unrelated prompts (`deep_analysis`,
`pr_diff_analysis`, `scaffold_generate`, etc.) fence their own bare example headings
(`## Executive Summary`, `## Quick Start`) with no framework or phase-guard behind them at all —
fence position alone cannot distinguish "a rendered example of a graded response" from "a prompt's
own illustrative output format." Fix: a bare fenced heading is admitted as a declaration only when
the SAME file also names that exact header, unambiguously, via backtick-inline or
`marker:`/`section_header:` YAML — otherwise it is dropped. Verified both directions in
`--self-test`: an uncorroborated fenced heading never fires, and a header renamed consistently
(backtick + fence together) is still caught. Also discovered mid-build: `verification/user-message.md`'s
own RESULT block mixes shapes — `## Context` and `## Analysis` are genuinely fenced, but
`## Goals` and `## Execution` are bare headings OUTSIDE the fence in the same block (the file's own
formatting is inconsistent). The corroboration rule handles this correctly without needing to know
that distinction.

### DEV-T4-3 — bug found in the first fenced-example extractor, caught by self-test design

The capture group for a bare heading line held only the text after `## ` (e.g. `"Context"`), not
the full header (`"## Context"`), so it could never match entries in `declaredHeaders` (which store
the full string). This made every fenced-example match a guaranteed false positive before the
corroboration rework, and would have made the corroboration set-membership check silently always
fail after it (zero fenced-example findings ever, including true positives) had it shipped unfixed.
Caught by `--self-test`'s "renamed consistently" case, which requires both `inline-backtick` AND
`fenced-example` kinds to appear — a weaker self-test (checking `problems.length > 0` alone) would
have passed on the inline-backtick finding and hidden the fenced path being permanently dead.

### DEV-T2-1 — optional constructor params grouped into a `collaborators` object

`declaredSectionsProvider` as a seventh positional parameter on `ChainOperatorExecutor` breached
`max-params` (≤6), and `lint:ratchet` caught it as `max-params` warnings baseline=7 → current=8.
Measured the blast radius before choosing: 14 construction sites exist (13 in tests, 1 in
`prompt-executor.ts:679`), and **no test passes more than four positional arguments**. Grouping
`referenceResolver`, `scriptReferenceResolver` and `declaredSectionsProvider` into one optional
`collaborators` object brings the constructor to 5 params and touches exactly one production call
site, with zero test churn. A full options-object refactor of all six params was rejected as wider
than this tier authorises.

### DEV-T2-2 — the declaration resolves on `selectedFramework.id`, never `.type`

First implementation read `selectedFramework?.type`. That is wrong in a way that would have shipped
green: `FrameworkManager.getFrameworkGuide` lowercases its argument (`framework-manager.ts:478-481`),
so `type: 'CAGEERF'` resolves to `'cageerf'` by coincidence, while a framework whose discriminator is
not simply its lowercased id — `5w1h` is the live example — would resolve to nothing and declare an
empty header set. `19-phase-guard-verification-stage` resolves on `.id`
(`resolveFrameworkId`, `:215-223`). **The declaration and the guard must read the same field**, or the
prompt names different headers than the guard grades, which is this plan's own defect re-created one
layer over. Now reads `step?.frameworkContext?.selectedFramework.id`, with a debug log when no
framework id resolves so an empty declaration is observable rather than silent.

### DEV-T2-3 — declared sections render even when framework injection is suppressed

`shouldSuppressFrameworkForSteps` hides framework _guidance_; it does not disable stage 19. Rendering
the header vocabulary only when injection is enabled would leave the guard grading a step that was
never told the vocabulary — the defect, reintroduced behind a config flag. Commented at the call site.

### DEV-T4-5 — plan row 4.0 split into 4.0 (✓) + 4.0b (⊘), a new mark added for this

`validate-plan-row-tracking.js` had only two recognized marks, `✓` and `☐`. Row 4.0's own
DEV-T4-1 measurement — 1 of 5 named files actually edited, 4 correctly needed no change — has no
honest representation in that vocabulary: forcing all 5 under `✓` claims 4 edits that never
happened, and there was no open work left to mark `☐`. Added a third mark, `⊘` (U+2298, "closed —
verified, no change required") to `validate-plan-row-tracking.js`: it is exempt from rule 1's
git-tracked check (a `⊘` row deliberately names files it did not touch) and requires its own stamp,
`(verified YYYY-MM-DD · <reason>)`, under a new rule 3 (`auditClosedRows`) — mirroring rule 2's
`(as of ... · flips when ...)` requirement for `☐`, for the same reason: `⊘` is a MARKED claim like
`✓`, not an unmarked default like `☐`, so it must carry a checkable proposition.

Split row 4.0 in the plan file: `4.0` stays `✓`, scoped now to the single file that actually
changed (`verification/user-message.md`); `4.0b` is new, marked `⊘`, naming the 4 files verified
and correctly left alone, with the stamp `(verified 2026-08-17 · grep run before editing found no
Min length/Enforced by table or char-count value in any of the four — see DEV-T4-1)`. This is more
honest than editing 4.0's row content alone (which would still read as one claim covering 5 files)
and more honest than a single row wearing both marks (which would make the file-count-vs-edit-count
relationship illegible to a later reader). Attempted the `--self-test` update requested by the task
before touching the real plan — that test suite now covers: a stamped `⊘` passes, an unstamped `⊘`
is caught, a `⊘` naming an on-disk-but-untracked file does not trigger rule 1 (with and without a
co-occurring `✓` on the same line), and a `⊘` row in a `reference`/non-`active` plan is not graded.

Also updated the `system-message.md` vocabulary line ("Tier tables with a Status column (☐/✓/⚠)")
to `(☐/✓/⚠/⊘)` via MCP `resource_manager` `update`/`patch` on the `implementation_plan` prompt's
`system_message` field (manual writes under `server/resources/prompts/**` are forbidden) — the
chain that authors these plans should know the fourth mark exists, even though `⊘` is typically
applied by a human/agent reviewing a completed tier rather than emitted by `tier_execute` itself.

### DEV-T4-4 — `lint:ratchet` is currently red for a reason outside this plan

`prettier/prettier` baseline=0 → current=1 from `server/src/modules/versioning/snapshot-contract.ts`,
an **untracked file created by a concurrent session** during this work. ESLint over every file this
plan touched is clean. Left unformatted rather than editing another session's in-flight file; the
ratchet cannot go green here until that session lands or formats it.

### DEV-T2b-1 — criterion registry landed as a new tier, ahead of Tier 3

Not in the original plan. Ruled during execution in answer to "how do we make this extensible":
which criteria exist, and which are worth declaring, both change over time, so a hardcoded list in
the renderer would need editing twice for every new criterion. Only `section_header` is
structurally fixed — it is the ADDRESSING key, not a criterion (`phase-guard-evaluator.ts` returns
early when the splitter finds no section, so every criterion under a wrong header is unreachable).

Landed BEFORE Tier 3 at the operator's direction: 2b.2 restructures the same function Tier 3.1
modifies, so doing it after would have meant writing the advisory branch twice.

`phase-guard-evaluator.ts` went 266 → 172 lines and now names no criterion. The 113 pre-existing
phase-guard and chain-operator tests passed unchanged across the refactor, which is what makes it
behavior-neutral rather than merely believed to be.

### DEV-T2b-2 — negative criteria are undeclarable by TYPE, not by convention

`forbidden_terms` and `matches_pattern` state what a section must NOT contain. Declaring either
hands the model the evasion target — it describes what to avoid emitting rather than what not to
do. This matters for the intended future use of `matches_pattern` as a sensitive-data check (F4
records that all three unused criteria are currently dead capability).

Enforced with `declare?: never` on `NegativeCriterion`, so a negative entry that tries to declare
itself fails to compile. A convention would have been a review comment; this is a build error.
`phase-guard-criteria.test.ts` asserts the runtime half of the same invariant.

### DEV-T4-6 — the ⊘ mark was verified on the main thread after its agent stopped without reporting

The subagent adding `⊘` (closed — verified, no change required) stopped with no completion record.
Its work had in fact landed, so it was verified here rather than re-run: 26 self-tests pass,
including the four required cases and two edge cases that were not specified — a row carrying BOTH
`✓` and `⊘`, and half-stamps (a date with no reason, a reason with no date). `validate:plan-row-tracking`
now reports `⊘` rows as a separate count. Plan row 4.0 was split into `4.0 ✓` (the one file that
actually restated a guard value) and `4.0b ⊘` (the four investigated and correctly left alone).

**Do not read a stopped agent as a failed agent.** Check the working tree before re-dispatching;
this one was complete.

### DEV-T3-1 — Tier 3.1 landed as a recorded declaration, spanning 7 files

The plan's row named one file (`phase-guard-evaluator.ts:96`) and one change ("third case beside
required/optional"). What OQ-4 actually requires is a fact that did not previously exist anywhere,
so the change spans the write path, the store, and the read path:

| file                                          | change                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `infra/database/sqlite-engine.ts`             | `SCHEMA_VERSION` 23 → 24; `chain_run_nodes.declared_sections_json TEXT`                    |
| `infra/database/table-contracts.ts`           | column documented under the v23 provenance note                                            |
| `shared/types/chain-execution.ts`             | `StepMetadata.declaredSections?: string[]`                                                 |
| `shared/types/chain-session.ts`               | `setStepState` gains an optional 5th parameter                                             |
| `modules/chains/manager.ts`                   | `setStepState` carries the declaration forward across milestones, sticky like `renderedAt` |
| `modules/chains/run-registry.ts`              | INSERT + SELECT + a tolerant `parseDeclaredSections`                                       |
| `operators/chain-operator-executor.ts`        | render result reports the headers it emitted                                               |
| `stages/18-execution-stage.ts`                | records them against the node id minted on the step just rendered                          |
| `stages/19-phase-guard-verification-stage.ts` | partitions phases into blocking vs advisory                                                |

Note the evaluator itself was NOT modified. The filter belongs in the stage, not the evaluator: the
evaluator's job is to grade a section against its guards, and which phases are eligible to block is
an orchestration decision the stage already owns. Putting it in the evaluator would have pushed a
session-state read into a pure function.

**One writer, deliberately.** An earlier draft also threaded `declaredSections` through
`manager.updateSessionState`'s free-form metadata bag, which typechecked but created a second write
path for one column. Removed — `18-execution-stage` records it at render, which is the only moment
the fact exists, and `setStepState` carries it forward from there.

**No record blocks nothing.** A run with no recorded declaration is treated as having declared
nothing, not as having declared everything. That direction is forced by the plan's own risk row —
the change may only make blocking rarer — and it means the fallback can never resurrect the defect.

### DEV-T3-2 — the existing phase-guard suite had to declare before it could keep asserting

Six of the suite's tests failed the moment 3.1 landed, all for the same reason: their fixtures never
recorded a declaration, so under the new rule nothing was eligible to block. That is the behavior
change working, not a regression — but left alone it would have silently deleted the suite's
enforcement coverage while staying green.

`createMockSessionStore` now takes the headers the run declared, and `beforeEach` declares the four
CAGEERF headers the fixtures use, so every pre-existing assertion tests what it was written to test.
Three directional tests were added on top: an undeclared header warns and does not block, a run with
no record blocks nothing, and — the one that must fail if the advisory filter is ever widened by
accident — a declared-and-missing section still blocks.

### DEV-T3-3 — a real bug caught by the fixtures, not by types

First implementation read `session?.state.stepStates`, which guards only `session`. `state` is
non-optional on the type, so this compiled; ten tests then failed on `Cannot read properties of
undefined`. Partial test doubles and a session restored before hydration both produce a session
with no `state`. Reading defensively is correct here regardless of what the type promises.

### DEV-T3-4 — F1 named the wrong function; the wiring target is `validatePhasesSchema`

The plan and F1 both name the zero-caller function `validatePhasesFile` at
`framework-schema.ts:213-230`. No function of that name exists or ever existed in that file
(`rg "validatePhasesFile" src/ tests/ tooling/ scripts/` → 0 hits, checked before writing any
code). The function matching F1's description — phases.yaml Zod validation, zero callers, absent
from the barrel, and the guards-without-`section_header` ERROR at what is now line 253 — is
`validatePhasesSchema`, exported at `framework-schema.ts:221`. Treated as the intended target:
every other fact in F1 (zero callers, dead coherence checks, the specific error text) matches this
function exactly, and no second dead validator exists in the file. Wired `validatePhasesSchema`,
not a new function.

Two consequences: `runtime-framework-loader.ts` already imports `validateFrameworkSchema` (the
top-level `framework.yaml` validator, a different function) from the same module — the plan's
implicit premise that only one validator existed there was wrong, and the naming collision between
`validateFrameworkSchema`/`validatePhasesSchema`/`validatePhasesFile` is itself worth flagging for
a future rename pass. Not undertaken here — out of scope for a wiring task, and renaming an
exported function this plan does not otherwise touch would widen the diff for no behavioral gain.

### DEV-T3-5 — wiring point, error/warning posture, and the no-console ratchet cost

Wired in `RuntimeFrameworkLoader.loadFromDir` (`runtime-framework-loader.ts`), immediately after
the existing `validateDefinition`/`validateFrameworkSchema` call and inside the same
`if (this.validateOnLoad)` block — the same place `inlineReferencedFiles` already sets
`definition.phases`, so no second read of the file is needed. Guarded on `if (definition.phases)`
so frameworks with no `phasesFile` (none of the 8 bundled directories, but a valid shape per the
schema) are not penalized for having nothing to validate. A private `validatePhases()` wrapper
mirrors the existing `validateDefinition()` method for symmetry.

Posture matches the sibling `validateDefinition` check exactly: `errors` increment `loadErrors` and
return `undefined` (framework refused, `console.error` names the phase and the specific coherence
failure — e.g. "guards but no section_header" already includes the phase id via
`validatePhasesSchema`'s own message format); `warnings` are `console.warn`-logged and do not block.
No new error-handling shape was introduced.

**Pre-wiring measurement, not just post-wiring assertion.** Before touching the loader, checked all
8 bundled `phases.yaml` files (the 7 the plan names plus `verify`, which has a `phasesFile` but
declares no `guards`) directly against the three dormant checks: zero duplicate `order` values,
zero steps where `section_header` and `guards` disagree in presence (so the header-without-guards
warning cannot fire either), and `max_length` is not set by any bundled framework at all (so
`min_length > max_length` cannot fire structurally, not just by coincidence of current values).
This is why 3.4 measured zero risk before wiring, not merely zero failures after.

**Ratchet cost of the two new log calls.** The two new `console.error`/`console.warn` call sites
pushed `no-console` warnings baseline=74 → current=76 on first `lint:ratchet` run — a real
regression, not a pre-existing one, because this file already carries the no-console warning on
every existing log line (matching its own established stderr-logging convention, not a rule this
plan should relitigate for the whole file). Suppressed only the two new call sites with
`// eslint-disable-next-line no-console` rather than reworking the file's dozen pre-existing
console calls, which is out of scope. First attempt at the suppression comment split the reason
onto a second `//` line, which made `eslint-disable-next-line` disable the _comment_ line instead
of the `console.error`/`console.warn` line beneath it — caught by `lint:ratchet` reporting a new
`Unused eslint-disable directive` warning alongside the still-unsuppressed `no-console` warning.
Fixed by keeping the directive and its reason on one line. `lint:ratchet` reports
`OK: 3175 errors, 1008 warnings (no regressions)` after the fix — a different total than
DEV-T1-3's and DEV-T4-4's numbers because the concurrent session's `snapshot-contract.ts`
formatting issue that made DEV-T4-4's run red had already been resolved by the time this tier ran;
re-measured fresh rather than assumed red per the project's ratchet-slack guidance.

**Unrelated ratchet/typecheck findings, not touched.** `typecheck:tests:ratchet` reported one
pre-existing failure, `tests/unit/execution/formatting/response-assembler-declared-sections.test.ts`
(baseline=0 current=1) — an untracked file from a concurrent session's Tier 2.5/2.6 work, not
created or edited by this tier. Confirmed via `git status --porcelain` and a direct
`npx tsc --noEmit --project tsconfig.test.json` grep that neither file this tier touched appears in
that error. Left alone, same posture as DEV-T4-4.

### DEV-T6-1 — the declared-but-never-consumed family, consolidated rather than extended by one more script

Follow-up to F5, ruled by the operator: expand the EXISTING gates rather than add a fourth. The
repo had already built this gate twice without naming the family:

| layer    | gate                                       | catches                                       |
| -------- | ------------------------------------------ | --------------------------------------------- |
| database | `validate:no-phantom-columns`              | a column declared and indexed, with no writer |
| types    | `validate:state-field-writers`             | an optional field with readers and no writer  |
| modules  | `validate:knip-ratchet` (added this round) | an export declared and never imported         |

Both existing docblocks now carry the family table and point at each other, so a new instance of
the shape lands in the member that owns its layer instead of a fourth script.

**Coverage added, no new gate.** `validate:state-field-writers` has a `WATCHED` registry, so the
extension was three entries, not code: `StepMetadata` (the v24 persistence record — a field
declared here with no writer is a column reading NULL on every row), `ChainStepRenderResult`, and
`ChainOperatorCollaborators`. Watched interfaces went 6 → 9, optional fields under watch to 93.

**`ChainOperatorCollaborators` had to be given a name to be checkable.** It was an inline type
literal on a constructor parameter, and the gate resolves symbols from named interface
declarations — an anonymous literal is invisible to it. Extracting it is the substantive half of
this change: the repo carries **24 optional constructor dependencies across 16 files**, all
defaulting to no-op, which is a deliberate convention whose cost is that an unwired seam compiles,
passes every test, and silently keeps the old behavior. Only the named ones can ever be gated.

**Back-tested, not assumed.** A seeded `seededPhantomSeam?` with a reader and no writer was added
to `ChainOperatorCollaborators`; the gate flagged it by name with its declaration site, and the
file was restored to 0 findings. A gate that has never fired is not evidence.

**What this family still does NOT catch, stated plainly.** Runtime unreachability — code wired,
imported and written, sitting on a branch the live path never takes. That is exactly F5, and no
static gate here would have caught it. It is covered instead by the `reached` probe added to
`~/.claude/rules/refactoring.md` under `WHEN(new_capability)`, and by `testing.md`'s existing
integration-first rule. Recording the boundary so this family is not mistaken for insurance
against the defect that motivated it.

## Validation ledger

| tier    | command                                                           | result                                                                                                                                                                                                                                                                                                                                                                                                                                           | date       |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1       | `npm run typecheck`                                               | pass                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-08-17 |
| 1       | `npm run test:ci`                                                 | pass — 196 suites, 2586 passed / 1 skipped                                                                                                                                                                                                                                                                                                                                                                                                       | 2026-08-17 |
| 1       | `git diff --stat -- server/resources/prompts/`                    | empty — zero prompt-text diff                                                                                                                                                                                                                                                                                                                                                                                                                    | 2026-08-17 |
| 1       | `npm run lint:ratchet`                                            | FAIL then pass — see DEV-T1-3                                                                                                                                                                                                                                                                                                                                                                                                                    | 2026-08-17 |
| 1       | `npm run typecheck:tests:ratchet`                                 | pass — 375 errors in `tests/`, no regressions                                                                                                                                                                                                                                                                                                                                                                                                    | 2026-08-17 |
| 4       | `node scripts/validate-phase-header-drift.js --self-test`         | pass — 8/8 cases                                                                                                                                                                                                                                                                                                                                                                                                                                 | 2026-08-17 |
| 4       | `node scripts/validate-phase-header-drift.js` (live)              | pass — 183 prompt files, 44 declared headers                                                                                                                                                                                                                                                                                                                                                                                                     | 2026-08-17 |
| 4       | `npm run validate:suite-membership`                               | pass — new step wired, substrate matches derivation                                                                                                                                                                                                                                                                                                                                                                                              | 2026-08-17 |
| 4       | `npm run validate:all`                                            | 3 pre-existing failures unrelated to Tier 4 (`lint:ratchet` max-params from Tier 2's `chain-operator-executor.ts`, `validate:format` on `plans/subagent-delegation-contract-2026-08-12.md`, `validate:plan-row-tracking` on Tier 2/3/5 rows this agent does not own) — `validate:phase-header-drift` itself passes                                                                                                                               | 2026-08-17 |
| 3.3-3.4 | `npm run typecheck`                                               | pass — clean, no errors                                                                                                                                                                                                                                                                                                                                                                                                                          | 2026-08-17 |
| 3.3-3.4 | `npm run lint:ratchet`                                            | FAIL (no-console +2) then pass — see DEV-T3-5; `OK: 3175 errors, 1008 warnings (no regressions)`                                                                                                                                                                                                                                                                                                                                                 | 2026-08-17 |
| 3.3-3.4 | `npm run typecheck:tests:ratchet`                                 | reports 1 pre-existing failure in a concurrent session's untracked file, not this tier's — see DEV-T3-5; zero errors in either file this tier touched                                                                                                                                                                                                                                                                                            | 2026-08-17 |
| 3.3-3.4 | `npm run test:ci`                                                 | pass — 198 suites, 2616 passed / 1 skipped                                                                                                                                                                                                                                                                                                                                                                                                       | 2026-08-17 |
| 3.4     | `npx jest --testPathPatterns yaml-framework-loading`              | pass — 10/10, including the seeded refusal test and the all-8-bundled-frameworks regression test                                                                                                                                                                                                                                                                                                                                                 | 2026-08-17 |
| 2.3-2.6 | `npm run typecheck`                                               | pass — clean                                                                                                                                                                                                                                                                                                                                                                                                                                     | 2026-08-17 |
| 2.3-2.6 | `npm run lint:ratchet`                                            | pass — `OK: 3175 errors, 1008 warnings (no regressions)`, per-rule against `.eslint-ratchet-baseline.json`                                                                                                                                                                                                                                                                                                                                       | 2026-08-17 |
| 2.3-2.6 | `npm run typecheck:tests:ratchet`                                 | FAIL (baseline=0 current=1 on the new test file) then pass — see DEV-T2-6; `OK: 374 errors in tests/ (no regressions)` after the fix                                                                                                                                                                                                                                                                                                             | 2026-08-17 |
| 2.3-2.6 | `npm run test:ci`                                                 | pass — 198 suites, 2616 passed / 1 skipped                                                                                                                                                                                                                                                                                                                                                                                                       | 2026-08-17 |
| 5       | `npm run validate:all`                                            | 2 pre-existing failures unrelated to Tier 5 (`validate:format` on `docs/reference/mcp-tools.md` + `plans/subagent-delegation-contract-2026-08-12.md`; `validate:no-legacy-sidecars` on `server/src/cli-shared/version-history.ts:671`) — all three already modified in this session's initial `git status`, none under this tier's scope; `validate:phase-header-drift` and `validate:plan-row-tracking` both pass against the 5.1/5.2 row edits | 2026-08-17 |
| 5       | `npm run test:ci`                                                 | pass — 198 suites, 2616 passed / 1 skipped                                                                                                                                                                                                                                                                                                                                                                                                       | 2026-08-17 |
| 5       | `npx prettier --check` (all Tier 5 touched files, from `server/`) | pass — `docs/guides/gates.md`, `docs/guides/phase-guards.md`, `plans/phase-guard-declaration-contract-2026-08-15.md`, its implementation-notes sibling, and `CHANGELOG.md` (after DEV-T5-3's revert) all format-clean                                                                                                                                                                                                                            | 2026-08-17 |

### DEV-T2-4 — measured (not estimated) token delta for the declared-sections block

Task 2.4 requires a MEASURED number, not a char/4-style estimate. No tokenizer is a project
dependency (`grep -i "tiktoken\|tokenizer" package.json` → 0 hits). Installed
`@anthropic-ai/tokenizer` (Anthropic's own package) with `npm install --no-save` inside the
session scratchpad — never touching `server/package.json` or its lockfile — and fed it the exact
rendered "Required Sections" block text `buildDeclaredSectionsBlock`/`buildResponseFormatSection`
both produce for CAGEERF's four required phases (`## Context`, `## Analysis`, `## Goals`,
`## Execution`, each with `criteria: []` because CAGEERF's guards configure only `min_length`,
deliberately undeclared per the Tier 2b table, and `forbidden_terms`, a negative criterion that can
never declare).

**Result: 53 tokens for the block alone, 55 tokens including the leading `\n\n` join separator**
both `formatSinglePromptResponse` and `formatChainResponse` use when composing sections. This is
per rendered step/response that reaches stage 19 under a 4-required-phase framework — it is not
multiplied by chain length beyond one occurrence per step, since each step's own prompt carries its
own copy (matching the pre-existing chain-path cost `buildResponseFormatSection` already spent
before this tier; Tier 2.5 adds the identical cost to the previously-uncovered gated-single-prompt
path only).

### DEV-T2-5 — response-assembler needed no `collaborators` object; gating discriminator is session presence, not `executionPlan.strategy`

The chain path (DEV-T2-1) grouped `declaredSectionsProvider` into an optional `collaborators`
object because `ChainOperatorExecutor`'s constructor already had 6 positional parameters and a
7th breached `max-params`. `ResponseAssembler` had exactly ONE existing optional parameter
(`runStepViewProvider`); adding `declaredSectionsProvider` as a second positional parameter brings
it to 2, nowhere near the `≤6` limit, so introducing an object wrapper here would have been
unforced ceremony copied from a constraint that does not apply to this class.

The plan text for 2.5 says "Branch on `executionPlan.strategy`, never `isChainExecution()`". Read
literally as an in-method conditional, this doesn't fit `formatSinglePromptResponse`:
`21-formatting-stage.ts:103-114` already only invokes this method for a non-chain-shaped
`formatterContext` (or as a fallback when a chain-shaped context has no session), so a `strategy`
check inside it would be redundant with the call site's own dispatch. The actual per-execution
question 2.6 asks for — gated vs. ungated single prompt — is answered by
`context.sessionContext?.sessionId` presence, which is exactly the fact
`execution-planner.ts:427-450`/`19-phase-guard-verification-stage.ts:73-78` already use to decide
whether stage 19 runs at all. `resolveDeclaredSections()` gates on that, and separately never reads
`context.sessionContext?.isChainExecution` (F2's flag), which is what "never `isChainExecution()`"
actually forbids: that boolean is `true` for gated single prompts too (F2), so using it to decide
"is this NOT a chain, therefore should I declare" would silently skip the declaration for exactly
the case OQ-1 exists to fix — the same defect one layer over. Verified directly:
`response-assembler-declared-sections.test.ts` sets `sessionContext.isChainExecution: true` on its
gated fixture (mirroring F2) and still asserts the block renders.

### DEV-T5-1 — 5.1 split across `gates.md` (plan-named target) and `phase-guards.md` (better information placement)

The plan row named `docs/guides/gates.md` as the sole target. Reading both guides before drafting
(`docs/guides/phase-guards.md` also exists) showed `phase-guards.md` is the dedicated guide for
exactly this subsystem — it already documents `section_header`, `guards`, the per-field rule table,
and coherence requirements in the same depth this contract needs. `gates.md` is the broader survey
of all gate types (criteria, shell, judge) and already deferred to `phase-guards.md` via a `[!NOTE]`
for `framework_compliance` before this change.

Placed the full mechanism — the `declared-sections.ts` single-source diagram, the gated-single-prompt
path, the criteria declarability table, the "may only block on a declared header" rule, the
load-refusal behavior, and the drift gate — as a new `## Declared Sections` section in
`phase-guards.md`, between "Coherence Requirements" and "Enforcement Modes". Added a short pointer
subsection to `gates.md` (`### Declared Headers — A Guard Cannot Block on What the Prompt Never
Said`) that satisfies the plan's literal ask for `gates.md` to describe the contract, links to the
full section, and updates the "Enforce required framework sections" row of the existing "Choosing an
Enforcement Mode" table to reflect the new behavior. Added `phase-guards.md` to `gates.md`'s "See
Also" list, which previously omitted it despite the existing NOTE cross-reference.

**Also fixed, while already editing these two files**: both guides referred to the grading stage as
"Stage 09b" (3 occurrences across the two files — `phase-guards.md:7,96`, `gates.md:13,333`). The
actual file is `19-phase-guard-verification-stage.ts` (confirmed against
`server/src/engine/execution/pipeline/stages/`, which numbers 01 through 22 with no `09b`). This is
a pre-existing, unrelated documentation drift, but leaving an inaccurate stage number beside newly
written accurate content in the same file would be a self-contradiction I introduced knowingly.
Also updated `phase-guards.md`'s Requirements item 4, which said phase guards validate only
"chain step responses" — inaccurate since the OQ-1 ruling (Tier 2.5/2.6): a gated single prompt
reaches Stage 19 the same way.

**Not fixed, out of scope**: `docs/architecture/overview.md:495,499` carries the same "Stage 09b"
reference and is not touched by this tier — it is a different document, not part of the plan's named
5.1 targets, and correcting it belongs to whoever owns that doc's next edit rather than to a
documentation-only tier scoped to `gates.md`/`phase-guards.md`.

### DEV-T5-2 — CHANGELOG split across `Added` and `Fixed`, against the plan's single-`Fixed` proposal

The plan's Release section states `Changelog section: Fixed`, matching its `fix(frameworks): …`
commit-convention line. The task explicitly asked for independent judgment rather than the plan's
literal default, given that the shipped diff includes a whole new module
(`engine/frameworks/declared-sections.ts`), a new criteria registry
(`phase-guards/criteria.ts`) with a declarability split, new load-time framework validation, new
per-node persistence (schema v24), and a new CI gate — substantially more than a `Fixed` entry alone
communicates to a reader.

Applied the changelog-generator skill's Ambiguous Cases guidance ("bug fix that also improves
X → primary intent decides the section", generalized to "capability + defect repair → both
sections, cross-reference"): wrote an `Added` entry for the new declared-header capability
(criteria declarability table, load-time refusal, drift gate) and a separate `Fixed` entry for the
specific defect this plan's own reproduction demonstrated — a guard blocking on a header the render
never declared, reproduced live on this repository's own `>>implementation_plan` chain. Both entries
are user/self-hoster-observable: prompt render shape changed (Added) and a previously-possible
unsatisfiable review loop is now impossible (Fixed).

**Placement of the `[Unreleased]` heading itself**: the file had no `[Unreleased]` section positioned
above the newest release. `## [Unreleased]` (line ~224 pre-edit) exists in the file, but sits
**below** `## [4.0.0]` (2026-08-15) and above `## [3.2.1]` (2026-08-07) — chronologically impossible
for a genuinely-unreleased section, and its content (version-history/rollback fixes) reads as
pre-4.0.0 work that was never swept into a release heading before 4.0.0 shipped. This matches a
pattern the changelog's own history names explicitly (`* remove orphaned [Unreleased] section from
pre-v2.0.0 changelog`, visible elsewhere in this file) — an orphaned, already-superseded `Unreleased`
block. **Flagged, not fixed**: reconciling it means deciding whether that content already shipped
under a later version heading or was genuinely dropped, which is a judgment call outside this tier's
scope (`docs/guides/gates.md` + `CHANGELOG.md` Unreleased entry only) and risks conflicting with
whoever owns changelog hygiene next. Added a new, correctly-positioned `## [Unreleased]` section
directly above `## [4.0.1]` (the newest release) instead, per Keep a Changelog convention and where
Release Please's next release PR will look.

### DEV-T5-3 — `npx prettier --write` from `server/` cwd reformatted the generator-owned CHANGELOG.md; reverted

Ran `npx prettier --write` on all touched Markdown from the `server/` working directory (matching
the task brief's literal command), passing `../CHANGELOG.md` as one of the targets. Prettier resolves
`.prettierignore` relative to its cwd, so this read `server/.prettierignore` (which does not list
`CHANGELOG.md`) instead of the root `.prettierignore`, which explicitly excludes it: `CHANGELOG.md`
is release-please-owned, and the root ignore file's own comment names the exact failure mode this
would have caused ("Formatting these is not ours to own: the bot rewrites them on every release, so
any reformat would be reverted on the next run", and a required-check failure precedent at PR #112).
The write reformatted the entire 960-line file — commit-list bullets `*` → `-`, added blank lines
between grouped entries — a 263-line diff for what should have been a 10-line addition.

Caught by re-running `validate:all`, which showed `validate:format` newly failing only on
`CHANGELOG.md` alongside two genuinely-unrelated pre-existing failures (see below); the original
`validate:format` run (before the fix) had NOT flagged `CHANGELOG.md` at all, which was the tell that
my own edit had put it in a state the root ignore rule was never supposed to let happen.

**Fix**: `git show HEAD:CHANGELOG.md > CHANGELOG.md` to restore the file to its last-committed
content (a working-tree file write via `git show`, not an index/HEAD-mutating command — the hard
constraint against `checkout`/`stash`/etc. was not touched), then re-applied only the `[Unreleased]`
insertion by hand via `Edit`, matching the file's own hand-written-entry convention (`-` bullets, one
blank line between entries) rather than Prettier's. Re-verified: `git diff --stat -- CHANGELOG.md`
now shows exactly 10 lines inserted, and `npx prettier --check` against it (from `server/`, matching
CI's own invocation via `validate:format`'s `xargs npx --prefix server prettier --check`) now reports
nothing — confirming `validate:format` was already correctly excluding it and my fix restored that.

**Lesson for future prettier invocations from `server/` against root-level files**: pass
`--ignore-path ../.prettierignore` explicitly, or run from the repo root, rather than relying on cwd
resolution when the target path crosses the `server/`/root boundary — `server/.prettierignore` and
root `.prettierignore` protect different generator-owned files and are not interchangeable.

**Remaining `validate:format` failures are unrelated and pre-existing**: `docs/reference/mcp-tools.md`
and `plans/subagent-delegation-contract-2026-08-12.md` were already listed as modified in this
session's initial `git status` (before any Tier 5 edit) and are not under `docs/guides/` or
`CHANGELOG.md` — consistent with a concurrent session's in-flight work, same posture as DEV-T4-4 and
DEV-T3-5's "concurrent session" findings. Left untouched. `validate:no-legacy-sidecars` also fails,
on `server/src/cli-shared/version-history.ts:671` — a file under `server/src/**`, explicitly out of
this tier's scope, and also already modified in the initial `git status`.

### DEV-T2-6 — `jest.fn(() => [...])` inferred a zero-arg mock, breaking `toHaveBeenCalledWith`

First draft of `response-assembler-declared-sections.test.ts` wrote
`jest.fn(() => [] as DeclaredSection[])` for a provider fixture, matching the surrounding tests'
terse style. TypeScript inferred the mock as `() => DeclaredSection[]` (zero parameters) from the
callback's own signature rather than from `ResponseAssembler`'s `(frameworkId: string) => ...`
constructor parameter type, so `expect(provider).toHaveBeenCalledWith('plain-framework')` failed to
typecheck ("Expected 0 arguments, but got 1"). Caught by `typecheck:tests:ratchet`
(baseline=0 current=1 on the new file — the failure a concurrent Tier 3.3-3.4 session's own
implementation notes correctly attributed to "a concurrent session's Tier 2.5/2.6 work" and
correctly left untouched). Fixed by naming the parameter explicitly:
`jest.fn((_frameworkId: string) => [] as DeclaredSection[])`. Re-run:
`OK: 374 errors in tests/ (no regressions)`.

### DEV-T2-7 — F5 fix: declare from `renderGateReviewStep`, reusing `resolveDeclaredSections` + `buildResponseFormatSection`

**Confirmed the diagnosis before editing.** Read `13-session-stage.ts` (`createPendingGateReviewIfNeeded`
opens the pending review upfront for a chain step carrying a blocking gate) and
`18-execution-stage.ts:50-53` (returns early with `'Pending gate review detected'` once a pending
review exists), then read `chain-operator-executor.ts` end to end: `renderNormalStep` at `:493` is
the sole call site of `buildResponseFormatSection` on HEAD, and `renderGateReviewStep` assembles its
`contentParts` from `frameworkGuidance` / `reviewPrompt` / `gateGuidance` / `supplementalSections`
only — no declaration call anywhere in that function. This matches F5's root-cause paragraph
verbatim; nothing needed re-deriving.

**Fix**: added a `responseFormatSection` computed in `renderGateReviewStep` via the SAME two private
helpers `renderNormalStep` already uses — `this.resolveDeclaredSections(targetStep)` then
`this.buildResponseFormatSection(isTargetFinalStep, gateGuidanceEnabled, declaredSections)` — and
appended it to `contentParts` (`chain-operator-executor.ts`, inside `renderGateReviewStep`, ~30 new
lines). No second lookup, no parallel block, no new file.

**Placement decisions, both derived from values already in scope rather than introduced**:

- `isFinalStep` parameter: reused `targetIndex === stepPrompts.length - 1` — `targetIndex` is the
  index of the step actually being reviewed (already resolved a few lines above for P5
  visibility), giving the same "is this the chain's last step" semantics `renderNormalStep` computes
  from `currentStepIndex === totalSteps - 1`. No second definition of "final" was created.
- `gateGuidanceEnabled` parameter: reused the flag already computed at the top of the function
  (`this.isGateGuidanceEnabled(chainContext)`) rather than re-deriving it — this also means the
  gate review's "Gate Coverage" scaffold line mirrors what `renderNormalStep` already shows
  alongside its own separate `step.metadata['gateInstructions']` content, so no new duplication
  pattern was introduced; the same two-layers-of-gate-text shape already existed for normal steps.

**Retry decision — declare on EVERY gate-review render, not only the first.** Deliberately does
NOT mirror the `!isRetry` gate that already exists a few lines above on `frameworkGuidance` in the
same function. `frameworkGuidance` is skipped on retry because the model already saw it once;
declared-section headers are the opposite case — a retry exists precisely because a prior attempt
failed a structural check (a declared header missing or malformed), so the retry turn is exactly
when the model most needs the vocabulary restated. Suppressing it on retry would produce the
scenario named in the task: a step told to fix its structure without being told the structure.
Encoded as: no `isRetry` guard around the new `responseFormatSection` computation at all — it runs
unconditionally whenever a `targetStep` resolves, matching the existing comment on the
`renderNormalStep` call site ("declared section headers are resolved even when framework INJECTION
is suppressed").

**Regression tests added** (`tests/unit/execution/operators/chain-operator-executor.test.ts`, new
nested `describe('gate review render (F5 …)')` inside the existing `'declared section headers'`
block, 3 tests, +159 lines total in the file): first-render declaration, retry-still-declares
(`attemptCount: 1`), and no-provider-wired declares nothing (mirrors the pre-existing normal-step
regression test at the same describe level). `NODE_OPTIONS="--experimental-vm-modules" npx jest
--runInBand tests/unit/execution/operators/chain-operator-executor.test.ts` → 23/23 passed.

**Live drive is the acceptance proof, not the unit suite** (per F5's own closing line and the
task's framing). Ran `npm run build`, then spawned a fresh server from the rebuilt `dist/` four
times:

| command                                                             | Required Sections | Required Response Format                                                                   | headers found                                           |
| ------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `>>implementation_plan feature:"probe"` (declared chain)            | **yes**           | **yes**                                                                                    | `## Context`, `## Analysis`, `## Goals`, `## Execution` |
| `>>notes topic:"probe"`                                             | **yes**           | **yes**                                                                                    | `## Context`, `## Analysis`, `## Goals`, `## Execution` |
| `>>content_analysis --> >>deep_analysis` (symbolic chain)           | **yes**           | **yes**                                                                                    | `## Context`, `## Analysis`, `## Goals`, `## Execution` |
| `>>content_analysis text:"probe"` (single prompt, regression check) | **yes**           | no (unchanged — this path never went through `renderGateReviewStep` or `renderNormalStep`) | `## Context`, `## Analysis`, `## Goals`, `## Execution` |

All three chain commands F5 originally reported as failing now declare the full header vocabulary;
the Tier 2.5 single-prompt path is unaffected (unchanged output shape, still passes).

**Validation**: `npm run typecheck` clean · `npm run lint:ratchet` → `OK: 3175 errors, 1008
warnings (no regressions)` · `npm run typecheck:tests:ratchet` → `OK: 374 errors in tests/ (no
regressions)` · `npm run test:ci` → `198 suites passed, 2619 passed / 1 skipped, 2620 total`.

**F5 status: CLOSED.** The Done criterion "Every grading path declares" now holds for chains, not
only for the single-prompt path Tier 2.5 verified. No edits made outside
`chain-operator-executor.ts` and its unit test file; `phase-guards/**`, `response-assembler.ts`,
`runtime-framework-loader.ts`, `docs/**`, and `CHANGELOG.md` were not touched.
