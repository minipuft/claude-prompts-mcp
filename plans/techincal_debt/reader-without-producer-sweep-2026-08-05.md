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

## F11 — `ContentAnalyzer` is handed a config it never reads

`ContentAnalyzer` stores `SemanticAnalysisConfig` and exposes `getConfig` / `updateConfig`, and
reads no field from it — the last one (the `llmIntegration` cache-key term) went with the sidecar
retirement. Both accessors have **zero `src/` callers**; only tests call them. So
`mcp/tools/index.ts:216 → configManager.getSemanticAnalysisConfig()` is a live wire into a dead
terminal.

**Blocked by design, not by scope.** The `analysis` config section is deprecated-in-place and stays
parsed for one cycle (that plan's T0.1), so this plumbing has to survive until the removal major
regardless. Executing it early would delete the thing the deprecation warning describes.

**Retirement trigger**: the same major that removes the `analysis` section. At that point
`getAnalysisConfig`, `getSemanticAnalysisConfig`, `AnalysisConfig`, `SemanticAnalysisConfig`,
`LLMIntegrationConfig`, the `ContentAnalyzer` constructor parameter, and
`server/scripts/validate-no-llm-client.js` (whose allowlist exists only for this plumbing) all go
together. The guard's own satisfied-exception check will report its allowlist entries as stale when
that happens, which is the intended signal.

---

## F13 — A second `StepResult`, in a closed dead loop of three types

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

## Sequencing

F9 ✓ done. F13 is independently actionable now. F11 is not — it waits on the major. Do not bundle
them into one tier just because they were measured together; they share a shape, not a trigger.
