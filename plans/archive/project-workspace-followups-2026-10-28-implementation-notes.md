---
title: Project-workspace follow-ups notes
date: 2026-10-28
status: done
plan: project-workspace-followups-2026-10-28.md
tags: [resources, config, cli, hooks]
---

# Project-workspace follow-ups — implementation notes

## 2026-10-28 — opened

- Source: owner questions in chat 2026-10-28 after the stack opened. Measured before cutting: `hooks/lib/config_loader.py` looks in `MCP_WORKSPACE`, then `${CLAUDE_PLUGIN_DATA}`, then the packaged `server/`; `cli-shared/config-operations.ts` and `version-history-scope.ts` call `findWorkspaceConfigFiles(workspace)`; `src/index.ts:595` probes the workspace files directly; `docs/guides/cli.md` §config and `hooks/README.md:182` describe the workspace-only order. The server's six-step order is documented in `docs/reference/configuration.md` only.

## Deviations

- DEV-1 (rows 1 and 2): the client crashed three times while the two workers ran; resuming them from their transcripts twice produced no further progress, so the planner finished both rows in-session from the partial tree (which was complete: 108 unit + 14 integration tests green, arch, both ratchets, hooks lint/types, prettier), committing each row from its own file list. A hand edit to the bundled `strategic_worker` system message sat in the tree from another session and was left uncommitted.
- DEV-3 (row 3): the "no version on a failed verification" guarantee covers the missing-pointer shape only (F1 in Findings).

## Findings

- F1 (row 3): the version record (`commit`) runs inside the mutation transaction AFTER the schema validate but BEFORE the registry-reload verification in `PromptMutationReceiptService.complete()`, so any reload mismatch other than a missing pointer still records a version first; closing that fully means moving the reload inside the transaction (not done). `validate:mutation-atomicity` reads the record's position lexically; run at the boundary. The same missing-pointer shape also affected `user_message_template`; the new guard covers both message files.

## 2026-10-28 — closure

- All four rows terminal; plan retired to `plans/archive/`; `publish: push` under the owner's ruling. gemini-prompts#53 opened for row 4.
