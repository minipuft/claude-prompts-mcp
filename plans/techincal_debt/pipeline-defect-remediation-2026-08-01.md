---
title: "Pipeline Defect Remediation — 7 Tiers"
date: 2026-08-01
status: done
tags: []
---

# Pipeline Defect Remediation — 7 Tiers (COMPLETE)

**Date**: 2026-08-01 (Tier 7 added 2026-08-02)
**Area**: `server/src/engine/execution/pipeline/`
**Work type**: refactor (secondary: bug_fix)
**Confidence**: high — 18/18 symbol claims verified with zero drift (Phase 2.5); Tier 7 re-verified
12/12 on 2026-08-02

---

## Summary

Six confirmed defects in the prompt execution pipeline, plus a fourth telemetry bug found during
design. Folded into independently shippable tiers. Touches 14 existing files, adds 5 new
(2 are tests).

~~Net ~-180 lines of source.~~ **Measured on completion: `server/src/` is +524 net**
(1206 insertions / 859 deletions across 67 files, plus the 177-line `execution-metrics.ts`).
The estimate assumed extraction is subtraction. It is not: replacing an inline block with a named
function adds its signature, its record types, its doc comment and its guards, and the deleted
lines are only the visible half. Recorded rather than quietly amended — the estimate was the
input to sizing several tiers, and the tiers were still worth doing. What shrank was the thing
actually named as the defect: duplicated derivations, dead branches, and per-function complexity.

**All 7 tiers are complete (2026-08-02).** Tier 6 made stage ordering mechanically enforced.
Tier 7 was promoted from Deferred once measurement showed its bullet was both numerically wrong
and mis-classified; it cleared the coordinator's four remaining complexity violations, one of
them Critical.

**The pipeline's shape is not the problem.** A linear stage sequence over a shared context with a
uniform `execute(context)` interface is the right pattern; it buys per-stage spans, metrics, and
hooks from one 85-line loop. The defects are in the wiring, the numbering, and the observability —
all accreted while stages grew 12 → 23.

---

## Phase 1: Discovery & Triage

### Probe evidence per finding

| #   | Finding                              | Probe                                       | Result                                                                  |
| --- | ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Stale filename prefixes              | `registerStages()` :259-288 vs `fd` listing | CONFIRMED. Exec order 06a→05→06→07→07b→06b. Two files share prefix `10` |
| 2   | 23 positional ctor params            | :34-56 + all 3 call sites                   | CONFIRMED + AMPLIFIED                                                   |
| 3   | DependencyInjectionStage not a stage | `rg pipelineDependencies`                   | CONFIRMED, but `gateEnforcement` is load-bearing                        |
| 4   | Four permanently-non-null stages     | builder :167,176,299,323                    | CONFIRMED. Only tests pass null                                         |
| 5a  | `skippedStages` never mutated        | `rg` → 6 hits, 0 mutations                  | CONFIRMED                                                               |
| 5b  | `mapStageType` covers 7/23           | 23 names vs 7 switch cases                  | CONFIRMED                                                               |
| 5c  | `__probe__` span per request         | :540                                        | CONFIRMED                                                               |
| 6   | metadata bag                         | `rg` (unsound — see Phase 2)                | CORRECTED to 5 keys                                                     |

### Finding 2 amplified — tests prove the hazard is live

`pipeline-telemetry.test.ts:100` hand-scrambles array indices to satisfy positional order:

```
stages[10]!, // frameworkStage
stages[8]!,  // judgeSelectionStage
stages[13]!, // promptGuidanceStage
stages[9]!,  // gateStage
```

A human already had to solve this permutation by hand. Not a latent risk — an active cost.

### Finding 3 blocker

`context.gateEnforcement` has **5 consumers across 3 files**: `08-response-capture-stage.ts:77`,
`07-session-stage.ts:163`, `gate-verdict-processor.ts:48,140,224,428`. `ExecutionContext`'s ctor
takes only `(mcpRequest, logger)` but `GateEnforcementAuthority` needs `chainSessionStore` +
`gateLoader`. Deleting the stage is a design decision, not a mechanical delete.

### Blast radius

`PromptExecutionPipeline` has **3 construction sites**: `pipeline-builder.ts:351`, plus 2 tests.

---

## Phase 2: Design & Pre-flight

### Correction 1 — metadata bag is 5 keys, not 22

Phase 1's `rg -o "metadata\['[a-zA-Z]+'\]"` matched **seven unrelated bags** (chain step prompts,
pending gate reviews, execution results, metric envelopes, resource frontmatter, a dead
`ContextBuilder`). Receiver-scoped grep gives the truth:

`ExecutionContext.metadata` = `pipelineDependencies`, `commandMetricId`, `temporaryGateIds`,
`executionOptions`, `operatorValidation`.

The method was also unsound the other way: `operatorValidation` is written via **spread**
(`03-operator-validation-stage.ts:67`), invisible to bracket-notation grep.

**Consequence**: Finding 6 collapses from "med-high risk, defer" to cheap — and moves _earlier_,
because draining the bag is the precondition for deleting the DI stage.

### Correction 2 — `stepIndex`/`stepNumber` is not a collision

`chain-operator-executor.ts:887-903` honors a consistent convention:

```ts
const directIndex = metadata["stepIndex"]; // used as-is → 0-based
const stepNumber = metadata["stepNumber"];
return stepNumber > 0 ? stepNumber - 1 : 0; // decremented → 1-based
```

Confirmed writer-side: `07-session-stage.ts:171` uses `?? 1`. Both live on
`PendingGateReview.metadata` which crosses SQLite. **Out of scope, no action.**

### New finding 5d — fourth telemetry defect

All writers target `context.state.gates.temporaryGateIds`; `prompt-execution-pipeline.ts:426`
still reads `context.metadata['temporaryGateIds']` → `temporaryGatesApplied` is **permanently 0**
(:440). The same file reads the typed slot correctly at :591. Half-finished migration.

### Uncertainty resolutions

- **U1 — GateEnforcementAuthority home**: builder constructs it (already holds `chainSessionStore`
  :285 + `gateLoader` :313), passes to pipeline, assigned onto context in `execute()`. All 5
  readers unchanged. _Rejected_: widening `ExecutionContext` ctor (couples context to gate
  internals); injecting into 5 sites (3 files for a 1-line problem).
- **U2 — violation response**: **throw at construction**, mitigated by a pure fn unit-tested in CI
  so a miswire fails in CI before startup. _Rejected_: log-and-continue reintroduces the defect.
- **U3 — migration shape**: incremental per key. Nothing spreads/iterates the bag as a unit.

### Pre-flight

```
domain      : pass — ownership matches CLAUDE.md matrix
layer       : FAIL — 00-dependency-injection-stage.ts:51 CONSTRUCTS GateEnforcementAuthority;
              matrix says stages may only CALL it
naming      : pass — 23 behavior-specific names, no vague suffixes
complexity  : FAIL — PROBE: npx eslint → build() complexity 12, max 10
size        : pass w/ note — coordinator 679 ln; all stages ≤361
service     : pass — GateEnforcementAuthority exists; relocate, don't create
defined     : pass — PROBE: internal-state.ts:29 `metricId?: string` DECLARED AND UNUSED
contracts   : pass — 3 construction sites, all typecheck-visible
pattern     : pass — moves logic OUT of a stage toward OOP shell + FP internals
reuse-scope : n/a          persistence : n/a (per-request in-memory)
lib-api     : PARTIAL — 5c needs current OTel API via /docs before implementing
lib-version : deferred to T1 — memory records OTel v2.x drift

failures    : 2
compound    : "complexity + layer → Service extraction needed → Extract before fixing"
              Shared root cause: construction logic accumulated in the wrong places — some in
              a runtime STAGE (layer), some piled into build() (complexity). Remediation is
              already extraction-shaped. Do NOT patch either symptom independently.
```

### Interfaces

```ts
// T6 — stage.ts (both OPTIONAL; existing 22 stages compile unchanged)
export interface PipelineStage {
  readonly name: string;
  readonly provides?: readonly string[];
  readonly requires?: readonly string[];
  execute(context: ExecutionContext): Promise<void>;
}

export interface StageOrderViolation {
  readonly stage: string;
  readonly missing: string;
  readonly producedBy: string | null;
  readonly producedAtIndex: number | null;
}

export function validateStageOrder(
  stages: readonly PipelineStage[]
): readonly StageOrderViolation[];

// T2 — coordinator
constructor(
  stages: readonly PipelineStage[],
  logger: Logger,
  metricsProvider?: () => MetricsCollector | undefined,
  hookRegistry?: HookRegistryPort,
  gateEnforcementFactory?: () => GateEnforcementAuthority   // T4
)
```

Seed declarations encoding the three documented invariants:

| Stage               | provides                                  | requires                                  |
| ------------------- | ----------------------------------------- | ----------------------------------------- |
| SessionManagement   | `sessionContext.currentStep`              | —                                         |
| InjectionControl    | `state.injection`                         | `sessionContext.currentStep`              |
| PromptGuidance      | —                                         | `state.injection`                         |
| JudgeSelection      | `state.framework.clientFrameworkOverride` | —                                         |
| FrameworkResolution | —                                         | `state.framework.clientFrameworkOverride` |

