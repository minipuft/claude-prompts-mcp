# Client Capabilities Reference

Lookup table for client presets, handoff profiles, and integration limits.

## Client Presets

| `--client` value | Handoff profile      | Status               | Primary behavior                                       |
| ---------------- | -------------------- | -------------------- | ------------------------------------------------------ |
| `claude-code`    | `task_tool_v1`       | canonical            | Task tool style guidance                               |
| `codex`          | `spawn_agent_v1`     | canonical            | `spawn_agent`-oriented handoff guidance                |
| `gemini`         | `gemini_subagent_v1` | canonical            | Gemini sub-agent guidance                              |
| `opencode`       | `opencode_agent_v1`  | canonical            | OpenCode agent guidance                                |
| `cursor`         | `cursor_agent_v1`    | experimental/testing | Cursor-specific handoff wording with fallback guidance |
| `unknown`        | `neutral_v1`         | canonical            | Client-neutral fallback guidance                       |

## Config Shape by Client

| Client         | Typical config file                                                       | Config format                  |
| -------------- | ------------------------------------------------------------------------- | ------------------------------ |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) | JSON (`mcpServers`)            |
| Codex          | `~/.codex/config.toml`                                                    | TOML (`[mcp_servers.*]`)       |
| Cursor         | `~/.cursor/mcp.json`                                                      | JSON                           |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                                     | JSON                           |
| Zed            | `~/.config/zed/settings.json` (`mcp` key)                                 | JSON                           |
| OpenCode       | `~/.config/opencode/opencode.json`                                        | JSON (`mcp`)                   |
| Gemini CLI     | extension-managed                                                         | Extension or manual CLI launch |

## Hooks / Companion Integration Coverage

| Client family                   | Companion package in ecosystem          | Coverage       |
| ------------------------------- | --------------------------------------- | -------------- |
| Claude Code                     | `claude-prompts` plugin hooks           | full           |
| OpenCode                        | `opencode-prompts` hooks                | full           |
| Gemini CLI                      | `gemini-prompts` hooks                  | partial        |
| Codex / Cursor / Windsurf / Zed | no dedicated hooks package in this repo | MCP tools only |

## Client Profile Resolution Order

The runtime resolves client profile with this precedence (first match wins):

1. Launch defaults (`--client` / `identity.launchDefaults.client*`)
2. Trusted request metadata (`authInfo.extra`, `x-client-*` headers)
3. Request hint (`options.client_profile`)
4. SDK heuristic (`clientInfo.name/version`)
5. `unknown` fallback (`neutral_v1`)

## Protocol Limits (Important)

- STDIO transports generally do not provide stable client-identifying headers.
- MCP metadata exposure may vary by client version and host environment.
- For deterministic behavior, launch-time `--client` is the authoritative signal.
- Header-based routing is most useful in controlled HTTP gateway deployments.

## Related

- [How to Configure Client-Aware Handoff Presets](../guides/client-integration.md)
- [Identity Scope](../guides/identity-scope.md)
