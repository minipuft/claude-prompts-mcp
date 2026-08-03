---
title: "Implementation Notes — Pipeline Defect Remediation"
date: 2026-08-01
status: reference
tags: []
---

# Implementation notes — pipeline defect remediation

Companion to `pipeline-defect-remediation-2026-08-01.md`. Records where execution
departed from the plan and why. Highest-signal input to the next planning pass.

---

## Tier 1 — Telemetry correctness (2026-08-01)

### Deviations

**D1 — `cpm.stages.skipped` is derived, not accumulated.**
The plan (step 1.2) said "push `stage.name` onto `skippedStages` on early exit". That
would have recorded the stage that _caused_ the exit — which ran, so it is not skipped —
and it would still have emitted `''` on the error path, because a throw leaves the loop
before any push site. Both are the same bug in a new place.

The `finally` block appends one `stageMetrics` entry per stage that _starts_, including
the one that throws. So `registeredStageNames.slice(stageMetrics.length)` is exactly the
set that never ran, and it is correct for normal completion, early exit, and throw with
no mutable accumulator at all. The `skippedStages` local and the `enrichRootSpan`
parameter are both gone. Net **-4** lines rather than the planned +6.

Test coverage reflects the widened scope: three cases (early exit, full run, throw)
rather than one.

**D2 — one new source file, `execution-telemetry.ts` (+139).**
The plan asserts "T1-T5 create zero new source files". Pre-flight broke that:

```
npx eslint src/engine/execution/pipeline/prompt-execution-pipeline.ts
  569:complexity   — 'enrichRootSpan' has a complexity of 17. Maximum allowed is 10.
  569:max-params   — 'enrichRootSpan' has too many parameters (6). Maximum allowed is 4.
```

`enrichRootSpan` is the function steps 1.2 and 1.3 modify, and cyclomatic >10 is a
Critical block (`refactoring.md`), not an advisory. Compound diagnosis: `complexity` +
`layer` → **service extraction needed** — the same diagnosis Phase 2 recorded for this
file.

Identification: behavior = derive telemetry payload values from an execution's collected
data; state = none; shape = module of pure functions plus one const table (statelessness
rules out a class); placement = beside the coordinator that is its only consumer, not
`infra/observability`, because it is keyed by pipeline stage names.

Rejected alternatives: private methods on the coordinator (`architecture.md` forbids
helper methods in orchestration, and the file is already 679 ln against a 150 advisory);
inlining the stage-type table in the coordinator (grows an already over-size file with
data that has no other reason to sit there).

Result: `enrichRootSpan` clears both violations; file-level problem count 31 → 29.

**D3 — `PipelineStageType` gained 9 members, not a like-for-like table swap.**
Step 1.3 said "switch → Record ... all 22 names". The union only had 10 usable members
for 23 stage names, so a table alone would still have collapsed most stages into
`'other'`. Added `normalization`, `lifecycle`, `identity`, `script`, `judge_selection`,
`injection_control`, `prompt_guidance`, `verification`, `gate_review`.

Safe because `stageType` has exactly one producer and zero readers beyond the type
declaration (`rg -n "stageType" src/ tests/`). The union already carried three members
no branch produced — `inline_gate`, `operator_validation`, `response_capture` — which is
what a table designed for full coverage looks like after the switch stopped keeping up.

`DependencyInjection` maps to `'lifecycle'` rather than earning its own member, because
Tier 4 deletes that stage; minting a public type member with a three-tier lifespan is the
churn `cleanup-standards.md` exists to prevent.

**D4 — the probe span was removed, not replaced.**
Step 1.4 said "replace `__probe__` span with non-emitting SDK check". There is no public
`@opentelemetry/api` predicate for "is a real provider registered" — but none is needed.
Starting the _real_ root span and asking whether it records answers the question without
a second span: the no-op tracer returns a `NonRecordingSpan` that is never exported.

Verified against `@opentelemetry/api@1.9.1` (installed; declared `^1.9.0`) — step 1.5.
`doc/sdk-registration.md`: `trace.getTracer()` "returns a tracer from the registered
global tracer provider (no-op if a working provider has not been initialized)".
`sdk-trace-base/README.md`: "The default OpenTelemetry tracer provider does not record
any tracing information."

Side effect worth knowing: a root span the sampler drops now also reports
`isRecording() === false`, which suppresses its child stage spans. That is the intended
relationship — the old probe used a different span name, so sampling decisions could
diverge between the probe and the span it was standing in for.

### Found during execution, not in the plan

**Test fixtures named a stage that does not exist.** Both `pipeline-telemetry.test.ts`
and `pipeline-orchestrator.test.ts` build a fake stage called `FrameworkInjectionControl`;
the production literal in `07b-injection-control-stage.ts:45` is `InjectionControl`.
Harmless while the fixtures only assert ordering, but the Tier 1 stage-type assertions are
keyed by production name, so the telemetry fixture was corrected.

→ `pipeline-orchestrator.test.ts:25` still carries the wrong name. **Fix in Tier 2**,
which rewrites that constructor call anyway.

