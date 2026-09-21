# Troubleshooting

Common issues and how to fix them.

---

## Server Won't Start

### "Unable to determine server root"

**Cause**: Working directory isn't `server/` or paths aren't absolute.

**Fix**:

1. Run from `server/` directory
2. Use `--workspace` flag or `MCP_WORKSPACE` environment variable to set your workspace
3. Run with `--debug-startup` to see detection strategies:
   ```bash
   node dist/index.js --transport=stdio --debug-startup
   ```

**Recommended**: Use the new path configuration system instead of deprecated env vars:

```bash
# Via CLI flags
npx claude-prompts --workspace=/path/to/workspace

# Via environment variables
MCP_WORKSPACE=/path/to/workspace npx claude-prompts
```

### "Refusing to start: ... is set to ..."

**Cause**: A path you set cannot be used, so the server stopped before serving instead of running on
something you did not ask for. The message names the variable or flag, its value, the path it
resolved to, what is wrong, and what removing the setting would fall back to. It fires for:

- `MCP_WORKSPACE` / `--workspace` or `MCP_RESOURCES_PATH` naming a path that does not exist or is
  not a directory. The server no longer creates a missing workspace.
- `MCP_CONFIG_PATH` / `--config` naming a file that is missing, a directory, unreadable, or invalid
  (JSON for a `.json` path, JSONC for a `.jsonc` path).
- A config file inside your workspace (`config.jsonc` or `config.json`) that is unreadable, a
  directory, invalid, or valid JSON that is not an object.

**Fix**: correct the path in your client config, create the directory, or unset the setting. A
relative value resolves against the server's working directory, which for most clients is not your
shell's, so prefer absolute paths. To check a config file:

```bash
# config.json (strict JSON)
node -e "JSON.parse(require('fs').readFileSync('config.json'))"

# config.jsonc — cpm tolerates comments and a trailing comma the same way the server does
cpm config validate -w /path/to/workspace
```

### "holds both config.jsonc (...) and config.json (...)"

**Cause**: Your workspace directory contains both `config.jsonc` and `config.json`. Nothing on disk
says which one the server would read, so rather than guess (and silently prefer `.jsonc`), the
server refuses to start, and every `cpm config` subcommand refuses the same way, naming both paths.

**Fix**: delete whichever file you are not using. `config.jsonc` is the current name and the one
that accepts comments; `config.json` is still read if you keep it instead — but a workspace may hold
only one of the two.

### A comment in `config.json` fails to parse

**Cause**: `config.jsonc` and `config.json` are two different dialects, chosen entirely by the
file's extension — `.jsonc` tolerates `//` and `/* */` comments and a trailing comma before `}`/`]`,
`.json` stays strict `JSON.parse`. A `//` comment or a trailing comma in a file named `config.json`
is a syntax error there, even though the identical content parses in a file named `config.jsonc`.

**Fix**: rename the file to `config.jsonc` (delete any `config.json` left in the same directory
first — see above), or remove the comments and trailing commas to keep it as strict `config.json`.

### Config JSON Syntax Error in the packaged config

**Cause**: Only the `config.json` shipped with the server still falls back instead of refusing:
invalid JSON there logs `Error loading configuration` and `Using default configuration` to stderr,
and the server starts on built-in defaults.

**Fix**: reinstall the package, or point `MCP_CONFIG_PATH` at a valid config file.

