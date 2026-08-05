# Claude Prompts MCP Server

[![npm version](https://img.shields.io/npm/v/claude-prompts.svg)](https://www.npmjs.com/package/claude-prompts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)

MCP server for prompt management, thinking frameworks, and quality gates. Hot-reloads prompts, injects structured reasoning, enforces output validation—all through MCP tools Claude can call directly.

The server, desktop extension, and npm package require Node.js >=22.13.0 because the runtime uses `node:sqlite` without an experimental flag. The same npm package exposes the self-contained `cpm` bin; its standalone GitHub Release asset supports Node.js >=18.18.0.

## Quick Start

| Method                | Command                                       | Best For     |
| --------------------- | --------------------------------------------- | ------------ |
| **Desktop Extension** | Drag `.mcpb` into Settings                    | End users    |
| **NPX**               | `npx -y claude-prompts --client=claude-code`  | Auto-updates |
| **Local Dev**         | `npm run start:stdio -- --client=claude-code` | Contributors |

Set `--client` to match your host client (`claude-code`, `codex`, `gemini`, `opencode`, `cursor`, or `unknown`) so handoff guidance stays client-aware.

**Desktop Extension** — [Download `.mcpb`](https://github.com/minipuft/claude-prompts-mcp/releases), drag into Claude Desktop Settings. Done.

**NPX** — Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest", "--client=claude-code"]
    }
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

**Solution**: Frameworks inject a structured thinking method into the system prompt. Claude follows defined reasoning phases. Each framework auto-applies quality gates for its phases.

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

### ✅ Verification Gates — Ground-truth validation via shell commands

**Problem**: LLM self-evaluation isn't always reliable. You want real test results, not Claude's opinion about whether code works.

**Solution**: Shell verification runs actual commands (like `npm test`) and uses exit codes as ground truth. Claude keeps trying until tests pass or max attempts reached.

```text
# Run tests after implementation
prompt_engine(command: ">>implement-login :: verify:'npm test'")

# Quick feedback loop
prompt_engine(command: ">>fix-typo :: verify:'npm run lint' :fast")

# Full CI validation
prompt_engine(command: ">>refactor-auth :: verify:'npm test' :full")
```

**Presets**: `:fast` (1 try, 30s), `:full` (5 tries, 5 min), `:extended` (10 tries, 10 min)

**Expect**: Claude implements, tests run, failures bounce back with error output. Claude iterates until tests pass.

See [Ralph Loops Guide](docs/guides/ralph-loops.md) for details.

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

### `resource_manager` — Unified CRUD for prompts, gates, and frameworks

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

| Symbol | Name          | What It Does                  |
| :----: | :------------ | :---------------------------- |
|  `>>`  | **Prompt**    | Execute template by ID        |
| `-->`  | **Chain**     | Pipe output to next step      |
|  `@`   | **Framework** | Inject framework + auto-gates |
|  `::`  | **Gate**      | Add quality criteria          |
|  `%`   | **Modifier**  | Control execution mode        |

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
      "args": ["-y", "claude-prompts@latest", "--client", "claude-code"],
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
├── frameworks/               # Custom thinking frameworks (optional)
└── gates/                    # Custom quality gates (optional)
```

**Minimum required:** Just `prompts/` with at least one prompt directory.

Script tools enable validation scripts that auto-trigger on schema match. See [Script Tools Guide](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/script-tools.md) for details.

---

## Releasing (Maintainers)

This repo uses a Release PR flow to ensure the npm package version and changelog are committed before publishing.

- Changelog: `CHANGELOG.md`
- Package version: `server/package.json#version`
- Tag format: `vX.Y.Z` (created by release-please)

**One-time GitHub setup**

- Add repo secret `RELEASE_PLEASE_TOKEN` (PAT) so release tags/releases can trigger workflows.
- Add repo secret `NPM_TOKEN` (npm automation token for `claude-prompts`).
- (Recommended) Create GitHub Environment `npm` with required reviewers to gate publishing.

**Release steps**

1. Merge normal work into `main`.
2. Release Please opens a Release PR; review the version bump + `CHANGELOG.md`.
3. Merge the Release PR.
4. Publish the draft GitHub Release created for the new tag (this triggers the npm publish workflow).

The publish workflow verifies the packed npm consumer before publishing. The extension workflow then attaches the MCPB, standalone `cpm` bundle, checksum, and source-map archive to the same GitHub Release.

---

### Claude Desktop Configurations

**Basic — Use package defaults (good for trying it out):**

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest", "--client", "claude-code"]
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
      "args": ["-y", "claude-prompts@latest", "--client", "claude-code"],
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
      "args": ["-y", "claude-prompts@latest", "--client", "claude-code"],
      "env": {
        "MCP_WORKSPACE": "/home/user/projects/my-app"
      }
    }
  }
}
```

**Codex launch profile — Handoff preset (`spawn_agent_v1`):**

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts@latest", "--client", "codex"]
    }
  }
}
```

Supported presets:

| `--client` value | Handoff profile      | Status               | Notes                                                       |
| ---------------- | -------------------- | -------------------- | ----------------------------------------------------------- |
| `claude-code`    | `task_tool_v1`       | canonical            | Task tool routing                                           |
| `codex`          | `spawn_agent_v1`     | canonical            | `spawn_agent` preferred; fallback handoff guidance included |
| `gemini`         | `gemini_subagent_v1` | canonical            | Gemini sub-agent capability guidance                        |
| `opencode`       | `opencode_agent_v1`  | canonical            | OpenCode agent capability guidance                          |
| `cursor`         | `cursor_agent_v1`    | experimental/testing | Cursor handoff wording enabled with fallback guidance       |
| `unknown`        | `neutral_v1`         | canonical            | Neutral client fallback                                     |

