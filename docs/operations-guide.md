# Operations & Deployment Guide

**Use this guide when** you want the fastest path to a working Claude Prompts MCP server, with tips for transports, supervisor mode, hot reload, and diagnostics.

**You’ll learn**
- How to install dependencies and launch STDIO or SSE transports
- Which config flags control frameworks, gates, and dynamic tool descriptions
- Troubleshooting steps for startup failures, chain sessions, and logging

Once you’re comfortable running the server, hop over to the [MCP Tooling Guide](mcp-tooling-guide.md) and [Prompt & Template Authoring Guide](prompt-authoring-guide.md) to iterate on prompts inside the running instance.

## 1. Prerequisites

- **Node.js**: v16, v18, or v20 (CI covers all three). Use the same major version for `npm` that ships with your Node install.
- **OS**: macOS, Linux, or Windows with access to a POSIX-like shell (Git Bash/WSL work fine).
- **Git**: Required for cloning and for hot-reload integrity (file watchers rely on a repo checkout).
- **Disk**: ~1 GB for repo + dependencies + runtime-state.

Verify versions:

```bash
node -v
npm -v
```

## 2. Initial Setup

```bash
git clone https://github.com/minipuft/claude-prompts-mcp.git
cd claude-prompts-mcp/server
npm install
```

> Tip: the repo root contains automation scripts, but every build/test/dev command runs inside the `server/` workspace.

## 3. Configuration (`server/config.json`)

- `server.port`: SSE HTTP port (default `9090`). STDIO mode ignores this.
- `transports.default`: `stdio` or `sse`. CLI flags override the default (`node dist/index.js --transport=sse`).
- `logging.directory` + `logging.level`: Respect the transport-aware logger in `server/dist/logging/`.
- `prompts.file`: Path to the canonical `promptsConfig.json`. Hot reload depends on this being absolute.
- Environment overrides: set `MCP_SERVER_ROOT` or `MCP_PROMPTS_CONFIG_PATH` when launching from IDEs/Claude Desktop to skip path detection.
- `frameworks.enableSystemPromptInjection`: `false` disables methodology context injection into rendered prompts (server keeps running, you manually include any system text you need).
- `frameworks.enableMethodologyGates`: `false` turns off framework-derived gates. Inline gates in prompt metadata still run.
- `frameworks.enableDynamicToolDescriptions`: `false` stops the runtime from rewriting `prompt_manager`, `prompt_engine`, and `system_control` descriptions with framework hints—useful if the MCP client already displays custom text.

Runtime state (`runtime-state/*`) stores framework selection and chain sessions. Never commit these files; they are regenerated automatically.

## 4. Running the Server

### Local STDIO (Claude Desktop, Cursor, Windsurf)

```bash
cd server
npm run build
node dist/index.js --transport=stdio --verbose
```

