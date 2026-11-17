# Your Own Resources

Your prompts, gates, frameworks and styles live in a **profile**: a folder with a `config.jsonc` and a `resources/` directory, selected per client with one variable. The shipped resources load underneath it unless you say otherwise.

## Set up a profile

1. **Make the folder.** `claude-prompts --init=~/prompts/dev` scaffolds `config.jsonc` and three example prompts under `resources/prompts/`. Any folder with that layout works.
2. **Point your client at it.** Put `MCP_WORKSPACE` in the `env` block of your client's server entry; the [install section](../../README.md#quick-start) shows each client's file.
   ```json
   "env": { "MCP_WORKSPACE": "/home/you/prompts/dev" }
   ```
   The Claude Code plugin needs no setting until you want one: it uses its own data folder.
3. **Name it.** `cpm workspace add dev ~/prompts/dev -w ~/prompts/dev` records the label in `workspaces.jsonc` beside the folder; run `cpm workspace` from inside a profile or pass `-w`. `use dev` prints the line from step 2 for another profile; `list` and `show` read the file; `remove` drops a label and leaves the folder.

**Verify:** `system_control status` shows `profile: dev` and a **Resource locations** list with your folder first and `bundled` last.

## Read from a second library

List it in the profile's config. Earlier entries win a shared id; `"bundled"` is the shipped set and goes where you put it. Leave `"bundled"` out and only your folders serve, plus the six frameworks the server needs to run, and the server prints the prompt count per location at startup.

```jsonc
{ "paths": { "resources": ["../shared/resources", "bundled"] } }
```

There is no command for this; the list is the whole mechanism.

## Where a new resource is saved

A created or updated resource lands in the profile's `resources/<type>/`, or in `paths.writeTarget` when the config names one of the listed folders. Inside a repository that has a `.claude-prompts/` folder (STDIO only), it lands there instead. Every write answers with its last line, `saved: <path>`; a rollback does too.

## Edit files by hand

A file you change on disk gets a version and a rollback point exactly as a tool write does. A file the server cannot load is listed under **Refused files** in `system_control status` and in `changes list` with the reason, while the previous definition keeps serving.

## A project's own resources

A repository can carry `.claude-prompts/resources/<type>/`; over STDIO those load above your profile and the shipped set, and that folder receives writes. Its `config.jsonc` may carry prompt settings but not `paths.*`: the list is a machine setting, and a committed file must not point a collaborator's server at a path.

## Plugin installs

The Claude Code plugin ships no path setting. With `MCP_WORKSPACE` unset it uses `~/.claude/plugins/data/<plugin>/`, which survives updates; uninstalling deletes that folder unless you pass `--keep-data`. The Codex manifest keeps `${PLUGIN_ROOT}` because Codex passes no data folder.

## Reference

Settings and every startup refusal: [Configuration](../reference/configuration.md#where-resources-come-from). Tool output shapes: [MCP Tools](../reference/mcp-tools.md). `MCP_RUNTIME_ROOT` moves state and logs; `MCP_CONFIG_PATH` names a config file outside the profile.