### Not fixed — deliberately out of scope

Pre-existing violations in `prompt-execution-pipeline.ts` left standing, all on methods
where Tier 1 changed a single line:

| Line | Rule                         | Owner                          |
| ---- | ---------------------------- | ------------------------------ |
| 35   | max-params (26)              | **Tier 2** — array constructor |
| 86   | complexity 17 / cognitive 29 | unowned — see below            |
| 369  | max-params (8)               | unowned                        |
| 413  | max-params (5)               | unowned                        |

`executePipelineStages` at cognitive 29 against a 15 limit is a Critical-severity block
that **no tier currently owns**. Tier 2 shrinks the constructor, not this method. Worth a
tier of its own or an explicit deferral.

### Measured

| Check                               | Result                                          |
| ----------------------------------- | ----------------------------------------------- |
| RED (before fixes)                  | 5 failed / 22 passed                            |
| `npm run test:ci`                   | 1743 passed / 146 suites                        |
| `npm run typecheck`                 | clean                                           |
| `npm run lint:ratchet`              | 3463 errors, 1409 warnings — no regression      |
| `npm run validate:all`              | exit 0                                          |
| `npm run validate:arch`             | 438 modules, 0 errors (2 pre-existing warnings) |
| `npm run verify:mcp`                | 11/11                                           |
| `npx eslint execution-telemetry.ts` | 0 problems                                      |

---

## Tier 2 — Array constructor + de-null (2026-08-02)

### Verified in isolation, not in the working tree

A second session was editing this repo concurrently — 16 unrelated files modified
(`framework-manager.ts`, `prompt-executor.ts`, `runtime/*`, `system-control/*`). The
shared `lint:ratchet` was red on `import-x/order` (+2) from _their_ in-flight work, so a
tree-wide gate run could neither pass nor be attributed.

Tier 2 was therefore gated on a detached worktree at `HEAD` carrying only its four files.
Every number below is from that run. Reproduce with:

```
git worktree add <dir> HEAD --detach
# copy the 4 tier files in, then run the gate
```

Do not `git stash` to isolate work while another session is live — it moves their
uncommitted changes too. (Learned the hard way; recovered intact.)

### Deviations

**D5 — step 2.3 named the wrong file.**
The plan pointed at `pipeline-builder.ts:42-43,51,53` for "drop `| null`". Those lines are
import specifiers (`FrameworkResolutionStage,` `JudgeSelectionStage,`). The four
`PipelineStage | null` declarations were in `prompt-execution-pipeline.ts:43-44,52,54`,
and they died with the constructor rewrite in 2.1 rather than needing a separate step.

The builder never passed `null` for any of them: `ScriptExecutionStage`,
`ScriptAutoExecuteStage`, `createShellVerificationStage`, and
`createPhaseGuardVerificationStage` are all constructed unconditionally, and the two
factories return non-nullable types. Finding 4 confirmed — the optionality was decorative.

**D6 — the gate criterion needed an extraction the plan didn't budget.**
`build()` measured cyclomatic 12 against a limit of 10, and the tier's gate demands ≤10.
Moving the ordering into an array literal does not remove a single decision point, so
steps 2.1-2.5 alone would have left the gate failing. Extracted two private methods:

| Extracted                         | Removes                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| `createFrameworkStage()`          | the manager-present ternary (-1)                              |
| `resolveResourceManagerHandler()` | `mcpToolsManager?.getResourceManagerHandler?.() ?? null` (-3) |

Both are private methods on a factory, which `architecture.md` permits (services orchestrate
in public, stay pure in private) — unlike the same move on an orchestration stage.

`build()` is still ~270 lines. No rule blocks it and the tier does not own it, but a
factory method that long is a candidate for grouping along the section comments it already
carries (`Stage 00`, `01-04`, `05-07`, `08-12`).

**D7 — deleted `getStage()`.**
Zero references in `src/`, `tests/`, or `docs/`. Its docstring claimed "for diagnostics and
testing"; neither used it. It was the only reader of `this.stages` besides the executor, so
leaving it beside a freshly rewritten field is the stale-breadcrumb pattern
`cleanup-standards.md` names. Internal TS exports are outside the declared public API
contract (project `CLAUDE.md`), so this is not a semver event.

**D8 — added a construction-time guard.**
`if (stages.length === 0) throw`. An empty array previously surfaced as "Pipeline completed
without producing a response" at request time; now it fails where the mistake is.

### Carry-over from Tier 1, resolved

`pipeline-orchestrator.test.ts` built a fake stage named `FrameworkInjectionControl`;
production is `InjectionControl` (`07b-injection-control-stage.ts:45`). Corrected.

### Found during execution, not in the plan

**`npm run typecheck` does not cover tests.** `tsconfig.json` sets
`"exclude": ["node_modules", "dist", "tests"]`. Both test files called the constructor with
26 positional arguments after 2.1 landed, and typecheck reported clean — only Jest caught
it.

