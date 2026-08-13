---
title: "Adaptive Chain Runtime — residual findings after initiative closure"
date: 2026-08-13
status: backlog
tags: []
---

# Adaptive Chain Runtime — residuals

The initiative (P0–P7) is terminal; master plan and phase plans retired to `plans/reference/`.
This file is the live home for every ledger row that was still OPEN at closure. Full finding
descriptions live in the master plan's Findings Ledger
(`plans/reference/adaptive-chain-runtime-2026-08-09.md`) — this table carries only the residue
and its route.

| Id     | Residue                                                                                                                             | Route / next actor                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P3-F5  | Each chain step still costs 2 prompt_engine calls; `declaredCostCeiling` records but nothing reduces the round-trip                 | unowned — candidate for a future same-call capture design                      |
| P4-F1  | `persistSessions` catches-and-logs against the awaited-persistence posture; detector (cold-load test) landed, writer posture stands | cross-cutting remediation; pairs with sqlite-layer remediation plan            |
| P5-F6  | Gate review renders only at step 1 under default frequency; step-2+ targeted gates undemonstrable to a client                       | injection/review frequency owner — diagnose intended behavior first            |
| P6-F10 | `patch` update rewrites the whole prompt dir; P7-F8 `tools:` drop fires against unnamed siblings                                    | **routing awaits owner** — recommended: standalone fix(mcp-tools) follow-up    |
| P6-F12 | `pr_review_chain` markdown step block is unreachable prose; 4 template vars render empty                                            | shipped-example hygiene, one resource_manager pass                             |
| P6-F14 | `GateSetResolver.accumulate` admits unregistered gate ids run-wide                                                                  | gates hygiene follow-up                                                        |
| P6-F15 | `generate-contracts` silently skips a contract missing `metadata.artifactKind`                                                      | candidate gate: `validate:contracts` asserts every contract yields ≥1 artifact |
| P6-F16 | `patch` cannot reach nested argument descriptions; partial update does not preserve unsupplied core fields                          | resource_manager settability follow-up (same family as P7-F8/P6-F10)           |
| P7-F4  | 13 of 17 prompt categories untracked → probes over `resources/prompts/` need `rg --no-ignore`                                       | standing hazard — keep in worker briefs until categories are tracked           |
| P7-F8  | `tools:` dropped by both write paths; `ConvertedPrompt` has no `tools` field, so no snapshot records them                           | resource_manager settability follow-up (fold with P6-F10 fix)                  |
| P7-F9  | Two unreachable `else { warn }` branches in gate/framework lifecycle processors                                                     | delete on next touch of those processors                                       |
| P7-F10 | `cli-shared/version-history.ts` diverges from the server writer on numbering semantics — **flagged for sync at release**            | **release cycle** — reconcile before or with the next release                  |
| P7-F11 | 4 of 286 shipped templates fail a naive dry render; future template validation must be differential                                 | constraint on any future template-validation gate                              |
| P7-F12 | Create path verifies produced YAML after a version row is spent (update path fixed)                                                 | resource_manager create-path follow-up                                         |
| P7-F15 | Prompt WRITE path resolves package-relative while LOADER honors `MCP_RESOURCES_PATH`                                                | packaged-defect initiative (`project_mcp_workspace_packaged_defect` memory)    |

Already routed elsewhere (listed for completeness, no action here): P5-F1 → subagent-delegation-contract plan (OQ-P6-6) · P7-F5 → chain-management memory (updated 2026-08-13).
