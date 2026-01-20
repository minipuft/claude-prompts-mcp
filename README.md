# Claude Prompts MCP Server

<div align="center">

<img src="assets/logo.png" alt="Claude Prompts MCP Server Logo" width="200" />

[![npm version](https://img.shields.io/npm/v/claude-prompts.svg?style=for-the-badge&logo=npm&color=0066cc)](https://www.npmjs.com/package/claude-prompts)
[![License: MIT](https://img.shields.io/badge/License-MIT-00ff88.svg?style=for-the-badge&logo=opensource)](https://opensource.org/licenses/MIT)

**Hot-reloadable prompts with chains, gates, and structured reasoning for AI assistants.**

[Quick Start](#quick-start) • [Features](#what-you-get) • [Syntax](#syntax-reference) • [Docs](#documentation)

</div>

---

## Quick Start

### Claude Code (Recommended)

```bash
# Step 1: Add marketplace (first time only)
/plugin marketplace add minipuft/minipuft-plugins

# Step 2: Install
/plugin install claude-prompts@minipuft

# Step 3: Try it
>>tech_evaluation_chain library:'zod' context:'API validation'
```

<details>
<summary>Why hooks matter</summary>

The plugin adds hooks that fix common issues:

| Problem | Hook Fix |
|---------|----------|
| Model ignores `>>analyze` | Detects syntax, suggests correct MCP call |
| Chain step forgotten | Injects `[Chain] Step 2/5 - continue` |
| Gate review skipped | Reminds `GATE_REVIEW: PASS\|FAIL` |

Raw MCP works, but models sometimes miss the syntax. The hooks catch that. → [hooks/README.md](hooks/README.md)

</details>

<details>
<summary>Development setup</summary>

Load plugin from local source for development:

```bash
git clone https://github.com/minipuft/claude-prompts ~/Applications/claude-prompts
cd ~/Applications/claude-prompts/server && npm install && npm run build
claude --plugin-dir ~/Applications/claude-prompts
```

Edit hooks/prompts → restart Claude Code. Edit TypeScript → rebuild first.

</details>

**User Data**: Custom prompts stored in `~/.local/share/claude-prompts/` persist across updates.

---

<details>
<summary><strong>OpenCode</strong></summary>

**User Install** — Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "claude-prompts": {
      "type": "local",
      "command": ["npx", "-y", "claude-prompts@latest"]
    }
  }
}
```

**Development Setup** — Use the [opencode-prompts](https://github.com/minipuft/opencode-prompts) plugin (includes hooks):

```bash
git clone https://github.com/minipuft/opencode-prompts ~/Applications/opencode-prompts
cd ~/Applications/opencode-prompts && git submodule update --init
ln -s ~/Applications/opencode-prompts ~/.config/opencode/plugin/opencode-prompts
cd server && npm install && npm run build
```

Then point MCP to your local server in `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "claude-prompts": {
      "type": "local",
      "command": ["node", "~/Applications/opencode-prompts/server/dist/index.js", "--transport=stdio"],
      "environment": { "MCP_WORKSPACE": "~/Applications/opencode-prompts/server" }
    }
  }
}
```

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

**User Install:**

```bash
gemini extensions install https://github.com/minipuft/gemini-prompts
```

**Development Setup** — Load from local source:

```bash
git clone https://github.com/minipuft/gemini-prompts ~/Applications/gemini-prompts
cd ~/Applications/gemini-prompts && git submodule update --init
cd core/server && npm install && npm run build
ln -s ~/Applications/gemini-prompts ~/.gemini/extensions/gemini-prompts
```

Same tools (`prompt_engine`, `resource_manager`, `system_control`) with Gemini-optimized hooks.

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

**Option A: GitHub Release** (recommended)

1. Download `claude-prompts-{version}.mcpb` from [Releases](https://github.com/minipuft/claude-prompts/releases/latest)
2. Drag into Claude Desktop Settings → MCP Servers
3. Done

The `.mcpb` bundle is self-contained (~5MB)—no npm required.

**Option B: NPX** (auto-updates)

Add to your config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop and test: `>>research_chain topic:'remote team policies'`

</details>

<details>
<summary><strong>Cursor</strong></summary>

1. Open Settings → MCP → Edit Config (or edit `~/.cursor/mcp.json`)
2. Add:

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

3. Restart Cursor and test: `resource_manager(resource_type:"prompt", action:"list")`

</details>

<details>
<summary><strong>Other MCP Clients</strong> (Windsurf, Zed, etc.)</summary>

Add to your MCP configuration file:

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

</details>

<details>
<summary><strong>From Source</strong> (developers only)</summary>

```bash
git clone https://github.com/minipuft/claude-prompts.git
cd claude-prompts/server
npm install && npm run build && npm test
```

Point your MCP config to `server/dist/index.js`. The esbuild bundle is self-contained.

**Transport options**: `--transport=stdio` (default), `--transport=streamable-http` (HTTP clients).

</details>

### Custom Resources

Use your own prompts without cloning:

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

Your resources directory can contain: `prompts/`, `gates/`, `methodologies/`, `styles/`.

| Override Method | Example |
|-----------------|---------|
| All resources | `MCP_RESOURCES_PATH=/path/to/resources` |
| Just prompts | `MCP_PROMPTS_PATH=/path/to/prompts` |
| CLI flag (dev) | `--prompts=/path/to/prompts` |

**Priority:** CLI flags > individual env vars > `MCP_RESOURCES_PATH` > package defaults.

See [CLI Configuration](docs/reference/mcp-tools.md#cli-configuration) for all options.

---

## What You Get

### 🔥 Hot Reload

Edit prompts, test immediately. Better yet—ask Claude to fix them:

```text
User: "The code_review prompt is too verbose"
Claude: resource_manager(action:"update", id:"code_review", ...)
User: "Test it"
Claude: prompt_engine(command:">>code_review")  # Uses updated version instantly
```

### 🔗 Chains

Break complex tasks into steps with `-->`:

```text
analyze code --> identify issues --> propose fixes --> generate tests
```

Each step's output flows to the next. Add quality gates between steps.

### 🧠 Frameworks

Inject structured thinking patterns:

```text
@CAGEERF Review this architecture    # Context → Analysis → Goals → Execution → Evaluation → Refinement
@ReACT Debug this error              # Reason → Act → Observe loops
```

### 🛡️ Gates

Quality criteria Claude self-checks:

```text
Summarize this :: 'under 200 words' :: 'include key statistics'
```

Failed gates can retry automatically or pause for your decision.

### ✨ Judge Selection

Let Claude pick the right tools:

```text
%judge Help me refactor this codebase
```

Claude analyzes available frameworks, gates, and styles, then applies the best combination.

### 📜 Version History

Every update is versioned. Compare, rollback, undo:

```text
resource_manager(action:"history", id:"code_review")
resource_manager(action:"rollback", id:"code_review", version:2, confirm:true)
```

### 🔄 Checkpoints

Save working directory state before risky changes. Restore instantly if something breaks:

```text
# Checkpoint before refactoring
resource_manager(resource_type:"checkpoint", action:"create", name:"pre-refactor")

# Something broke? Rollback to checkpoint
resource_manager(resource_type:"checkpoint", action:"rollback", name:"pre-refactor", confirm:true)

# List all checkpoints
resource_manager(resource_type:"checkpoint", action:"list")
```

Uses git stash under the hood. Pairs with [verification gates](#verification-gates) for safe autonomous loops.

### ✅ Verification Gates (Ralph Loops)

Ground-truth validation via shell commands—Claude keeps trying until tests pass:

```text
# You say this:
>>implement-feature :: verify:"npm test" loop:true

# Claude does this:
# 1. Implements feature
# 2. Runs npm test → FAIL
# 3. Reads error, fixes code
# 4. Runs npm test → FAIL
# 5. Tries again...
# 6. Runs npm test → PASS ✓
# You get working code.
```

**Context Isolation**: After 3 failed attempts, spawns a fresh Claude instance with session context—no context rot, fresh perspective, automatic handoff.

| Preset | Max Tries | Timeout | Use Case |
|--------|-----------|---------|----------|
| `:fast` | 1 | 30s | Quick iteration |
| `:full` | 5 | 5 min | CI validation |
| `:extended` | 10 | 10 min | Large test suites |

**Override options**: `max:15` (custom attempts), `timeout:120` (custom seconds).

```text
# Custom limits for stubborn tests
>>fix-flaky-test :: verify:"npm test" :full max:8 timeout:180 loop:true
```

See [Ralph Loops Guide](docs/guides/ralph-loops.md) for autonomous verification patterns and cost tracking.

---

## Syntax Reference

| Symbol | Name | What It Does | Example |
|:------:|:-----|:-------------|:--------|
| `>>` | Prompt | Execute template | `>>code_review` |
| `-->` | Chain | Pipe to next step | `step1 --> step2` |
| `*` | Repeat | Run prompt N times | `>>brainstorm * 5` |
| `@` | Framework | Inject methodology | `@CAGEERF` |
| `::` | Gate | Add quality criteria | `:: 'cite sources'` |
| `%` | Modifier | Toggle behavior | `%clean`, `%judge` |
| `#` | Style | Apply formatting | `#analytical` |

**Modifiers:**
- `%clean` — No framework/gate injection
- `%lean` — Gates only, skip framework
- `%guided` — Force framework injection
- `%judge` — Claude selects best resources

---

## Using Gates

```text
# Inline (quick)
Research AI :: 'use recent sources' --> Summarize :: 'be concise'

# With framework
@CAGEERF Explain React hooks :: 'include examples'

# Programmatic
prompt_engine({
  command: ">>code_review",
  gates: [{ name: "Security", criteria: ["No hardcoded secrets"] }]
})
```

| Severity | Behavior |
|----------|----------|
| Critical/High | Must pass (blocking) |
| Medium/Low | Warns, continues (advisory) |

See [Gates Guide](docs/guides/gates.md) for full schema.

---

## Configuration

Customize via `server/config.json`:

| Section | Setting | Default | Description |
|:--------|:--------|:--------|:------------|
| `prompts` | `directory` | `prompts` | Prompts directory (hot-reloaded) |
| `frameworks` | `injection.systemPrompt` | enabled | Auto-inject methodology guidance |
| `gates` | `definitionsDirectory` | `gates` | Quality gate definitions |
| `execution` | `judge` | `true` | Enable `%judge` resource selection |

---

## The Three Tools

| Tool | Purpose |
|------|---------|
| `prompt_engine` | Execute prompts with frameworks and gates |
| `resource_manager` | CRUD for prompts, gates, methodologies, checkpoints |
| `system_control` | Status, analytics, health checks |

```bash
prompt_engine(command:"@CAGEERF >>analysis topic:'AI safety'")
resource_manager(resource_type:"prompt", action:"list")
resource_manager(resource_type:"checkpoint", action:"create", name:"backup")
system_control(action:"status")
```

---

## How It Works

```mermaid
%%{init: {'theme': 'neutral', 'themeVariables': {'background':'#0b1224','primaryColor':'#e2e8f0','primaryBorderColor':'#1f2937','primaryTextColor':'#0f172a','lineColor':'#94a3b8','fontFamily':'"DM Sans","Segoe UI",sans-serif','fontSize':'14px','edgeLabelBackground':'#0b1224'}}}%%
flowchart TB
    classDef actor fill:#0f172a,stroke:#cbd5e1,stroke-width:1.5px,color:#f8fafc;
    classDef server fill:#111827,stroke:#fbbf24,stroke-width:1.8px,color:#f8fafc;
    classDef process fill:#e2e8f0,stroke:#1f2937,stroke-width:1.6px,color:#0f172a;
    classDef client fill:#f4d0ff,stroke:#a855f7,stroke-width:1.6px,color:#2e1065;
    classDef clientbg fill:#1a0a24,stroke:#a855f7,stroke-width:1.8px,color:#f8fafc;
    classDef decision fill:#fef3c7,stroke:#f59e0b,stroke-width:1.6px,color:#78350f;

    linkStyle default stroke:#94a3b8,stroke-width:2px

    User["1. User sends command"]:::actor
    Example[">>analyze @CAGEERF :: 'cite sources'"]:::actor
    User --> Example --> Parse

    subgraph Server["MCP Server"]
        direction TB
        Parse["2. Parse operators"]:::process
        Inject["3. Inject framework + gates"]:::process
        Render["4. Render prompt"]:::process
        Decide{"6. Route verdict"}:::decision
        Parse --> Inject --> Render
    end
    Server:::server

    subgraph Client["Claude (Client)"]
        direction TB
        Execute["5. Run prompt + check gates"]:::client
    end
    Client:::clientbg

    Render -->|"Prompt with gate criteria"| Execute
    Execute -->|"Verdict + output"| Decide

    Decide -->|"PASS → render next step"| Render
    Decide -->|"FAIL → render retry prompt"| Render
    Decide -->|"Done"| Result["7. Return to user"]:::actor
```

**The feedback loop:** Command with operators → Parse and inject methodology/gates → Claude executes and self-evaluates → Route: next step (PASS), retry (FAIL), or return result (done).

---

## Documentation

- **[MCP Tooling Guide](docs/reference/mcp-tools.md)** — Full command reference
- **[Prompt Authoring](docs/tutorials/build-first-prompt.md)** — Tutorial
- **[Chains](docs/concepts/chains-lifecycle.md)** — Multi-step patterns
- **[Gates](docs/concepts/quality-gates.md)** — Quality validation
- **[Ralph Loops](docs/guides/ralph-loops.md)** — Autonomous verification patterns
- **[Architecture](docs/architecture/overview.md)** — System internals

---

## Contributing

```bash
cd server
npm install
npm run build        # esbuild bundles to dist/index.js
npm test             # Run test suite
npm run validate:all # Full CI validation
```

The build produces a self-contained bundle (~4.5MB). `server/dist/` is gitignored—CI builds fresh from source.

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow details.

---

## License

[MIT](LICENSE)