This matters more than it looks for this tier specifically. Tier 2's premise is that 23
type-identical positional parameters cannot be order-checked. An array does fix _arity_
drift at production call sites, but test call sites get no compile-time check at all, and
ordering is still unchecked everywhere — which is what Tier 6 exists for.

Worth deciding separately: add a `tsconfig.test.json` plus a `typecheck:tests` script, or
accept Jest as the only test-call-site check.

### Not fixed — deliberately out of scope

`executePipelineStages` remains at cyclomatic 17 / cognitive 29 against limits of 10 / 15.
Flagged in Tier 1 as unowned; Tier 2 shrank the constructor, not this method. Still unowned.

### Measured (isolated worktree at `2ddd763f` + 4 tier files)

| Check                          | Before               | After                        |
| ------------------------------ | -------------------- | ---------------------------- |
| constructor `max-params`       | 26 (limit 4)         | **gone**                     |
| `build()` complexity           | 12 (limit 10)        | **gone**                     |
| `prompt-execution-pipeline.ts` | 679 ln, 29 problems  | 548 ln, 20 problems          |
| `pipeline-builder.ts` problems | 13                   | 12                           |
| `lint:ratchet`                 | 3463 err / 1409 warn | 3459 / 1407 — no regressions |
| `npm run typecheck`            | clean                | clean                        |
| `npm run test:ci`              | 1743 / 146 suites    | 1743 / 146 suites            |
| `npm run validate:all`         | exit 0               | exit 0                       |
| `npm run verify:mcp`           | 11/11                | 11/11                        |

---

## Tier 3 — Drain the metadata bag (2026-08-02)

Gated on a detached worktree at `094baec6` carrying only the seven tier files, same
procedure as Tier 2 — a concurrent session still holds ~30 unrelated files in the shared tree.

### Step 3.0 rewrote the tier

3.0 was marked mandatory because Phase 1's grep was unsound. It was right to be. Re-running
the census receiver-scoped changed three of the tier's premises:

**The bag was 4 keys, not 5.** Tier 1 already retired `temporaryGateIds` when it moved the
`temporaryGatesApplied` read to `state.gates`. Nothing referenced it any more.

**Two of the four had zero production readers.**

| Key                    | Writers                    | Production readers                | Disposition                  |
| ---------------------- | -------------------------- | --------------------------------- | ---------------------------- |
| `commandMetricId`      | pipeline:82                | pipeline:425, 478                 | → `state.lifecycle.metricId` |
| `operatorValidation`   | 03-operator-validation:69  | **none** (3 test assertions only) | → `context.diagnostics`      |
| `executionOptions`     | 00-dependency-injection:67 | **none** (own guard only)         | deleted                      |
| `pipelineDependencies` | 00-dependency-injection:57 | gate-verdict-processor:478        | Tier 4                       |

`operatorValidation` was write-only state — a stage computing a value, storing it in a shared
bag, and nothing ever branching on it. That is what `DiagnosticAccumulator` already exists for,
so it became `context.diagnostics.debug(...)` rather than a typed slot nothing would read.

**There are nine unrelated `metadata` bags, not seven.** The Tier 1 correction undercounted.
Two more surfaced here, both of which a name-only grep reports as hits on the bag being drained:

- `gates/core/index.ts:202` — `context.metadata = validationContext.metadata` assigns a **local
  `ValidationContext`**, declared four lines above. Reads as a wholesale clobber of the
  `ExecutionContext` bag; is not.
- `mcp/tools/prompt-engine/utils/context-builder.ts:314,326,331` — `EnhancedExecutionContext`,
  a separate shape. It reads `metadata['executionId']`, a key no writer in the repo sets.

Neither was touched. The lesson holds from Tier 1: grep the receiver, never the key name.

### Deviations

**D9 — `operatorValidation` routed to diagnostics, and its "absence" assertion had to change
shape.** `operator-validation-stage.test.ts:43` asserted
`expect(context.metadata.operatorValidation).toBeUndefined()`. The diagnostics equivalent is
`expect(context.diagnostics.getByStage('OperatorValidation')).toEqual([])` — an empty
accumulator rather than an absent key. Same guarantee, different assertion shape.

**D10 — updated the `@deprecated` docblock on `ExecutionContext.metadata`.** It listed
`executionOptions` as one of the "infrastructure keys that remain", which this tier deleted.
Left alone it would have been a stale breadcrumb pointing at a key that no longer exists.
It now names the single remaining key and says the field can be deleted with it.

### Found during execution, not in the plan

**`framework-stage.test.ts:415-429` contained a commented-out test carrying the author's
unresolved reasoning** — `// This seems wrong in the original test if it expects skip? Ah,
no, ...`, `// Wait, let's look at the original test.` — wrapped around a dead
`expect(context.metadata['frameworkSystemPromptApplied']).toBeUndefined()`.
**Cleaned up on request; see the Tier 3 addendum below.**

### Measured (isolated worktree at `094baec6` + 7 tier files)

