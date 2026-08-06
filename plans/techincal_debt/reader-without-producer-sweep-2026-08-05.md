---
title: "Reader-without-producer sweep — gate retry API and analyzer config"
date: 2026-08-05
status: backlog
tags: [technical-debt, gates, config, dead-code]
---

# Reader-without-producer sweep

**Area**: `server/src/engine/gates/core/`, `server/src/engine/gates/types.ts`,
`server/src/modules/semantic/content-analyzer.ts`, `server/src/mcp/tools/index.ts`
**Work type**: refactor
**Origin**: measured while executing
[semantic-llm-sidecar-retirement-2026-08-05](../semantic-llm-sidecar-retirement-2026-08-05.md)
(filed there as **F9** and **F11**). Carried here so the actionable findings sit in the working set
rather than inside a finished plan. Citing that plan is also what keeps it classified `reference`
instead of `done` — `plans/archive/` is gitignored, and archiving a document something points at
would break the citation.

**Both were deliberately NOT executed inside that plan.** F9 belongs to the gate _retry_ system,
a different lineage from the semantic sidecar. F11 cannot be executed until the deprecation cycle
it depends on completes. Neither is a deferral of that plan's own scope.

---

## F9 — The gate retry-hint API has no callers ✓ DONE 2026-08-05

**Executed.** The prediction below held: the hints ship, only the public re-entry API was orphaned.
Deleted `GateValidator.shouldRetry`, `LightweightGateSystem.shouldRetry`,
`LightweightGateSystem.getRetryHints`, the `retryRequests` statistic, and the dead `StepResult` —
84 lines. Two integration tests now pin the surviving path.

**Three corrections this spec needed, all found by measuring before editing:**

1. **`GateValidator.getRetryHints` does not exist.** The row below attributes it to `GateValidator`;
   it was defined only on `LightweightGateSystem`, and standalone rather than delegating. One
   delegating pair, one singleton.
2. **`retryRequests` was stranded by the deletion** — its only writer was inside `shouldRetry`.
   Left behind it would have been declared, initialised, reset and returned by `getStatistics()`
   with zero writers: the declaration-dead shape this repo runs validators against. Caused by the
   tier, so removed in it.
3. **The `StepResult` in `engine/gates/types.ts` was entirely dead, not just its field.** Word-exact
   search returned zero consumers. Deleting only `validationResults` would have left a dead
   duplicate interface behind — the interface was the unit, not the field.

**Verification shape.** Behaviour-preserving, so the survivor tests were written and run **before**
the deletion (486 green) — an assertion that only passes afterward proves nothing. Falsified by
stubbing `generateRetryHints` to `[]`, which failed exactly `validateGate still returns hints when a
gate fails` and only that one; the companion passing-gate case correctly stayed green, since a
passing gate yields `[]` either way.

**The homonym held.** `argument-parser.ts` carries its own live, written, tested `validationResults`
(argument validation, not gates). Untouched, and its tests were the control.

**A gate caught what typecheck could not.** Removing `retryRequests` with a 4-space `String.replace`
pattern matched inside a 6-space-indented line and left two stray spaces. `typecheck` passed —
TypeScript does not read indentation — and `lint:ratchet` failed on `prettier/prettier` 0→1.

**Unresolved, reported rather than closed**: one transient integration failure (`1 failed, 485
passed`) on the first post-deletion run, not reproduced in eight subsequent full runs including
three of the identical command. Its identity was not captured. The shell_verify tests spawn real
subprocesses, which is a plausible source of load-sensitivity — plausible, not evidenced.

---

### Original measurement (2026-08-05, kept for the record)

Measured 2026-08-05:

| Symbol                         | Finding                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `GateValidator.shouldRetry`    | `gates/core/index.ts:252` delegates to it; **nothing calls that wrapper**        |
| `GateValidator.getRetryHints`  | same shape — `rg "\.shouldRetry\(\|\.getRetryHints\("` finds only the delegation |
| `StepResult.validationResults` | `engine/gates/types.ts:298` — **no writers**                                     |

**The decision this needs first, before any deletion.** Zero writers admits two readings, and the
user-facing interface decides which: either the retry path is _meant_ to be live and its producer
was never wired, or it is a redundant channel superseded by something else. The sibling case in the
retiring plan (T2.5) resolved the same shape as **redundant**, because `%judge` routes verdicts
through `gate_verdict` → `GateVerdictProcessor` instead. Retry hints may or may not have an
equivalent live replacement — `generateRetryHints` IS called from `validateGate`, so the hints are
produced and returned inside `ValidationResult`; what is unreachable is the _public_ re-entry API.

So the likely finding is narrower than "the retry system is dead": the hints ship, and only the
externally-callable wrappers are orphaned. **Verify that before deleting anything.**

