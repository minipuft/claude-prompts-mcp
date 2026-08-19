---
title: "Adaptive Chain Runtime — residual findings after initiative closure"
date: 2026-08-13
status: reference
tags: []
---

# Adaptive Chain Runtime — residuals

The initiative (P0–P7) is terminal; master plan and phase plans are retired
(`plans/reference/`). This file was the live home for every ledger row still OPEN at closure.
**The residuals sweep (2026-08-13 → 2026-08-17, PR #231, merged) closed it**: 10 of 15 rows
fixed, 5 re-homed to live owners. This document is now a disposition record — nothing here is a
queue. Full finding descriptions: master plan's Findings Ledger
(`plans/reference/adaptive-chain-runtime-2026-08-09.md`). Sweep evidence:
`adaptive-chain-runtime-residuals-2026-08-13-implementation-notes.md`.

## Fixed by the sweep (PR #231, merged 2026-08-17)

| Id     | Disposition                                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5-F6  | Diagnosed (code defect, frequency uninvolved) AND fixed — post-advance declared-gate review re-evaluation; step-N>1 targeted gates now render their review     |
| P6-F10 | Fixed — suppliedKeys write-scope narrowing; patch-only edit leaves prompt.yaml byte-identical; category change is now a true transactional MOVE (owner ruling) |
| P6-F12 | Fixed via resource_manager (7 empty vars, not 4; missing outputMapping + bare-name refs). **Workspace-only** — `pr-review/` is gitignored (see P7-F4)          |
| P6-F14 | Fixed — GateSetResolver Stage 1.5 existence gate (warn + drop + diagnostics; fails open pre-init)                                                              |
| P6-F15 | Fixed — generate-contracts fails loudly on unmarked contracts; ≥1-artifact assertion; explicit artifact-less posture requires reason + closedBy                |
| P6-F16 | Fixed — `argument_updates` merge-by-name parameter (additive contract change); preservation half had already landed at HEAD (snapshot-base merge)              |
| P7-F8  | Data-loss half fixed — writer preserves `tools:` id list + authored category on update AND rollback. Settability half (id-string repair) → parity initiative   |
| P7-F9  | Fixed — dead `else { warn }` branches deleted; prompt-side processor confirmed already correct                                                                 |
| P7-F10 | Fixed — CLI rollback now mirrors go-forward numbering (bridge + restored-content-as-newest); `saveVersion` primitive was already identical; posture kept as-is |
| P7-F12 | Fixed — create path runs `diagnosePromptWrite(null, …)` pre-write; broken template → refused, nothing written                                                  |

Also fixed in-sweep (found by the settability audit, owner-ruled in): gate `activation` /
`retry_config` / `pass_criteria` fallback-merge, and writer-side preservation of
`severity` / `enforcementMode` / `gate_type` (+ schema-coverage guard).

## Re-homed (live owners, verified to exist)

| Id     | Live home                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-F5  | `project_chain_management_tooling` memory — unowned same-call-capture design candidate                                                                        |
| P4-F1  | `project_sqlite_layer_remediation` memory (carried debt) — its previously named route, the sqlite plan, is itself retired; the memory is the live owner       |
| P7-F4  | `resource-manager-settability-matrix-2026-08-13.md` §Standing hazards — tracking-policy decision belongs to the settability-parity initiative                 |
| P7-F11 | `resource-manager-settability-matrix-2026-08-13.md` §Standing hazards — differential-validation constraint; already embodied by shipped `diagnosePromptWrite` |
| P7-F15 | `project_mcp_workspace_packaged_defect` memory (packaged-defect initiative)                                                                                   |

Already routed elsewhere before the sweep (unchanged): P5-F1 → subagent-delegation-contract plan
(OQ-P6-6) · P7-F5 → chain-management memory (updated 2026-08-13).

Successor initiative seeded by the sweep: **resource_manager settability parity** —
`resource-manager-settability-matrix-2026-08-13.md` (matrix, ranked gaps, 7-step increment
sequence, prompt_builder bridge repair).