| Check                      | Result                                |
| -------------------------- | ------------------------------------- |
| `npm run typecheck`        | clean                                 |
| `npm run lint:ratchet`     | 3454 err / 1407 warn — no regressions |
| `npm run test:ci`          | 1743 passed / 146 suites              |
| `npm run test:integration` | 426 passed / 33 suites                |
| `npm run validate:all`     | exit 0                                |
| `npm run verify:mcp`       | 11/11                                 |

Integration was run explicitly this tier: `response-capture-hooks.test.ts` writes
`pipelineDependencies` at three sites, so the bag has integration-level coverage that the
unit suite does not exercise. Relevant to Tier 4, which removes that writer.

### Addendum — `framework-stage.test.ts` cleanup

The comment block was the symptom; the cause was a fixture that contradicted its own test name.

`test('skips framework resolution when system disabled and no override provided')` set
`frameworkOverride: 'SCAMPER'` in its setup. That reads as a direct contradiction — and as a
contradiction of its sibling three lines up,
`test('applies framework override even when framework system is disabled')`. The original
author noticed, reasoned in a `/* */` block, and left the reasoning in the file unresolved.

Both tests are correct. The override each sets lives on a **different object**:

| Field                                                   | Read by production code |
| ------------------------------------------------------- | ----------------------- |
| `context.parsedCommand.executionPlan.frameworkOverride` | yes — every site        |
| `context.executionPlan.frameworkOverride`               | **no site anywhere**    |

Probe: `rg -n "frameworkOverride" src/` — all seven read sites go through
`parsedCommand?.executionPlan?.frameworkOverride` (`06-framework-stage.ts:99,192`,
`06b-prompt-guidance-stage.ts:328`, `judge-menu-formatter.ts:145`,
`execution-planner.ts:140`, `framework-decision-authority.ts:43`).

So the "skips" test set an override the stage cannot see, took the skip branch for the reason
its name claims, and passed — while reading as though it asserted the opposite. Removing that
one line makes the fixture match the name. A comment now records which field the stage reads,
since that is the non-obvious part that caused the confusion.

The sibling "applies" test sets the override on **both** objects and was left alone: that
mirrors a real run, where planning populates `context.executionPlan` from the parsed command.

Verified: `framework-stage.test.ts` 10/10, full unit suite 1756/146 suites, typecheck clean.

**Left standing** — `framework-stage.test.ts` types `strategy: 'prompt'` at four sites, which
is not a member of `ExecutionStrategyType`. Invisible to `npm run typecheck` for the reason
Tier 2 recorded: `tsconfig.json` excludes `tests`. Same root cause, different file; not fixed
here.

---

## Tier 4 — Delete DependencyInjectionStage (2026-08-02)

Gated on a detached worktree at `6c499633`. This tier snapshots `node_modules` into the
worktree instead of symlinking it: mid-tier the shared `node_modules` was torn down and
rebuilt by the concurrent session, and typecheck started reporting `Cannot find name 'Array'`
— TypeScript's own lib files were briefly absent. A symlinked worktree inherits that.

### What the stage actually did

Two things per request, neither of them request-dependent:

1. `context.gateEnforcement = new GateEnforcementAuthority(chainSessionStore, logger, gateLoader)`
   — all three inputs are constructor-injected, so the same object was rebuilt on every request.
2. Wrote `pipelineDependencies`, a **6-field object of which 2 fields had a reader**.
   `frameworkEnabled`, `analyticsService`, `temporaryGateRegistry`, and `pipelineVersion` were
   write-only; only `hookRegistry` and `notificationEmitter` were ever read, at exactly one
   site (`gate-verdict-processor.ts:478`).

Finding 3 confirmed, and stronger than recorded: the stage did no work any consumer observed.

### The bag was laundering a type across a layer boundary

This is the part the plan did not anticipate, and it is the reason the tier was not mechanical.

`emitGateEvents` calls seven methods — `emitGateEvaluated`, `emitGateFailed`,
`emitRetryExhausted`, `emitResponseBlocked` on the hook registry, and three more on the
notification emitter. **None of them are declared on `HookRegistryPort` or
`McpNotificationEmitterPort`**, which declare only `emitBeforeStage`/`emitAfterStage`/
`emitStageError` and `canSend`/`setServer` respectively.

The value's static type is narrowed to the port at the `mcp/` boundary
(`prompt-executor.ts:289`, `mcp/tools/index.ts:281`) while the runtime object stays the
concrete `HookRegistry` created in `application.ts`. The metadata bag — being
`Record<string, unknown>` — let `engine/` cast it back with `as` and call methods the
declared type does not have. Remove the bag and the hole becomes a compile error.

Widening the ports would make `shared/types/index.ts` import `GateDefinition` from
`engine/gates/types.ts`, plus `GateEvaluationResult`/`HookExecutionContext` from `infra/hooks`
and three notification payload types from `infra/observability` — `shared` is the bottom
layer, so that inverts the graph. **Out of scope for this tier; the contract's home is an
open question.**

Interim: the constructor takes the honest port types, and `emitGateEvents` narrows once with
two `Pick<>` aliases naming exactly the methods it needs. Same single cast as before, but now
compile-time visible, documented, and adjacent to the call instead of hidden in a bag read.

