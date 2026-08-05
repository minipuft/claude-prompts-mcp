---
title: "Pipeline Follow-up — Tiers 8-14"
date: 2026-08-02
status: reference
tags: []
---

# Pipeline Follow-up — Tiers 8-14

**Date**: 2026-08-02
**Area**: `server/src/engine/execution/pipeline/`, `server/src/engine/gates/`
**Work type**: Tier 8 = explore, review only (**✓ complete 2026-08-02**) · Tier 9 = bug_fix
(**✓ complete 2026-08-02**, `76630b73`) · Tier 10 = explore → tooling, raised by Tier 9 (**✓ complete 2026-08-03**) ·
**Tiers 11-14 = refactor, scoped by Tier 8** — Tiers 11-14 ✓ complete 2026-08-02/03
**Predecessor**: [`pipeline-defect-remediation-2026-08-01.md`](./pipeline-defect-remediation-2026-08-01.md) (Tiers 1-7, complete)
**Successor**: [`pipeline-followup-2026-08-03.md`](./pipeline-followup-2026-08-03.md) (Tiers 15-16 — the eight baselined fields, and the predicates Tier 12 left in the stage)
**Confidence**: high on Tier 9 findings (probed 2026-08-02) · Tier 8 is scoped to produce a
finding, not a fix
**Retention**: `reference`, not `done` — [`docs/adr/0001-gate-resolution-precedence.md`](../../../docs/adr/0001-gate-resolution-precedence.md)
cites this plan, so it is load-bearing for an architectural record and cannot be retired with the
work it tracked.

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

## Tier 8: Stage-level domain ownership — ✓ REVIEW COMPLETE 2026-08-02

**Deliberately not a fix tier.** It produces a written finding and a recommendation; any code
change is a later tier that this one scopes. **No file in the six was touched.**

> **Headline: 4 of 6 are real, 2 are not.** The measurement did not distinguish them — reading each
> function did. `tool-routing.ts` and `injection-decision-service.ts` are correctly-layered code
> that happens to score over a threshold; decomposing them would have been refactoring toward a
> number. This is the outcome the tier's own "why deferred" argument predicted, now measured rather
> than asserted.
>
> **One finding outranks the complexity question entirely**: the chain-ID run-counter format is
> parsed by **two private implementations under different names** (§ 8.1 F1). That is an SSOT
> defect, not a layer smell, and it is invisible to `rg` — which is why nothing caught it.
>
> **Re-measured 2026-08-02 before reviewing** (per [[feedback-untrusted-inventory]]): all six
> scores are unchanged from the table below, including `12-framework-stage` at 23 after the Tier 9
> edit — that edit touched `buildDecisionInput`, the violation is on `execute`.

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

### Why this was deferred rather than done

- The measurement alone does not distinguish a stage that is too complex from a stage
  coordinating a genuinely complex step. Acting on the number is how you get a decomposition
  whose only justification is arithmetic — the pattern the size-ceiling removal above exists to
  stop. **Confirmed: 2 of 6 were exactly that.**
- Tier 7 shows the cost of getting this right: an extraction with a real SSOT defect behind it
  still needed a byte-level differential to prove behavior held.
- There is no forcing function. The ratchet holds the line; nothing regresses while this waits.

---

### 8.1 — Findings per file

#### F1. `stages/13-session-stage.ts` — cognitive 26 · **domain logic + SSOT defect** · 326 lines, 13 private methods

**Responsibilities held** (four, not one):

1. Session resolution — resume vs. create vs. force-restart (`execute`, lines 41–128)
2. **Chain-ID identity** — base-id precedence, run-counter strip/parse, next-run-number
3. Pending gate-review creation (`createPendingGateReviewIfNeeded`, 40 lines)
4. Blueprint construction + deep clone via `JSON.parse(JSON.stringify(...))`

**Orchestration or domain logic?** Domain. Responsibility 1 is legitimate stage work. 2–4 are not:
they compute domain answers rather than choosing which service to call.

**The SSOT defect (this is the real finding).** The chain-ID run-counter format `base#N` has **two
private implementations in two layers, under different names**:

| Concern            | Stage (orchestration)               | ChainManager (module)                  | Body              |
| ------------------ | ----------------------------------- | -------------------------------------- | ----------------- |
| strip run counter  | `stripRunCounter` (13-session:278)  | `extractBaseChainId` (manager.ts:1747) | `/#\d+$/` replace |
| extract run number | `extractRunNumber` (13-session:282) | `getRunNumber` (manager.ts:1751)       | `/#(\d+)$/` match |

