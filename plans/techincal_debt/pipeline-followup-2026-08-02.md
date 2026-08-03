---
title: "Pipeline Follow-up — Tiers 8-10"
date: 2026-08-02
status: active
tags: []
---

# Pipeline Follow-up — Tiers 8-10

**Date**: 2026-08-02
**Area**: `server/src/engine/execution/pipeline/`, `server/src/engine/gates/`
**Work type**: Tier 8 = explore (review only) · Tier 9 = bug_fix (**✓ complete 2026-08-02**) ·
Tier 10 = explore → tooling (raised by Tier 9)
**Predecessor**: [`pipeline-defect-remediation-2026-08-01.md`](./pipeline-defect-remediation-2026-08-01.md) (Tiers 1-7, complete)
**Confidence**: high on Tier 9 findings (probed 2026-08-02) · Tier 8 is scoped to produce a
finding, not a fix

---

## Why these are separate tiers

The Tiers 1-7 pass fixed the coordinator and left the 22 stages untouched. A re-analysis after
T7 surfaced two unrelated things the pass did not cover, with different risk profiles:

- **Tier 9 is a live defect** with a bounded blast radius: two of three judge-selection channels
  have no producer, so consumers read state nothing writes.
- **Tier 8 is a layer question**, not a lint question, and answering it wrong costs more than
  leaving it. It is deliberately review-only.

---

## Gate thresholds changed first (2026-08-02)

Measurements below were taken **after** this change, not before. Recorded because the earlier
re-analysis reported 18 violating files under the old thresholds and this plan reports 6 — the
difference is the threshold, not any code change.

| Rule                           | Was              | Now         | Why                                                                                                                                                                                                                    |
| ------------------------------ | ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `complexity` (cyclomatic)      | `warn, 10`       | **off**     | Counts every `??`/`?.` as a branch. A 20-line pure predicate scored 11 purely from null-coalescing. Where it disagreed with cognitive complexity it was the worse signal, and keeping both meant the worse one blocked |
| `max-params`                   | `warn, 4`        | `warn, 6`   | A stage constructor taking five injected services is DI, not a defect. Flags genuine outliers (7+)                                                                                                                     |
| `sonarjs/cognitive-complexity` | `warn, 15`       | unchanged   | The metric that tracks reading cost                                                                                                                                                                                    |
| Per-layer line ceiling (prose) | 50-125 / max 150 | **removed** | Never mechanically enforced; `validate-filesize.js` is advisory at 500, hard-block at 1000. The ceiling distorted work toward the threshold rather than the domain                                                     |

Effect: `src/` lint warnings 1401 → 1109; pipeline files violating 18 → 6. Baseline regenerated
deliberately (`lint:ratchet:baseline`) after the ratchet's vanished-rule detection correctly
fired.

---

## Tier 9: Judge selection has two dead channels — ✓ COMPLETE 2026-08-02

Smaller, self-contained, and a live user-facing gap. Independent of Tier 8.

> **9.1 inverted this tier's premise.** The plan assumed a half-wired feature (read side
> shipped, write side missing) and scoped 9.3 to "implement the producer(s)". The menu's own
> text settles it the other way: `JudgeMenuFormatter.buildJudgeResponse` instructs the client to
> "Call `prompt_engine` again using inline operators" — `@<framework> :: <gate> #<style>` — and
> **all three operator paths are live**. The judge feature works end to end. What was dead is a
> redundant _second_ channel for two of the three selections, structurally shadowed by the first:
> `clientOverride` sits at framework Priority 3 behind the operator at Priority 2, and
> `clientSelectedGateIds` at gate rank 90 behind `inline-operator` at rank 100. A producer would
> have been unreachable for any client following the instructions it was given.
>
> **9.2 therefore decided: delete the consumers, do not wire producers.** Rejected alternative —
> wiring producers — would add a second path to the same outcome, the parallel-system pattern
> `cleanup-standards.md` forbids, and would be dead on arrival besides.
>
> **Deviation from the stated gate.** The gate required "an integration test that fails on today's
> `main` and passes after". Under a delete decision there is no behavior change, so no test can be
> RED-then-GREEN — and that is the finding, not a gap in it. The substituted criterion is stronger
> in the direction that matters: `tests/integration/gates/judge-selection-reentry.test.ts` proves
> all three operator channels reach their consumers, and it was run **against unmodified `HEAD` in
> a detached worktree with the dead fields still present — 4/4 pass there and 4/4 after**. The
> removed channels demonstrably contributed nothing.
>
> `clientSelectedStyle` was **kept**: it has a real writer and is load-bearing. It carries the
> `parsedCommand.styleSelection` path that `executionPlan.styleSelection` does not, and normalizes
> to lowercase. The plan's concern that it "is not fed by the judge flow" was mistaken — `#style`
> _is_ the judge flow's documented answer mechanism.

