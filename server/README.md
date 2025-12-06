# Claude Prompts MCP Server

[![npm version](https://img.shields.io/npm/v/claude-prompts-server.svg)](https://www.npmjs.com/package/claude-prompts-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org/)

MCP server for prompt management, thinking frameworks, and quality gates. Hot-reloads prompts, injects structured reasoning, enforces output validation—all through MCP tools Claude can call directly.

## Quick Start

```bash
npx -y claude-prompts-server
```

Add to Claude Desktop (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts-server"]
    }
  }
}
```

Restart Claude Desktop. Test with: `prompt_manager(action: "list")`

---

## What You Get

### 🔥 Hot Reload — Let Claude iterate on prompts for you

**Problem**: Prompt engineering is slow. Edit → restart → test → repeat. And you're debugging prompt issues manually.

**Solution**: Just ask Claude to fix it. Describe the problem, Claude updates the prompt via `prompt_manager`, you test immediately. No manual editing, no restart.

```text
User: "The code_review prompt is too verbose"
Claude: prompt_manager(action:"update", id:"code_review", ...)
User: "Test it"
Claude: prompt_engine(command:">>code_review")  # Updated version runs instantly
```

---

### 🧠 Frameworks — Consistent structured reasoning

**Problem**: Claude's reasoning varies. Sometimes thorough, sometimes it skips steps. You want methodical thinking every time.

**Solution**: Frameworks inject a thinking methodology into the system prompt. Claude follows defined reasoning phases. Each framework auto-applies quality gates for its phases.

```text
prompt_engine(command: "@CAGEERF Review this architecture")
prompt_engine(command: "@ReACT Debug this error")
```

**Expect**: Claude's response follows labeled phases. The framework's gates validate each phase completed properly.

---

### 🛡️ Gates — Claude self-validates outputs

**Problem**: Claude returns plausible outputs, but you need specific criteria met—and you want Claude to verify, not you.

**Solution**: Gates inject quality criteria. Claude self-evaluates and reports PASS/FAIL. Failed gates trigger retries or pause for your decision.

```text
prompt_engine(command: "Summarize this :: 'under 200 words' :: 'include statistics'")
```

**Expect**: Response includes self-assessment. If criteria aren't met, server auto-retries with feedback.

---

## MCP Tools

Three tools Claude can call:

### `prompt_engine` — Execute prompts and chains

```bash
# Run a prompt
prompt_engine(command: ">>code_review")

# Apply framework + gates
prompt_engine(command: "@CAGEERF >>analysis :: 'cite sources'")

# Chain steps together
prompt_engine(command: "research --> analyze --> summarize")
```

### `prompt_manager` — Create, update, delete prompts

```bash
prompt_manager(action: "list")
prompt_manager(action: "create", id: "my_prompt", name: "My Prompt", ...)
prompt_manager(action: "update", id: "my_prompt", ...)
prompt_manager(action: "reload")  # After external file edits
```

### `system_control` — Runtime administration

```bash
system_control(action: "status")
system_control(action: "framework", operation: "switch", framework: "CAGEERF")
system_control(action: "analytics")
```

---

## Syntax Reference

| Symbol | Name | What It Does |
|:------:|:-----|:-------------|
| `>>` | **Prompt** | Execute template by ID |
| `-->` | **Chain** | Pipe output to next step |
| `@` | **Framework** | Inject methodology + auto-gates |
| `::` | **Gate** | Add quality criteria |
| `%` | **Modifier** | Control execution mode |

**Modifiers**: `%clean` (skip all injection), `%lean` (gates only), `%guided` (force injection), `%judge` (auto-select resources)

---

## Configuration

Point to your workspace with prompts and config:

```bash
MCP_SERVER_ROOT=/path/to/workspace npx claude-prompts-server
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--transport=stdio\|sse` | Transport mode (default: stdio) |
| `--verbose` | Detailed logging (overrides auto-quiet) |
| `--quiet` | Minimal logging (auto-enabled for stdio) |
| `--debug-startup` | Startup diagnostics |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `MCP_SERVER_ROOT` | Server root (contains config.json, prompts/) |
| `MCP_PROMPTS_CONFIG_PATH` | Direct path to prompts config |
| `LOG_LEVEL` | debug, info, warn, error |

---

## Documentation

Full guides in the [main repository](https://github.com/minipuft/claude-prompts-mcp):

- [Architecture](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/architecture.md) — System design
- [MCP Tooling](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/mcp-tooling-guide.md) — Complete tool reference
- [Prompt Authoring](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/prompt-authoring-guide.md) — Template structure
- [Chain Workflows](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/chain-workflows.md) — Multi-step patterns
- [Gate System](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/enhanced-gate-system.md) — Quality validation

---

## Development

```bash
git clone https://github.com/minipuft/claude-prompts-mcp.git
cd claude-prompts-mcp/server
npm install && npm run build
npm run start:stdio
```

## License

[MIT](LICENSE)