---

## Phase 2.5: Verification

All 14 cited files exist, none is a shim (smallest real file: `index.ts` at 39 ln), **18/18 symbol
line numbers matched exactly — zero drift**.

Two refinements:

1. **T3 scope widens by one assertion.** Four `operatorValidation`/`executionOptions` assertion
   sites, not three: `symbolic-stage.test.ts:263`, `operator-validation-stage.test.ts:43`
   (`toBeUndefined()` negative case) and `:192`, `dependency-injection-stage.test.ts:48`.
2. **`index.ts` is the rename choke point.** 39 lines carrying all 23 stage export paths — makes
   T5 typecheck-verifiable rather than silently breaking imports.

`CLAUDE.md:100` says `Pipeline (22 stages)` while `ls` returns 23 — the documented defect T5 fixes.

---

## Phase 3: Implementation Plan

### Deviation from Phase 2's ordering

Phase 2 put the renumber first (T0). **Reversed.** Renumbering 23 files then deleting one leaves
either a permanent gap at position 02 — recreating the exact "numbers mean nothing" defect — or
forces a second rename pass over 22 files, doubling git rename history and making `git log
--follow` permanently noisier. Renumbering once, after the count settles at 22, costs four tiers
of stale numbers that barely touch stage files.

### Tier 1: Telemetry correctness — ✓ COMPLETE (2026-08-01)

| #       | File                                      | Change                                                                   | ~Ln | Dep | Verify          |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------ | --- | --- | --------------- |
| ✓ 1.1   | `pipeline-telemetry.test.ts`              | ADD failing assertions for all 4 defects BEFORE fixing                   | +90 | —   | 4 RED           |
| ✓ 1.2   | `prompt-execution-pipeline.ts:97,169-188` | Push `stage.name` onto `skippedStages` on early exit                     | +6  | 1.1 | GREEN           |
| ✓ 1.3   | `:641-660`                                | `mapStageType` switch → `Record<string, PipelineStageType>` all 22 names | ~30 | 1.1 | GREEN           |
| ✓ 1.4   | `:535-552`                                | Replace `__probe__` span with non-emitting SDK check                     | ~10 | 1.5 | GREEN           |
| ✓ 1.5   | _(research)_                              | `/docs` → context7 for `@opentelemetry/api` registration check           | 0   | —   | cited in commit |
| ✓ 1.6   | `:426-427`                                | Read `state.gates.temporaryGateIds` not metadata                         | ~4  | 1.1 | GREEN           |
| ✓ 1.7\* | `execution-telemetry.ts` **NEW**          | Extract `enrichRootSpan` (complexity 17) + stage-type table              | +13 | —   | eslint          |

\* Unplanned — added under the Phase 3 pre-flight block, see `implementation-notes.md`.

**Gate**: `npm run typecheck && npm run lint:ratchet && npm run test:ci` — **PASSED**
(also ran: `validate:all` exit 0 · `validate:arch` 438 modules · `verify:mcp` 11/11)

RED-first is mandatory — this surface has **zero** existing coverage, which is why all four bugs survived.
Observed RED: 5 failures / 22 pre-existing passes. Observed GREEN: 1743/1743 across 146 suites.

### Tier 2: Array constructor + de-null — ✓ COMPLETE (2026-08-02)

| #       | File                                         | Change                                                                         | ~Ln | Dep |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------------ | --- | --- |
| ✓ 2.1   | `prompt-execution-pipeline.ts:33-65,244-289` | 23 params → `stages: readonly PipelineStage[]`; delete `registerStages()`      | -55 | T1  |
| ✓ 2.2   | `pipeline-builder.ts:351-378`                | Pass one array literal; ordering rationale moves here                          | ~25 | 2.1 |
| ✓ 2.3   | ~~`pipeline-builder.ts:42-43,51,53`~~        | Drop `\| null`; delete `...(x ? [x] : [])` spreads — **wrong file**, see notes | -8  | 2.1 |
| ✓ 2.4   | `pipeline-orchestrator.test.ts:103-130`      | Positional + 4 nulls → ordered array                                           | ~30 | 2.1 |
| ✓ 2.5   | `pipeline-telemetry.test.ts:100-128`         | Replace hand-scrambled index mapping                                           | ~30 | 2.1 |
| ✓ 2.6\* | `pipeline-builder.ts`                        | Extract `createFrameworkStage` + `resolveResourceManagerHandler`               | ~30 | 2.2 |
| ✓ 2.7\* | `prompt-execution-pipeline.ts`               | Delete dead `getStage()`; throw on empty stage array                           | -4  | 2.1 |

