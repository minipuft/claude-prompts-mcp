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