Both are `private`, and the names share no substring — so `rg stripRunCounter` never finds
`extractBaseChainId`. This is the **Name-it-twice** failure the `/search` skill documents: the
capability exists twice because it was searched for by name, not by behavior. The format is also
asserted in four more places as _prose_ (`prompt-engine.schema.ts:127`,
`request-validator.ts:109`, `validation/schemas.ts:138`, `_generated/prompt_engine.generated.ts:62`)
— six sites, one contract, no owner.

Worse: `getNextRunNumber` normalizes with the stage's copy, then calls
`chainSessionStore.getRunHistory(normalized)` — the service that owns run history and has its own
copy of the same normalizer.

**Owning service**: none exists. That is itself the finding. The matrix has no "chain identity"
row. Recommend a new `ChainIdCodec` utility (pure FP, no state — parse/format/next-run) that both
`ChainManager` and the stage import. It is a _format codec_, so per the layer model it is a
utility, not a service.

**What breaks if it moves**: nothing at the boundary — both copies are private and behaviourally
identical, so a shared codec is a pure substitution. Risk is in responsibility 3 (`createPending‐
GateReviewIfNeeded` mutates `sessionContext.pendingReview` **and** persists via
`authority.setPendingReview`), which is on the hot path for every gated chain step.

---

#### F2. `stages/12-framework-stage.ts` — cognitive 23 · **domain logic (decision second-guessed)**

**Responsibilities**: framework decision consumption; framework _requirement_ derivation; chain vs.
single resolution.

**Orchestration or domain logic?** Domain, and specifically **a decision split across two owners**.
The stage calls `context.frameworkAuthority.decide()` — the declared SSOT — and then computes its
own `requiresFramework` that can override the authority's `shouldApply`:

```ts
const requiresFramework = Boolean(
  plan.requiresFramework ||
  chainRequiresFramework ||
  singleRequiresFramework ||
  decision.shouldApply,
);
```

**Duplicated derivation, byte-identical, 11 lines apart** (lines 124–133 and 142–154):
`chainRequiresFramework` / `singleRequiresFramework` are computed twice per call. This is the same
defect class Tier 7 cleared in the coordinator — a derivation with two sites — one layer down.

**Owning service**: `FrameworkDecisionAuthority`. "Is a framework required for this execution" is a
framework decision; it belongs beside `shouldApply`, as an input to one decision rather than a
second opinion computed afterwards.

**What breaks if it moves**: the authority caches its decision on first `decide()` call, so folding
requirement-derivation in changes _when_ `chainStepsRequireFramework` is evaluated. Needs the
Tier-7 treatment — a differential over the decision output.

---

#### F3. `stages/20-gate-review-stage.ts` — cognitive 21 · **domain logic (gate coverage decision)**

**Responsibilities**: pending-review guards; shell-verify execution; **auto-pass coverage
decision**; judge-gate composition; render delegation.

**Orchestration or domain logic?** Mostly orchestration — but lines 79–113 decide _whether a gate
review is satisfied_, by unioning this run's shell-verified gate ids with
`state.gates.shellVerifyPassedForGates` and testing `pendingReview.gateIds.every(...)`. Deciding a
gate is cleared is gate-verdict domain work.

**Owning service**: `GateEnforcementAuthority` (matrix: "Gate enforcement") or `GateVerdictProcessor`
(matrix: "Gate verdict processing"). The stage already calls the authority elsewhere in the
pipeline, so this is an **extension, not a new service** — `authority.isSatisfiedByShellVerification(...)`.

**What breaks if it moves**: the stage writes `context.executionResults` on the auto-clear path and
returns early. The decision can move; the early return must stay in the stage.

---

#### F4. `stages/08-script-execution-stage.ts` — cognitive 19 · **missed extension point**

**Responsibilities**: tool detection delegation; **auto-approve partitioning + policy**; trigger
partitioning delegation; result accumulation.

**Orchestration or domain logic?** This is the `layer + service` compound from `refactoring.md`: a
partitioning service **already exists** and is injected — `toolTriggerFilter.filterByTrigger()`
partitions matches by trigger/confirm settings. The stage then implements a _second_ partitioning,
`separateAutoApproveTools`, privately, plus the approve/block policy inline (lines 94–127) via
`checkValidationOutput`.

**Owning service**: `ToolTriggerFilter` — extend it. Two partitioners over the same collection, one
injected and one private, is the missed extension point, not a missing abstraction.

**What breaks if it moves**: auto-approve _executes the script_ to get its validation result before
deciding — so the partition is not pure; it has an I/O dependency the existing filter does not. The
extension must take the executed results as data, keeping execution in the stage.

---

