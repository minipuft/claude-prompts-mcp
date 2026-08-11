---
title: "P2 Complexity Telemetry — Implementation Notes"
date: 2026-08-11
status: backlog
tags: []
---

# P2 Complexity Telemetry — Implementation Notes

Plan: `plans/adaptive-chain-runtime-p2-complexity-telemetry-2026-08-11.md`
Started: 2026-08-11. Created before first edit per execution protocol.

## Preconditions log

- Plan produced by worker-driven `>>implementation_plan` chain (`chain-implementation_plan#1`), judged main-thread: all 6 spot-checked anchors verified exact (3 append sites, manager :1353/:1377/:1395, formatting-stage constructor missing chainSessionStore, handler queryRecent :54, PipelinePorts shape, gateVerdicts zero-binder).
- Three open questions RULED main-thread before dispatch (see plan §Rulings): Q1 verdict-submission count; Q2 view NOT extended (measured zero readers), handler computes in-memory; Q3 gate_verdicts_json out of scope.
- Foreign-hunk check: only `sqlite-engine.ts` carries uncommitted foreign work (+17 lines, `getInstance()` singleton-path guard at :195-225) — disjoint from P2's anchors (:114, :632 region). All other P2 target files clean.
- Executor: single opus (high effort) subagent per user directive, tiers sequential; main thread keeps tier acceptance, live drive, scope check.

## Deviations