### Deviations

**D11 — the pipeline constructor became an options object (4.8).**
Plan step 4.3 has the builder construct `GateEnforcementAuthority` and the pipeline assign it
per request. That needs the pipeline to receive it — a 5th positional parameter, which
re-breaks the `max-params` limit Tier 2 had just cleared on this exact constructor.

Introduced `PipelinePorts { logger, metricsProvider?, hookRegistry?, gateEnforcement? }`;
the constructor is now `(stages, ports)`. Two parameters, and the list can grow again without
another round of this. Cost: the same three construction sites Tier 2 rewrote get rewritten
again — the plan assumed T2 would leave five positional params, so the collision was
structural, not a mistake in either tier.

Assignment happens at the top of `execute()`, before `startRootSpan`, so it is set earlier
than the old stage-2 assignment. No reader can observe it unset.

**D12 — `STAGE_TYPES` lost its `DependencyInjection` row (4.9).**
Tier 1 deliberately mapped that stage to `'lifecycle'` rather than minting a union member for
a stage due to be deleted. That decision paid off here: removing the stage needed only a row
deletion, no change to `PipelineStageType`.

**D13 — the integration test's three metadata writes became constructor injection.**
`response-capture-hooks.test.ts` built its stage in `beforeEach` with a hookless processor and
then smuggled hooks in per test via `context.metadata['pipelineDependencies']`. Both
`hookRegistry` and `notificationEmitter` are already constructed in the same `beforeEach`
above the stage, so they now go straight into the processor and all three writes are gone.

### Found during execution

**Two of my own Tier 1 tests broke on hardcoded indices.** `cpm.stages.skipped` assertions used
`stageNames.slice(5)` and `slice(8)`, derived from `CommandParsing` being index 4 and
`ExecutionPlanning` index 7. Removing a stage shifted both by one.

That is the same brittleness class this whole plan is about, reproduced in the tests written to
verify the fix. Replaced with a `stagesAfter(name)` helper that derives the slice point from
`indexOf`, so the assertions survive the Tier 5 renumber and any future stage change.

**One import-order violation was mine**, caught only because the tier was gated in isolation —
in the shared tree it would have been indistinguishable from the concurrent session's
pre-existing `import-x/order` noise. `npx eslint --fix` on the one file.

### Not fixed — deliberately out of scope

- The port/concrete gap above.
- `executePipelineStages` at cyclomatic 17 / cognitive 29. Flagged in Tiers 1 and 2; still
  unowned by any tier.

### Measured (isolated worktree at `6c499633` + 9 tier files, 2 deletions)

| Check                      | Result                                |
| -------------------------- | ------------------------------------- |
| `npm run typecheck`        | clean                                 |
| `npm run lint:ratchet`     | 3454 err / 1406 warn — no regressions |
| `npm run test:ci`          | 1741 passed / 145 suites              |
| `npm run test:integration` | 426 passed / 33 suites                |
| `npm run validate:arch`    | 437 modules (was 438), 0 errors       |
| `npm run validate:all`     | exit 0                                |
| `npm run verify:mcp`       | 11/11                                 |

Suite counts drop by one file and two tests — that is the deleted
`dependency-injection-stage.test.ts`, not lost coverage: its two assertions covered the
`pipelineDependencies` write (now deleted) and `gateEnforcement` initialization (now covered
by every pipeline test, since the pipeline assigns it on every request).

---

## Tier 5 — Renumber 22 files to execution order (2026-08-02)

### D14 — the rename table was correct; the "Plus" list was not

The 22-row rename table was verified against the `stages` array in
`pipeline-builder.ts:355-378` before any file moved: 22 entries, same sequence, no
drift. That part of the tier executed as written.

The three follow-on items listed after the table did not survive contact:

| Plan said                                                       | Measured                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| strip `MOVED:` / `NOW AFTER:` / `Now runs after judge decision` | **zero** such comments exist in `stages/`. The only `src/` matches are `REMOVED:` markers in `mcp/tools/index.ts`, `chainUtils.ts`, `monitor.ts` about the deleted modular-chain system — unrelated scope |
| `CLAUDE.md:100` → 22 stages                                     | the line is 111, and it already said 22 — no work                                                                                                                                                         |
| `docs/architecture/overview.md`                                 | three stale counts, only one of them in this file                                                                                                                                                         |

### D15 — ~90 numeric stage references the plan did not account for

The tier's real cost was not the renames. Comments across ten modules name stages by
number (`Stage 09b`, `pipeline stage 08`, `InjectionControlStage (07b)`). Renaming the
files does not make these stale — it makes them **wrong**, pointing at a different
stage than before. Leaving them would have made the tree less accurate than it was
before the tier ran.

Resolved by replacing the number with the **stage name**, not the new number. A
positional number is the thing this tier exists to stop trusting; re-numbering the
prose would re-arm the same trap for the next reorder. `StepResponseCaptureStage` is
stable and greppable, `Stage 08` is neither.

Two classes needed judgment rather than substitution, because the old scheme was
ambiguous: `00` covered three stages and `10` covered two. Each of the 23 sites was
resolved by locating the behaviour the comment described:

- `metadata.judge`, `shellVerifyPassedForGates` auto-pass, `pendingReview` feedback
  rendering, `formatGateShellVerifySection` → all `GateReviewStage`
- `buildGateValidationInfo` caller, chain-terminal execution record → `ResponseFormattingStage`
  (`StepExecutionStage` emits the per-step record)
- `normalizedCommand` / command-string baking → `RequestNormalizationStage`

### D16 — near-miss: `Stage 1` / `Stage 2` in gate-set-resolver is a different concept

`gate-set-resolver.ts` and its test describe gate resolution as "Stage 1 (additive
union) then Stage 2 (veto set)". Nine sites, nothing to do with the pipeline. A
blind numeric sed across `src/` would have corrupted them silently — they type-check
and pass either way, so no gate would have caught it. The sweep matched two-digit
forms only and these were reviewed out by hand.

### D17 — the stage-order doc had been wrong since Tier 4

`docs/architecture/overview.md` listed `DependencyInjection` at position 2 (deleted in
T4) and omitted `IdentityResolution` entirely. The two errors cancelled in the total,
so the block still said 22 and read as correct. Also carried `AssertionVerification`,
renamed to `PhaseGuardVerification` at some earlier point. T4's gate did not catch
this and T5's file list would not have either — it named `CLAUDE.md:100`, which was
already right.

Also corrected the claim that "execution order is determined by the pipeline
orchestrator, not file names". That was true when file numbers were arbitrary; now
they match, and the honest statement is that the `stages` array is the contract and
a renamed file changes nothing on its own.

### Gate

| Check                             | Result                                      |
| --------------------------------- | ------------------------------------------- |
| `npm run typecheck`               | clean                                       |
| `npm run lint:ratchet`            | 3437 errors / 1405 warnings, no regressions |
| `npm run typecheck:tests:ratchet` | 395 in `tests/`, no regressions             |
| `npm run test:ci`                 | 145 suites / 1754 tests                     |
| `npm run test:integration`        | 33 suites / 430 tests                       |
| `npm run validate:all`            | exit 0                                      |
| `npm run validate:format`         | all files match                             |
| `npm run validate:arch`           | 437 modules, 2 pre-existing warnings        |
| `npm run verify:mcp`              | 11/11                                       |

51 import paths were checked programmatically against the filesystem before the gate
ran: all 51 resolve. The tests-typecheck ratchet added earlier this session earned its
keep here — it is the check that proves 28 rewritten test files still compile, which
`npm run typecheck` cannot see.

---

## D18 — T6: a seeded invariant that did not exist (2026-08-02)

Phase 2 designed three seed invariants. Probing before writing them found the third one
false: `state.framework.clientFrameworkOverride` is not a field of `InternalState`, and
`state.framework.clientOverride` — the field that does exist — has **no producer anywhere
in `src/`**. Seeding either would have made the validator report a violation against the
production array, and the constructor throws on non-empty, so the first `prompt_engine`
call after T6 would have failed.

The real judge-phase coupling is `clientSelectedStyle`: written by JudgeSelection at
`10-judge-selection-stage.ts:105`, read by PromptGuidance at `15-prompt-guidance-stage.ts:108,125`.

**Why it was worth probing a design that came from a verified Phase 2.5.** Phase 2.5
verified 18/18 _symbol line numbers_, which is a different claim from _this field exists
and this stage writes it_. A line-number check answers "is the citation current"; it does
not answer "is the assertion at that line true". The seed table's entries were prose in
the Phase 2 design, never a cited symbol, so nothing in 2.5 covered them.

Generalizes: **a plan's verification pass certifies the claims it enumerated, not the
plan.** Rows added to a design after (or beside) the verification pass carry the
confidence of the section they sit in, which is zero.

### Also corrected

The same false field appeared in four comments that had been asserting it for some time —
`pipeline-builder.ts` (stage-array rationale), `15-prompt-guidance-stage.ts:25,100`, and
`pipeline-orchestrator.test.ts:22`. Leaving a false comment beside a newly-true
declaration is worse than either alone, so all four were rewritten to the real fields.

### Scope added

6.5 (constructor calls validator, throws) shipped with no test in the plan. Three cases
appended to `pipeline-orchestrator.test.ts`. The tier's whole value is that a miswire
fails mechanically; leaving the mechanism itself unverified would have been the same
class of gap T6 exists to close.

### RED induced, not assumed

`sessionStage`/`injectionControlStage` were swapped in the production array and the server
rebuilt: `verify:mcp` 11/11 → 10/11 with the constraint-violation message. Worth recording
the failure _shape_: `PipelineBuilder.build()` runs on first tool call, not at boot, so an
inversion surfaces as a `prompt_engine` tool error, not a startup crash. "Throws at
construction" is true but does not mean "fails fast at startup".

### Gate