\* Unplanned — 2.6 is what the gate criterion actually required; 2.7 is dead code on the rewritten field. See `implementation-notes.md`.

**Gate**: full suite **+** `npx eslint src/mcp/tools/prompt-engine/core/pipeline-builder.ts` — `build()` complexity must be ≤10 — **PASSED** (violation gone; measured on an isolated worktree, see notes)

Measured: constructor `max-params` 26 → gone · `build()` complexity 12 → under limit ·
coordinator 679 → 548 ln, 29 → 20 problems · ratchet 3463/1409 → 3459/1407 errors/warnings.

### Tier 3: Drain the metadata bag — ✓ COMPLETE (2026-08-02)

**Gate**: full suite — **PASSED**. typecheck clean · ratchet 3454/1407 no regressions ·
unit 1743/146 · integration 426/33 · `validate:all` exit 0 · `verify:mcp` 11/11.

3.0 changed the tier: the bag was **4 keys, not 5** (T1 already retired `temporaryGateIds`),
`operatorValidation` and `executionOptions` had **zero production readers**, and two more
unrelated `metadata` bags surfaced — nine total, not seven. See `implementation-notes.md`.

`ExecutionContext.metadata` now holds exactly one key: `pipelineDependencies` (T4).

| #   | File                                      | Change                                                               | ~Ln | Dep |
| --- | ----------------------------------------- | -------------------------------------------------------------------- | --- | --- |
| 3.0 | _(re-verify)_                             | Re-run receiver-scoped `rg -n "\.metadata\b"` before deleting        | 0   | —   |
| 3.1 | `00-dependency-injection-stage.ts:66-70`  | Delete `executionOptions` write (dead)                               | -5  | 3.0 |
| 3.2 | `dependency-injection-stage.test.ts:48`   | Delete assertion                                                     | -1  | 3.1 |
| 3.3 | `03-operator-validation-stage.ts:66-72`   | Delete `operatorValidation` spread; route to `context.diagnostics`   | ~-8 | 3.0 |
| 3.4 | 3 test files, **4 assertions**            | Retarget to `context.diagnostics`                                    | ~12 | 3.3 |
| 3.5 | `prompt-execution-pipeline.ts:95,493,547` | `commandMetricId` → `state.lifecycle.metricId` (slot exists, unused) | ~6  | 3.0 |

**Gate**: full suite. 3.0 is mandatory — Phase 1's grep missed the spread write.

### Tier 4: Delete DependencyInjectionStage (23 → 22) — ✓ COMPLETE (2026-08-02)

| #       | File                                              | Change                                                                   | ~Ln | Dep     |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------------ | --- | ------- |
| ✓ 4.1   | `gate-verdict-processor.ts:31-34,478-482`         | Add ctor params 3&4; replace the `as` cast                               | ~12 | T3      |
| ✓ 4.2   | `pipeline-builder.ts:285`                         | Pass `hookRegistry`, `notificationEmitter`                               | +2  | 4.1     |
| ✓ 4.3   | builder + `prompt-execution-pipeline.ts:70-82`    | Construct `GateEnforcementAuthority` in builder; assign in `execute()`   | ~14 | 4.1     |
| ✓ 4.4   | `00-dependency-injection-stage.ts`                | **DELETE FILE**                                                          | -80 | 4.1-4.3 |
| ✓ 4.5   | `pipeline/index.ts:10` + `pipeline-builder.ts:30` | Remove export + import                                                   | -2  | 4.4     |
| ✓ 4.6   | `dependency-injection-stage.test.ts`              | **DELETE FILE**                                                          | -70 | 4.4     |
| ✓ 4.7   | `execution-context.ts:70-90`                      | Delete `metadata` field + `@deprecated` block                            | -22 | 4.4     |
| ✓ 4.8\* | `prompt-execution-pipeline.ts` ctor               | Positional ports → `PipelinePorts` object (a 5th param broke max-params) | ~20 | 4.3     |
| ✓ 4.9\* | `execution-telemetry.ts` + 2 pipeline tests       | Drop the deleted stage from `STAGE_TYPES` and both fixtures              | ~10 | 4.4     |

\* Unplanned. 4.8 is forced by Tier 2's own max-params fix; 4.9 is the fallout of 23 → 22. See `implementation-notes.md`.

**Gate**: full suite **+** `npm run validate:arch` — **PASSED**
typecheck clean · ratchet 3454/1406 no regressions · unit 1741/145 · integration 426/33 ·
`validate:arch` 437 modules (was 438) · `validate:all` exit 0 · `verify:mcp` 11/11.

