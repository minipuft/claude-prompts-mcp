---
title: "Pipeline Follow-up — Tiers 8-14"
date: 2026-08-02
status: active
tags: []
---

# Pipeline Follow-up — Tiers 8-14

**Date**: 2026-08-02
**Area**: `server/src/engine/execution/pipeline/`, `server/src/engine/gates/`
**Work type**: Tier 8 = explore, review only (**✓ complete 2026-08-02**) · Tier 9 = bug_fix
(**✓ complete 2026-08-02**, `76630b73`) · Tier 10 = explore → tooling (raised by Tier 9) ·
**Tiers 11-14 = refactor, scoped by Tier 8** — Tier 11 ✓ complete 2026-08-02; 12-14 open
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
