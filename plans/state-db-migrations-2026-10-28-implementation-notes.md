---
title: "state.db migrations — implementation notes"
date: 2026-10-28
status: backlog
tags: []
---

# state.db migrations — implementation notes

## Rulings

| Id  | Date       | Ruling                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 2026-10-28 | Upgrades from below v35 are refused. Owner chose "proceed" on the recommendation that listed the floor.                                                                                                                                                                                                                                                                                            |
| Q2  | 2026-10-28 | Planner ruling: migration steps are pure transforms over the durable snapshot, not live ALTER steps as first described in chat. The engine already holds every durable row in memory between snapshot and restore, so DDL stays single-sourced in `applySchema` and the three v36 primary-key changes need no table rebuild. Reported to the owner at plan hand-off; reversible before PR1 merges. |
| Q6  | 2026-10-28 | Owner: "lets proceed with both PRs" — push both branches and open both PRs; merge waits for the owner.                                                                                                                                                                                                                                                                                             |

## Findings

- F1 (2026-10-28): `prompt_engine` dropped every value sent through `inputs` on a `>>a --> >>b` chain command: the run started with `feature` empty and no refusal, although `feature` is required. Inline arguments in the command string arrived intact. Run `chain-implementation_plan#1`, aborted.
- F2 (2026-10-28): the live `execution_records.organization_id` holds the workspace name (114/30/14 rows per workspace); every other table's `organization_id` is NULL. Row 4.3 locates the writer.
- F3 (2026-10-28): the shared checkout's HEAD moved twice during planning (feat/framework-operator-caret → feat/framework-bundle-membership → feat/project-workspace-followups).

## Deviations

## Receipts
