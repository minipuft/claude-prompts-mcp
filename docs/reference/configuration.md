# Configuration Reference

The server and the `cpm` CLI both read one file: `config.jsonc` or `config.json` in your
workspace, or the packaged default if you have neither. This page documents that file: which one
gets read, how a single value gets resolved when several sources set it, how an editor validates
it, and how to read or change a setting once the server is running.

For the list of settings itself, see [Where the Settings Live](#where-the-settings-live) below.
This page does not restate it, because a second copy drifts from the first.

## Which File Is Read

The server checks four locations, in order, and stops at the first match:

1. **`--config` / `MCP_CONFIG_PATH`**: an explicit path always wins over anything workspace- or
   package-relative. It is parsed as JSONC if the path ends `.jsonc`, otherwise strict JSON.
2. **`<workspace>/config.jsonc`**, where the workspace comes from `--workspace` or
   `MCP_WORKSPACE`.
3. **`<workspace>/config.json`**, read only if `config.jsonc` is not present.
4. **`<package>/config.json`**: the file that ships with the server, used when no workspace is
   configured or the workspace holds neither file.

A workspace holding **both** `config.jsonc` and `config.json` is ambiguous, so the server refuses
to start rather than silently preferring `.jsonc`; `cpm config` refuses the same way. The message
names both paths. Delete whichever file you are not using.

**What refuses startup, and what falls back:**

| Setting                                                   | Problem                                                        | Result                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `--workspace` / `MCP_WORKSPACE`                           | Not an existing directory                                      | Refuses to start                                                     |
| `--config` / `MCP_CONFIG_PATH`                            | Missing, a directory, unreadable, or invalid for its extension | Refuses to start                                                     |
| A workspace `config.jsonc`/`config.json`                  | Unreadable, a directory, or valid JSON that is not an object   | Refuses to start                                                     |
| A workspace holding both `config.jsonc` and `config.json` | Ambiguous                                                      | Refuses to start                                                     |
| A workspace with no config file at all                    | n/a                                                            | Falls back to the packaged default                                   |
| The packaged `config.json`                                | Invalid JSON                                                   | Falls back to built-in defaults, logs a warning, does **not** refuse |

The refusal only applies to a setting an operator actually named. The one file that still falls
back silently on a parse error is the packaged one nobody configured; refusing there would mean a
plain `npx claude-prompts` with no arguments could fail on a corrupted install.

## Precedence of a Single Value

Reading down from the built-in default, each layer overrides the one above it, but only for the
handful of keys that a layer actually reaches:

1. **Built-in default**, compiled into the server (`server.port` is `9090`, `logging.level` is
   `info`, and so on).
2. **The config file**, if it sets the key.
3. **An environment variable**, for the two keys that have one: `PORT` overrides `server.port`,
   and `LOG_LEVEL` overrides `logging.level` (accepted values: `debug`, `info`, `warn`, `error`,
   case-insensitive; an unrecognized value is ignored with a warning, not applied).
4. **A command-line flag**, where one exists. `--log-level` overrides everything above it for the
   log level the running process actually uses. `--transport` is the only way to select a
   transport at all; no config key does (see below).

Nothing above is a generic mechanism: `server.port` and `logging.level` are the only two keys
with an environment override, and most keys have no CLI flag. A key with neither reads straight
from the file, or the default if the file doesn't set it.

**Transport is a launch-time-only decision.** `--transport` (`stdio`, `streamable-http`, or
`both`) is the sole selector. A config file that still sets `server.transport` to anything other
than `"stdio"` makes the server refuse to start, naming the value it found and the `--transport`
flag to pass instead. It does not fall back to stdio silently, because that would run the wrong
transport while telling the operator nothing.

**What `system_control(action:"config", operation:"get")` reports as a value's `source`** follows
this same chain, collapsed to three labels: `file` (the config file set it), `default` (the
built-in default; the file didn't set it), or `environment` (`PORT` or `LOG_LEVEL` is overriding
both). A `--log-level` flag is not reflected in this `source` label; it changes what the running
logger uses without changing what the config layer reports the key as.

## Editor Validation

A freshly written `config.jsonc` carries a `$schema` line pointing at a fetchable URL:

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/npm/claude-prompts@5/config.schema.json",
  "version": 5,
  // ...
}
```

An editor with JSON Schema support (VS Code's built-in JSON language service, for example) fetches
that URL and validates your file against it as you type, flagging an unknown key or a value
outside its allowed range before you ever start the server. `cpm init`, the server's `--init`, and
`cpm config reset` all write this line.

**The server and `cpm` never fetch it.** Validation at runtime always checks against the schema
packaged with the running server version, not the file's own `$schema` line. A config loaded from
an unusual path via `--config` or `MCP_CONFIG_PATH` is still checked correctly, and a stale
`$schema` value in an old file has no effect on server behavior. The line exists purely to help
your editor.

**Working offline, or on a pre-5.0 install:** the URL resolves starting with the first `5.x`
release; nothing before it published `config.schema.json` to the registry. If your editor can't
reach the network, or you're pinned to an older version, point `$schema` at the package's own copy
instead:

```jsonc
"$schema": "./node_modules/claude-prompts/config.schema.json"
```

A file that still says `"./config.schema.json"` (the old default) keeps loading normally either
way. The value only matters to your editor.

## Reading and Changing Settings

**From the CLI** (works without a running server):

```bash
cpm config list                    # Full config as formatted JSON
cpm config get <key>                # One value by dot-notation key
cpm config set <key> <value>        # Write one value (backup + edit in place)
cpm config validate                 # Check the file against the schema
cpm config reset --force            # Restore defaults
cpm config keys                     # List every valid key
```

Full flag reference and subcommand details: [CLI Guide § config](../guides/cli.md#config).

**Over MCP**, `system_control(action:"config", …)` serves reads only: `list`, `keys`, `get`, and
`validate`. There is no `set`, `reset`, or `restore` operation; a request naming one is refused by
name. Change a setting with `cpm config set` instead. Full parameters and examples: [MCP Tools
Reference § Config Operations](mcp-tools.md#config-operations).

This is narrower than "configuration can't be written over MCP." Toggling gates or a framework
with `persist: true` (`system_control(action:"gates"|"framework", operation:"enable"|"disable",
persist:true)`) does write back to your config file, on keys the server itself chooses: a gates
toggle writes `gates.enabled`; a framework toggle writes three keys to the same boolean,
`frameworks.enabled`, `frameworks.dynamicToolDescriptions`, and `gates.frameworkGates`. The
difference from an ordinary write is that the caller names an action, not an arbitrary key or
value; it cannot ask the server to persist anything else. `framework:switch` and
`injection:override` have no `persist` option at all: an injection override lasts for the session
only.

**Edits keep your file intact.** `cpm config set` changes only the characters for the one key it's
touching, so comments, key order, and formatting around it survive. A key that exists only as a
commented-out example in the generated template gets inserted live, leaving the example where it
was.

**A saved change reaches a running server through hot reload**, with no restart required for most
settings. The server watches its config file and re-reads it on change.

## Where the Settings Live

This page intentionally does not enumerate every key. Two generated sources do, and both are
derived from the same schema, so they cannot drift from each other or from what the server
actually accepts:

- **`cpm init`** writes a fully commented `config.jsonc` template: every setting, its current
  value, its default, and its permitted values, generated straight from the schema.
- **`cpm config keys`** lists every valid dot-notation key from the same source, for scripting or
  a quick lookup without opening a file.

## Python Hooks Read the Same File

Claude Code hooks under `hooks/` resolve the config file independently of the server process
(hooks don't inherit the server's environment), but land on the same file when both are pointed at
the same workspace:

1. `MCP_WORKSPACE`
2. `CLAUDE_PLUGIN_DATA`
3. The packaged `server/` directory

Within each candidate directory, `config.jsonc` is tried before `config.json`, and the first file
that exists wins. See `hooks/README.md` for the hook-specific settings this covers (currently just
`hooks.expandedOutput`).

## Upgrading from a Pre-5.0 File

A `config.json` with no `"version"` key is read as a pre-5.0 file and translated in memory on
load: renamed and moved keys resolve to their new locations, and removed sections (`analysis`,
`server.transport`) are dropped with a one-time notice naming what changed. Nothing is rewritten on
disk; the translation happens on every load until you update the file yourself.

For the full list of what moved, what was removed, and why, see the [CHANGELOG](../../CHANGELOG.md)
and [CLI Guide § config.jsonc](../guides/cli.md#configjsonc).
