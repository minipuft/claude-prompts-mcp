---
title: "Delegation handoff contract — implementation notes"
date: 2026-09-07
status: active
plan: plans/delegation-handoff-contract-2026-09-07.md
tags: [chains, delegation]
---

# Implementation Notes

Deviations, rulings on open questions, and probe output for
`plans/delegation-handoff-contract-2026-09-07.md`.

## Rulings

| id  | date | ruling |
| --- | ---- | ------ |

## Deviations

| #   | Date       | Row     | Deviation                                                                                                                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                   |
| --- | ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2026-09-07 | 1.3     | `buildResultContractSection` deleted rather than kept as a wrapper delegating to `buildHandoffResultSection`; `PROPOSED_GATE_REVIEW_TOKEN` moved from `brief.ts` into `handoff-contract.ts`. Importers (`acknowledgment.ts`, three tests) point at the contract module.                                                                                                                                                       | Two names for one builder is the drift the module exists to prevent; the parser of the token and its emitter now live in one file.                                                    |
| 2   | 2026-09-07 | 1.4     | Three `DelegationPayload` construction sites, not two: `formatting/response-assembler.ts:455` (next-step advisory on the non-operator path) also needed `nodeToken` + `mode`. All three call `handoffNodeToken`.                                                                                                                                                                                                              | Verify-paths counted the operator's two; `typecheck` surfaced the third once the fields became required, which is what row 1.2's Verify predicted.                                    |
| 3   | 2026-09-07 | 1.1     | The new module carries `// @lifecycle canonical` like its siblings. First attempt omitted it (a sibling branch deletes every such header); `lint:ratchet` refused: `claude/require-file-lifecycle` baseline 0 → 1.                                                                                                                                                                                                            | The header has a second reader beyond the filesize exemption: an ESLint rule. `feat/gate-findings` row 0.1 must retire that rule and its ratchet entry too, or its strip cannot land. |
| 5   | 2026-09-07 | 1.5     | `delegated-resume-brief.integration.test.ts` also asserts `run_in_background: false` in the rendered handoff, beyond the unit test the row named.                                                                                                                                                                                                                                                                             | The unit test calls the strategy directly; the integration assertion is the reached probe — it proves the pipeline's own render path emits the pin.                                   |
| 6   | 2026-09-07 | T1 gate | The tier gate `npm test -- delegation` ran the ENTIRE suite here and was killed (exit 137, no summary): jest's path pattern matched the worktree directory `claude-prompts-mcp-delegation`, so every test file qualified. Gate re-run as `typecheck && lint:ratchet && typecheck:tests:ratchet && test:unit && test:integration`, with the delegation files named by `tests/…` path for the scoped run (9 suites, 107 tests). | A worktree named after the feature makes any `jest <feature>` filter match every file. Name test paths from `tests/` in worktrees.                                                    |
| 4   | 2026-09-07 | 1.1     | `parseHandoffTrailer` drops lines that are exactly a code fence before extracting fields.                                                                                                                                                                                                                                                                                                                                     | The brief asks the worker to END with a fenced block, so the closing fence is a conforming reply's last line, not part of `findings` or the gate review.                              |
