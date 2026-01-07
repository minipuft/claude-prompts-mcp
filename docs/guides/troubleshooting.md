# Troubleshooting

> Status: canonical

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

### Config JSON Syntax Error

**Cause**: Invalid JSON in `config.json` blocks startup.

**Fix**:
```bash
node -e "JSON.parse(require('fs').readFileSync('config.json'))"
```

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
3. Verify `prompts.registerWithMcp: true` in `config.json`

---

## Prompt Issues

### Prompts Not Loading

**Cause**: Prompt not listed in registry or file path mismatch.

**Fix**:
1. Check registry: `prompt_manager(action: "list")`
2. Verify path in `prompts/promptsConfig.json`
3. Manual reload: `prompt_manager(action: "reload")`

### Hot Reload Not Working

**Cause**: File watcher issue or file not in watched paths.

**Fix**:
1. Confirm file is listed in `prompts/promptsConfig.json`
2. Trigger manual reload: `prompt_manager(action: "reload")`
3. Check `server/logs/` for watcher errors
4. Use supervisor mode if STDIO sessions must persist during reload

---

## Chain Issues

### Chain Sessions Reset Unexpectedly

**Cause**: `runtime-state/chain-sessions.json` permissions or corruption.

**Fix**:
1. Check write permissions on `runtime-state/` directory
2. Delete `chain-sessions.json` and restart (sessions will reset)
3. In CI, use HTTP transport (`--transport=streamable-http`) to avoid STDIO restrictions

### Chain Stuck / Won't Advance

**Cause**: Gate failed and waiting for verdict, or session corrupted.

**Fix**:
1. Check if gate review is pending—send `gate_verdict` or `gate_action`
2. Force restart: `prompt_engine(command: ">>prompt", force_restart: true)`
3. Inspect session: check `runtime-state/chain-sessions.json`

---

## Framework Issues

### "No active framework" Messages

**Expected behavior** when you haven't switched methodologies.

**Fix** (if you want a framework active):
```bash
system_control(action: "framework", operation: "switch", framework: "CAGEERF")
```

### Framework Not Injecting into Prompts

**Cause**: Injection disabled in config or using `%clean` modifier.

**Fix**:
1. Check `frameworks.enableSystemPromptInjection: true` in `config.json`
2. Remove `%clean` or `%lean` modifiers from command
3. Use `%guided` to force injection

---

## Gate Issues

### Gates Not Appearing in Output

**Cause**: No gates specified or framework gates disabled.

**Fix**:
1. Add gates explicitly: `gates: ["code-quality"]` or `:: 'criteria'`
2. Check `frameworks.enableMethodologyGates: true` in config
3. Verify gate activation rules match your prompt category

### Gate Keeps Failing

**Cause**: Retry limit reached or criteria unclear.

**Fix**:
1. Use `gate_action: "skip"` to bypass and continue
2. Use `gate_action: "retry"` to reset attempt counter
3. Clarify criteria in the gate definition

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
4. Transport type (STDIO/SSE/Streamable HTTP)
5. Node.js version: `node -v`
6. Steps to reproduce
