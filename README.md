<!-- maintainers: this README is governed by docs/portfolio/readme-charter.md — run `cd server && npm run validate:readme` before committing changes -->

# Claude Prompts MCP Server

<div align="center">

<img src="assets/logo.png" alt="Claude Prompts MCP Server Logo" width="200" />

[![npm version](https://img.shields.io/npm/v/claude-prompts.svg?style=for-the-badge&logo=npm&color=0066cc)](https://www.npmjs.com/package/claude-prompts)
[![License: MIT](https://img.shields.io/badge/License-MIT-00ff88.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**An MCP workflow server.**

Craft reusable prompts with validation and reasoning guidance.<br>
Orchestrate agentic workflows with a composable operator syntax.<br>
Export as native skills.

[Quick Start](#quick-start) · [What You Get](#what-you-get) · [Compose Workflows](#compose-workflows) · [Run Anywhere](#run-anywhere) · [Docs](#documentation)

</div>

### What your AI client gives you — and what this server adds

| Your client already does   | This server adds                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Run a prompt               | Compose prompts with validation, reasoning guidance, and formatting in one expression |
| Single-shot skills         | Multi-step workflows that thread context between steps                                |
| Execute subagents          | Hand off mid-chain steps to agents with full workflow context                         |
| Client-native skill format | Author once as YAML, export to any client with `skills:export`                        |
| Manual prompt writing      | Versioned templates with hot-reload, rollback, and history                            |
| Trust the output           | Validate output between steps — self-evaluation and shell commands                    |

### Is this for me?

- **Use this if** you write the same prompts repeatedly, run multi-step workflows, or want to share reusable prompts with a team.
- **Skip if** your client's built-in `/commands` already handle what you need, or you're looking for a no-code prompt library.
- **Coming from raw MCP prompts?** This server adds chaining, validation between steps, and methodology overlays — your existing prompts still work as single-shot.
- **Coming from Claude Code skills?** Author once as YAML; `npm run skills:export` compiles to native skills for Claude Code, Cursor, OpenCode, and Gemini.

<div align="center">

<img src="assets/demos/hero-demo.gif" alt="Chain workflow with gate validation — prompt executes through hooks, gate catches missing field on first attempt then self-corrects" width="720" />

<sub>Chain + gate validation in action (haiku model) — gates catch errors and guide self-correction, even on the cheapest model</sub>

</div>

---

<!-- diataxis: how-to -->

## Quick Start

### Claude Code (Recommended)

```bash
# Add marketplace (first time only)
/plugin marketplace add minipuft/minipuft-plugins

# Install
/plugin install claude-prompts@minipuft

# Try it
>>tech_evaluation_chain library:'zod' context:'API validation'
```

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

---

### Claude Desktop

**Option A: GitHub Release** (recommended)

1. Download `claude-prompts-{version}.mcpb` from [Releases](https://github.com/minipuft/claude-prompts/releases/latest)
2. Drag into Claude Desktop Settings → MCP Servers
3. Done

The `.mcpb` bundle is self-contained (~5MB) — no npm required.

**Option B: NPX** (auto-updates)

Add to your config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop and test: `>>research_chain topic:'remote team policies'`

---

<details>
<summary><strong>Other clients</strong> — VS Code · Cursor · OpenCode · Gemini CLI · Codex · Windsurf · Zed · From Source</summary>

**One-click install**:

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=claude-prompts&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22claude-prompts%40latest%22%5D%7D&quality=stable)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-F14F21?style=flat-square&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=claude-prompts&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsYXVkZS1wcm9tcHRzQGxhdGVzdCJdfQ==)

**Plugin installers** (recommended — adds hooks):

```bash
# OpenCode (full hooks)
npm install -g opencode-prompts && opencode-prompts install

# Gemini CLI (partial hooks)
gemini extensions install https://github.com/minipuft/gemini-prompts
```

**Manual config** for VS Code, Cursor, OpenCode (no hooks), Gemini CLI (no hooks), Codex, Windsurf, Zed: see [Client Integration Guide](docs/guides/client-integration.md) for per-client config locations, JSON examples, and `--client` preset matrix. [Client Capabilities Reference](docs/reference/client-capabilities.md) covers profile mapping and limits.

**From source** (developers):

```bash
git clone https://github.com/minipuft/claude-prompts.git
cd claude-prompts/server && npm install && npm run build && npm test
```

Point your MCP config to `server/dist/index.js`. Transport: `--transport=stdio` (default) or `--transport=streamable-http`.

</details>

> [!TIP]
> **Custom resources** — bring your own prompts, gates, methodologies, and styles via `--init=~/my-prompts` or `MCP_RESOURCES_PATH`. See [Custom Resources Guide](docs/guides/custom-resources.md).

---

---

<!-- diataxis: reference -->

## What You Get

Four resource types you author, version, and compose into workflows. The bundled set ships 90+ prompts across 11 categories — all hot-reloadable and versionable.

### Prompt Templates

Versioned YAML with hot-reload. Edit a template, test it immediately — or ask your AI to update it through MCP.

```
>>code_review target:'src/auth/' language:'typescript'
```

### Validation Rules (Gates)

Criteria the AI checks its own output against. Blocking or advisory.

```
:: 'no false positives' :: 'cite sources with links'
```

Failed checks can retry automatically or pause for your decision.

> [!TIP]
> **Define your own checks.** See the [Gates Guide](docs/guides/gates.md) for blocking vs advisory rules, retry behavior, and shell verification.

### Reasoning Guidance (Methodologies)

Frameworks that shape how the AI thinks through a problem — not only what it outputs. 6 built-in, or create your own.

```
@CAGEERF    # Context → Analysis → Goals → Execution → Evaluation → Refinement
@ReACT      # Reason → Act → Observe loops
@5W1H       # Who, What, Where, When, Why, How
```

> [!TIP]
> **Create your own framework.** See the [Methodologies Guide](docs/guides/methodologies.md) for built-in frameworks and custom authoring.

### Styles

Response formatting and tone.

```
#analytical    # Structured, evidence-based output
#concise       # Brief, action-focused
```

All resources are hot-reloadable, versioned with rollback history, and managed through the `resource_manager` tool. Start with the [Prompt Authoring Tutorial](docs/tutorials/build-first-prompt.md).

---

<!-- diataxis: how-to -->

## Compose Workflows

The operator syntax wires resources together — chain steps, add validation inline, hand off steps to agents.

```
>>review target:'src/auth/' @CAGEERF :: 'no false positives'
  --> security_scan :: verify:"npm test"
  --> recommendations :: 'actionable, with code'
  ==> implementation
```

<details>
<summary><strong>See the output</strong> — tech evaluation chain with context7 research</summary>

<br>

<img src="assets/demos/chain-workflow-demo.gif" alt="Tech evaluation chain researching Zod via context7, producing a scored assessment table with security, performance, DX, integration, and ecosystem ratings" width="720" />

<sub>Context7 fetches live library docs mid-chain — final output is a structured assessment with sources</sub>

</details>

What happened:

1. Loaded the `review` template with arguments
2. Injected CAGEERF reasoning guidance
3. Added a validation rule (AI self-evaluates against it)
4. Chained output to the next step
5. Ran a shell command for ground-truth validation
6. Handed the final step off to a client-native subagent

Chains support conditional branching, context threading, and agent handoffs — see [Chains Lifecycle](docs/concepts/chains-lifecycle.md) and [MCP Tools Reference](docs/reference/mcp-tools.md).

### Verification Loops

Ground-truth validation via shell commands — the AI keeps iterating until tests pass:

```
>>implement-feature :: verify:"npm test" loop:true
```

Implements, runs the test, reads failures, fixes, retries. Spawns a fresh context after repeated failures to avoid context rot.

| Preset      | Tries | Timeout | Use Case          |
| ----------- | ----- | ------- | ----------------- |
| `:fast`     | 1     | 30s     | Quick check       |
| `:full`     | 5     | 5 min   | CI validation     |
| `:extended` | 10    | 10 min  | Large test suites |

> [!TIP]
> **Autonomous test-fix cycles.** See [Ralph Loops](docs/guides/ralph-loops.md) for presets, timeout configuration, and context-rot prevention.

### Judge Mode

Let the AI pick the right resources for the task:

```
%judge Help me refactor this authentication module
```

Analyzes available templates, reasoning frameworks, validation rules, and styles — applies the best combination automatically. For scoring and overrides see [Judge Mode Guide](docs/guides/judge-mode.md).

---

<!-- diataxis: how-to -->

## Run Anywhere

Author workflows as YAML templates. Export as native skills to your client.

```yaml
# skills-sync.yaml — choose what to export
registrations:
  claude-code:
    user:
      - prompt:development/review
      - prompt:development/validate_work
```

```bash
npm run skills:export
```

The `review` prompt becomes a `/review` Claude Code skill. `validate_work` becomes `/validate_work`. Same source, native experience — no MCP call required at runtime.

Compiles to Claude Code skills, Cursor rules, OpenCode commands, and more. `npm run skills:diff` flags when exports drift from source. Configuration, supported clients, and drift detection: [Skills Sync Guide](docs/guides/skills-sync.md).

---

<!-- diataxis: explanation -->

## With Hooks

Well-composed prompts carry their own structure. Hooks keep the experience consistent across models and long sessions.

| Behavior            | What happens                                         |
| ------------------- | ---------------------------------------------------- |
| Prompt routing      | `>>analyze` in conversation → correct MCP tool call  |
| Chain continuity    | Injects step progress and continuation between steps |
| Validation tracking | Tracks pass/fail verdicts across chain steps         |
| Agent handoffs      | Routes `==>` steps to client-native subagents        |
| Session persistence | Preserves workflow state through context compaction  |

Hooks ship with the plugin install. Full support on [Claude Code](.) and [OpenCode](https://github.com/minipuft/opencode-prompts); partial on [Gemini CLI](https://github.com/minipuft/gemini-prompts). Other clients get the three MCP tools but no hook-driven behaviors. Detail: [hooks/README.md](hooks/README.md).

---

<details>
<summary><strong>Syntax Reference</strong></summary>

| Symbol | Name      | What It Does              | Example                |
| :----: | :-------- | :------------------------ | :--------------------- |
|  `>>`  | Prompt    | Execute template          | `>>code_review`        |
| `-->`  | Chain     | Pipe to next step         | `step1 --> step2`      |
| `==>`  | Handoff   | Route step to agent       | `step1 ==> agent_step` |
|  `*`   | Repeat    | Run prompt N times        | `>>brainstorm * 5`     |
|  `@`   | Framework | Inject reasoning guidance | `@CAGEERF`             |
|  `::`  | Gate      | Add validation criteria   | `:: 'cite sources'`    |
|  `%`   | Modifier  | Toggle behavior           | `%clean`, `%judge`     |
|  `#`   | Style     | Apply formatting          | `#analytical`          |

**Modifiers:**

- `%clean` — No framework/gate injection
- `%lean` — Gates only, skip framework
- `%guided` — Force framework injection
- `%judge` — AI selects best resources

→ [MCP Tools Reference](docs/reference/mcp-tools.md) for full command documentation.

</details>

<details>
<summary><strong>The Three Tools</strong></summary>

| Tool               | Purpose                                        |
| ------------------ | ---------------------------------------------- |
| `prompt_engine`    | Execute prompts with frameworks and validation |
| `resource_manager` | Create, update, version, and export resources  |
| `system_control`   | Status, analytics, framework switching         |

```
prompt_engine(command:"@CAGEERF >>analysis topic:'AI safety'")
resource_manager(resource_type:"prompt", action:"list")
system_control(action:"status")
```

</details>

---

<!-- diataxis: explanation -->

## How It Works

Command with operators → server parses and injects resources (framework, gates, style) → client executes the rendered prompt and self-evaluates against the gates → router decides: next step on pass, retry on fail, return on done.

Full request lifecycle, pipeline stages, and subsystem diagrams: [Architecture Overview](docs/architecture/overview.md).

---

<!-- diataxis: reference -->

## Documentation

Full docs index — organized by Diátaxis quadrant (tutorials, how-to, reference, concepts):

→ **[docs/README.md](docs/README.md)**

Quick jumps: [Build your first prompt](docs/tutorials/build-first-prompt.md) · [Chains lifecycle](docs/concepts/chains-lifecycle.md) · [MCP Tools reference](docs/reference/mcp-tools.md) · [Architecture overview](docs/architecture/overview.md) · [Troubleshooting](docs/guides/troubleshooting.md)

---

<!-- diataxis: how-to -->

## Contributing

```bash
cd server
npm install
npm run build        # esbuild bundles to dist/index.js
npm test             # Run test suite
npm run validate:all # Full CI validation
```

The build produces a self-contained bundle. `server/dist/` is gitignored — CI builds fresh from source.

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow details.

---

<!-- diataxis: reference -->

## License

[MIT](LICENSE)