---

### Environment Variables

| Variable             | Purpose                                                      | Example                          |
| -------------------- | ------------------------------------------------------------ | -------------------------------- |
| `MCP_WORKSPACE`      | Base directory containing prompts/, config.json              | `/home/user/my-prompts`          |
| `MCP_RESOURCES_PATH` | Resources base override (frameworks, gates, styles, scripts) | `/path/to/resources`             |
| `MCP_CONFIG_PATH`    | Custom server config.json                                    | `/path/to/config.json`           |
| `LOG_LEVEL`          | Logging verbosity                                            | `debug`, `info`, `warn`, `error` |

Per-resource-type path overrides (`MCP_PROMPTS_PATH`, `MCP_GATES_PATH`, `MCP_STYLES_PATH`,
`MCP_SCRIPTS_PATH`, and the former `MCP_METHODOLOGIES_PATH`) were documented here but are not read
anywhere in the server. Point `MCP_RESOURCES_PATH` at a resources directory instead; workspace
resources overlay the bundled ones.

**Resolution priority:** CLI flags > Environment variables > Workspace subdirectory > Package defaults

---

### CLI Flags

All flags accept both `--flag=value` and `--flag value` formats.

```bash
# Use a workspace
npx claude-prompts --workspace /path/to/workspace

# Override where resources are loaded from
npx claude-prompts --workspace /path/to/workspace --config /path/to/config.json

# Select transport
npx claude-prompts --transport sse

# Client-aware handoff routing at launch
npx claude-prompts --client codex

# Debugging
npx claude-prompts --verbose
npx claude-prompts --debug-startup
npx claude-prompts --log-level debug

# Validate setup without running
npx claude-prompts --startup-test --verbose
```

| Flag                      | Purpose                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `-h`, `--help`            | Show help and exit                                                               |
| `--init /path`            | Initialize a new workspace with starters                                         |
| `--workspace /path`       | Base directory for all user assets                                               |
| `--config /path`          | Custom server config.json                                                        |
| `--workspace-id VALUE`    | Launch default workspace scope                                                   |
| `--organization-id VALUE` | Launch default organization scope                                                |
| `--identity-mode VALUE`   | Identity policy: `permissive` or `locked`                                        |
| `--client VALUE`          | Client preset: `claude-code`, `codex`, `gemini`, `opencode`, `cursor`, `unknown` |
| `--transport MODE`        | Transport: `stdio`, `sse`, `streamable-http`                                     |
| `--log-level LEVEL`       | Log level: `debug`, `info`, `warn`, `error`                                      |
| `--verbose`               | Detailed logging                                                                 |
| `--quiet`                 | Suppress non-error output                                                        |
| `--debug-startup`         | Verbose startup diagnostics                                                      |
| `--startup-test`          | Validate and exit (good for testing setup)                                       |

---

### Troubleshooting

**"No prompts found"**

- Check `MCP_WORKSPACE` points to a directory containing `prompts/`
- Run `npx claude-prompts --startup-test --verbose` to see resolved paths

**"Framework not found"**

- Custom frameworks need `framework.yaml` in each subdirectory of `resources/frameworks/`
- Use `MCP_RESOURCES_PATH` to point at the resources directory that contains them

**"Permission denied"**

- Ensure the user running Claude Desktop can read your workspace directory

**Changes not appearing**

- Confirm you're editing files under your configured `MCP_WORKSPACE` / `MCP_RESOURCES_PATH`
- If needed, restart Claude Desktop (most clients restart MCP servers on reconnect)

---

## Documentation

Full guides in the [main repository](https://github.com/minipuft/claude-prompts-mcp):

- [Architecture](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/architecture/overview.md) — System design
- [MCP Tooling](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/reference/mcp-tools.md) — Complete tool reference
- [Prompt Authoring](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/tutorials/build-first-prompt.md) — Tutorial
- [Chains](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/concepts/chains-lifecycle.md) — Multi-step patterns
- [Gates](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/concepts/quality-gates.md) — Quality validation
- [Client Integration](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/client-integration.md) — Per-client `--client` install setup
- [Client Capabilities](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/reference/client-capabilities.md) — Preset mapping, status, and integration limits
- [Skills Sync](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/guides/skills-sync.md) — Export prompts to client-native skills

---

## Development

```bash
git clone https://github.com/minipuft/claude-prompts-mcp.git
cd claude-prompts-mcp/server
npm install && npm run build
npm run start:stdio
```

### Skills Sync — Export prompts as native client skills

Export YAML prompts to Claude Code, Cursor, Codex, and OpenCode as native skill packages. Exported prompts are auto-deregistered from MCP to avoid duplication.

```bash
cp skills-sync.example.yaml skills-sync.yaml  # First-time setup
npm run skills:export   # Compile to client-native format
npm run skills:diff     # Detect drift via SHA-256 manifests
npm run skills:pull     # Generate .patch files for stale skills
```

Config: `skills-sync.yaml` (git-ignored, personal). See [Skills Sync Guide](docs/guides/skills-sync.md) for details.

---

## License

[MIT](../LICENSE)