#### F5. `routing/tool-routing.ts` — cognitive 16 · **orchestration-complex — LEAVE**

`detectToolRoutingCommand` is a module-level **pure function** with no class and no state — a
utility, which is the correct layer for it. All 16 points come from seven sequential
`pattern → result` branches. There is no domain logic and no owner to move it to: it _is_ the
routing table.

**Recommendation: no tier.** Converting the if-chain to a data-driven table is a legitimate
readability change but it is mechanical, worth doing only if someone is already in the file, and it
would not change a single layer boundary. Filing a tier for it would be refactoring toward a number.

---

#### F6. `decisions/injection/injection-decision-service.ts` — `checkFrequency` 7 params · **LEAVE**

Not a stage. It is a **private method of a service doing service work**, which is exactly where the
layer model puts domain logic. The seven parameters are cohesive — they are one frequency decision's
inputs (`type`, `currentStep`, `totalSteps`, `frequency`, `timestamp`, `source`, `target`) — and it
sits at the threshold, not past it. `refactoring.md` sets the limit at 6 to "flag genuine outliers
(7+)"; this is the boundary case that rule was widened to tolerate.

**Recommendation: no tier.** A `FrequencyCheckInput` parameter object would clear the warning and
is a fine drive-by, but there is no ownership question here.

---

### 8.2 / 8.3 — Classification and owners

| File                            | Score    | Classification             | Owner for the move                           | Tier |
| ------------------------------- | -------- | -------------------------- | -------------------------------------------- | ---- |
| `13-session-stage.ts`           | 26       | **domain logic + SSOT**    | **new `ChainIdCodec` utility** (none exists) | 11   |
| `12-framework-stage.ts`         | 23       | **domain logic**           | `FrameworkDecisionAuthority` (extend)        | 12   |
| `20-gate-review-stage.ts`       | 21       | **domain logic**           | `GateEnforcementAuthority` (extend)          | 13   |
| `08-script-execution-stage.ts`  | 19       | **missed extension point** | `ToolTriggerFilter` (extend)                 | 14   |
| `routing/tool-routing.ts`       | 16       | orchestration-complex      | — correct layer                              | none |
| `injection-decision-service.ts` | 7 params | service doing service work | — correct layer                              | none |

**Three of the four are extensions of services that already exist and are already injected.** Only
F1 needs something new, and what it needs is a utility, not a service.

### 8.4 — Follow-on tiers

Written as four separate tiers, each with its own gate, per the subtier requirement. **Tier 11 is
the one to do first** — it is the only one carrying a correctness defect rather than a layering
one, and it is the smallest.

| Tier | Scope                                                                                              | Risk   | Why this size                                                            |
| ---- | -------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| 11   | Extract `ChainIdCodec`; delete both private copies; point the four prose assertions at it          | low    | Pure substitution — both copies are behaviourally identical              |
| 12   | Fold framework-requirement derivation into `FrameworkDecisionAuthority`; kill the duplicated block | medium | Changes decision-cache timing; needs a Tier-7-style differential         |
| 13   | Move the shell-verify coverage decision to `GateEnforcementAuthority`                              | medium | Hot path for every gated chain step; early-return must stay in the stage |
| 14   | Extend `ToolTriggerFilter` with auto-approve partitioning                                          | medium | Partition has an I/O dependency; execution must stay in the stage        |

**Do not batch 11–14 into one pass.** Tier 7 needed a byte-level differential to prove one
extraction held; these are four independent ones with different owners and different blast radii.

**Complexity is the symptom, not the exit criterion.** Each tier passes when the domain logic sits
with its owner — not when the score drops below 15. Tiers 12–14 may well leave their stage above
the threshold, and that is an acceptable outcome; F5 and F6 stay above it deliberately.

**Gate for this tier**: none — no code changes, and none were made. Exit criterion was 8.4 producing
executable tiers: **met**, four tiers with named owners, sized risk, and per-tier gates.

---

## Tier 11: `ChainIdCodec` — ✓ COMPLETE 2026-08-02

Scoped by Tier 8 F1. Executed first per 8.4.

