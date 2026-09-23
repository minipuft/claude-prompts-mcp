---
title: "Primitive rework — implementation notes"
date: 2026-09-23
status: active
plan: plans/technical-debt/primitive-rework-2026-09-23.md
tags: [gates, chains, execution, mcp-tools]
---

# Implementation Notes

Deviations, rulings on open questions, and probe output for
`plans/technical-debt/primitive-rework-2026-09-23.md`.

## Rulings

| id  | date       | ruling                                                                                                                                                                                                                                                               |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-09-23 | Planner: the review map persists in the run's residual document (`run-registry.ts` 368–369, field map 505), not in a new column — no schema bump. Measured: neither `run-registry.ts` nor `sqlite-engine.ts` contains `pending_review_json`; `SCHEMA_VERSION` is 31. |

## Pre-flight (Step 2)

domain pass · layer pass · naming pass · complexity pass · size pass (`chain-operator-executor.ts`
at its ceiling: reads move out) · service pass · defined pass · contracts pass · pattern pass ·
reuse-scope pass · persistence pass (ephemeral residual document) · lib-api n/a · lib-version n/a ·
failures 0 · compound none.

## Verify-Paths (Step 3)

Raw output measured on `main` `1161853f` from `server/`:

```
$ rg -c "pendingGateReview" src --glob '!**/*.test.ts' | sort -t: -k2 -nr | head -6
src/modules/chains/manager.ts:15
src/engine/execution/operators/chain-operator-executor.ts:11
src/engine/gates/services/gate-verdict-processor.ts:7
src/shared/types/chain-session.ts:4
src/modules/chains/run-registry.ts:4
src/mcp/tools/system-control/handlers/session-action-handler.ts:3
$ rg -ln "pendingGateReview" src --glob '!**/*.test.ts' | wc -l
17
$ rg -n "pending_review_json|pendingGateReview" src/modules/chains/run-registry.ts
62:  pendingGateReview?: unknown;
368:  if (session.pendingGateReview !== undefined)
369:    residual.pendingGateReview = session.pendingGateReview;
505:    ['pendingGateReview', 'pendingGateReview'],
$ rg -n "SCHEMA_VERSION = |pending_review_json" src/infra/database/sqlite-engine.ts
381:const SCHEMA_VERSION = 31;
$ rg -n "toLightweightGate|private toLightweight|buildInlineGateDefinition" src/engine/gates/core/gate-loader.ts src/engine/gates/registry/gate-provider-adapter.ts src/modules/prompts/yaml-prompt-loader.ts
gate-loader.ts:284:  private toLightweightGate(definition: LoadedGateDefinition): LightweightGateDefinition {
gate-provider-adapter.ts:150:  private toLightweight(definition: LoadedGateDefinition): LightweightGateDefinition {
yaml-prompt-loader.ts:201:function buildInlineGateDefinition(definition: Record<string, unknown>): InlineGateDefinition {
$ rg -n "KNOWN_PROVIDER_GAPS" tests/unit/gates/registry/gate-provider-converter-parity.test.ts
36:const KNOWN_PROVIDER_GAPS = ['sourceRoot'];
$ wc -l scripts/validate-system-control-parameter-reads.js scripts/validate-scoped-framework-reads.js
483 246
$ wc -l src/engine/execution/operators/chain-operator-executor.ts
1413   (ESLint max-lines counts 1002/1000)
```

Every other path in the plan's §Verified paths was checked with `ls -la`, `wc -l` and `rg -n`; no
ENOENT, no shim.

## Evolution analysis (row 4.1)

_Empty until the analyst worker reports._

## Deviations

_None yet._