### The finding

`JudgeSelectionStage` presents a menu of **styles, frameworks and gates**
(`judge-menu-formatter.buildJudgeResponse`), sets `judgePhaseTriggered`, and returns early so the
client can re-invoke with a selection. Probed 2026-08-02:

| Channel                               | Writers | Readers | Status                    |
| ------------------------------------- | ------- | ------- | ------------------------- |
| `state.framework.clientSelectedStyle` | 1       | 7       | **works** — but see below |
| `state.framework.clientOverride`      | **0**   | 8       | **dead**                  |
| `state.framework.clientSelectedGates` | **0**   | 4       | **dead**                  |

Probe: `rg -n "framework\.<field>\s*=" src/` returns nothing for the latter two; every apparent
"write" is a local `const` binding of the read.

~~Two of the three things the menu offers cannot be selected. The consumers are real and reachable
— `12-framework-stage.ts:100,197-199` folds `clientOverride` into its decision input, and
`gate-enhancement-service.ts:164,290` folds `clientSelectedGates` into the gate accumulator — so
this is not dead code to delete. It is a **half-wired feature**: the read side shipped, the write
side did not.~~

**Corrected by 9.1**: all three menu offerings _can_ be selected — through `@`, `::` and `#`, which
is what the menu tells the client to send. The consumer line-numbers above are accurate; the
inference from them was not. Reachable consumers reading a never-written field do not imply a
missing writer — they can equally mean a **redundant channel**, which is what these were. It _was_
dead code to delete.

**Same defect class as Finding 5d**, which Tier 1 fixed: `temporaryGatesApplied` read a metadata
key no writer set any more and was pinned at zero. That one was found; these two were not — and the
generalization is Tier 10 below.

### The style channel is also not what it looks like

~~`clientSelectedStyle`'s only writer is `applyInlineStyleSelection` (`10-judge-selection-stage.ts:105`),
which reads `parsedCommand.styleSelection` — the inline `%style` operator, not a response to the
judge menu. So even the working channel is not fed by the judge flow it appears to serve.~~

**Corrected by 9.1**: the writer and the line number are right, the reading of them is wrong. The
operator is `#style`, and the judge menu explicitly instructs the client to answer with
`#<analytical|procedural|creative|reasoning>`. This channel _is_ the judge flow working as designed
— it is the model the other two should have followed, not an anomaly.

### Subtiers

