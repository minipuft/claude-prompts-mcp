<!-- diataxis: how-to -->

# Custom Resources

Use your own prompts, gates, frameworks, and styles. Two approaches depending on whether you want the bundled resources or not.

## Option A — Own workspace (full control)

Create a workspace with starter templates, then point your MCP config to it:

```bash
npx -y claude-prompts@latest --init=~/my-prompts
```

This creates `~/my-prompts/resources/` with starter prompts you own. Set `MCP_WORKSPACE` or `MCP_RESOURCES_PATH` to use it. Prompts created via `resource_manager` are saved here. Your AI can update them through MCP — no manual editing needed.

## Option B — Plugin install (bundled resources + hooks)

Plugin installs (Claude Code, OpenCode, Gemini) set `MCP_WORKSPACE` automatically and ship the bundled prompts, gates, and frameworks. Where created resources are saved follows the rules below; for the Claude Code plugin the workspace is its plugin data folder, which Claude Code keeps across plugin updates.

## Where created resources are saved

Prompts, gates, and frameworks you create through `resource_manager` are written to one folder per type:

- **A workspace is set** (`MCP_WORKSPACE` or `--workspace`) and `MCP_RESOURCES_PATH` is not: `<workspace>/resources/<type>/`, for example `<workspace>/resources/prompts/`. The folder does not need to exist; the first write creates it. If the workspace already keeps that type in the older `<workspace>/<type>/` layout, writes go there instead, so one collection is not split across two folders.
- **`MCP_RESOURCES_PATH` is set**: its `<type>/` folder when that folder exists, otherwise the package's own resources folder.
- **Neither is set**: the package's own resources folder, which a reinstall replaces.

Editing a bundled prompt copies it into your folder first, and your copy then takes precedence over the bundled one.

## What an edit does to a file you wrote by hand

These are your files, so you can comment them, order the keys however you like, and wrap long text
to taste. An edit through `resource_manager` or `cpm` keeps that work rather than reformatting the
file around your change. Two cases, and the difference is worth knowing:

- **Changing a value** — a description, a name, a severity — rewrites only the lines that value
  occupies. Comments, blank lines, key order, quoting style, and the wrapping of long text you did
  not touch all stay exactly as you left them.
- **Adding or removing a key**, or changing the number of entries in a list, re-renders the
  document. Your comments still survive, but a long value elsewhere in the file may come back
  wrapped at a different width.

A file the edit does not change is not written at all, so it is untouched either way. Nothing here
changes what a file _means_ — only how much of its formatting an edit disturbs.

## Environment variables

| Variable             | Effect                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_RESOURCES_PATH` | Sets the base resources directory (replaces the package default). Must be an existing directory, or startup is refused.                                                      |
| `MCP_WORKSPACE`      | Enables overlay — custom resources in your workspace load **alongside** bundled ones. Same-ID resources take priority. Must be an existing directory, or startup is refused. |

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

For the env vars the server actually reads (`MCP_WORKSPACE`, `MCP_RESOURCES_PATH`, `MCP_CONFIG_PATH`), see [CLI Configuration](../reference/mcp-tools.md#cli-configuration). There are no per-resource-type path overrides.

A path you set must be usable, or the server stops at startup instead of quietly serving something else. `MCP_CONFIG_PATH` (and the `--config` flag) must name a readable config file — JSON for a `.json` path, JSONC (comments and a trailing comma allowed) for a `.jsonc` path. `MCP_WORKSPACE` (and `--workspace`) and `MCP_RESOURCES_PATH` must name an existing directory, which the server no longer creates for you. A config file inside your workspace, if there is one, must be a readable JSON object, and a workspace holding both `config.jsonc` and `config.json` refuses to start rather than picking one. Otherwise the server exits on every transport with a message on stderr naming the setting, its value, the resolved path, what is wrong, and what removing it would fall back to. Without that check, a typo in a path served the bundled prompts in place of yours with nothing to say so. A workspace with no config file uses the packaged one, and an empty value counts as unset.
