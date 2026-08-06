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

## F9 — The gate retry-hint API has no callers

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

## Sequencing

F9 is independently actionable now. F11 is not — it waits on the major. Do not bundle them into one
tier just because they were measured together; they share a shape, not a trigger.
