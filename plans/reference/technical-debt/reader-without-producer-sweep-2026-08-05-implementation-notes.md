---
title: "Reader-without-producer sweep — Implementation Notes"
plan: plans/reference/technical-debt/reader-without-producer-sweep-2026-08-05.md
date: 2026-08-05
status: reference
tags: [technical-debt, gates, dead-code]
---

# Implementation Notes

Deviations and re-measurements from executing F9, F11 and F13. F14 remains open.

Created retroactively at the same time as the sidecar plan's notes — see that file's **D0** for why
neither existed during execution.

---

## Deviations

### D1 — F9's spec named a method that does not exist

**Spec said**: `GateValidator.shouldRetry` **and** `getRetryHints`, both with the delegate-plus-
wrapper shape.

**Measured**: `getRetryHints` was defined only on `LightweightGateSystem`, standalone, formatting
hints already present on `ValidationResult`. One delegating pair, one singleton.

### D2 — F9 stranded a statistic, which went in the same commit

`GateValidationStatistics.retryRequests` was incremented at exactly one site — **inside**
`shouldRetry`. Deleting the method left the field declared, initialised, reset, and returned by
`getStatistics()` with zero writers: the declaration-dead shape this repo runs validators against.

Removed in the same change rather than becoming the next finding, per the caused-by-this-tier rule
used throughout the sidecar plan.

### D3 — F9's target was the interface, not the field

Spec: "`StepResult.validationResults` has no writers." Measured: the **entire `StepResult`** in
`engine/gates/types.ts` had zero consumers. Deleting only the field would have left a dead duplicate
interface behind.

### D4 — F13 was ten types, not three, plus an eleventh from F9

Walking every edge found a closed island: `ChainStepResult`, `GateEvaluationResultContract`,
`GateRequirementContract`, `GateStatus`, `ValidationResultContract`, `StepResult`, `ExecutionState`,
`EnhancedChainExecutionState`, `ChainExecutionProgress`, `ChainStepProgress`. The eleventh —
`engine/gates/types.ts`'s own `GateStatus` — had been orphaned by the F9 commit and missed at the
time.

### D5 — F11 executed in a non-major by splitting it, against its own retirement list

The entry claimed the plumbing and the config types shared one trigger. They do not. Split into
internal (removed) and contract (retained), because the section's removal had been published as
next-major one commit earlier. Detail in the sidecar notes, **D5**.

---

## Re-measurements

| Spec claim                                      | Measured                                           |
| ----------------------------------------------- | -------------------------------------------------- |
| `GateValidator.getRetryHints` exists            | does not exist                                     |
| `StepResult.validationResults` is the dead unit | the whole interface is dead                        |
| F13 is three types                              | ten, plus one orphaned by F9                       |
| F11's retirement list is one trigger            | two triggers — internal now, contract at the major |

---

## Discovered constraints

### C1 — The orphan scan over-reports live consumers

The script that enumerated `shared/types/index.ts` counts a **duplicate definition elsewhere** as a
consumer. That is exactly how `GateStatus` first read as live. Its output is a starting point, never
a verdict — re-verify each symbol individually before acting. Noted in F14 so the next executor does
not inherit the false confidence.

### C2 — `generateRetryHints` is live and must stay

The precondition F9 demanded. It is private, called from `validateGate:119`, and its output ships
inside every failing `ValidationResult`. The deletion was therefore a **surface** removal — the
public re-entry API — not a capability removal. Getting this backwards would have silently dropped
retry feedback.

### C3 — A test whose property becomes structural should be deleted, not repaired

`content-analyzer.test.ts` had a flag-invariance test comparing two analyzers differing only by a
config flag. After F11 there is no config to vary, so the test could not be written at all. Replaced
by `expect(ContentAnalyzer).toHaveLength(1)` plus absence assertions — removing the input is a
stronger guarantee than proving the input is ignored.

### C4 — Assertions on line ranges earn their keep

The second F13 deletion block used an explicit line-range assertion that **failed and aborted**
before mutating the file (`end` was 321; the closing brace is 322). Line arithmetic against a file
being edited is not trustworthy; the guard is cheap and caught a real off-by-one.