| Check                                | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| `npm run typecheck`                  | clean                                        |
| `npx eslint validate-stage-order.ts` | 0 problems (after decomposition — see below) |
| `npm run lint:ratchet`               | 3437 / 1405, no regressions                  |
| `npm run typecheck:tests:ratchet`    | 395 in `tests/`, no regressions              |
| `npm test`                           | 146 suites / 1770 tests                      |
| `npm run validate:arch`              | 438 modules, 2 pre-existing warnings         |
| `npm run verify:mcp`                 | 11/11                                        |

First draft of `validateStageOrder` measured **cyclomatic 11 against a limit of 10** — the
`?? []` and `?.`/`?? null` chains each count a branch, which is invisible when reading for
control flow. Decomposed into `indexFirstProducers` + `toViolation` + the loop. eslint
reports it only as a warning; the refactoring rule treats it as blocking, which is why it
was fixed rather than accepted at 11.

---

## D19 — T7: the estimate said the code would shrink; it grew (2026-08-02)

The tier's own criterion was violation count, and it was met exactly: complexity /
cognitive / max-params on `prompt-execution-pipeline.ts` **4 → 0**, `heapUsedDelta` in
that file **2 → 0**, no existing test file modified.

But the plan's row estimates summed to roughly **-126** lines in the coordinator. Measured:
**571 → 550, i.e. -21**, against **+171** in the new `execution-metrics.ts` and **+218** in
its spec. The estimates counted the lines an extraction deletes and skipped the named
types, doc comments and guards that replacing an inline block requires — a `StageAttempt`
record, a `StageRunResult`, a `RootSpanOutcome`, and three module-level helpers did not
exist to be estimated.

The same error is in the plan's Summary at whole-plan scale: it claimed "net ~-180 lines
of source" across all seven tiers. Measured on completion, `server/src/` is **+524**
(1206 insertions / 859 deletions across 67 files, plus the untracked 177-line
`execution-metrics.ts`). Both numbers are now struck through in place rather than
amended, because the estimate was an input to sizing.

Generalizes: **an extraction estimate that only counts the source block is a floor, not a
figure.** Worth stating because "decomposition shrinks the codebase" is the intuition the
estimate encoded, and it was false here. The work was still correct — the defect was a
duplicated derivation and a thrice-repeated tail, neither of which is a size problem.

### Two design corrections found while implementing

**`runStage` cannot return `Promise<StageAttempt>`.** The plan's signature has no way to
express a stage that threw. The original `finally` recorded the failing stage's metrics
_before_ the throw propagated, so a rethrowing `runStage` would either drop that entry or
need the accumulator threaded in. It returns `{ summary, failure? }` and `runStages`
rethrows after recording — control flow stays in the loop that owns it.

**One extraction was not enough.** 7.3 named `runStage` alone; with the loop still inline,
`executePipelineStages` stayed over the cyclomatic limit. The loop became `runStages` and
the two exit-log payloads became `logCompletion`. Early exit and full completion were
deliberately _not_ merged into one log call: they are different events with different
payloads, and collapsing them to satisfy a linter is the failure mode the tier's own
rejected-alternative note warns about.

### Two behavioral edges preserved on purpose, both invisible to tsc

- `messageAsError` returns `undefined` for an empty string, matching the original truthy
  check. A `!== undefined` test would newly call `span.recordException` for an
  empty-message error.
- `buildStageMetric` reads the four memory values off the summary individually instead of
  spreading it. Spreading would add `stage` and `durationMs` keys to the emitted
  `metadata`, which `pipeline-telemetry.test.ts:86` captures — the emission shape is
  asserted, and `tsc` would not have caught the change.

### Gate

| Check                             | Result                                   |
| --------------------------------- | ---------------------------------------- |
| `npm run typecheck`               | clean                                    |
| `npx eslint execution-metrics.ts` | 0 problems                               |
| `npm run lint:ratchet`            | 3433 / 1401, no regressions (down 4 / 4) |
| `npm run typecheck:tests:ratchet` | 395 in `tests/`, no regressions          |
| `npm test`                        | 147 suites / 1788 tests                  |
| `npm run test:integration`        | 33 suites / 430 tests                    |
| `npm run validate:arch`           | 439 modules, 2 pre-existing warnings     |
| `npm run verify:mcp`              | 11/11                                    |

## Tier 11 — ChainIdCodec (2026-08-02)

### Deviations

- **D20 — the tier's own inventory was wrong in both directions, and re-measuring changed
  the design.** Tier 8 F1 recorded "two code copies + four prose assertions". Probing the
  regex literal instead of the method names found six _executable_ literals (two of the four
  "prose" sites are inlined Zod regexes) and, decisively, an already-exported
  `CHAIN_ID_PATTERN` in `shared/utils/constants.ts` holding the same regex with two live
  importers. Had the codec been written to the plan's inventory it would have become a
  seventh copy of the format sitting beside a sixth. The `defined` pre-flight check —
  "defined elsewhere? PROBE: rg `<symbol>` ALL modules" — is what caught it; the plan
  authored one day earlier had already missed it.

