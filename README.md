<!-- maintainers: this README is governed by docs/portfolio/readme-charter.md — run `cd server && npm run validate:readme` before committing changes -->

# Wolfflow

<div align="center">

<img src="assets/logo.png" alt="Wolfflow logo" width="200" />

[![npm version](https://img.shields.io/npm/v/claude-prompts.svg?style=for-the-badge&logo=npm&color=0066cc)](https://www.npmjs.com/package/claude-prompts)
[![License: MIT](https://img.shields.io/badge/License-MIT-00ff88.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**An MCP workflow server.** _Written once, always followed._

Craft reusable prompts with validation and reasoning guidance.<br>
Orchestrate agentic workflows with a composable operator syntax.<br>
Export as native skills.

<sub>Wolfflow ships on npm as <a href="https://www.npmjs.com/package/claude-prompts"><code>claude-prompts</code></a>. The package and CLI names are unchanged.</sub>

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
| Trust the output           | Validate output between steps: self-evaluation and shell commands                     |

### Is this for me?

- **Use this if** you write the same prompts repeatedly, run multi-step workflows, or want to share reusable prompts with a team.
- **Skip if** your client's built-in `/commands` already handle what you need, or you're looking for a no-code prompt library.
- **Works with** Claude Code, Claude Desktop, Cursor, OpenCode, Gemini CLI, Codex, Windsurf, and Zed. Plugin installers add hooks (chain tracking, gate enforcement, state preservation) for Claude Code, OpenCode, and Gemini CLI; other clients run MCP-only.

### How to write a chain

```
>>review target:'src/auth/' @ReACT :: 'cite sources'
  --> security_scan :: verify:"npm test"
  ==> implementation
```

Read top-to-bottom:

- `>>review target:'src/auth/'` runs the `review` prompt against your auth folder.
- `@ReACT` overlays the ReACT reasoning framework on this step.
- `:: 'cite sources'` adds a gate the AI must satisfy (cite sources, or retry).
- `--> security_scan :: verify:"npm test"` chains to step 2, which must pass `npm test` before producing output.
- `==> implementation` hands the final step off to a client-native agent (a subagent in Claude Code).

Validation runs between steps, not only at the end. For the full operator set including `*`, `%`, and `#`, see the **Syntax Reference** details block near the bottom.

<div align="center">

<img src="assets/demos/hero-demo.gif" alt="Chain workflow with gate validation. A prompt executes through hooks, a gate catches a missing field on the first attempt, and the model self-corrects" width="720" />

<sub>A gate catches a missing field, the model corrects itself, and the chain passes. Recorded on haiku, the cheapest model.</sub>

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
git clone https://github.com/minipuft/wolfflow-mcp ~/Applications/wolfflow-mcp
cd ~/Applications/wolfflow-mcp/server && npm install && npm run build
claude --plugin-dir ~/Applications/wolfflow-mcp
```

Edit hooks/prompts → restart Claude Code. Edit TypeScript → rebuild first.

</details>

---

### Claude Desktop

**Option A: GitHub Release** (recommended)

1. Download `claude-prompts-{version}.mcpb` from [Releases](https://github.com/minipuft/wolfflow-mcp/releases/latest)
2. Drag into Claude Desktop Settings → MCP Servers
3. Done

The `.mcpb` bundle is self-contained (~5MB); no npm required.

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
<summary><strong>Other clients</strong>: VS Code · Cursor · OpenCode · Gemini CLI · Codex · Windsurf · Zed · From Source</summary>

**One-click install**:

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=claude-prompts&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22claude-prompts%40latest%22%5D%7D&quality=stable)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-F14F21?style=flat-square&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=claude-prompts&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNsYXVkZS1wcm9tcHRzQGxhdGVzdCJdfQ==)

**Plugin installers** (recommended, adds hooks):

```bash
# OpenCode (full hooks)
npm install -g opencode-prompts && opencode-prompts install

# Gemini CLI (partial hooks)
gemini extensions install https://github.com/minipuft/gemini-prompts
```

**Manual config** for VS Code, Cursor, OpenCode (no hooks), Gemini CLI (no hooks), Codex, Windsurf, Zed: see [Client Integration Guide](docs/guides/client-integration.md) for per-client config locations, JSON examples, and `--client` preset matrix. [Client Capabilities Reference](docs/reference/client-capabilities.md) covers profile mapping and limits.

**From source** (developers):

```bash
git clone https://github.com/minipuft/wolfflow-mcp.git
cd wolfflow-mcp/server && npm install && npm run build && npm test
```

Point your MCP config to `server/dist/index.js`. Transport: `--transport=stdio` (default) or `--transport=streamable-http`.

</details>

**Custom resources**: `--init=~/my-prompts` scaffolds a starter workspace: three example prompts plus `config.json`. Edit them (YAML schema), or have your AI author new prompts, gates, and frameworks via `resource_manager`. Point `MCP_RESOURCES_PATH` at an existing workspace if you already have one in the right shape. See [Custom Resources Guide](docs/guides/custom-resources.md).

---

<!-- diataxis: reference -->

## What You Get

Four primitives you author, version, and compose. The bundled set ships 120+ prompts across 17 categories. All hot-reloadable, all versioned with rollback.

| Primitive       | Symbol | What it is                                                                                                                                                                                                               | Example                                      |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Prompt template | `>>`   | Versioned YAML with named arguments; hot-reload on save                                                                                                                                                                  | `>>code_review target:'src/auth/'`           |
| Gate            | `::`   | Validation criterion the AI checks its own output against; blocking or advisory; can shell-verify                                                                                                                        | `:: 'cite sources'` · `:: verify:"npm test"` |
| Framework       | `@`    | Reasoning framework that shapes how the AI works through the problem; plug in your own or use built-ins like `@ReACT`, `@5W1H`, or the project's own `@CAGEERF` scaffold ([Frameworks Guide](docs/guides/frameworks.md)) | `@ReACT` · `@your_framework`                 |
| Style           | `#`    | Output formatting and tone                                                                                                                                                                                               | `#analytical` · `#procedural`                |

Prompts, gates, and frameworks are managed through the `resource_manager` tool. Your AI creates, edits, versions, and rolls them back through MCP, no file editing required. Styles are managed with the bundled `cpm` CLI. Failed gate checks can retry automatically or pause for your decision ([Gates Guide](docs/guides/gates.md)). Build your first primitive: [Prompt Authoring Tutorial](docs/tutorials/build-first-prompt.md).

---

<!-- diataxis: how-to -->

## Compose Workflows

The basic chain syntax is in [How to write a chain](#how-to-write-a-chain) at the top. Two patterns extend it. Chains also support context threading between steps and agent handoffs. See [Chains Lifecycle](docs/concepts/chains-lifecycle.md) and [MCP Tools Reference](docs/reference/mcp-tools.md).

<details>
<summary><strong>See the output</strong>: tech evaluation chain with context7 research</summary>

<br>

<img src="assets/demos/chain-workflow-demo.gif" alt="Tech evaluation chain researching Zod via context7, producing a scored assessment table with security, performance, DX, integration, and ecosystem ratings" width="720" />

<sub>Context7 fetches live library docs mid-chain. The final output is a structured assessment with sources.</sub>

</details>

### Verification Loops

Ground-truth validation via shell commands. The AI keeps iterating until tests pass:

```
>>implement-feature :: verify:"npm test" loop:true
```

Implements, runs the test, reads failures, fixes, retries. Spawns a fresh context after repeated failures to avoid context rot.

| Preset      | Tries | Timeout | Use Case          |
| ----------- | ----- | ------- | ----------------- |
| `:fast`     | 1     | 30s     | Quick check       |
| `:full`     | 5     | 5 min   | CI validation     |
| `:extended` | 10    | 10 min  | Large test suites |

For autonomous test-fix cycles with context-rot prevention: [Ralph Loops Guide](docs/guides/ralph-loops.md).

### Judge Mode

Let the AI pick the right resources for the task:

```
%judge Help me refactor this authentication module
```

Analyzes available templates, reasoning frameworks, validation rules, and styles, then recommends the best combination. You confirm before it runs. For scoring and overrides see [Judge Mode Guide](docs/guides/judge-mode.md).

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

The `review` prompt becomes a `/review` Claude Code skill. `validate_work` becomes `/validate_work`. Same source, native experience; no MCP call required at runtime.

Compiles to Claude Code skills, Cursor rules, OpenCode commands, and more. `npm run skills:diff` flags when exports drift from source. Configuration, supported clients, and drift detection: [Skills Sync Guide](docs/guides/skills-sync.md).

---

<!-- diataxis: explanation -->

## With Hooks

Without hooks, you're calling the three MCP tools explicitly (the LLM constructs each call). With hooks, the operators work in conversation: `>>`, `-->`, `==>`, `::` feel native rather than mediated, and workflow state survives across LLM turns and context compaction.

What hooks unlock:

| Hook                                   | Unlocks                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Auto-routing**                       | `>>analyze topic:'X'` in chat fires the right MCP tool call without you naming it                            |
| **Chain continuity across compaction** | Multi-step chains preserve state when context compacts mid-execution; the chain doesn't restart from scratch |
| **Cross-step verdict tracking**        | Gate pass/fail verdicts thread across all chain steps without the LLM re-deriving them                       |
| **Native agent handoffs**              | `==>` routes to your client's subagent system automatically; no manual subagent invocation                   |
| **Session persistence**                | Workflow state preserved when context compacts mid-chain                                                     |

Hooks ship with the plugin install. Full support on Claude Code (this repo) and [OpenCode](https://github.com/minipuft/opencode-prompts); partial on [Gemini CLI](https://github.com/minipuft/gemini-prompts). Other clients get the three MCP tools but no hook-driven behaviors. Detail: [hooks/README.md](hooks/README.md).

---

<details>
<summary><strong>Syntax Reference</strong></summary>

| Symbol | Name      | What It Does              | Example                |
| :----: | :-------- | :------------------------ | :--------------------- |
|  `>>`  | Prompt    | Execute template          | `>>code_review`        |
| `-->`  | Chain     | Pipe to next step         | `step1 --> step2`      |
| `==>`  | Handoff   | Route step to agent       | `step1 ==> agent_step` |
|  `*`   | Repeat    | Run prompt N times        | `>>brainstorm * 5`     |
|  `@`   | Framework | Inject reasoning guidance | `@ReACT`               |
|  `::`  | Gate      | Add validation criteria   | `:: 'cite sources'`    |
|  `%`   | Modifier  | Toggle behavior           | `%clean`, `%judge`     |
|  `#`   | Style     | Apply formatting          | `#analytical`          |

**Modifiers** (one per command, placed first):

- `%clean` — No framework/gate/style injection
- `%lean` — Gates only, skip framework and style
- `%framework` — Framework injection only
- `%judge` — AI recommends resources; you confirm

→ [MCP Tools Reference](docs/reference/mcp-tools.md) for full command documentation.

</details>

<details>
<summary><strong>The Three Tools</strong></summary>

| Tool               | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `prompt_engine`    | Execute prompts with frameworks and validation   |
| `resource_manager` | Create, update, version, and roll back resources |
| `system_control`   | Status, analytics, framework switching           |

Most users invoke these via `>>` syntax in conversation; hooks construct the actual calls. For programmatic MCP clients calling tools directly, see [MCP Tools Reference](docs/reference/mcp-tools.md).

</details>

---

<!-- diataxis: explanation -->

## How It Works

Command with operators → server parses and injects resources (framework, gates, style) → client executes the rendered prompt and self-evaluates against the gates → router decides: next step on pass, retry on fail, return on done.

Full request lifecycle, pipeline stages, and subsystem diagrams: [Architecture Overview](docs/architecture/overview.md).

---

<!-- diataxis: reference -->

## Documentation

Full docs index, organized by Diátaxis quadrant (tutorials, how-to, reference, concepts):

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

The build produces a self-contained bundle. `server/dist/` is gitignored, and CI builds fresh from source.

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow details.

---

<!-- diataxis: reference -->

## License

[MIT](LICENSE)