| #   | Tier | What forced it                                                                                                                                                                                                                                                                                                                                                                                            | Conservative option taken                                                                                                                                                                                                                                                              |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1    | Tier 1 row 1 adds `getRunTelemetry` to the `ChainSessionService` **interface**, but its implementation is Tier 2 row 7. `npm run typecheck` therefore cannot pass at the Tier 1 gate — 3 errors, all one cause (`ChainSessionStore` does not implement the new member). Plan's tier split is the cause, not a code defect.                                                                                | Ran the two Tier-1-specific gates (`validate:table-contracts`, `validate:no-phantom-columns`) at Tier 1 — both green — and deferred the `typecheck` leg of Tier 1's gate to the Tier 2 gate, which runs it. No interface/impl split was invented to work around it.                    |
| 2   | 6    | Row 13/14 test paths were placeholders the plan told me to pin at edit time. `tests/integration/execution/` does not exist; the P1 precedent the plan cites lives at `tests/integration/chain/unknown-observations-flow.integration.test.ts`. There is no `tests/unit/chains/` either — the manager's unit tests live in `tests/unit/chain-session/chain-session-store.test.ts`.                          | Followed the sibling convention rather than creating two new directories: `tests/integration/chain/run-telemetry.integration.test.ts` and `tests/unit/chain-session/manager-run-telemetry.test.ts`.                                                                                    |
| 3   | 6    | `tests/integration/chain/execution-record-store.integration.test.ts` hand-mirrors the `execution_records` DDL. Widening the store's INSERT by 5 columns makes every `append()` in that suite fail against the un-widened mirror — and `append()` is best-effort, so it logs a warn and returns rather than throwing. The suite would have gone quietly wrong, not red. Not a file the plan's table lists. | Extended that test's mirrored DDL with the same 5 columns in the same change. No assertions touched.                                                                                                                                                                                   |
| 4   | 6    | `tests/integration/database/sqlite-backend.test.ts` asserts the literal `SCHEMA_VERSION` twice (`:56`, `:266`). The v20→v21 bump fails both. Not a file the plan's table lists, and the plan's final gate would not have caught it: `test:ci` is `test:unit` only, and only `test:integration` runs that suite.                                                                                           | Updated both literals to 21. Nothing else in the suite changed — those assertions are the intended tripwire for an undeclared bump, so they were re-pointed rather than loosened. Also ran `test:integration` (not in the plan's final gate) because two new/edited suites live there. |

## Live drive (main thread, 2026-08-11) — SUCCESS SIGNAL OBSERVED

Six drive iterations against throwaway streamable-http servers from fresh dist (verify:mcp pattern), all recorded in scratchpad `p2-live-drive*.mjs`. Final result (drive 6, session `review-quick_decision-1786436900261`):

- **Rendered in `system_control execution_history`**: `_planned 3 / executed 2 · gates fired 4 (retries 1) · unknowns opened 1 / closed 1_` on the ✅ completed session — the plan's named success signal, observed in returned tool text.
- **DB row** (direct sqlite read): `(steps_planned 3, gates_fired 4, gate_retries 1, unknowns_opened 1, unknowns_closed 1)`. Gate arithmetic exactly matches the Q1 ruling: 4 verdict submissions (1 FAIL + 3 PASS), 1 retry.
- **Discriminating probes**: 5 in-flight/abandoned sessions render NO telemetry line; the pre-P2 completed record (all 5 columns NULL) renders none either — presence-branching proven at both render and storage layers. P1+P2 composition proven: the final call's `unknown_resolved` validated against the persisted ledger AND counted into telemetry.
- **Failed-path emission** not driven live (no way to throw mid-pipeline from outside); covered by the integration test + the executor's mutation check (removing the `emitFailureRecord` spread fails the assertion).
- Drives 1-4 were driver-choreography failures, each teaching the client contract; kept in scratchpad as the record of how completion actually latches.

## Pre-existing defects DISCOVERED by the live drive (none are P2 regressions; all out of P2 scope)

1. **Completion banner fires before the run is complete.** At `currentStep == totalSteps` the footer says "✓ Chain complete (3/3) · No user_response needed" — but `chainComplete` only latches at `currentStep > totalSteps` (18-execution-stage:64/:111), which requires the client to submit the final step's gate verdict (or one more call). A client that obeys the banner leaves the run permanently `working` — 4 of 6 drive sessions demonstrate exactly this, and terminal `completed` records are therefore systematically under-written in real flows. The one pre-P2 completed record in history exists only because its driver sent an extra call. **Feeds P3** (run lifecycle semantics).
2. **Step 1's render appends no working record** — the chain-start call renders step 1 without an `execution_records` append (only resume-path renders append), so `executed` undercounts by exactly 1 on every fully-driven chain (hence `planned 3 / executed 2` above — accurate recording of an incomplete ledger). **Feeds P3**.
3. **`user_response` on a 3/3 chain re-opens a fresh review** (attempt 1/3) instead of answering "already complete" — same lifecycle-semantics family as (1).
4. **Two `state.db` files in play**: MCP_WORKSPACE-honoring spawns (verify:mcp, throwaway drives) use `<repo>/runtime-state/state.db` (now v21); the long-running plugin server uses `server/runtime-state/state.db` (v20). Known packaged-server MCP_WORKSPACE defect family; the concurrent session's `getInstance()` guard hunk is adjacent work.

**Testing lesson (growth-capture candidate)**: the integration test proved the completed-path emission by constructing `currentStep > totalSteps` directly — a state no banner-obeying client ever reaches. Test-reachable ≠ client-reachable; the live drive is what exposed the gap.

## P2 STATUS: COMPLETE 2026-08-11 (uncommitted, pending user go-ahead)

All done criteria met: success signal live (above), full suite green (test:ci 2056/2056, both SQLite gates, ratchets, arch, verify:mcp 12/12, test:integration 501/501), D4 compliance verified by grep (increments, derivation, display only), docs lockstep, scope check clean (all touched files map to plan rows or logged deviations).

## Discoveries carried out of planning

- `v_execution_history` has zero code readers; its `VIEW_CONTRACTS` entry names a reader that factually reads `queryRecent()`. Tier 1 row 5 documents this as a `finding` on the view contract.
- `ExecutionRecord.gateVerdicts` / `gate_verdicts_json` is value-dead since shipping (no writer binds it; `buildAppendParams` defaults `[]` at execution-record-store.ts:204). Debt-sweep candidate, NOT P2 scope (Q3 ruling).