- **D21 — the tier was mis-sold as a correctness defect and executed anyway.** 8.4 ranked
  Tier 11 first because it "carries a correctness defect rather than a layering one". It does
  not: both strip copies are byte-identical, both parse copies behave identically on every
  input, and every prompt id in the repo conforms to the validating character class, so no id
  can be minted that validation would later reject. The defect is latent drift. The _ranking_
  still holds for a different reason — it is the smallest and the only pure substitution — so
  the tier ran, with the justification corrected in the plan rather than silently inherited.

- **D22 — one finding was outside the tier and taken anyway, because it was the same defect.**
  `shared/utils/` held two different constants both named `CHAIN_ID_PATTERN`: the run-id regex
  and, in `chainUtils.ts`, a filesystem-slug regex. Not in the tier scope, three lines to fix,
  and squarely the confusion the tier exists to remove — a future `rg CHAIN_ID_PATTERN` would
  otherwise return two unrelated things. Renamed to `CHAIN_SLUG_PATTERN` with each constant's
  doc naming the other.

- **D23 — `nextRunNumber` moved to the codec, `getRunHistory` did not.** The stage's
  `getNextRunNumber` mixed a pure derivation with an I/O fetch. Only the pure half is in the
  codec, which takes the history as data; the stage still owns the fetch. Keeps the codec free
  of state and I/O, which is what makes it a utility rather than a service.

- **D24 — `extractChainId` in `prompt-executor.ts` was simplified, not just rewired.** It ran
  `command.trim().match(CHAIN_ID_PATTERN)` and returned `match[0]` — with an anchored pattern
  that is a whole-string test spelled as an extraction. Replaced with the codec's `isChainId`
  guard. Behaviour-preserving, and it stops the call site from depending on the pattern
  staying anchored.

### Lint accounting

`lint:ratchet` measures the whole working tree, which currently carries a concurrent session's
uncommitted CLI/release work, so it cannot attribute a violation. Measured instead by linting
exactly the 11 changed source files against a detached `HEAD` worktree: **332 → 329**, the
delta being −3 `strict-boolean-expressions` and no rule increased. Two violations I did
introduce (`import-x/order`, `prettier/prettier`) were found this way and fixed before commit.

## Tier 12 — framework-requirement derivation (2026-08-02)

### Deviations

- **D25 — the tier's prescribed approach was rejected, and the rejection is the finding.**
  8.4 said "fold framework-requirement derivation into `FrameworkDecisionAuthority`" and
  priced the risk as cache _timing_. Probing the caller graph first (`rg` for
  `frameworkAuthority` outside the authority's own directory) showed
  `GateEnhancementService.getActiveFrameworkId` calls `getFrameworkId` → `decide()` from
  **stage 11**, one stage earlier, on the main path for both single prompts and chains. Since
  `decide()` caches on first call, a requirement folded into it would be computed before
  stage 12 loads `currentRequestFrameworkGates` — so every gate-derived requirement would
  evaluate against an empty set and read false. Not a timing risk to be differentialled; a
  fold that cannot work. The stage keeps the derivation, and the code now says why.

- **D26 — the "duplicated block" was strictly weaker than duplicated.** The first block was
  guarded by `!decision.shouldApply`, which makes the second block's extra
  `|| decision.shouldApply` term a no-op in precisely that state. Same inputs, same value,
  same branch, same log message — it could not change an outcome. So the deletion is
  subsumption rather than equivalence-under-change, which is a stronger claim than the
  differential alone would give. The differential was still written and still run against
  unmodified `HEAD` (17/17 both sides), because the argument is only as good as its premise
  about the guard.

- **D27 — a Tier-9-class dead field was found by hand and removed, not repaired.** The
  stage's `buildDecisionInput` set `globalActiveFramework` from
  `context.frameworkContext?.selectedFramework?.id`; `rg` for writers of that property
  returns two, both in this same stage and both downstream of the read. Structurally always
  `undefined`. Applying the Zero-Writers rule — the user-facing interface decides whether a
  reader-with-no-writer means a missing producer or a redundant channel — the channel already
  has a real producer in `GateEnhancementService`, and `FrameworkManager.selectFramework({})`
  independently resolves the active framework from the same state store, so nothing is
  observably broken. Adding a second producer to "fix" it would have been the wrong repair.
  Removed, with the real producer named in a comment.

- **D28 — three private predicates were left in the stage against `architecture.md`.**
  `chainStepsRequireFramework`, `stepRequiresFramework`, and `hasFrameworkGate` are private
  helpers on an orchestration class, which the layer model bans. They close over the
  request-scoped framework-gate set that this stage loads asynchronously in `execute`. Moving
  them without moving that load would hide an async dependency behind a synchronous call —
  the same trap as D25 one level down. Recorded rather than silently accepted.

### Lint accounting

Same method as Tier 11: eslint over the single changed source file against a detached `HEAD`
worktree. **17 → 13** — `sonarjs/cognitive-complexity` (23 → under 15) and
`@typescript-eslint/no-unused-vars` (the unused deprecated `FrameworkSelection` import)
cleared, `no-unnecessary-condition` and `strict-boolean-expressions` each down one, nothing
added.