> **The tier's inventory was low, and its severity framing was high.** Re-measured before
> executing (`rg` on the regex literal, not on any method name — the probe F1 itself
> recommends):
>
> - The plan counted **two** code copies and "four more places [that] assert the format as
>   prose". Two of those four are not prose: `validation/schemas.ts:137` and
>   `mcp/tools/schemas/prompt-engine.schema.ts:126` each **inline the validating regex**
>   `/^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/` verbatim. So the format lived in **six** executable
>   literals, not two.
> - Worse for the "no owner" claim: `shared/utils/constants.ts:8` already exported a
>   `CHAIN_ID_PATTERN` holding that exact regex, and two call sites already imported it. A
>   partial owner existed. Creating a fresh codec without absorbing it would have added a
>   _seventh_ literal — this is the `defined` pre-flight check earning its place.
> - A fifth prose site the plan missed: `shared/types/execution.ts:105`. And a sixth
>   inconsistency: the `constants.ts` doc called `N` a **version**; everything else calls it
>   a **run number**.
> - **`shared/utils/` contained two different constants both named `CHAIN_ID_PATTERN`** —
>   the run-id regex in `constants.ts` and a filesystem-slug regex in `chainUtils.ts:18`.
>   Same name, same directory, different meanings. Renamed to `CHAIN_SLUG_PATTERN`.
>
> **There is no live defect.** The plan called Tier 11 "the only one carrying a correctness
> defect". Probed: the two strip copies are byte-identical and the two parse copies differ
> only in null-check style, with identical behaviour on every input. Prompt ids were checked
> against the pattern's character class — all conform, so no id can be minted that the
> validator would later reject. The defect is **latent drift**, not observable misbehaviour.
> Tier 11 is still worth doing first because it is the smallest and the only pure
> substitution; the ranking survives, the justification does not.

### Subtiers

| #    | Status | Step                                                                                   | Files                                                                                            | Depends | Verification                                                              |
| ---- | ------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| 11.1 | ✓      | Re-measure the format's real footprint by behaviour, not by name                       | —                                                                                                | —       | 6 executable literals + 5 prose sites + 1 name collision (plan said 2+4)  |
| 11.2 | ✓      | Create the codec, absorbing the existing `CHAIN_ID_PATTERN` rather than duplicating it | `shared/utils/chain-id-codec.ts` (new), `shared/utils/constants.ts`, `shared/utils/index.ts`     | 11.1    | one `RUN_SUFFIX_PATTERN` literal serves strip, parse, and format          |
| 11.3 | ✓      | Delete both private copies and rewire all 16 call sites                                | `stages/13-session-stage.ts` (−39 ln), `modules/chains/manager.ts` (−43 ln)                      | 11.2    | `rg extractBaseChainId\|getRunNumber\|stripRunCounter` → 0 outside docs   |
| 11.4 | ✓      | Point the two inlined Zod regexes and the three prose assertions at the codec          | `validation/schemas.ts`, `prompt-engine.schema.ts`, `request-validator.ts`, `types/execution.ts` | 11.2    | `rg 'chain-\[a-zA-Z0-9_-\]'` → 1 hit, the codec                           |
| 11.5 | ✓      | Break the `CHAIN_ID_PATTERN` name collision inside `shared/utils/`                     | `shared/utils/chainUtils.ts`                                                                     | 11.2    | renamed `CHAIN_SLUG_PATTERN`, both meanings documented against each other |
| 11.6 | ✓      | Unit-test the codec, encoding what the deleted copies did rather than a new contract   | `tests/unit/shared/chain-id-codec.test.ts` (new)                                                 | 11.3    | 18/18                                                                     |

**Gate**: the format has one owner, and the stage no longer computes chain identity.

| Check                             | Result                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `npm run typecheck`               | clean                                                           |
| eslint, my 11 files vs `HEAD`     | 329 vs 332 — **−3 `strict-boolean-expressions`, no rule added** |
| `npm run typecheck:tests:ratchet` | 395 in `tests/`, no regressions                                 |
| `npm run test:unit`               | 149 suites / 1816 tests                                         |
| `npm run test:integration`        | 34 suites / 434 tests                                           |
| `npm run validate:arch`           | 440 modules, 2 pre-existing warnings                            |
| `npm run validate:contracts`      | in sync                                                         |
| `npm run verify:mcp`              | 11/11                                                           |

**Deliberately left duplicated**: `tooling/contracts/prompt-engine.json:44` states the format in
the `chain_id` tool description, which regenerates `_generated/prompt_engine.generated.ts:62`.
Per `.claude/rules/mcp-contracts.md` a tool description exists to let an LLM construct a correct
call, so the format belongs inline there. It is a duplicate by design, and the only one left.

**Net**: 44 insertions, 88 deletions across 10 files, plus one new 84-line utility and its test.

---

## Tier 12: framework-requirement derivation — ✓ COMPLETE 2026-08-02

Scoped by Tier 8 F2.