`ExecutionContext.metadata` no longer exists. The pipeline runs **22** stages.

### Tier 5: Renumber 22 files to execution order — ✓ COMPLETE (2026-08-02)

`git mv` to sequential `01-`…`22-`, no letter suffixes:

| New | Stage                 | New | Stage                    |
| --- | --------------------- | --- | ------------------------ |
| 01  | request-normalization | 12  | framework                |
| 02  | execution-lifecycle   | 13  | session                  |
| 03  | identity-resolution   | 14  | injection-control        |
| 04  | parsing               | 15  | prompt-guidance          |
| 05  | inline-gate           | 16  | response-capture         |
| 06  | operator-validation   | 17  | shell-verification       |
| 07  | planning              | 18  | execution                |
| 08  | script-execution      | 19  | phase-guard-verification |
| 09  | script-auto-execute   | 20  | gate-review              |
| 10  | judge-selection       | 21  | formatting               |
| 11  | gate-enhancement      | 22  | post-formatting-cleanup  |

Plus: `index.ts` 22 export paths; builder grouping comments; **strip `MOVED:` / `NOW AFTER:` /
`Now runs after judge decision`** (cleanup-standards historical-breadcrumb rule); `CLAUDE.md:100`
→ 22 stages; `docs/architecture/overview.md`.

**Gate**: full suite **+** `npm run validate:format`

### Tier 6: Make ordering invariants mechanical — ✓ COMPLETE (2026-08-02)

| #     | File                                     | Change                                 | ~Ln  | Dep     |
| ----- | ---------------------------------------- | -------------------------------------- | ---- | ------- |
| ✓ 6.1 | `stage.ts:8-18`                          | Add optional `requires?` / `provides?` | +16  | T5      |
| ✓ 6.2 | `pipeline/validate-stage-order.ts`       | **NEW** — pure validator               | +111 | 6.1     |
| ✓ 6.3 | `tests/.../validate-stage-order.test.ts` | **NEW** — 3 inversions caught          | +188 | 6.2     |
| ✓ 6.4 | 4 stage files                            | Seed `requires`/`provides`             | ~5   | 6.1     |
| ✓ 6.5 | coordinator ctor                         | Call validator; throw on non-empty     | +7   | 6.2,6.4 |

**Gate**: full suite **+** `validate:arch` **+** `verify:mcp` — all green (1770 unit tests, 0 arch
errors, 11/11 MCP checks). Both ratchets report no regressions.

#### Correction: one seeded invariant did not exist

