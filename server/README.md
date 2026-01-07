# Claude Prompts MCP Server

[![npm version](https://img.shields.io/npm/v/claude-prompts.svg)](https://www.npmjs.com/package/claude-prompts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen.svg)](https://nodejs.org/)

MCP server for prompt management, thinking frameworks, and quality gates. Hot-reloads prompts, injects structured reasoning, enforces output validation—all through MCP tools Claude can call directly.

## Quick Start

| Method | Command | Best For |
|--------|---------|----------|
| **Desktop Extension** | Drag `.mcpb` into Settings | End users |
| **NPX** | `npx -y claude-prompts` | Auto-updates |
| **Local Dev** | `npm run start:stdio` | Contributors |

**Desktop Extension** — [Download `.mcpb`](https://github.com/minipuft/claude-prompts-mcp/releases), drag into Claude Desktop Settings. Done.

**NPX** — Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "claude-prompts": { "command": "npx", "args": ["-y", "claude-prompts@latest"] }
  }
}
```

Restart Claude Desktop. Verify:
```
resource_manager(resource_type: "prompt", action: "list")
```
→ Returns available prompts. Now try `>>analyze` or `>>research_chain`.

---

## What You Get

### 🔥 Hot Reload — Let Claude iterate on prompts for you

**Problem**: Prompt engineering is slow. Edit → restart → test → repeat. And you're debugging prompt issues manually.

**Solution**: Just ask Claude to fix it. Describe the problem, Claude updates the prompt via `resource_manager`, you test immediately. No manual editing, no restart.

```text
User: "The code_review prompt is too verbose"
Claude: resource_manager(resource_type:"prompt", action:"update", id:"code_review", ...)
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

### 📜 Version History — Undo and compare changes

**Problem**: You edited a prompt and broke something. No undo, no diff, no way back.

**Solution**: Every update auto-saves a version snapshot. View history, compare with diffs, rollback to any previous state.

```text
resource_manager(resource_type:"prompt", action:"history", id:"code_review")
resource_manager(resource_type:"prompt", action:"compare", id:"code_review", from_version:1, to_version:3)
resource_manager(resource_type:"prompt", action:"rollback", id:"code_review", version:2, confirm:true)
```

**Expect**: Full version history with timestamps. Rollback auto-saves current state first—you can always undo.

---

## MCP Tools

Three consolidated tools Claude can call:

### `prompt_engine` — Execute prompts and chains

```bash
# Run a prompt
prompt_engine(command: ">>code_review")

# Apply framework + gates
prompt_engine(command: "@CAGEERF >>analysis :: 'cite sources'")

# Chain steps together
prompt_engine(command: "research --> analyze --> summarize")
```

### `resource_manager` — Unified CRUD for prompts, gates, and methodologies

```bash
resource_manager(resource_type: "prompt", action: "list")
resource_manager(resource_type: "prompt", action: "create", id: "my_prompt", name: "My Prompt", ...)
resource_manager(resource_type: "prompt", action: "update", id: "my_prompt", ...)

# Version history
resource_manager(resource_type: "prompt", action: "history", id: "my_prompt")
resource_manager(resource_type: "prompt", action: "compare", id: "my_prompt", from_version: 1, to_version: 3)
resource_manager(resource_type: "prompt", action: "rollback", id: "my_prompt", version: 2, confirm: true)
```

### `system_control` — Runtime administration

```bash
system_control(action: "status")
system_control(action: "framework", operation: "switch", framework: "CAGEERF")
system_control(action: "analytics")
```

---

## Syntax Reference

| Symbol | Name          | What It Does                    |
| :----: | :------------ | :------------------------------ |
|  `>>`  | **Prompt**    | Execute template by ID          |
| `-->`  | **Chain**     | Pipe output to next step        |
|  `@`   | **Framework** | Inject methodology + auto-gates |
|  `::`  | **Gate**      | Add quality criteria            |
|  `%`   | **Modifier**  | Control execution mode          |

**Modifiers**: `%clean` (skip all injection), `%lean` (gates only), `%guided` (force injection), `%judge` (auto-select resources)

---

## Configuration

### Why Use Custom Prompts?

The package includes example prompts, but the real power comes from **your own prompts**:

- **Project-specific templates** — Code review prompts tailored to your stack
- **Team workflows** — Standardized analysis chains your whole team uses
- **Domain expertise** — Prompts encoding your specific domain knowledge
- **Persistent iteration** — Claude improves your prompts via `resource_manager`, and they persist

---

### Creating Your First Workspace

**1. Initialize a workspace with starter prompts:**

```bash
npx claude-prompts --init=~/my-prompts
```

This creates `~/my-prompts/prompts/` with starter prompts (`prompt.yaml` + templates).

**2. Point Claude Desktop to your workspace:**

Edit `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"],
      "env": {
        "MCP_WORKSPACE": "/home/YOUR_USERNAME/my-prompts"
      }
    }
  }
}
```

**3. Restart Claude Desktop and test:**

```
resource_manager(resource_type:"prompt", action:"list")
prompt_engine(command: ">>quick_review code:'function add(a,b) { return a + b }'")
```

**4. Let Claude iterate on your prompts:**

```text
User: "Make the quick_review prompt also check for performance issues"
Claude: resource_manager(resource_type:"prompt", action:"update", id:"quick_review", ...)
```

Changes apply instantly—no restart needed. This is the recommended workflow: **describe what you want, let Claude implement it.**

---

### Workspace Structure

```
my-workspace/
├── prompts/
│   └── <category>/<id>/      # Prompt directories (required)
│       ├── prompt.yaml       # Metadata, arguments, tools reference
│       ├── user-message.md   # Template content
│       └── tools/            # Script tools (optional)
│           └── <tool_id>/
│               ├── tool.yaml    # Config (trigger, runtime, timeout)
│               ├── schema.json  # Input validation schema
│               └── script.py    # Validation logic
├── config.json               # Server settings (optional)
├── methodologies/            # Custom thinking frameworks (optional)
└── gates/                    # Custom quality gates (optional)
```

**Minimum required:** Just `prompts/` with at least one prompt directory.

Script tools enable validation scripts that auto-trigger on schema match. See [Script Tools Guide](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/script-tools.md) for details.

---

## Releasing (Maintainers)

This repo uses a Release PR flow to ensure the npm package version and changelog are committed before publishing.

- Changelog: `server/CHANGELOG.md`
- Package version: `server/package.json#version`
- Tag format: `claude-prompts-vX.Y.Z` (created by release-please)

**One-time GitHub setup**
- Add repo secret `RELEASE_PLEASE_TOKEN` (PAT) so release tags/releases can trigger workflows.
- Add repo secret `NPM_TOKEN` (npm automation token for `claude-prompts`).
- (Recommended) Create GitHub Environment `npm` with required reviewers to gate publishing.

**Release steps**
1. Merge normal work into `main`.
2. Release Please opens a Release PR; review the version bump + `server/CHANGELOG.md`.
3. Merge the Release PR.
4. Publish the draft GitHub Release created for the new tag (this triggers the npm publish workflow).

---

### Claude Desktop Configurations

**Basic — Use package defaults (good for trying it out):**
```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"]
    }
  }
}
```

**Recommended — Your own workspace:**
```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"],
      "env": {
        "MCP_WORKSPACE": "/home/user/my-mcp-workspace"
      }
    }
  }
}
```

**Advanced — Per-project prompts:**
```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest"],
      "env": {
        "MCP_PROMPTS_PATH": "/home/user/projects/my-app/prompts"
      }
    }
  }
}
```

---

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `MCP_WORKSPACE` | Base directory containing prompts/, config.json | `/home/user/my-prompts` |
| `MCP_PROMPTS_PATH` | Direct path to a prompts directory | `/path/to/prompts` |
| `MCP_METHODOLOGIES_PATH` | Custom methodologies directory | `/path/to/methodologies` |
| `MCP_GATES_PATH` | Custom gates directory | `/path/to/gates` |
| `MCP_CONFIG_PATH` | Custom server config.json | `/path/to/config.json` |
| `LOG_LEVEL` | Logging verbosity | `debug`, `info`, `warn`, `error` |

**Resolution priority:** CLI flags > Environment variables > Workspace subdirectory > Package defaults

---

### CLI Flags

```bash
# Use a workspace
npx claude-prompts --workspace=/path/to/workspace

# Override specific paths
npx claude-prompts --prompts=/path/to/prompts

# Debugging
npx claude-prompts --verbose
npx claude-prompts --debug-startup

# Validate setup without running
npx claude-prompts --startup-test --verbose
```

| Flag | Purpose |
|------|---------|
| `--workspace=/path` | Base directory for all user assets |
| `--prompts=/path` | Direct path to a prompts directory |
| `--methodologies=/path` | Custom methodologies directory |
| `--gates=/path` | Custom gates directory |
| `--config=/path` | Custom server config.json |
| `--verbose` | Detailed logging |
| `--startup-test` | Validate and exit (good for testing setup) |

---

### Troubleshooting

**"No prompts found"**
- Check `MCP_WORKSPACE` points to a directory containing `prompts/`
- Run `npx claude-prompts --startup-test --verbose` to see resolved paths

**"Methodology not found"**
- Custom methodologies need `methodology.yaml` in each subdirectory
- Use `MCP_METHODOLOGIES_PATH` to point to your methodologies folder

**"Permission denied"**
- Ensure the user running Claude Desktop can read your workspace directory

**Changes not appearing**
- Confirm you're editing files under your configured `MCP_WORKSPACE` / `MCP_PROMPTS_PATH`
- If needed, restart Claude Desktop (most clients restart MCP servers on reconnect)

---

## Documentation

Full guides in the [main repository](https://github.com/minipuft/claude-prompts-mcp):

- [Architecture](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/architecture/overview.md) — System design
- [MCP Tooling](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/reference/mcp-tools.md) — Complete tool reference
- [Prompt Authoring](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/prompt-authoring-guide.md) — Template structure
- [Chains](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/chains.md) — Multi-step patterns
- [Gates](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/gates.md) — Quality validation

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
