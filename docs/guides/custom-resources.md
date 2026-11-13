<!-- diataxis: how-to -->

# Custom Resources

Use your own prompts, gates, frameworks, and styles. Three approaches, depending on whether the resources belong to you, to a plugin install, or to one project.

## Option A — Own workspace (full control)

Create a workspace with starter templates, then point your MCP config to it:

```bash
npx -y claude-prompts@latest --init=~/my-prompts
```

This creates `~/my-prompts/resources/` with starter prompts you own, and a `config.jsonc` beside it. Set `MCP_WORKSPACE` to `~/my-prompts` to use it. Prompts created via `resource_manager` are saved here. Your AI can update them through MCP — no manual editing needed.

## Option B — Plugin install (bundled resources + hooks)

Plugin installs (Claude Code, OpenCode, Gemini) ship the bundled prompts, gates, and frameworks. Where created resources are saved follows the rules below.

The Claude Code plugin's `.mcp.json` carries no path environment. Claude Code hands every plugin's server `CLAUDE_PLUGIN_DATA`, a folder it creates and keeps across plugin updates, and the server takes it as the workspace and runtime root when `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` are unset. A plugin that wrote no `env` block also lets a `MCP_WORKSPACE` you set in Claude Code's settings reach the server unchanged, so pointing the plugin at your own library is one setting. Uninstalling the plugin deletes the data folder unless you pass `--keep-data`, so a library you want to keep belongs in a workspace of your own.

The Agent Plugins `mcp.json` that Codex reads keeps `"MCP_WORKSPACE": "${PLUGIN_ROOT}"`: Codex passes its MCP child no data variable, so without that line the server would fall back to the package root and write beside the plugin's own files.

## Option C — Project workspace

A repository can carry its own prompts, gates, frameworks, and styles in `<project>/.claude-prompts/`, so they travel with the code and apply only there. The directory holds an optional `config.jsonc` and a `resources/` folder with one subfolder per type (`prompts`, `gates`, `frameworks`, `styles`). It mirrors the harnesses' own project folders: Claude Code's `.claude/`, Gemini CLI's `.gemini/`, and OpenCode's `.opencode/`.

From the project root, scaffold it with the same starter content as `--init`:

```bash
npx -p claude-prompts cpm init --project
```

