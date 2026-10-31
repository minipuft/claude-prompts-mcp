---
title: "one isolating workspace column — implementation notes"
date: 2026-10-30
status: backlog
tags: []
---

# One isolating workspace column — implementation notes

## Rulings

| Id  | Date       | Ruling                                                                                                                                                                                                 |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q3  | 2026-10-30 | Owner took the default: the workspace id is `<label>-<8hex>` in one column.                                                                                                                            |
| Q4  | 2026-10-30 | Owner took the default: a config file's history keeps `config:<digest>` as its `workspace_id`.                                                                                                         |
| Q5  | 2026-10-30 | Owner took the alternative: no adoption. The v36 step still re-keys basename-era rows to `legacy:<old tenant_id>`, readable through `source_workspace`. Row 4.5 killed. Evidence put to the owner: F1. |
| Q7  | 2026-10-30 | Owner: ADR 0002 (refuse schema downgrades) is accepted; the engine already enforces it and ADR 0005 cites it. Landed on the #521 branch.                                                               |

## Findings

- F1 (2026-10-30): a copy of the live plugin `state.db` (v35) holds 95 version_history rows — 57 under `claude-prompts-mcp`, 34 under `server`, 4 under `default`. 93 are projection-only (no `tree_hash`); 6 of the 12 resource ids with history were not found in the bundle, the plugin data directory or this repo's `.claude-prompts/` (`strategicImplement` was renamed `strategic_implement`; the rest are August probes). The `default` rows carry `registerWithMcp`/`mcpPromptMode`, which later snapshots no longer write.
- F2 (2026-10-30): `handleHistory` and `handleCompare` in `prompt-versioning-processor.ts` look the prompt up in the current catalog before reading history, so `source_workspace` reaches `legacy:<name>` rows only for ids that still exist. Rows for a renamed or deleted id stay in the file, unreadable through the tool. Accepted with Q5.

## Deviations

## Receipts
