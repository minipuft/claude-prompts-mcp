<!-- diataxis: how-to -->

# Custom Resources

Use your own prompts, gates, methodologies, and styles. Two approaches depending on whether you want the bundled resources or not.

## Option A — Own workspace (full control)

Create a workspace with starter templates, then point your MCP config to it:

```bash
npx -y claude-prompts@latest --init=~/my-prompts
```

This creates `~/my-prompts/resources/` with starter prompts you own. Set `MCP_WORKSPACE` or `MCP_RESOURCES_PATH` to use it. Prompts created via `resource_manager` are saved here. Your AI can update them through MCP — no manual editing needed.

## Option B — Plugin install (bundled resources + hooks)

Plugin installs (Claude Code, OpenCode, Gemini) set `MCP_WORKSPACE` automatically and ship the bundled 90+ prompts, gates, and methodologies. Prompts created via `resource_manager` are saved to the plugin's resources directory.

## Environment variables

| Variable             | Effect                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `MCP_RESOURCES_PATH` | Sets the base resources directory (replaces the package default).                                                      |
| `MCP_WORKSPACE`      | Enables overlay — custom resources in your workspace load **alongside** bundled ones. Same-ID resources take priority. |

## Config examples per client

**Claude Desktop / VS Code / Cursor** (JSON with `env`):

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"],
      "env": {
        "MCP_RESOURCES_PATH": "/path/to/your/resources"
      }
    }
  }
}
```

**OpenCode** (JSON with `environment`):

```json
{
  "mcp": {
    "claude-prompts": {
      "type": "local",
      "command": ["npx", "-y", "claude-prompts@latest", "--transport=stdio"],
      "environment": {
        "MCP_RESOURCES_PATH": "/path/to/your/resources"
      }
    }
  }
}
```

## Reference

For all env vars including fine-grained path overrides (`MCP_PROMPTS_PATH`, `MCP_GATES_PATH`, etc.), see [CLI Configuration](../reference/mcp-tools.md#cli-configuration).