> **The stated approach is rejected on evidence; the deliverable stands.** 8.4 scoped this
> tier as "fold framework-requirement derivation into `FrameworkDecisionAuthority`" and rated
> the risk as "changes decision-cache timing; needs a Tier-7-style differential". The risk is
> worse than that, and it is not a timing question — the fold would be **silently inert**:
>
> - `FrameworkDecisionAuthority.decide()` caches on first call and returns the cached value
>   thereafter, ignoring later input.
> - `GateEnhancementService.getActiveFrameworkId()` calls it via `getFrameworkId()` on the
>   main path for both single prompts and chains — from **stage 11**, before this stage runs.
>   `19-phase-guard-verification-stage.ts:213` already documents this ("populated by
>   GateEnhancementStage").
> - So a requirement folded into `decide()` would be evaluated at stage 11 — before
>   `currentRequestFrameworkGates` is loaded here in stage 12's `execute`, and from a service
>   with no access to the framework-gate set. `hasFrameworkGate` would see an empty set and
>   every gate-derived requirement would read false.
>
> The derivation therefore stays in the stage, with the reason recorded in the code beside it.
> The tier's actual deliverable — kill the duplicated block — is unaffected and was done.

> **The duplicate was not merely duplicated; it was unreachable-as-distinct.** The first block
> (old lines 118-136) ran only when `!decision.shouldApply`, which makes the second block's
> extra `|| decision.shouldApply` term a no-op in exactly that state. Both blocks computed the
> same value from the same inputs and took the same branch with the same log message, so the
> first could never change an outcome. Deletion is subsumption, not equivalence-under-change.

> **A third finding, of the Tier 9 class.** The stage's `buildDecisionInput` passed
> `globalActiveFramework: context.frameworkContext?.selectedFramework?.id`. `rg` for writers of
> `context.frameworkContext` returns **two, both in this stage, both downstream of that read** —
> so the field was structurally always `undefined` and the authority's Priority 3 could never
> fire from here. Not observable, because `FrameworkManager.selectFramework({})` independently
> consults the same framework state store, and because `GateEnhancementService` supplies the
> field for real from its own provider. Removed rather than repaired: adding a provider
> fallback here would create a second producer for a channel that already has one, to fix
> nothing a user can see. This is precisely what Tier 10's detector is meant to find mechanically.

### Subtiers

| #    | Status | Step                                                                             | Files                                                            | Depends | Verification                                                       |
| ---- | ------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| 12.1 | ✓      | Establish whether the fold is safe before doing it                               | `gate-enhancement-service.ts`, `framework-decision-authority.ts` | —       | **Rejected**: stage 11 primes the cache; fold would be inert       |
| 12.2 | ✓      | Delete the duplicated derivation block                                           | `stages/12-framework-stage.ts`                                   | 12.1    | −19 ln; cognitive **23 → under 15**                                |
| 12.3 | ✓      | Record in code why the derivation stays in the stage                             | `stages/12-framework-stage.ts`                                   | 12.1    | comment names the cache-priming caller and the gate-set dependency |
| 12.4 | ✓      | Remove the structurally-dead `globalActiveFramework` input and the unused import | `stages/12-framework-stage.ts`                                   | 12.2    | `FrameworkSelection` unused-import violation cleared               |
| 12.5 | ✓      | Differential over the removed block's whole reachable state space                | `tests/unit/execution/pipeline/framework-stage.test.ts`          | 12.2    | **17/17 against unmodified `HEAD` and 17/17 after**                |

**Gate**: the derivation exists once, and its placement is justified rather than assumed.

| Check                        | Result                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `npm run typecheck`          | clean                                                                |
| eslint, the stage vs `HEAD`  | 17 → 13; cognitive-complexity and no-unused-vars cleared, none added |
| `npm run test:unit`          | 150 suites / 1830 tests                                              |
| `npm run test:integration`   | 34 suites / 434 tests                                                |
| `npm run validate:arch`      | 441 modules                                                          |
| `npm run validate:contracts` | in sync                                                              |
| `npm run verify:mcp`         | 11/11                                                                |

**Left alone deliberately**: `chainStepsRequireFramework`, `stepRequiresFramework`, and
`hasFrameworkGate` remain private methods on the stage, which `architecture.md` nominally bans
in orchestration. They read the request-scoped framework-gate set this stage loads and owns;
moving them without moving that load would put an async dependency behind a synchronous call.
F2's ownership complaint is answered by the cache finding above, not by relocating three
predicates.

---

## Tier 13: shell-verify coverage decision — ✓ COMPLETE 2026-08-02

Scoped by Tier 8 F3.

> **It went to the gates decisions module, not onto `GateEnforcementAuthority` — and the
> first attempt to put it on the authority was a live regression.** F3 named the authority as
> the owner and noted it is "already called elsewhere in the pipeline, so this is an
> extension, not a new service". Implementing that literally produced
> `context.gateEnforcement?.resolveShellVerificationCoverage(...)`, and `gateEnforcement` is
> **optional** — `PipelineDependencies.gateEnforcement?` at `prompt-execution-pipeline.ts:45`,
> assigned only under `if (this.gateEnforcement !== undefined)` at line 85. Wherever that port
> is unset, a review that previously auto-cleared would silently stop clearing and fall
> through to a full LLM review. Caught before commit by asking what `?.` returns rather than
> by a test, since no test wires the pipeline without the authority.
>
> The mismatch is the lesson: the authority is **stateful** (caches an enforcement decision,
> holds the session store) and optional; this decision is **stateless**. `architecture.md`
> puts pure functions behind direct imports, not injection — so the decision is an exported
> function in `decisions/gates/`, which is the owner _module_, reached without an instance.
> F3's ownership claim is satisfied; its "extend the class" prescription is not, and should
> not be.

> **Complexity moved the right way but did not clear the bar, as 8.4 predicted.** The stage
> went 21 → 17, still above 15. 8.4 states the exit criterion is domain logic sitting with its
> owner, not a score, and that Tiers 12-14 may legitimately leave their stage above threshold.
> Recorded rather than chased: shaving the remaining 2 points would mean decomposing the
> judge-gate and render paths, which is a different tier with a different owner.

### Subtiers

| #    | Status | Step                                                                         | Files                                                                           | Depends | Verification                                                          |
| ---- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| 13.1 | ✓      | Type the decision's inputs and result                                        | `decisions/gates/gate-enforcement-types.ts`                                     | —       | `ShellVerificationOutcome/CoverageInput/Coverage`, no gates/shell dep |
| 13.2 | ✓      | Place the decision with its owner — as a function, not an authority method   | `decisions/gates/shell-verification-coverage.ts` (new), `index.ts`              | 13.1    | **Rejected the method form**: optional port would break auto-clear    |
| 13.3 | ✓      | Stage calls it; running commands, writing results, and the early return stay | `stages/20-gate-review-stage.ts`                                                | 13.2    | cognitive 21 → 17; early return unmoved                               |
| 13.4 | ✓      | Add a refusal reason so a review that does not clear says why                | `stages/20-gate-review-stage.ts`                                                | 13.3    | new `diagnostics.info` on the not-cleared path                        |
| 13.5 | ✓      | Unit-test the decision, weighted toward the cases where it must refuse       | `tests/unit/execution/pipeline/state/shell-verification-coverage.test.ts` (new) | 13.2    | 9/9                                                                   |

**Gate**: deciding a gate is cleared happens in the gates decisions module; the stage keeps
only what needs I/O and control flow.

| Check                        | Result                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`          | clean                                                                   |
| eslint, 5 files vs `HEAD`    | 28 → 28 — no rule added, none removed (cognitive stays a warning at 17) |
| existing gate tests          | **unmodified**; 19/19 against `HEAD` and 19/19 after                    |
| `npm run test:unit`          | 151 suites / 1839 tests                                                 |
| `npm run test:integration`   | 34 suites / 434 tests                                                   |
| `npm run validate:arch`      | 442 modules                                                             |
| `npm run validate:contracts` | in sync                                                                 |
| `npm run verify:mcp`         | 11/11                                                                   |

**Behaviour preserved exactly**: no existing test was touched. The auto-clear path is covered
by `gate-judge-pipeline-wiring.test.ts` ("includes ShellVerificationStage
shellVerifyPassedForGates in coverage check"), which passes unchanged on both sides.

**Left alone deliberately**: the stage calls `chainSessionStore.clearPendingGateReview`
directly rather than `authority.clearPendingReview`, which is a pure delegation to the same
call. Routing it through the optional authority would reintroduce exactly the nullable branch
13.2 removed, to change nothing.

---

## Tier 14: auto-approve partitioning — ✓ COMPLETE 2026-08-03

Scoped by Tier 8 F4.

> **F4's lifecycle check passed — the first of Tiers 12-14 where it did.** `toolTriggerFilter`
> is a **required** constructor dependency reached through `ToolTriggerFilterPort`, not an
> optional field like Tier 13's `gateEnforcement`, and the filter caches no decision. The
> extension is safe as prescribed, and the port has one implementor and one consumer.

> **F4 bundled two things that are not one extension.** It described "auto-approve
> partitioning + policy" as a single missed extension point on `ToolTriggerFilter`. They
> answer different questions: `separateAutoApproveTools` decides _which path a tool takes_ —
> the same question `filterByTrigger` answers over the same list, which is the real missed
> extension — while `checkValidationOutput` decides _what a script said_, parsing a stdout
> protocol (`{valid, warnings, errors}`). Putting a stdout protocol on a trigger/confirmation
> service would give that service a second domain. Split: the partitioner joined the filter,
> the interpreter did not.

> **`validate:arch` rejected the interpreter's natural home, and was right.** Domain put it in
> `modules/automation/execution/` beside the executor producing `ScriptExecutionResult`. The
> engine may not import values from `modules/` (`engine-no-modules-or-mcp-value`), and the
> filter escapes that rule only by arriving through an injected port — over-wiring for one
> pure function. It moved to `src/shared/utils/`, where `ScriptExecutionResult` itself lives,
> so a pure reader sits at the same layer as the type it reads. Third tier running where the
> prescribed owner was structurally wrong; first one where a mechanical gate caught it instead
> of a probe.

### Subtiers

| #    | Status | Step                                                                        | Files                                                                                                     | Depends | Verification                                                    |
| ---- | ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| 14.1 | ✓      | Check the collaborator's lifecycle before extending it                      | `tool-trigger-filter.ts`, `shared/types/index.ts`                                                         | —       | required dep, no cache, 1 implementor / 1 consumer — safe       |
| 14.2 | ✓      | Move the partition to the filter, keeping execution in the stage            | `shared/types/index.ts`, `tool-trigger-filter.ts`                                                         | 14.1    | `partitionAutoApprove` pure; candidates returned, not verdicts  |
| 14.3 | ✓      | Place the validation-output interpreter with its own domain, not the filter | `shared/utils/script-validation-output.ts` (new)                                                          | 14.1    | `validate:arch` rejected `modules/`; landed at the shared layer |
| 14.4 | ✓      | Delete both private methods from the stage                                  | `stages/08-script-execution-stage.ts`                                                                     | 14.2-3  | cognitive 19; both helpers gone                                 |
| 14.5 | ✓      | Update the port mock the extension broke, and cover both new units          | `script-execution-stage.test.ts`, `tool-trigger-filter.test.ts`, `script-validation-output.test.ts` (new) | 14.4    | 13 new tests; mock delegates to the real pure partitioner       |

**Gate**: two partitioners over one list became one, and the stage keeps only what needs I/O.

| Check                                       | Result                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `npm run typecheck`                         | clean                                              |
| eslint, 4 files vs `HEAD`                   | 21 → 21, per-rule identical                        |
| `npm run test:unit`                         | 154 suites / 1870 tests                            |
| `npm run test:integration`                  | 34 suites / 434 tests                              |
| `npm run validate:arch`                     | 443 modules — the rule that caught 14.3 now passes |
| `npm run validate:state-field-writers`      | 8 known, none new                                  |
| `npm run validate:contracts` · `verify:mcp` | in sync · 11/11                                    |

**Mock drift, as `cleanup-standards.md` predicts.** Extending the port broke 10 tests whose
hand-written stub lacked the new method — invisible to `rg` for the port name. The mock now
delegates to the real `partitionAutoApprove` rather than returning a fixed partition, because
several of those cases assert the stage routes by `autoApproveOnValid`, which a stub would
have answered for them.

**Complexity**: stage cognitive 19, unchanged and still over 15 — both deleted methods were
separate functions, not branches inside `execute`. 8.4 sets the exit criterion as ownership,
not score.

---

## Tier 10: Mechanical check for write-never state fields — ✓ COMPLETE 2026-08-03

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

### Outcome — ✓ COMPLETE 2026-08-03

`scripts/validate-state-field-writers.js` (ts-morph), wired into `validate:all` with a
`--self-test` beside the other guards, plus a ratchet baseline.

> **The first detector passed its self-test and failed its back-test, 1 of 3.** It matched
> property _names_ — deliberately, to over-count writes and keep false positives low. Against
> `76630b73^` it missed `clientOverride`, because the phantom state field existed to feed a
> same-named field on `FrameworkDecisionInput`, and `decisionInput.clientOverride = ...`
> made the state field look written. That is not an edge case: **a phantom channel almost
> always has a same-named consumer being written**, so name matching misses the exact shape
> it targets. Rewritten to resolve references through the type checker
> (`findReferencesAsNodes` + write-position test). The self-test now carries a same-name
> decoy on another interface — the case that defeated v1.
>
> It also missed `enhancedGateConfiguration` for an unrelated reason: that field lived on
> `ConvertedPrompt`, which 10.1 named as a candidate and the first watched set omitted.
> Two misses, two causes, only one of them a detector defect.

**10.3 measurement.** Type-aware detection first reported 15 findings. Seven were one
systematic false-positive class: members of a nested object that is only ever assigned
wholesale (`decisionInput.modifiers = executionPlan.modifiers`), so no member has an
individual writer by construction rather than by defect. Fixed by descending into a nested
type literal only when at least one of its members is individually written. **15 → 8, and
all 8 are true positives** — verified by hand:

| Finding                                                     | Why it is real                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConvertedPrompt.delegation` (+5 more)                      | `converter.ts` is the only construction site and sets none of them, while `06-operator-validation-stage.ts:129` reads `convertedPrompt?.delegation`       |
| `GateEnforcementInput.gateInstructions`, `.enforcementMode` | Fields of the input to `GateEnforcementAuthority.decide()`, **which has no callers** — so `getCachedDecision()` always returns null for its two consumers |

**A false-positive rate of zero on today's tree, and eight pre-existing findings.** Rather
than choose between "gate that cannot go green" and "report nobody reads", it ships as a
**ratchet** — the pattern this repo already uses for `lint` and `typecheck:tests`. New
findings fail; the eight are baselined in `scripts/state-field-writers-baseline.json`, and
fixing one fails the check until the baseline is lowered, so it cannot silently drift up or
stall on the way down.

**Not an instance, and worth recording as a scope boundary**: Tier 12's `globalActiveFramework`
is _not_ what this detects. It has two writers; what was dead was one specific call site's
contribution. Call-site-local dead assignment is a different shape, and this detector will
not catch it.

### Subtiers

| #    | Status | Step                                                                                                                          | Depends | Verification                                               |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| 10.1 | ✓      | Enumerate the state-carrying interfaces in scope; decide which are worth gating                                               | —       | Written list with the reason each is in or out             |
| 10.2 | ✓      | Prototype the detector (ts-morph: find property declarations with no `PropertyAccessExpression` on the left of an assignment) | 10.1    | Run against `HEAD~1` — must flag all three known instances |
| 10.3 | ✓      | Decide enforcement: `validate:*` script vs. advisory report. Weigh the false-positive rate first                              | 10.2    | Measured FP count on today's tree                          |
| 10.4 | ✓      | Wire into `validate:all` if 10.3 says gate; add to CI's `full` route                                                          | 10.3    | Green on a clean tree, red on a seeded phantom field       |

**Do not skip 10.2's back-test.** A detector that cannot re-find the three known instances is not
measuring the thing that motivated it. **Do not skip 10.3**: fields assigned only via object
literals, spreads, or `Object.assign` will read as unwritten, and the false-positive rate decides
whether this can be a gate at all or has to stay a report.

**Gate**: the detector re-finds every known instance, its false-positive rate is measured, and
it fails on a new phantom field.

| Check                                    | Result                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Back-test `a06287dd^`                    | flags `enhancedGateConfiguration`, `clientOverride`, `clientSelectedGates` — **3/3** |
| Back-test `76630b73^`                    | flags `clientOverride`, `clientSelectedGates` — both present there                   |
| False positives, today's tree            | **0** of 8 findings, each verified by hand                                           |
| Seeded phantom field                     | exit 1, names the field and its declaration site                                     |
| Clean tree                               | exit 0, 72 optional fields across 6 interfaces                                       |
| `--self-test`                            | passes, including a same-name decoy on another interface                             |
| typecheck · unit · integration           | clean · 1847 · 434                                                                   |
| `validate:arch` · contracts · verify:mcp | 442 modules · in sync · 11/11                                                        |

**Risk**: low — analysis only until 10.4; 10.4 ships as a ratchet, so it cannot block on
pre-existing debt.

**Follow-on**: the eight baselined findings are real defects, not detector noise. The
`GateEnforcementInput` pair implies `GateEnforcementAuthority.decide()` is dead along with
both `getCachedDecision()` consumers — the Tier 9 shape at method scope. That is its own tier.

---

## Rejected alternatives

- **Fold Tier 8 into Tier 9** — different risk profiles and different work types. Tier 9 is a
  bounded bug fix with a falsifiable criterion; Tier 8 is open-ended review whose output is more
  planning. Batching them would let the review's uncertainty stall the fix.
- **Decompose the four stages now, using the thresholds as the specification** — the threshold
  says a function is hard to read, not what it should have been instead. Tier 7's value came from
  naming the defect (a duplicated derivation) before extracting; without that step this is
  refactoring toward a number.
- **Delete the dead judge consumers instead of wiring producers** — **chosen** by 9.2 on
  2026-08-02, once 9.1 established the menu was already answerable through inline operators.
  Wiring a producer would have added a second channel structurally shadowed by the first.