| #   | Status | Step                                                                                                                        | Files                                                                                                                                                                                                         | Depends | Verification                                                          |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| 9.1 | ✓      | Establish the intended re-entry path                                                                                        | `judge-menu-formatter.ts`                                                                                                                                                                                     | —       | **Answered: inline operators**, stated verbatim in the menu it emits  |
| 9.2 | ✓      | Decide per channel: wire the producer, or delete the consumers                                                              | —                                                                                                                                                                                                             | 9.1     | **Delete**; rejected alternative recorded above and in ADR 0001       |
| 9.3 | ✓      | Remove both dead channels, their 12 reads, the uncallable resolver input, and the now-unreachable rank/source union members | `internal-state.ts`, `12-framework-stage.ts`, `15-prompt-guidance-stage.ts`, `framework-decision-authority.ts`, `decisions/types.ts`, `gate-enhancement-service.ts`, `gate-set-resolver.ts`, `state/types.ts` | 9.2     | typecheck clean · 1784 unit + 434 integration pass · verify:mcp 11/11 |
| 9.4 | ✓      | Integration test proving all three operator channels reach their consumers                                                  | `tests/integration/gates/judge-selection-reentry.test.ts`                                                                                                                                                     | 9.3     | 4/4 after **and** 4/4 against unmodified `HEAD` — see deviation above |
| 9.5 | ✓      | Amend ADR 0001: rank 90 `client-selection` removed, veto-scope claim preserved                                              | `docs/adr/0001-gate-resolution-precedence.md`, `docs/architecture/overview.md`                                                                                                                                | 9.3     | Amendment section with the probe table and both removal arguments     |

**Gate**: full suite **+** `verify:mcp`, plus the tier criterion — an integration test that fails
on today's `main` and passes after, proving a menu-selected framework and gate actually reach
their consumers.

**Do not skip 9.1.** The tempting move is to wire a writer next to the existing readers, which
would satisfy the probe and still leave the client with no documented way to answer the menu. The
defect is a missing path, not a missing assignment.

**Risk**: medium. Touches gate accumulation and framework selection, both on the hot path. The
mitigation is that all three channels currently carry `undefined`, so any correct producer is
strictly additive — no existing behavior reads a non-undefined value today.

---

## Tier 8: Stage-level domain ownership — REVIEW ONLY, deferred

**Deliberately not a fix tier.** It produces a written finding and a recommendation; any code
change is a later tier that this one scopes.

### The finding to review

Project CLAUDE.md's Domain Ownership Matrix says stages are thin orchestration that may only
_call_ owner services. Six files in `pipeline/` exceed cognitive complexity 15 or params 6:

| File                                                | Measure                   |
| --------------------------------------------------- | ------------------------- |
| `stages/13-session-stage.ts`                        | cognitive **26**          |
| `stages/12-framework-stage.ts`                      | cognitive **23**          |
| `stages/20-gate-review-stage.ts`                    | cognitive **21**          |
| `stages/08-script-execution-stage.ts`               | cognitive **19**          |
| `routing/tool-routing.ts`                           | cognitive **16**          |
| `decisions/injection/injection-decision-service.ts` | `checkFrequency` 7 params |

Four of the six are stages, and three of those four sit above the coordinator's pre-T7 cognitive
score of 29's neighbourhood — this is the same class of debt Tier 7 cleared, one layer down.

### What the review must answer, per file

The question is **not** "is this over a threshold". It is:

1. **What responsibilities does this stage hold?** Name them. One is fine at any size.
2. **Is the complexity orchestration or domain logic?** A stage branching over which service to
   call is orchestration. A stage computing a domain answer is a matrix violation.
3. **If it is domain logic — which service owns it?** The matrix names an owner for every domain
   in this codebase. If none fits, that is itself the finding.
4. **What breaks if it moves?** These four stages are on the hot path for every `prompt_engine`
   call, and three of them mutate `context.sessionContext`.

### Why this is deferred rather than done

- The measurement alone does not distinguish a stage that is too complex from a stage
  coordinating a genuinely complex step. Acting on the number is how you get a decomposition
  whose only justification is arithmetic — the pattern the size-ceiling removal above exists to
  stop.
- Tier 7 shows the cost of getting this right: an extraction with a real SSOT defect behind it
  still needed a byte-level differential to prove behavior held. Four stages is four of those.
- There is no forcing function. The ratchet holds the line; nothing regresses while this waits.

### Subtiers

