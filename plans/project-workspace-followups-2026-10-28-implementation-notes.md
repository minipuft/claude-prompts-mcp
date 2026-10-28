---
title: Project-workspace follow-ups notes
date: 2026-10-28
status: active
plan: project-workspace-followups-2026-10-28.md
tags: [resources, config, cli, hooks]
---

# Project-workspace follow-ups — implementation notes

## 2026-10-28 — opened

- Source: owner questions in chat 2026-10-28 after the stack opened. Measured before cutting: `hooks/lib/config_loader.py` looks in `MCP_WORKSPACE`, then `${CLAUDE_PLUGIN_DATA}`, then the packaged `server/`; `cli-shared/config-operations.ts` and `version-history-scope.ts` call `findWorkspaceConfigFiles(workspace)`; `src/index.ts:595` probes the workspace files directly; `docs/guides/cli.md` §config and `hooks/README.md:182` describe the workspace-only order. The server's six-step order is documented in `docs/reference/configuration.md` only.

## Deviations

(none yet)

## Findings

(none yet)
