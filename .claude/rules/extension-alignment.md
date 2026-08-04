---
paths:
  - "hooks/**"
  - ".claude-plugin/**"
  - "manifest.json"
  - "mcp.json"
---

# Multi-Platform Extension Alignment

**Upstream hooks are the single source; downstream repos adapt, never fork.**

This repo ships the Claude Desktop extension and the Claude Code plugin. Three sibling repos
port the hook system to other hosts. Hook logic lives in `hooks/*.py` + `hooks/lib/` here —
downstream repos consume it as an npm dependency and register thin adapters.

## Distribution Channels

| Platform       | Repo               | Mechanism                                                           | Hook config                    |
| -------------- | ------------------ | ------------------------------------------------------------------- | ------------------------------ |
| Claude Desktop | this repo          | `manifest.json` (MCPB)                                              | none (no hooks)                |
| Claude Code    | this repo          | `.claude-plugin/plugin.json`                                        | `hooks/hooks.json`             |
| Gemini CLI     | `gemini-prompts`   | npm dep + `hooks/lib` symlink + Python adapters                     | `hooks/hooks.json` (that repo) |
| OpenCode       | `opencode-prompts` | independent TypeScript plugin rewrite                               | `index.ts` (that repo)         |
| Codex CLI      | `codex-prompts`    | npm dep + `hooks/lib` symlink + adapters over `_codex_bootstrap.py` | `hooks/hooks.json` (that repo) |

## Hook Event Mapping (measured 2026-08-03 against each repo's shipped config)

| Behavior                  | Claude Code                                | Codex CLI                                                  | Gemini CLI                                             |
| ------------------------- | ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `>>` syntax detection     | `UserPromptSubmit`                         | `UserPromptSubmit`                                         | `BeforeAgent`                                          |
| Gate verdict enforcement  | `PreToolUse` `.*prompt_engine`             | `PreToolUse` `.*prompt_engine`                             | `BeforeTool` `prompt_engine`                           |
| Delegation enforcement    | `PreToolUse` `Edit\|Write\|Bash\|Task`     | `PreToolUse` `Bash\|apply_patch\|collaborationspawn_agent` | `BeforeTool` `write_file\|replace\|bash\|task_tool\|…` |
| Chain/gate tracking       | `PostToolUse` `.*prompt_engine`            | `PostToolUse` `.*prompt_engine`                            | `AfterTool` `prompt_engine`                            |
| Ralph telemetry           | `PostToolUse` `Edit\|Write\|Bash`          | `PostToolUse` `Bash\|apply_patch`                          | `AfterTool` `write_file\|replace\|bash\|task_tool`     |
| Stop blocking (Ralph)     | `Stop`                                     | `Stop` (timeout 120s)                                      | `SessionEnd` (cleanup only)                            |
| Compaction handling       | `SessionStart` (`compact`) — recover after | `SessionStart` (`compact`) — recover after                 | `PreCompress` (`manual\|auto`) — save before           |
| Skill-first reminder      | unregistered                               | `SessionStart` (`startup\|resume`), catalog-free           | —                                                      |
| Subagent gate enforcement | unregistered                               | not portable on 0.146 (encrypted inter-agent payloads)     | —                                                      |

OpenCode is a behavioral port, not an adapter port — its event names and coverage live in
`opencode-prompts` and are narrower (no prompt-submit, stop, or subagent hooks).

**Codex divergences (0.146, measured)**: subagent task payloads are encrypted/absent from
transcripts, and plugin `.mcp.json` values are not interpolated (`${CLAUDE_PLUGIN_ROOT}` passes
through literally; server must be registered globally via `codex mcp add`). Details:
`codex-prompts` README §Known divergences.

## Alignment Checklist

**When modifying hooks in this repo:**

- [ ] Update `hooks/*.py` and `hooks/hooks.json` here (Claude Code source of truth)
- [ ] gemini-prompts + codex-prompts: refresh the npm dep, re-check adapter matchers and
      tool-name remaps (`CODEX_TOOL_NAMES`, Gemini tool aliases) against the new behavior
- [ ] opencode-prompts: port the behavior explicitly — nothing is shared with the TS rewrite
- [ ] Update `hooks/README.md` and the mapping table above
- [ ] Behavior branching on host belongs in the adapter, never in `hooks/lib/`

**Host seams (upstream, already built — extend, don't duplicate):**

- `workspace.py` env chain: `MCP_WORKSPACE` → `CLAUDE_PLUGIN_ROOT` → `PLUGIN_ROOT` (Codex native) → Gemini paths
- `cli_spawner.SpawnConfig.client` (`"claude" | "codex"`, env default `RALPH_SPAWN_CLIENT`) picks the spawn CLI
- `model_strategies` registry maps capability tiers per client (`codex` → `gpt-5.6-sol`)

**When modifying the MCP server config surface:**

- [ ] `manifest.json` (Claude Desktop) and `.claude-plugin/plugin.json` → `mcp.json` (Claude Code)
- [ ] Downstream repos bundle their own server config (`gemini-extension.json`, `.mcp.json`)

**When releasing:** this repo versions via release-please; downstream repos version
independently and re-lock via `server/scripts/synchronize-downstream-lock.js` after publish.

## Performance Standards

All SessionStart-class hooks (any host): complete in <5s, quick-check before heavy work,
exit silently on failure — a broken reminder must not break session start. On Codex,
a hook that fails to _launch_ is treated as a BLOCK on its event — downstream repos must
ship adapters before hook trust is granted.