| #   | Step                                                                          | Depends | Verification                               |
| --- | ----------------------------------------------------------------------------- | ------- | ------------------------------------------ |
| 8.1 | Answer the four questions above for each of the six files                     | —       | Written finding per file                   |
| 8.2 | Classify each: orchestration-complex (leave) vs domain-logic-in-a-stage (fix) | 8.1     | Classification with evidence per file      |
| 8.3 | For each "fix", name the owning service from the matrix and the move          | 8.2     | Named target, or "no owner exists" finding |
| 8.4 | Write the follow-on tier(s) — one per file, not one for all six               | 8.3     | Tiers sized so each has its own gate       |

**Gate**: none — no code changes. Exit criterion is 8.4 producing tiers a later pass can execute.

**Explicitly out of scope**: touching any of the six files. If the review finds something urgent,
it becomes its own tier with its own gate rather than being fixed inline here.

---

## Tier 10: Mechanical check for write-never state fields — NEW, from Tier 9

Tier 9 found `clientOverride` and `clientSelectedGates` by hand. ADR 0001's **F2** found
`enhancedGateConfiguration` — declared once, read in five places, written nowhere — the same way,
three days earlier. Two instances of one shape, both found by someone happening to look.

**The shape**: a field on a shared state/config interface that has readers and zero writers. It is
worse than unreachable code, because the readers _are_ reachable — they run on every request and
silently take the `undefined` branch, so the feature they gate looks implemented and is measured as
covered.

| Instance                                  | Declared | Readers | Writers | Found               |
| ----------------------------------------- | -------- | ------- | ------- | ------------------- |
| `enhancedGateConfiguration` (ADR 0001 F2) | 1        | 5       | 0       | 2026-07-29, by hand |
| `state.framework.clientOverride`          | 1        | 8       | 0       | 2026-08-02, by hand |
| `state.framework.clientSelectedGates`     | 1        | 4       | 0       | 2026-08-02, by hand |

A check over the interfaces that carry pipeline state — `InternalState`, `ExecutionPlan`,
`ConvertedPrompt` — asking "does every optional field have at least one assignment in `src/`?"
would have caught all three at once, and would catch the next one without an audit.

### Subtiers

| #    | Step                                                                                                                          | Depends | Verification                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| 10.1 | Enumerate the state-carrying interfaces in scope; decide which are worth gating                                               | —       | Written list with the reason each is in or out             |
| 10.2 | Prototype the detector (ts-morph: find property declarations with no `PropertyAccessExpression` on the left of an assignment) | 10.1    | Run against `HEAD~1` — must flag all three known instances |
| 10.3 | Decide enforcement: `validate:*` script vs. advisory report. Weigh the false-positive rate first                              | 10.2    | Measured FP count on today's tree                          |
| 10.4 | Wire into `validate:all` if 10.3 says gate; add to CI's `full` route                                                          | 10.3    | Green on a clean tree, red on a seeded phantom field       |

**Do not skip 10.2's back-test.** A detector that cannot re-find the three known instances is not
measuring the thing that motivated it. **Do not skip 10.3**: fields assigned only via object
literals, spreads, or `Object.assign` will read as unwritten, and the false-positive rate decides
whether this can be a gate at all or has to stay a report.

**Risk**: low — analysis only until 10.4.

---

## Rejected alternatives

- **Fold Tier 8 into Tier 9** — different risk profiles and different work types. Tier 9 is a
  bounded bug fix with a falsifiable criterion; Tier 8 is open-ended review whose output is more
  planning. Batching them would let the review's uncertainty stall the fix.
- **Decompose the four stages now, using the thresholds as the specification** — the threshold
  says a function is hard to read, not what it should have been instead. Tier 7's value came from
  naming the defect (a duplicated derivation) before extracting; without that step this is
  refactoring toward a number.
- **Delete the dead judge consumers instead of wiring producers** — still on the table, and it is
  9.2's decision. It cannot be made before 9.1 establishes whether the menu was ever answerable.