The Phase 2 seed table's third invariant — `JudgeSelection provides
state.framework.clientFrameworkOverride` → `FrameworkResolution requires` it — is unbacked.
`clientFrameworkOverride` is not a field of `InternalState`, and no stage anywhere in `src/` writes
`state.framework.clientOverride` either. Seeding it would have made the validator report a
violation against the production array, so the constructor would have thrown on the first
`prompt_engine` call.

The real coupling behind the same judge-phase constraint is **JudgeSelection provides
`state.framework.clientSelectedStyle`** (`10-judge-selection-stage.ts:105`) → **PromptGuidance
requires it** (`15-prompt-guidance-stage.ts:108,125`). That is what shipped, so 6.4 touched 4 stage
files rather than 5. The same false claim appeared in three comments (`pipeline-builder.ts`,
`15-prompt-guidance-stage.ts:25,100`) and one test comment
(`pipeline-orchestrator.test.ts:22`); all four now describe the real fields.

#### Scope added beyond the plan

6.5 had no test. Three cases were appended to `pipeline-orchestrator.test.ts` covering the
constructor path — accepts a satisfied order, throws on an inverted one, and the message names the
producing stage and index. Without them the wiring that makes this tier mechanical was itself
unverified.

#### What the guard is observably worth

Inverting `sessionStage`/`injectionControlStage` in the production array and rebuilding was run as
a RED check: `verify:mcp` went 11/11 → 10/11 with
`PromptExecutionPipeline received a stage array that violates 1 declared ordering constraint(s)`.
Note the failure shape — `PipelineBuilder.build()` runs on first tool call, not at boot, so an
inversion surfaces as a `prompt_engine` tool error rather than a startup crash. Reverted and
re-verified 11/11.

Two of the five documented constraints stay comment-only: ScriptExecution→ScriptAutoExecute and
ShellVerification→StepExecution couple through template context and verify loops rather than a
named context key, so there is nothing for `provides` to name.

### New file justifications

**`validate-stage-order.ts` (+55)** — cannot live in `stage.ts` (imported by all 22 stages; adding
logic makes every stage depend on it) nor in `prompt-execution-pipeline.ts` (already 679 ln, and
a private method is untestable without constructing a full pipeline). Identification: behavior =
reject an order where a consumer precedes its producer; state = none; shape = function
(statelessness rules out a class); placement = beside `stage.ts`, since a pure predicate over
`PipelineStage` belongs with the interface it constrains.

**`validate-stage-order.test.ts` (+80)** — new unit needs a spec; follows existing layout.

T1-T5 create **zero** new source files.

### Tier 7: Coordinator decomposition — the four unowned violations — ✓ COMPLETE (2026-08-02)

Promoted from Deferred. Flagged in the T1, T2 and T4 notes and survived all three because no tier
owned it. Measured 2026-08-02, `npx eslint prompt-execution-pipeline.ts`:

| Symbol                         | Line | Measured      | Limit |
| ------------------------------ | ---- | ------------- | ----- |
| `executePipelineStages`        | 87   | cyclomatic 17 | 10    |
| `executePipelineStages`        | 87   | cognitive 29  | 15    |
| `recordPipelineStageMetric`    | 316  | 8 params      | 4     |
| `recordCommandExecutionMetric` | 360  | 5 params      | 4     |

Cognitive 29 against a limit of 15 is **Critical** severity, where "deferred" is not an available
resolution — which is why this is a tier and no longer a Deferred bullet.

**Two structural defects, not four.** The parameter counts are symptoms:

- The four memory deltas are derived **twice** from the same two `MemoryUsage` snapshots, at
  `:250` (`logStageMetrics` → `StageMetricSummary`) and `:343` (`recordPipelineStageMetric` →
  `metadata`). Two of the eight parameters exist only to recompute what the previous line in the
  same `finally` already derived. This is the SSOT defect the parameter count was hiding.
- `enrichRootSpan` → `endSpanWithStatus` → `return` repeats **verbatim three times**, at
  `:182/183` (early exit), `:205/206` (completion) and `:220/221` (catch). This is the cyclomatic
  driver and is invisible in the "unnamed locals" framing.

#### Tier 7A — pure derivation, extracted before the coordinator is touched

| #     | File                                          | Change                                                                                                                                                                              | ~Ln  | Dep |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| ✓ 7.1 | `execution-metrics.ts` **NEW**                | `StageAttempt` + `CommandOutcome`; `summarizeStageAttempt`, `buildStageMetric`, `buildCommandMetric`; move `resolveExecutionMode` (:403) and `buildCommandMetricMetadata` (:417) in | +135 | —   |
| ✓ 7.2 | `tests/.../execution-metrics.test.ts` **NEW** | Both payload shapes incl. the four optional-field branches — `sessionId` (:353-355, :396-398), `errorMessage` (:356-358, :399-401)                                                  | +90  | 7.1 |

**Gate 7A**: `typecheck` + `npx eslint execution-metrics.ts` clean + `test:match execution-metrics`

#### Tier 7B — coordinator consumes it

| #     | File                                            | Change                                                                                                                               | ~Ln     | Dep      |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- | -------- |
| ✓ 7.3 | `prompt-execution-pipeline.ts:104-166`          | Extract `runStage(stage, index, context): Promise<StageAttempt>`; loop keeps only the early-exit check                               | -70/+45 | 7.1      |
| ✓ 7.4 | `prompt-execution-pipeline.ts:182-222`          | Extract `finishRootSpan(rootSpan, outcome)`; call at all three sites                                                                 | -18/+12 | —        |
| ✓ 7.5 | `prompt-execution-pipeline.ts:239-256, 316-402` | Recorders to `(attempt, context)` / `(context, outcome)`. **Replace** `logStageMetrics` with `summarizeStageAttempt` — do NOT delete | -95     | 7.1, 7.3 |
| ✓ 7.6 | this file                                       | Delete the Deferred bullet this tier replaces                                                                                        | ~-1     | 7.5      |

**Gate 7B**: full suite **+** `validate:arch` **+** `verify:mcp`, plus the tier criterion —
`npx eslint prompt-execution-pipeline.ts` reports **0** complexity/cognitive/max-params violations
(from 4), `rg "heapUsedDelta"` on that file returns **0** hits (from 2), and
`git diff --stat -- server/tests/` shows **no change to any existing test file**.

7.4 is independent and may land first. 7.3-7.5 all edit one file, so they serialize.

#### Outcome

Tier criterion met as specified: complexity/cognitive/max-params violations on
`prompt-execution-pipeline.ts` **4 → 0**, `heapUsedDelta` in that file **2 → 0**, and
`git diff --stat -- server/tests/` shows no change to any existing test file — the only test
change is the new `execution-metrics.test.ts`. Gate 7A and 7B both green; 147 suites / 1788 unit
tests, 33 suites / 430 integration tests, `validate:arch` 439 modules, `verify:mcp` 11/11.

**One extraction more than planned.** 7.3 specified `runStage` alone, which was not enough:
with the loop still inline, `executePipelineStages` measured over the cyclomatic limit. The loop
became `runStages(context, stageMetrics)` and the two exit-log payloads became `logCompletion`.
Three module-level pure helpers absorbed the branch-heavy ternaries — `toError`, `messageAsError`,
and the `StageFailure`/`StageRunResult`/`RootSpanOutcome` records.

**`runStage` reports its failure rather than rethrowing.** The plan's signature returned
`Promise<StageAttempt>`, which cannot express a stage that threw: the original `finally` recorded
metrics for the failing stage _before_ the throw propagated, so a rethrowing `runStage` would
either lose that entry or need the accumulator passed in. It returns `{ summary, failure? }` and
`runStages` rethrows after recording, which keeps control flow in the loop that owns it.

**Line count went up, not down.** The plan's row estimates summed to roughly -126 in the
coordinator; the measured change is **571 → 550 (-21)**, against **+171** in `execution-metrics.ts`
and **+218** in its spec. The estimates counted deleted lines and not the named types, doc comments
and guards that replacing an inline block requires. The tier's criterion was violation count, not
size, and that criterion is met — but "decomposition shrinks the codebase" was not true here and
the estimates should not be reused as evidence that it is.

**Two behavioral edges preserved deliberately**, both invisible to `tsc`:
`messageAsError` returns `undefined` for an empty message, matching the original truthiness check —
otherwise an empty-message error would newly call `span.recordException`. And `buildStageMetric`
reads the four memory values off the summary individually rather than spreading it, because
spreading would add `stage` and `durationMs` keys to the emitted `metadata` object that
`pipeline-telemetry.test.ts:86` captures.

#### Why `logStageMetrics` is replaced, not deleted

Its return value feeds the `stageMetrics[]` array that `enrichRootSpan` consumes at `:182`, `:205`
and `:220`. The method and its debug-log side effect move to `execution-metrics.ts`; the returned
`StageMetricSummary` has to survive as `summarizeStageAttempt` or the root span silently loses its
`cpm.stages.slowest` and `cpm.stages.skipped` attributes.

#### New file justification

**`execution-metrics.ts` (+135)** — the Existing > New candidate was `execution-telemetry.ts`
(135 ln, same directory, already imported by the coordinator, already exports `StageMetricSummary`).
Rejected on **responsibility count**, not line count: that module builds OTel `Attributes` for the
span exporter; these functions build `PipelineStageMetric`/`CommandExecutionMetric` for
`MetricsCollector`. Different consumers, different contracts, different reasons to change. The
resulting ~270 ln would also cross the 200-line utility ceiling, but that is the weaker argument.
Identification: behavior = turn one stage's execution outcome into the payloads timing, logging,
spans and metrics all read; state = none; shape = module of pure functions over a plain record
(statelessness rules out a class); placement = beside `execution-telemetry.ts`, its sibling by
construction. Rejected alternative: keep the builders private and collapse the parameter lists into
an options object — satisfies `max-params` while leaving the duplicated derivation intact, i.e.
turns the linter green and misses the defect.

**Risk**: medium. Hot path for every `prompt_engine` call, and a changed emission shape would not
fail `tsc`. Mitigated by `pipeline-telemetry.test.ts:86`, which captures the actual emitted
`PipelineStageMetric` objects — the prohibition on editing that file is load-bearing, not stylistic.

**Independent of T6**: T6 edits only the constructor; T7 touches `:104-402`. No shared line range,
so order between them is free.

---

## Phase 4-6: Validation & Completion

### Testing strategy

| What to test                | Type        | Location                              | Why this type                                                             |
| --------------------------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------- |
| 4 telemetry emissions       | unit        | `pipeline-telemetry.test.ts`          | Span/metric payloads are observable at the collector boundary without I/O |
| Stage array wiring          | unit        | `pipeline-orchestrator.test.ts`       | Order is a pure property of the array                                     |
| `validateStageOrder`        | unit        | `validate-stage-order.test.ts` (new)  | Pure fn — table-driven, no pipeline needed                                |
| Gate verdict DI             | unit        | `step-response-capture-stage.test.ts` | Ctor injection is compile-checked; test proves runtime emission           |
| Full pipeline still answers | integration | `npm run verify:mcp`                  | Only end-to-end proof all 3 MCP tools respond from a fresh `dist/`        |
| Renumber correctness        | mechanical  | `ls` vs builder array                 | Not a behavior — a structural invariant                                   |

### Done criteria

| Criterion               | Validation                             | Pass condition           |
| ----------------------- | -------------------------------------- | ------------------------ |
| Numbering matches order | `ls stages/` vs builder array          | 1:1, no gaps, no letters |
| Miswire caught          | `npm test -- validate-stage-order`     | Mis-ordered array throws |
| Telemetry accurate      | telemetry suite                        | 4 assertions green       |
| No junk spans           | grep collector output / test assertion | Zero `__probe__`         |
| Stage count             | `ls stages/*.ts \| wc -l`              | 22                       |
| Bag gone                | `rg "context.metadata" src/`           | 0 hits                   |
| Complexity              | `npx eslint pipeline-builder.ts`       | `build()` ≤10            |
| Contract intact         | `npm run verify:mcp`                   | All 3 tools answer       |
| No scope creep          | `git diff main --stat`                 | Only planned files       |

### Documentation

| Doc                                      | Update                                         |
| ---------------------------------------- | ---------------------------------------------- |
| `CLAUDE.md:100`                          | 22 stages (T5)                                 |
| `docs/architecture/overview.md`          | Stage list + count (T5)                        |
| `CHANGELOG.md`                           | 3 entries below (T6)                           |
| `docs/guides/telemetry-observability.md` | Note corrected attributes if it documents them |

### Risks

| Risk                                       | Impact                 | Mitigation                                                                                  | Rollback         |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| OTel API differs from recall               | T1 blocked             | 1.5 gates 1.4 on context7; memory records v2.x drift                                        | Revert T1 commit |
| `gateEnforcement` unset when a reader runs | Gate processing breaks | Assigned in `execute()` before any stage — strictly earlier than the old stage-2 assignment | Revert T4        |
| lint:ratchet blocks                        | CI red                 | T2 removes ~30 lines, expected to lower complexity; T2 gate runs eslint explicitly          | Revert tier      |
| Missed import in 22 renames                | Build breaks           | `index.ts` single choke point; typecheck total; `git mv` preserves history                  | `git mv` back    |

### Release

- **Convention**: Conventional Commits, one commit per tier
- **Scopes**: `pipeline` (T1-T5), `execution` (T3-T4), `docs` (T5)
- Suggested: `fix(pipeline):` T1 · `refactor(pipeline):` T2 · `refactor(execution):` T3 ·
  `refactor(execution):` T4 · `refactor(pipeline):` T5 · `feat(pipeline):` T6

### Changelog

- **Fixed** — Pipeline telemetry now reports accurate values: skipped stage names were always
  empty, 16 of 23 stages reported an 'other' stage type, temporary gate counts were always zero,
  and a probe span was exported on every request.
- **Changed** — `PromptExecutionPipeline` takes an ordered stage array instead of 23 positional
  parameters, and stage files are numbered to match execution order. Ordering invariants are now
  asserted at construction instead of documented in comments.
- **Removed** — `DependencyInjectionStage` and the untyped `ExecutionContext.metadata` bag; gate
  services receive dependencies by constructor injection. Pipeline is 22 stages.

### Growth capture

- [ ] **Grep-method correction (high signal)**: `rg -o "metadata\['key'\]"` is unsound — misses
      spread writes and matches same-named bags on unrelated types. Scope by receiver
      (`context.metadata`), not by key shape. This produced a 22-vs-5 error that would have
      mis-sized a whole tier. → `/search` skill.
- [ ] **Half-finished migration leaves stale reads**: `temporaryGateIds` writers moved to the typed
      slot; the metrics read did not follow, silently zeroing a metric. Migration checklist must be
      _move write → move read → delete old read → grep_. → `/refactoring`.
- [ ] **Renumber-once ordering**: when a plan both renames-for-clarity and changes item count, do
      the count change first. Otherwise two rename passes. → memory.
- [ ] Memory: `reference_chain_execution_internals.md` — add the pipeline stage inventory and the
      3 ordering invariants once T6 lands.

---

## Deferred / out of scope

- Bag C `stepIndex`/`stepNumber` — verified correct (0-based vs 1-based), crosses SQLite
- Bags B/D/E/F (17 keys) — different owners, unrelated to `ExecutionContext`
- Dead `ContextBuilder` class (zero instantiations) — separate `npx knip` sweep
- 36 pre-existing eslint errors in touched files — ratchet holds the line

## Rollback protocol

One commit per tier; tier boundaries are the rollback points. If a gate fails: stop, do not
proceed (dev-workflow Failure Protocol), diagnose as syntax / logic / integration, fix root cause,
re-run the gate.