Configure Claude Desktop:

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "node",
      "args": ["/absolute/path/to/server/dist/index.js", "--transport=stdio"],
      "env": {
        "MCP_SERVER_ROOT": "/absolute/path/to/server",
        "MCP_PROMPTS_CONFIG_PATH": "/absolute/path/to/server/prompts/promptsConfig.json"
      }
    }
  }
}
```

### SSE Transport

```bash
cd server
npm run build
node dist/index.js --transport=sse --port=9090
# or npm run start:sse
```

Health check:

```bash
curl http://localhost:9090/status
```

### Supervisor Mode (Hot-Restart without dropping STDIO clients)

The supervisor in `server/dist/supervisor/` keeps STDIO pipes alive while the child process restarts:

```bash
cd server
node dist/supervisor/index.js --child "node" --args "dist/index.js --transport=stdio"
```

Logs show restart latency, crash-loop detection, and STDIO proxy status.

## 5. Hot Reload & Prompt Lifecycle

- The prompt registry watches every file listed in `prompts/promptsConfig.json`. Use the `prompt_manager` tool for modifications (`prompt_manager(action:"reload")`).
- File watchers call back into the runtime and re-register prompts with the MCP server automatically; no restart needed.
- When STDIO sessions must persist, use supervisor mode so the `runtime-state/chain-sessions.json` file is preserved while watchers reload content.

## 6. Operational Commands

| Command | Description |
| --- | --- |
| `npm run build` | TypeScript → dist compilation |
| `npm run typecheck` | Strict TS type verification without emit |
| `npm run start:stdio` | Build + launch STDIO transport with diagnostics |
| `npm run start:sse` | Build + launch SSE HTTP server |
| `npm run validate:all` | Aggregated validations (`lint`, `architecture`, `runtime smoke tests`) |
| `prompt_manager(action:"reload")` | Reload prompts and categories without restart |
| `system_control(action:"status")` | Check runtime health, active framework, metrics snapshot |

## 7. Diagnostics & Troubleshooting

### Startup Failures

Symptoms: "Unable to determine server root" or immediate exit.

- Ensure the working directory is `server/` when running `node dist/index.js`.
- Provide absolute paths via `MCP_SERVER_ROOT` + `MCP_PROMPTS_CONFIG_PATH` if IDE shortcuts hide cwd.
- Run `node dist/index.js --verbose --debug-startup` to see each detection strategy.

### MCP Client Cannot Connect

- Run server manually with `--transport=stdio` and keep the console open; ensure no other process consumes STDIO.
- Inspect Claude Desktop logs (`~/Library/Logs/Claude/` on macOS, `%APPDATA%\Claude\logs` on Windows) for MCP handshake traces.
- Validate prompts + config JSON with `node -e "JSON.parse(require('fs').readFileSync('config.json'))"` to catch syntax errors that block startup.

### Prompts Missing / Hot Reload Stuck

- Confirm `prompts/promptsConfig.json` lists the category you edited.
- Run `prompt_manager(action:"list", filter:"type:chain")` to verify the registry state the MCP server sees.
- Trigger a manual reload: `prompt_manager(action:"reload", reason:"manual-resync")`.
- For persistent failures, restart via supervisor to keep existing STDIO clients connected.

### Chain Sessions Resetting Unexpectedly

- Check `runtime-state/chain-sessions.json` for corruption or OS-level permission issues.
- Verify the process has write access to the repo root; STDIO mode writes runtime-state next to `server/`.
- In CI, use the SSE transport to avoid STDIO restrictions.

### Logging & Verbosity

- Adjust `logging.level` or start with `node dist/index.js --transport=stdio --verbose` for high-volume traces.
- Log files live under `server/logs/` (rotated by date). Delete stale files if disk pressure occurs.

### Framework Status Messages

- Seeing `framework: none` or “No active framework” in `system_control status` is normal unless you explicitly switched methodologies—auto-selection isn’t implemented.
- To change the reasoning style, run `system_control(action:"switch_framework", framework:"CAGEERF")` (or another framework) before executing prompts/chains that depend on it.
- If a chain expects a specific methodology, document the required framework in your prompt metadata and switch manually before running it.

## 8. Updating & Maintaining the Server

1. Pull latest changes.
2. Remove previous build artifacts: `rm -rf server/dist && npm run build` (or rely on incremental builds).
3. Reinstall dependencies if `package-lock.json` changed: `npm install`.
4. Re-run validations: `npm run typecheck && npm test && npm run validate:all`.
5. Restart the runtime (or let supervisor restart the child process).

## 9. Backup & Recovery

- Prompts live under `server/prompts/`. Copy that directory (plus `prompts/promptsConfig.json`) for offline backups.
- Runtime state (`runtime-state/*`) can be backed up for long-lived chain sessions but is safe to delete when troubleshooting.
- Logs under `server/logs/` contain transport-aware information; attach them to bug reports.

## 10. Getting Help

- Use `system_control(action:"status")` to capture framework + transport state when filing issues.
- Include `server/logs/*.log`, `runtime-state/` snapshots, and prompt IDs when reporting gate or execution bugs.
- Reference `docs/docs-migration-plan.md` to understand which documents are canonical vs. legacy during audits.

## 11. Example Ops Workflow

1. **Bootstrap**: Run through [Prerequisites](#1-prerequisites), `npm install`, and `npm run build`.
2. **Configure**: Set `frameworks.enableMethodologyGates=false` if you only want manual inline gates, or leave defaults for full framework support.
3. **Launch**: Use `npm run start:stdio -- --verbose` while wiring Claude Desktop; confirm with `system_control(action:"status")`.
4. **Customize**: Switch to the [MCP Tooling Guide](mcp-tooling-guide.md) and [Prompt & Template Authoring Guide](prompt-authoring-guide.md) to create prompts; rely on this guide’s troubleshooting when issues arise.

## Continuing Your Workflow

- **Explore architecture details**: Revisit the [Architecture Overview](architecture.md) to understand how transports, runtime, and the PromptExecutionPipeline fit together.
- **Operate via MCP tools**: Review the [MCP Tooling Guide](mcp-tooling-guide.md) for end-to-end examples of `prompt_manager`, `prompt_engine`, and `system_control`.
- **Create prompts and chains**: Follow the [Prompt & Template Authoring Guide](prompt-authoring-guide.md) and the [Chain Workflows Guide](chain-workflows.md) once the server is running smoothly.
- **Tune gates and guidance**: Use the [Enhanced Gate System](enhanced-gate-system.md) to configure inline gates or debug validation output.
