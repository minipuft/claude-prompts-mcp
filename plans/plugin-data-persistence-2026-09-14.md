---
title: "Plugin data persistence — a prompt written through the Claude Code plugin survives a plugin update"
date: 2026-09-14
status: active
tags: [runtime, hooks, distribution, plugin]
---

# Plugin Data Persistence

**Status**: ACTIVE — Tier 0 measured 2026-09-14; Tier 1 dispatched
**Owner**: minipuft
**Created**: 2026-09-14
**Blocks**: `plans/tutorial-rework-2026-09-11.md` row B.7, since the tutorial's first step is writing a prompt

## Now (2026-09-14)

**Goal**: a prompt a reader writes through the Claude Code plugin, and the plugin's runtime state, survive a plugin
update. **Current slice**: Tier 1, dispatched to worker W. **Next decision**: accept W's handoff on planner probes, then open
the PR. **Constraint in force**: the canonical Agent Plugins `mcp.json` does not change; Codex measured
`PLUGIN_DATA` unset inside the MCP server process.

## Why this exists

- **The workspace is the install directory.** The Claude Code plugin's `.mcp.json` sets only
  `MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}`. `resource_manager` therefore writes a new prompt, and the server writes
  `state.db` with its version history, into that directory.
- **Updates replace that directory.** Claude Code's plugins reference says `${CLAUDE_PLUGIN_ROOT}` changes on each
  update, and `${CLAUDE_PLUGIN_DATA}` is the directory that persists. Install paths are versioned
  (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`). An update leaves the user's prompts behind.
- **The renderer drops the persistent root on purpose.** `scripts/render-distributions.mjs` removes the canonical
  `MCP_RUNTIME_ROOT=${PLUGIN_DATA}` from the Claude Code projection, on the premise that Claude Code defines no such
  variable. Its docs now document `${CLAUDE_PLUGIN_DATA}`.
- **The hooks are a second consumer.** `hooks/lib/workspace.py` `get_state_db_path()` probes `MCP_RUNTIME_ROOT`, then
  the workspace (`MCP_WORKSPACE`, then `CLAUDE_PLUGIN_ROOT`). Hooks do not inherit the server's environment, so a
  server `state.db` under the data directory would be invisible to them.
- **An earlier measurement was on a different client.** `plans/reference/agent-plugins-migration-2026-08-08.md`
  (DEV-T4-3, 4.1) measured Codex: `PLUGIN_DATA` set for hooks, unset in the MCP child. It is not evidence about
  Claude Code either way.

## Rulings

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Owner, 2026-09-14: fix the plugin before the tutorial teaches authoring first.** The tutorial then promises that a prompt persists                                                                                                                                                                                                                                                                                                            |
| R2  | **The fix lives in the Claude Code projection, not in the canonical `mcp.json`.** The Agent Plugins package ships to clients where `PLUGIN_DATA` may not reach the server, and a literal `${PLUGIN_DATA}` workspace would be refused at startup                                                                                                                                                                                                 |
| R3  | **Explicit over inferred.** The server does not read `CLAUDE_PLUGIN_DATA` on its own; the plugin config passes the directory as a setting, in line with a server that runs only on the settings it was given                                                                                                                                                                                                                                    |
| R4  | **Planner, 2026-09-14, from row 0.1: substitute in `env`.** Claude Code 2.1.272 substitutes `${CLAUDE_PLUGIN_DATA}` in a plugin `.mcp.json` server's `env` and `args`, gives the server and hook processes `CLAUDE_PLUGIN_DATA`, and creates the data directory before the server starts. The Claude Code `.mcp.json` sets both `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` to `${CLAUDE_PLUGIN_DATA}`; the canonical `mcp.json` stays as it is (R2) |

## Dispatch

| Worker | Rows    | Tier / effort | Failure shape that justifies them                                                                                                                                            | Surface                                                                                                   | Bound               |
| ------ | ------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- |
| P      | 0.1     | sonnet / high | a wrong measurement: a literal placeholder or a server that never started read as a result, which would rule the design                                                      | background subagent, throwaway plugin under a temp dir                                                    | no repository edits |
| W      | 1.1–1.4 | opus / high   | wrong approach across consumers: the projection, the hooks' `state.db` lookup, the public hook API and the docs must move together, and a missed reader silently loses state | `fix/plugin-data-persistence--impl` (worktree `claude-prompts-mcp-plugin-data-impl`), background subagent | ≤ 8 files           |

## Tier 0 — measure

| #   | St                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Change                                                                                                                                                                          | Depends | Verification                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| 0.1 | ✓ (verified 2026-09-14 · worker P on Claude Code 2.1.272: `${CLAUDE_PLUGIN_DATA}` substituted in `env` and in `args`; `CLAUDE_PLUGIN_DATA` and `CLAUDE_PLUGIN_ROOT` present in the MCP server and `SessionStart` hook environments without being declared; `~/.claude/plugins/data/cpm-data-probe-inline` existed when the server's first line ran; `${CLAUDE_PLUGIN_ROOT}` resolved in every surface as the positive control; `~/.claude` config hashes unchanged) | A throwaway plugin whose MCP server and `SessionStart` hook write the path variables they receive. One `claude -p` session; `~/.claude` config hashes compared before and after | —       | the probe's raw JSON, with `${CLAUDE_PLUGIN_ROOT}` substitution as the positive control |

## Tier 1 — persist prompts and state (form ruled after 0.1)

| #   | St                                                                                                                                                                                             | Change                                                                                                                                                                                                                                                                                                                 | Depends  | Verification                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | ☐ (as of 2026-09-14 · flips when the Claude Code projection points the server's workspace and runtime root at the plugin data directory and `validate:render-drift` with its self-test passes) | `scripts/render-distributions.mjs` Claude Code projection: the server's workspace and runtime root become `${CLAUDE_PLUGIN_DATA}`, through `env` substitution (R4). Stop dropping `MCP_RUNTIME_ROOT`, since Claude Code resolves `${CLAUDE_PLUGIN_DATA}`. Canonical `mcp.json` unchanged (R2)                          | 0.1      | `validate:render-drift` and `validate:render-drift:self-test`; a self-test case that fails if the projection drops the data root |
| 1.2 | ☐ (as of 2026-09-14 · flips when hooks find the server's `state.db` under the plugin data directory)                                                                                           | `hooks/lib/workspace.py` `get_state_db_path()` adds `${CLAUDE_PLUGIN_DATA}/runtime-state/state.db` as a candidate ahead of the plugin root; hooks receive `CLAUDE_PLUGIN_DATA` (row 0.1). `hooks/lib/*` is public hook API that downstream plugins import, so the addition must be a no-op where the variable is unset | 0.1      | a pytest case with the variable set and unset, plus a mutation that removes the candidate                                        |
| 1.3 | ☐ (as of 2026-09-14 · flips when a live `--plugin-dir` drive shows a prompt created in one plugin copy still listed after switching to a second copy of the plugin)                            | Simulated update: create a prompt through `resource_manager`, point the plugin at a fresh copy of itself (a new root, same data directory), and confirm the prompt is still served and the `>>` hook's `resource_index` read sees it                                                                                   | 1.1, 1.2 | the drive transcript, with the pre-fix projection as the control (prompt missing after the switch)                               |
| 1.4 | ☐ (as of 2026-09-14 · flips when the CHANGELOG and the environment docs state where the Claude Code plugin keeps prompts and state)                                                            | CHANGELOG `Fixed`: a prompt created through the Claude Code plugin, and its version history, survive a plugin update. CLAUDE.md §Environment (paths) and the plugin docs name the data directory. Prompts already written into an install directory are not migrated (OQ-1)                                            | 1.1, 1.2 | `sync-project-guidance.js --check`; the entry read against the 1.3 drive                                                         |

## Open questions

| #    | Question                                                                                           | Default                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1 | Migrate prompts already written into a current install directory?                                  | No. They are already lost on the next update today; the CHANGELOG says where they were and how to move them with `resource_manager`                                                                              |
| OQ-2 | Does the workspace move to the data directory, or only the runtime root plus a resources override? | **RULED 2026-09-14 — the workspace moves (R4).** Workspace resources overlay the bundled tree, which stays loaded underneath, and writes go to the workspace; a resources path alone does not enable the overlay |