**Do not** absorb this into an unrelated tier. It changes `ValidationResult`/`StepResult` shape,
which is a different unit of review from deleting two methods.

## F11 — `ContentAnalyzer` is handed a config it never reads ✓ DONE 2026-08-05

`ContentAnalyzer` stores `SemanticAnalysisConfig` and exposes `getConfig` / `updateConfig`, and
reads no field from it — the last one (the `llmIntegration` cache-key term) went with the sidecar
retirement. Both accessors have **zero `src/` callers**; only tests call them. So
`mcp/tools/index.ts:216 → configManager.getSemanticAnalysisConfig()` is a live wire into a dead
terminal.

**Executed in a non-major, because this entry over-bundled.** It claimed everything below shared one
retirement trigger. It does not — the list mixes two different risk classes:

| Removed now (internal TypeScript, outside the declared contract)        | Retained until the major (contract)                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ContentAnalyzer` config field, ctor param, `getConfig`, `updateConfig` | the `analysis.semanticAnalysis` section itself                                                        |
| `createContentAnalyzer`'s config parameter                              | its parsing, defaulting and startup warning                                                           |
| the `mcp/tools/index.ts` fetch that existed only to pass it in          | `AnalysisConfig`, `SemanticAnalysisConfig`, `LLMIntegrationConfig` — the parser still reads all three |
| `ConfigManager.getAnalysisConfig` / `getSemanticAnalysisConfig`         | `validate-no-llm-client.js` and its allowlist                                                         |

**Why the split rather than the whole list.** One commit earlier (`d219f8b7`) we published — in
`CHANGELOG.md`, in `config.schema.json` as `"deprecated": true`, and in a warning users see at
startup — that the section is removed _in the next major_. Deleting it now would falsify a notice
shipped the same week, and it is the only part of this work a user could observe. F11's actual
finding never required it: "handed a config it never reads" is entirely about the plumbing.

**The retained half is proven, not asserted.** `legacy-key-migration.test.ts` is byte-unchanged and
its four T4 tests pass; removing the warning call failed exactly the two warning cases and left the
other two green, so the guard discriminates.

**Retirement trigger for what remains**: the major that removes the section. The guard's
satisfied-exception check will then report its allowlist entries as stale — the intended signal.

---

## F13 — A second `StepResult`, in a closed dead loop ✓ DONE 2026-08-05 (**10 types, not 3**)

Found while executing F9. `shared/types/index.ts` holds a **duplicate** `StepResult` — near-identical
to the one F9 deleted, differing only in using `ValidationResultContract[]` where the gates copy used
`ValidationResult[]`. It is not orphaned outright; it is worse than that, because the chain closes on
itself:

| Type                          | Consumers                                              |
| ----------------------------- | ------------------------------------------------------ |
| `ValidationResultContract`    | only `StepResult` (same file, `:227`)                  |
| `StepResult`                  | only `EnhancedChainExecutionState` (same file, `:366`) |
| `EnhancedChainExecutionState` | **none** — word-exact, whole repo                      |

Three types, each justified only by the next, and the last justified by nothing. Every individual
`rg` looks like a live consumer; only walking the chain to its end shows the loop is unreachable.
That is why a per-symbol dead-code check would pass all three.

**Executed — and the island was 10 types, not 3.** The three above were simply the ones I walked
first. Also dead, each referenced only by another member: `ChainStepResult`,
`GateEvaluationResultContract`, `GateRequirementContract`, `GateStatus` (the shared copy),
`ExecutionState`, `ChainExecutionProgress`, `ChainStepProgress`. An **11th** went with them —
`engine/gates/types.ts`'s own `GateStatus`, orphaned by F9 when it deleted the `StepResult` that
referenced it, and missed at the time.

**`GateStatus` nearly escaped, for the third time in this initiative.** It looked live to the first
scan because a _second_ `GateStatus` exists in `engine/gates/types.ts` — a duplicate name, not a
consumer. Same trap as `GateValidationResult` (excluded from the guard's forbidden list for this
reason) and `validationResults` (live in `argument-parser.ts`). A name-keyed dead-code check is
wrong three times out of three here; only walking edges works.

**The unbuilt-vs-superseded question, answered.** This entry warned that deleting an unbuilt design
discards it silently. It is superseded, not unbuilt: live chain state ships elsewhere —
`sqlite-engine.ts:639` runs `json_extract(cs.state, '$.state.totalSteps')` and
`observability-resources.ts` reads `session.state.totalSteps` / `currentStep` / `pendingReview`.
`EnhancedChainExecutionState` is the abandoned earlier shape of a concept that does exist.

**Deliberately not folded into F9.** F9 named `engine/gates/types.ts`; this is a different file and a
different lineage — chain-execution contract types, not gate validation. Same shape, different
subsystem, so it gets its own review.

**Before deleting**, resolve the duplication rather than just the deadness: two `StepResult`
interfaces existing at all is the finding underneath this one. Check whether the `shared/types` copy
was the intended canonical (it sits beside `ChainStepResult`, whose header at
`engine/execution/types.ts:102` declares `shared/types/index.ts` the canonical home for cross-layer
contract types) and whether `EnhancedChainExecutionState` was a chain-execution design that never
landed. If it was, this is not dead code — it is an unbuilt feature, and deleting it silently
discards the design.

---

## F14 — Nine dead types in `shared/types/index.ts` (**corrected 2026-08-06**)

**This entry was wrong twice and is now measured properly. Read the corrections before acting.**

### Correction 1 — it is nine, not ten. `GateRetryInfo` is LIVE.

`GateRetryInfo` is consumed by `GateValidationInfo`, which has **10 external consumers**. It read as
orphaned only because the scan counted hits _outside_ `shared/types/index.ts`, and its sole consumer
lives inside that file. Deleting it would have broken a live structured-response contract.

The scan errs in **both** directions, which is the reusable lesson:

| Error                  | Cause                                                         | Instance               |
| ---------------------- | ------------------------------------------------------------- | ---------------------- |
| over-reports liveness  | a duplicate definition elsewhere counts as a consumer         | `GateStatus` (F13)     |
| under-reports liveness | a type consumed only intra-file by a live type looks orphaned | `GateRetryInfo` (here) |

**The correct test is transitive reachability**, not a hit count: mark every type with external
consumers live, then propagate liveness to everything they reference, to a fixpoint. What remains
unreachable is dead. The nine below are the fixpoint result.

### Correction 2 — Express is NOT retired; these are duplicates of its real types

The earlier text called `ExpressRequest`/`ExpressResponse` "hand-rolled shims for a framework this
server no longer uses." **False.** `express@^5.2.1` is a live dependency, imported at
`infra/http/index.ts:14` and `infra/http/transport/index.ts:24`, and `@types/express` is installed.
These two are hand-rolled _duplicates_ of types Express already ships, and the real ones are what
the HTTP layer actually uses. That makes them ordinary dead code, not a design question.

### The nine

| Type                                                                                            | Verdict                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiResponse` · `ServerRefreshOptions` · `ServerState` · `FileOperation` · `ModificationResult` | plainly dead                                                                                                                                                                                                                                 |
| `ExpressRequest` · `ExpressResponse`                                                            | dead duplicates of `@types/express` — see Correction 2                                                                                                                                                                                       |
| `AutoExecutionConfig`                                                                           | dead; its fields (`stepConfirmation`, `gateValidation`, `pauseOnError`) match the abandoned chain-execution family F13 deleted. Script auto-execution (`09-script-auto-execute-stage.ts`) is a different, live concept — do not confuse them |
| `TelemetryRuntimePort`                                                                          | **duplicate seam**, not an abandoned one — see below                                                                                                                                                                                         |

