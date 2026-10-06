---
title: "Gate findings, re-planned on main: a refusal reaches the result, a verdict schema that cannot drift, an explicit always-on, then findings with evidence"
date: 2026-10-06
status: active
initiative_branch: main
branch_mode: worktree
worker_cap: 2
publish: "push+merge (2026-10-06, owner in chat: archive the gate-findings branch and re-plan its surviving ideas on main)"
tracking: none
tracking_reason: operator-opt-out
tags: [gates, tests]
---

# Gate findings, re-planned on main

## Now

_Written 2026-10-06._ **Cut, nothing dispatched.** The `feat/gate-findings` branch (2026-09-09, archived as `archive/feat-gate-findings` at `7a1a59945` with its 27 uncommitted files committed) carried seven ideas; on 2026-10-06 they were compared idea by idea with `main` at `4adcbc4b2`. The per-gate verdict record it set out to build is on `main` since #380 and #382; two ideas are obsolete; the rest are the rows below, ordered by value over cost. Row 1.1 is a live defect today. Next decision: the owner's ruling on row 1.3's premise (an empty `activation: {}` activates a gate everywhere; should that stay the meaning, or should always-on be explicit).

## Scope

**Objective:** a gate's result says what actually happened to its checks, the verdict contract cannot drift silently, always-on is a declared choice, and a failed gate can be addressed by id with the evidence that failed it. Not in scope: re-applying the branch's code (every file it touched was rewritten), the lifecycle-header strip, module invariants beyond one row.

## Rulings

| ID  | Date       | Ruling                                                                                                                                          |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 2026-10-06 | **OWNER**, in chat: archive the branch and re-plan the surviving ideas on `main`.                                                               |
| R2  | 2026-10-06 | Planner: the rows attach to `main`'s per-gate verdict record, never beside it; a finding is a property of a verdict entry, not a second object. |

## Tasks

| ID  | Status                                                                                                                                                                                            | Files                                                                                                                                                      | Change                                                                                                                                      | Bound     | Depends | Verification                                                                                                      | Tier                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1.1 | ☐ (as of 2026-10-06 · flips when a `shell_verify` command the allowlist refuses reaches the gate result and the review text as `refused`, distinct from a command that ran and failed)            | `server/src/engine/gates/services/gate-shell-verify-runner.ts` (drops `refused` at 202-211); `shell-verify-message-formatter.ts`; one e2e twin             | carry the executor's `refused` through `GateShellVerifyResult` and the review message; a never-run command no longer reads as `exitCode -1` | ≤ 4 files | —       | twin over both transports: an allowlisted command fails → "failed"; a non-allowlisted one → "refused", red before | sonnet · high · wrong output   |
| 1.2 | ☐ (as of 2026-10-06 · flips when a unit test fails if the published verdict entry's key set and the processor's refined schema diverge)                                                           | `server/tests/unit/gates/gate-verdict-schema-keyset.test.ts` (lift the two cases from `archive/feat-gate-findings`)                                        | the verdict-entry key-set case and the refined-schema case, against today's `prompt-engine.schema.ts:167-173`                               | ≤ 2 files | —       | red with a planted extra key                                                                                      | sonnet · medium · wrong output |
| 1.3 | ☐ (as of 2026-10-06 · flips when the owner rules on the empty-activation meaning and, if always-on becomes explicit, `activation.always` is in the gate schema and `gate-activation.ts` reads it) | `server/src/engine/gates/core/gate-activation.ts:151-191`; `gate-schema.ts:226-245`; docs                                                                  | an empty `activation: {}` activates everywhere today by accident of the code; make the choice explicit one way or the other                 | ≤ 4 files | —       | a gate with `always: true` fires with no category match; an empty block behaves as ruled                          | opus · high · wrong approach   |
| 1.4 | ☐ (as of 2026-10-06 · flips when a failed verdict entry carries a stable id and an evidence object, visible in `execution_history` and addressable on the next call)                              | `gate-verdict-processor.ts`; the verdict entry schema; `execution-record-store.ts`; `mcp/tools/index.ts:987-989` (the entry is flattened to a string here) | findings as properties of the per-gate entry (R2)                                                                                           | ≤ 6 files | 1.2     | an e2e twin naming a finding by id on the retry                                                                   | opus · high · wrong approach   |
| 1.5 | ☐ (as of 2026-10-06 · flips when one module declares an invariant in `module.yaml` and a validator fails on its violation)                                                                        | `server/scripts/lib/semantic-module-descriptors.ts` (lift the invariants diff from the archive); one module.yaml; `validate:all`                           | module invariants, one proving instance                                                                                                     | ≤ 4 files | —       | red on a planted violation                                                                                        | sonnet · medium · wrong output |
