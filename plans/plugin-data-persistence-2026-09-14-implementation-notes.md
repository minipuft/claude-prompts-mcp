---
title: "Plugin data persistence — implementation notes"
date: 2026-09-14
status: active
tags: [runtime, hooks, distribution, plugin]
---

# Implementation Notes — `plans/plugin-data-persistence-2026-09-14.md`

Session voice. Reader-facing text belongs in the commit subject, the CHANGELOG or the docs.

## Origin (2026-09-14)

Found while planning the tutorial rework. The owner ruled that the tutorial's first step is asking Claude to write a
prompt, which made "where does that prompt live" the reader's first experience. Measured in the source: `.mcp.json`
sets `MCP_WORKSPACE=${CLAUDE_PLUGIN_ROOT}` only, and `render-distributions.mjs` drops `MCP_RUNTIME_ROOT` from that
projection. Claude Code's docs say the plugin root changes on each update. On this machine claude-prompts loads from
the source checkout, so a real update could not be observed; per-plugin data directories exist, empty, for
marketplace-installed plugins (`~/.claude/plugins/data/<plugin>-<marketplace>/`), and one named
`claude-prompts-inline` exists from a `--plugin-dir` load in March.

## Row 0.1 accepted (2026-09-14)

Worker P built a throwaway plugin under a temp directory and ran one `claude -p` session with `--plugin-dir`.

| Question                                                                    | Claude Code 2.1.272            |
| --------------------------------------------------------------------------- | ------------------------------ |
| `${CLAUDE_PLUGIN_DATA}` substituted in `.mcp.json` `env`                    | yes                            |
| substituted in `args`                                                       | yes                            |
| `CLAUDE_PLUGIN_DATA` in the MCP server's environment without being declared | yes (`CLAUDE_PLUGIN_ROOT` too) |
| in the `SessionStart` hook's environment, and substituted in its command    | yes                            |
| data directory exists when the server's first line runs                     | yes, empty                     |
| bare `PLUGIN_DATA` / `PLUGIN_ROOT`                                          | not set                        |

The positive control held: `${CLAUDE_PLUGIN_ROOT}` resolved in env, args and the hook command. `~/.claude/settings.json`,
`installed_plugins.json` and `known_marketplaces.json` hashes were unchanged, and the probe's data directory was
removed.

**This is the mirror image of the Codex measurement** in the agent-plugins migration (DEV-T4-3), where `PLUGIN_DATA`
reached hooks but not the MCP child. The two clients differ, which is why R2 keeps the canonical file unchanged.

**Naming.** A `--plugin-dir` plugin gets `~/.claude/plugins/data/<name>-inline`. Marketplace installs follow
`<name>-<marketplace>`, inferred from existing directories rather than a fresh install.

**Consumers the worker must enumerate:**

- the renderer and its self-test, which asserts the drop;
- `hooks/lib/workspace.py` `get_state_db_path()`;
- the hook-owned `hooks-state.db` under `{CLAUDE_PLUGIN_ROOT}/server/runtime-state`, which is transient session rows,
  noted rather than moved unless the worker finds a durable reader;
- `scripts/hook-harness.mjs`;
- `extension-publish.yml`'s render check;
- CLAUDE.md §Environment (paths) and its `AGENTS.md` projection;
- any doc that says the Claude Code plugin's workspace is the plugin root.