### `TelemetryRuntimePort` — the only one that was a real question, and it is answered

Not "a port with no implementor." It is a **second declaration of a seam that is already
implemented under another name**: `TelemetryRuntime` lives at
`infra/observability/telemetry/types.ts:20`, is implemented by `TelemetryRuntimeImpl`
(`runtime.ts:73`), and is consumed across `hook-observer.ts` and `observability-resources.ts`.

The Port's own doc comment says _"Concrete: infra/observability/telemetry/runtime.ts
TelemetryRuntimeImpl"_ — and that class implements `TelemetryRuntime`, not the Port. The comment
describes a relationship that does not exist.

**Decision required**: none, if the goal is to remove dead code — `TelemetryRuntime` is canonical,
so delete the Port. A decision IS required only if someone wants the _engine layer_ to depend on a
shared-layer port rather than reach into `infra/` — that is an architecture question about layer
direction, and it should be decided on its own merits, not by whichever duplicate happened to
survive a cleanup.

### What I actually need from you

Nothing blocking. Eight of the nine are unambiguous deletions. The one judgment call is the
`TelemetryRuntimePort` layering question above, and the conservative default (delete the duplicate,
keep `TelemetryRuntime`) preserves today's behaviour exactly.

Worth confirming rather than assuming: whether any **downstream plugin** imports these from the
published package. `src/index.ts` exports only the four server-lifecycle functions and this package
is declared a binary distribution, so the expected answer is no — but that is the only way these
types could have a consumer this repo cannot see.

---

## Sequencing

F9 ✓, F11 ✓, F13 ✓ — all done. F14 is the remainder: **nine** types (not ten — `GateRetryInfo` is
live), eight of them unambiguous deletions, one a layering question whose conservative default
preserves current behaviour. Nothing blocks it.
