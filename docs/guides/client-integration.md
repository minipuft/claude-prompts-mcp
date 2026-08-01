# How to Configure Client-Aware Handoff Presets

This guide shows you how to configure the `--client` launch flag so the server emits the right handoff guidance for each MCP host client.

## Prerequisites

- Claude Prompts MCP server installed (`npx` or local build)
- Access to your client MCP config file
- Server version with client presets (`claude-code`, `codex`, `gemini`, `opencode`, `cursor`, `unknown`)

## Steps

1. **Pick the preset for your host client**

   | Host client                     | Use `--client` |
   | ------------------------------- | -------------- |
   | Claude Code / Claude Desktop    | `claude-code`  |
   | Codex                           | `codex`        |
   | Gemini CLI                      | `gemini`       |
   | OpenCode                        | `opencode`     |
   | Cursor                          | `cursor`       |
   | Windsurf (experimental mapping) | `cursor`       |
   | Unknown/unsupported client      | `unknown`      |

2. **Add the flag to your client MCP config**

   **JSON-based clients (Claude Desktop / Cursor / Windsurf / Zed style):**

   ```json
   {
     "mcpServers": {
       "claude-prompts": {
         "command": "npx",
         "args": ["-y", "claude-prompts@latest", "--client=cursor"]
       }
     }
   }
   ```

   **Codex (`~/.codex/config.toml`):**

   ```toml
   [mcp_servers.claude_prompts]
   command = "npx"
   args = ["-y", "claude-prompts@latest", "--client=codex"]
   ```

   **Manual server launch (any client):**

   ```bash
   npx -y claude-prompts@latest --client=gemini
   # or local build:
   node dist/index.js --transport=stdio --client=opencode
   ```

3. **Restart your client so it relaunches the MCP server**

4. **Verify profile resolution**

   Run:

   ```text
   system_control(action:"whoami")
   ```

   Confirm `clientProfile` matches your chosen preset.

5. **Verify handoff behavior**

   Run a prompt/chain with `==>` and confirm the returned guidance aligns with your client profile.

## Troubleshooting

**Issue:** Handoff wording still looks generic (`unknown`)  
**Fix:** Re-check the launch args in client config and fully restart the client process.

**Issue:** Config changes do not take effect  
**Fix:** Some clients cache MCP sessions. Force a full app restart, not only a chat/session refresh.

**Issue:** Multiple wrappers launch the server with different args  
**Fix:** Keep one authoritative MCP entry per client and remove duplicate launch points.

## See Also

- [Client Capabilities Reference](../reference/client-capabilities.md) — preset matrix and limitations
- [Identity Scope](identity-scope.md) — profile resolution order and transport-level identity behavior
- [MCP Tools](../reference/mcp-tools.md) — `system_control(action:"whoami")` reference
