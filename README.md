# Claude Prompts MCP Server

<div align="center">

![Claude Prompts MCP Server Logo](assets/logo.png)

[![npm version](https://img.shields.io/npm/v/claude-prompts-server.svg?style=for-the-badge&logo=npm&color=0066cc)](https://www.npmjs.com/package/claude-prompts-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-00ff88.svg?style=for-the-badge&logo=opensource)](https://opensource.org/licenses/MIT)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-ff6b35?style=for-the-badge&logo=anthropic)](https://modelcontextprotocol.io)

**Hot-reloadable prompts, structured reasoning, and chain workflows for your AI assistant.**

[Quick Start](#quick-start) • [Features](#features) • [Power Usage](#power-user-features) • [Docs](docs/README.md)

</div>

## Why This Exists

Stop copy-pasting prompts. This server turns your prompt library into a version-controlled, programmable engine.

1.  **Version Control**: Manage prompts as Markdown code in git.
2.  **Hot Reload**: Edit a template and use it instantly—no restarts.
3.  **Structured Execution**: It's not just text. The server parses your command, injects methodology (Frameworks), enforces quality (Gates), and renders a final template for the LLM.
4.  **Pluggable Analysis**: The `analysis` block in `server/config.json` is reserved for future third-party LLM-powered semantic analysis; it’s not active today.

## Quick Start

Get running in 60 seconds.

### 1. Install & Build

```bash
git clone https://github.com/minipuft/claude-prompts-mcp.git
cd claude-prompts-mcp/server
npm install && npm run build
# Verify it works (STDIO mode)
npm run start:stdio
```

### 2. Connect to Claude Desktop

Add this to your `claude_desktop_config.json`:

**Windows:**

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "node",
      "args": ["C:\\path\\to\\claude-prompts-mcp\\server\\dist\\index.js"]
    }
  }
}
```

**Mac/Linux:**

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "node",
      "args": ["/path/to/claude-prompts-mcp/server/dist/index.js"]
    }
  }
}
```

### 3. Try It

Restart Claude Desktop. In the input bar, type:

```text
prompt_manager list
```

## Core Concepts

This isn't a static file reader. It's a **render pipeline**:
`Command` -> `Parser` -> `Plan` -> `Framework Injection` -> `Gate Validation` -> `Template Render` -> `LLM`

- **Templates**: Markdown files with Nunjucks (`{{var}}`).
- **Frameworks**: Thinking methodologies (CAGEERF, ReACT) injected **once per prompt execution** into the system prompt to guide _how_ the AI thinks. You control when and how often this reminder appears using execution modifiers (`%clean`, `%guided`, etc.).
- **Guidance Resources**: Markdown files (`analytical.md`, `procedural.md`, `creative.md`) containing structural patterns or specific instructions that can be dynamically injected into a prompt based on semantic analysis.
- **Gates**: Quality checks (e.g., "Must cite sources") enforced before or during execution.

> **Framework Injection Frequency**: Methodology guidance is a per-execution reminder, not a continuous injection. Use `@Framework` when starting new analytical work, `%clean` for follow-ups where the methodology is already established. See the [MCP Tooling Guide](docs/mcp-tooling-guide.md#understanding-framework-injection-frequency) for detailed control options.

## Features

- **🔥 Hot Reload**: Edit `server/prompts/my_prompt.md`, save, run `prompt_engine >>my_prompt`. It updates instantly.
- **🔗 Chains**: Run multi-step logic. `analyze --> critique --> fix`.
- **🧠 Frameworks**: Apply structured reasoning (ReACT, CAGEERF) to any prompt.
- **🛡️ Gates**: Enforce quality standards on outputs.
- **✨ Resource-Driven Guidance**: Dynamically inject Markdown resources (e.g., analytical frameworks, creative structures) based on an LLM's assessment of the prompt.

## Power User Features

The `prompt_engine` supports a symbolic language for complex workflows.

### Symbolic Commands

| Symbol | Name      | Example             | Effect                                         |
| :----- | :-------- | :------------------ | :--------------------------------------------- |
| `-->`  | Chain     | `step1 --> step2`   | Pipes output of step1 into step2.              |
| `@`    | Framework | `@ReACT analysis`   | Wraps 'analysis' in the ReACT methodology.     |
| `::`   | Gate      | `code :: "no bugs"` | Enforces the "no bugs" criteria on the output. |
| `#`    | Style     | `#style(analytical)`| Applies a specific output style or persona.    |
| `%`    | Modifiers | `%judge prompt`     | `%judge` = guided menu; `%clean`/`%lean` disable framework injection. |

### Gate Retry & Enforcement (New)

The system now intelligently manages gate failures:

- **Retry Limits**: Gates auto-retry up to 2 times (configurable) before pausing.
- **Enforcement Modes**:
  - **Blocking**: Must pass to proceed (default for Critical/High severity).
  - **Advisory**: Logs a warning but allows the chain to continue (Medium/Low severity).
- **User Choice**: On exhaustion, you can choose to `retry`, `skip`, or `abort`.

### Examples

**1. Resource-Driven Prompt Enhancement (New)**
Use the semantic judge to automatically enhance a prompt with relevant guidance resources.

```bash
prompt_engine(command:"judge >>my_prompt template:'Explain database normalization.' --> ")
```

_The judge will analyze 'Explain database normalization.' and automatically inject appropriate guidance (e.g., analytical framework) from our resource library._

**2. The "Judge" Experience (New)**
Not sure what you need? Let the system help you build the request.

```bash
prompt_engine(command:"%judge code_review")
```

_Returns a menu to select styles, frameworks, and gates before running._

**3. Chained Reasoning with Gates**
Run a research task using CAGEERF, check it for citations, then summarize it.

```bash
prompt_engine(command:"@CAGEERF research topic:'AI' :: 'cite sources' --> summarize")
```

**4. Rapid Iteration**
Edit your template in VS Code, save, and immediately verify:

```bash
prompt_engine(command:"%clean my_new_prompt arg='test'")
```

## Configuration

Customize behavior via `server/config.json`. No rebuild required—just restart.

| Section | Setting | Default | Description |
| :--- | :--- | :--- | :--- |
| `prompts` | `file` | `prompts/promptsConfig.json` | Master config defining prompt categories and import paths. |
| `prompts` | `registerWithMcp` | `true` | Exposes prompts to Claude clients. Set `false` for internal-only mode. |
| `frameworks` | `enableSystemPromptInjection` | `true` | Auto-injects methodology guidance (CAGEERF, etc.) into system prompts. |
| `gates` | `definitionsDirectory` | `src/gates/definitions` | Path to custom quality gate definitions (JSON). |
| `judge` | `enabled` | `true` | Enables the built-in judge phase (`%judge`) that surfaces framework/style/gate options. |

## Documentation

- **[Architecture](docs/architecture.md)**: Deep dive into the execution pipeline.
- **[Tooling Guide](docs/mcp-tooling-guide.md)**: Full command reference.
- **[Authoring Guide](docs/prompt-authoring-guide.md)**: Creating templates and gates.
- **[Chains](docs/chain-workflows.md)**: Building multi-step flows.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
cd server
npm run test        # Run Jest
npm run typecheck   # Verify types
npm run validate:all # Full CI check
```

## License

[MIT](LICENSE)