When the server runs inside that project over STDIO, resources in `.claude-prompts/` load above your user workspace and everything else the server reads. On a shared id the nearest wins: project, then workspace, then the rest of the list in [Where resources come from](#where-resources-come-from). A project folder contributes its resources without listing locations; its own `config.jsonc` may not set `paths.resources`, which is a machine-level setting. Claude Code, Codex, OpenCode, and Gemini CLI start an MCP server in the project directory, so no setup beyond the folder is needed.

The server finds the project directory the same way it derives the project scope: `CLAUDE_PROJECT_DIR` if set, otherwise the working directory. The HTTP transport does not look at the project directory, because one HTTP process serves many projects; use Option A or B there.

A `.claude-prompts/` directory created while the server is running is picked up without a
restart for new resources. Which copy wins when the same id also exists in your workspace, and
where new resources are written, follow on the next start.

## Where resources come from

Each resource type is read from one ordered list of folders. When two folders define the same id, the earlier one wins:

1. **The project folder**, `<project>/.claude-prompts/resources/<type>/`, when the server runs over STDIO inside a project. It comes first whether or not `MCP_RESOURCES_PATH` is set.
2. **Your workspace's own folder**, `<workspace>/resources/<type>/`, and the older `<workspace>/<type>/` layout beside it. When `MCP_RESOURCES_PATH` is set, its `<type>/` folder takes this place instead; a workspace set alongside it still contributes its own folders right after it.
3. **Each entry of `paths.resources`** in your `config.jsonc`, in the order written. `"bundled"` stands for the package's shipped prompts, gates, frameworks and styles, at the position it is listed.
4. **The shipped resources, last**, only when the config has no `paths.resources` list.

A custom list replaces the shipped content: a list that leaves `"bundled"` out serves no shipped prompt, gate or style, and only the six frameworks the server needs to run still load from the package. List `"bundled"` to keep both. A gate the server looks for by default, such as `framework-compliance`, is then missing unless a listed folder ships it, and the warning about the missing gate names the list as the reason.

```jsonc
{
  "paths": {
    "resources": ["../shared/resources", "bundled"],
  },
}
```

- `"../shared/resources"` is a resources directory holding `prompts/`, `gates/`, `frameworks/` and `styles/`, resolved against the folder `config.jsonc` is in. Its prompts win over the shipped ones with the same id.
- `"bundled"` keeps the shipped prompts, gates, frameworks and styles, beneath the shared folder.

The list is a machine-level setting: put it in your workspace's `config.jsonc` or the file `MCP_CONFIG_PATH` names. Every entry must be an existing directory, listed once; the server refuses to start otherwise, and the [refusal table in Configuration](../reference/configuration.md#where-the-workspace-comes-from) lists each case. With a list in force, startup prints one line to stderr, `Resource locations: N prompts across M locations (...)`, naming the listed locations even when it found no prompts.

## Where created resources are saved

Prompts, gates, and frameworks you create through `resource_manager` are written to one folder per type, never to a `paths.resources` entry:

- **`.claude-prompts/` exists at the project root** (STDIO only): `<project>/.claude-prompts/resources/<type>/`, for example `.claude-prompts/resources/prompts/`. The folder does not need to exist; the first write creates it. The rules below apply only when the project has no `.claude-prompts/`.
- **`MCP_RESOURCES_PATH` is set**: its `<type>/` folder, created by the first write. When that folder does not exist yet and the workspace keeps the type in the older `<workspace>/<type>/` layout, writes go there instead.
- **A workspace is set** (`MCP_WORKSPACE`, `--workspace`, or the Claude Code plugin's data folder) and `MCP_RESOURCES_PATH` is not: `<workspace>/resources/<type>/`, for example `<workspace>/resources/prompts/`. The folder does not need to exist; the first write creates it. If the workspace already keeps that type in the older `<workspace>/<type>/` layout, writes go there instead, so one collection is not split across two folders.
- **Neither is set**: the package's own resources folder, which a reinstall replaces.

Editing a bundled prompt copies it into your folder first, and your copy then takes precedence over the bundled one.

## What an edit does to a file you wrote by hand

These are your files, so you can comment them, order the keys however you like, and wrap long text
to taste. An edit through `resource_manager` or `cpm` keeps that work rather than reformatting the
file around your change. Two cases, and the difference is worth knowing:

- **Changing a value** — a description, a name, a severity — rewrites only the lines that value
  occupies. Comments, blank lines, key order, quoting style, and the wrapping of long text you did
  not touch all stay exactly as you left them.
- **Adding or removing an entry in a list** changes only that entry's lines. Comments, the
  wrapping of long text and a list written in `[a, b]` style all stay as you left them.
- **Adding or removing a key**, or a value changing kind, re-renders the document. Your comments
  still survive, but a long value elsewhere in the file may come back wrapped at a different
  width.

A file the edit does not change is not written at all, so it is untouched either way. Nothing here
changes what a file _means_ — only how much of its formatting an edit disturbs.

## Environment variables

| Variable             | Effect                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_RESOURCES_PATH` | Names a resources directory that takes the place of your workspace's own folder: read before the `paths.resources` list, which still follows it, and the folder created resources are saved to. Must be an existing directory, or startup is refused.                                                                         |
| `MCP_WORKSPACE`      | Your workspace: its `resources/` folder loads ahead of the `paths.resources` list and the shipped resources, and its config file is the one read. Same-ID resources take priority. Must be an existing directory, or startup is refused. When unset, `CLAUDE_PLUGIN_DATA` (set by Claude Code for a plugin) is the workspace. |

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

A path you set must be usable, or the server stops at startup instead of quietly serving something else. `MCP_CONFIG_PATH` (and the `--config` flag) must name a readable config file — JSON for a `.json` path, JSONC (comments and a trailing comma allowed) for a `.jsonc` path. `MCP_WORKSPACE` (and `--workspace`) and `MCP_RESOURCES_PATH` must name an existing directory, which the server no longer creates for you. A config file inside your workspace, if there is one, must be a readable JSON object, and a workspace holding both `config.jsonc` and `config.json` refuses to start rather than picking one. Each `paths.resources` entry must be an existing directory too. Otherwise the server exits on every transport with a message on stderr naming the setting, its value, the resolved path, what is wrong, and what removing it would fall back to. Without that check, a typo in a path served the bundled prompts in place of yours with nothing to say so. A workspace with no config file uses the packaged one, and an empty value counts as unset.
