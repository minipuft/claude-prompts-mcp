# Pipeline Defect Remediation — 6 Tiers

**Date**: 2026-08-01
**Area**: `server/src/engine/execution/pipeline/`
**Work type**: refactor (secondary: bug_fix)
**Confidence**: high — 18/18 symbol claims verified with zero drift (Phase 2.5)

---

## Summary

Six confirmed defects in the prompt execution pipeline, plus a fourth telemetry bug found during
design. Folded into six independently shippable tiers. Touches 14 existing files, adds 3 new
(2 are tests). Net ~-180 lines of source.

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

### Tier 6: Make ordering invariants mechanical

| #   | File                                     | Change                                 | ~Ln | Dep     |
| --- | ---------------------------------------- | -------------------------------------- | --- | ------- |
| 6.1 | `stage.ts:8-18`                          | Add optional `requires?` / `provides?` | +8  | T5      |
| 6.2 | `pipeline/validate-stage-order.ts`       | **NEW** — pure validator               | +55 | 6.1     |
| 6.3 | `tests/.../validate-stage-order.test.ts` | **NEW** — 3 inversions caught          | +80 | 6.2     |
| 6.4 | 5 stage files                            | Seed `requires`/`provides`             | ~15 | 6.1     |
| 6.5 | coordinator ctor                         | Call validator; throw on non-empty     | +10 | 6.2,6.4 |

**Gate**: full suite **+** `validate:arch` **+** `verify:mcp`

### New file justifications

**`validate-stage-order.ts` (+55)** — cannot live in `stage.ts` (imported by all 22 stages; adding
logic makes every stage depend on it) nor in `prompt-execution-pipeline.ts` (already 679 ln, and
a private method is untestable without constructing a full pipeline). Identification: behavior =
reject an order where a consumer precedes its producer; state = none; shape = function
(statelessness rules out a class); placement = beside `stage.ts`, since a pure predicate over
`PipelineStage` belongs with the interface it constrains.

**`validate-stage-order.test.ts` (+80)** — new unit needs a spec; follows existing layout.

T1-T5 create **zero** new source files.

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
- Coordinator stays >advisory at ~620 ln; extracting the telemetry half is a follow-up

## Rollback protocol

One commit per tier; tier boundaries are the rollback points. If a gate fails: stop, do not
proceed (dev-workflow Failure Protocol), diagnose as syntax / logic / integration, fix root cause,
re-run the gate.