> [!NOTE]
> For the config file lookup order and precedence chain, see the [Configuration
> Reference](../reference/configuration.md). For all CLI flags and environment variables, see the
> [CLI Configuration](../reference/mcp-tools.md#cli-configuration) section in the MCP Tools
> reference.

---

## MCP Client Issues

### Client Won't Connect

**Cause**: STDIO conflict, wrong paths, or JSON syntax error in client config.

**Fix**:

1. Run server manually to verify startup:
   ```bash
   node dist/index.js --transport=stdio --verbose
   ```
2. Check Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%\Claude\logs`
3. Ensure absolute paths in `claude_desktop_config.json`

### Tools Not Appearing in Client

**Cause**: Server didn't register tools or client cache is stale.

**Fix**:

1. Check `system_control(action: "status")` to verify server is running
2. Restart Claude Desktop to refresh MCP connections
3. Verify `prompts.registerWithMcp: true` in your config file

> [!NOTE]
> For per-client setup instructions, see the [Client Integration Guide](./client-integration.md) or the [Quick Start](../../README.md#quick-start) in the README.

### "'x' is not a parameter of prompt_engine / system_control / resource_manager"

**Cause**: the call carried an argument key the tool's contract does not declare — usually a
misspelling, a camelCase spelling of a snake_case parameter, or a parameter borrowed from another
tool.

**Fix**: use the name the message suggests, or drop the key. The full declared list is one call
away: `resource_manager(resource_type:"prompt", action:"guide")`, `system_control(action:"guide")`,
or the tool description for `prompt_engine`.

**Why it is an error rather than being ignored**: such a key used to be dropped silently while the
call answered **success**. A mistyped _safety_ flag — `preview`, `confirm`, `persist` — therefore
reported a guarded action while running it unguarded. See
[mcp-tools.md § Undeclared parameters](../reference/mcp-tools.md#undeclared-parameters).

### "'gate_verdict' is a parameter of prompt_engine, but not one this server is advertising right now"

**Cause**: the gate system is disabled, so `prompt_engine` withdraws `gates`, `gate_verdict` and
`gate_action` from its advertised surface. The spelling is right; the state is wrong. A client
holding a cached `tools/list` from before the toggle is the usual source.

**Fix**: `system_control(action:"gates", operation:"enable")`, or drop the parameter. Re-listing
tools after the toggle stops the client from sending it again.

### "Script tool 'x' emitted an auto_execute call that is refused"

**Cause**: a script tool's `auto_execute.params` named a key `resource_manager` does not declare.
The script — not the caller — is what needs editing.

**Fix**: open the named script's `tools/<id>/` folder and correct the emitted key. See
[script-tools.md § Auto-execute parameters are checked](./script-tools.md#auto-execute-parameters-are-checked-not-forwarded).

---

## Prompt Issues

### Prompts Not Loading

**Cause**: Prompt not listed in registry or file path mismatch.

**Fix**:

1. Check registry: `resource_manager(resource_type: "prompt", action: "list")`
2. Verify path in `prompts/promptsConfig.json`
3. Manual reload: `resource_manager(resource_type: "prompt", action: "reload")`

### Hot Reload Not Working

**Cause**: File watcher issue or file not in watched paths.

**Fix**:

1. Confirm file is listed in `prompts/promptsConfig.json`
2. Trigger manual reload: `resource_manager(resource_type: "prompt", action: "reload")`
3. Check `server/logs/` for watcher errors
4. Use supervisor mode if STDIO sessions must persist during reload

> [!NOTE]
> For prompt creation and file structure, see the [Build Your First Prompt](../tutorials/build-first-prompt.md) tutorial. For the full schema, see [Prompt YAML Schema](../reference/prompt-yaml-schema.md).

---

## Chain Issues

### Chain Sessions Reset Unexpectedly

**Cause**: `runtime-state/state.db` permissions or corruption.

**Fix**:

1. Check write permissions on `runtime-state/` directory
2. Delete `state.db` and restart (sessions will reset)
3. In CI, use HTTP transport (`--transport=streamable-http`) to avoid STDIO restrictions

> [!NOTE]
> For chain concepts and session management, see [Chains Lifecycle](../concepts/chains-lifecycle.md). For chain step configuration, see [Chain Schema Reference](../reference/chain-schema.md).

### Chain Stuck / Won't Advance

**Cause**: Gate failed and waiting for verdict, or session corrupted.

**Fix**:

1. Check if gate review is pending—send `gate_verdict` (preferred format: `GATE_REVIEW: PASS/FAIL - reason`) or `gate_action` when retries are exhausted
2. Bundle responses for efficiency: include both `user_response` and `gate_verdict` in one call
3. Force restart: `prompt_engine(command: ">>prompt", force_restart: true)`
4. Inspect session: `system_control(action: "status")`

---

## Framework Issues

### "No active framework" Messages

**Expected behavior** when you haven't switched frameworks.

**Fix** (if you want a framework active):

```bash
system_control(action: "framework", operation: "switch", framework: "CAGEERF")
```

### Framework Not Injecting into Prompts

**Cause**: Injection disabled in config or using `%clean` modifier.

**Fix**:

1. Check `frameworks.enabled: true` in your config file
2. Remove `%clean` or `%lean` modifiers from command
3. Use `%guided` to force injection

> [!NOTE]
> For injection frequency tuning and modifier details, see the [Injection Control Guide](./injection-control.md).

---

## Gate Issues

### Gates Not Appearing in Output

**Cause**: No gates specified or framework gates disabled.

**Fix**:

1. Add gates explicitly: `gates: ["code-quality"]` or `:: 'criteria'`
2. Check `gates.frameworkGates: true` in config
3. Verify gate activation rules match your prompt category

### Gate Keeps Failing

**Cause**: Retry limit reached or criteria unclear.

**Fix**:

1. Use `gate_action: "skip"` to bypass and continue
2. Use `gate_action: "retry"` to reset attempt counter
3. Clarify criteria in the gate definition

> [!NOTE]
> For gate syntax, types, and best practices, see the [Gates Guide](./gates.md). For the full `gate.yaml` schema, see [Gate Configuration Reference](../reference/gate-configuration.md).

---

## Logging & Diagnostics

### Enable Verbose Logging

```bash
node dist/index.js --transport=stdio --verbose
```

Or set environment variable:

```bash
LOG_LEVEL=debug node dist/index.js --transport=stdio
```

### Log File Locations

- Server logs: `server/logs/*.log`
- Claude Desktop: `~/Library/Logs/Claude/` (macOS) or `%APPDATA%\Claude\logs` (Windows)

### Get Runtime Status

```bash
system_control(action: "status")
```

Returns: framework state, transport type, prompt count, gate metrics.

---

## Filing Issues

When reporting bugs, include:

1. Output of `system_control(action: "status")`
2. Relevant logs from `server/logs/*.log`
3. Prompt IDs and chain_ids involved
4. Transport type (STDIO/Streamable HTTP)
5. Node.js version: `node -v`
6. Steps to reproduce

---

## See Also

- **[MCP Tools Reference](../reference/mcp-tools.md)** — Full tool parameters, operators, and workflows
- **[Architecture Overview](../architecture/overview.md)** — How the pipeline processes requests
- **[Build Your First Prompt](../tutorials/build-first-prompt.md)** — Getting started tutorial
