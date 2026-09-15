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
