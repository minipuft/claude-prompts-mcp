# Claude Prompts MCP Server

[![npm version](https://img.shields.io/npm/v/claude-prompts-server.svg)](https://www.npmjs.com/package/claude-prompts-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org/)

Hot-reloadable Model Context Protocol server for prompts, thinking frameworks, and quality gates. Manage prompt libraries, apply structured reasoning methodologies, and enforce output quality—all through MCP tools.

## Why Use This?

- **Prompt Library Management** — Create, update, and organize prompts through MCP tools instead of manually editing files
- **Built-in Thinking Frameworks** — Apply CAGEERF, ReACT, 5W1H, or SCAMPER methodologies to guide structured reasoning
- **Quality Gates** — Enforce validation criteria on outputs with multi-tier gate systems
- **Multi-Step Chains** — Build complex workflows with persistent session state that survives restarts
- **Hot-Reload** — Edit prompts and see changes immediately without restarting the server
- **Symbolic Command Language** — Express complex workflows with intuitive operators (`-->`, `@`, `::`, `+`)

## Key Features

| Feature               | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| **3 MCP Tools**       | `prompt_engine`, `prompt_manager`, `system_control`                   |
| **4 Frameworks**      | CAGEERF, ReACT, 5W1H, SCAMPER thinking methodologies                  |
| **Quality Gates**     | Multi-tier validation with blocking and advisory modes                |
| **Symbolic Commands** | Chain (`-->`), framework (`@`), gate (`::`), parallel (`+`) operators |
| **Hot-Reload**        | File watcher auto-reloads prompts on save                             |
| **Chain Sessions**    | Persistent multi-step workflows with session resumption               |
| **Judge Mode**        | Interactive guided selection of frameworks, styles, and gates         |

## Quick Start

```bash
# Run without installing
npx claude-prompts-server --transport=stdio --quiet

# See all options
npx claude-prompts-server --help
```

### Connect to Claude Desktop

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-prompts": {
      "command": "npx",
      "args": ["-y", "claude-prompts-server", "--transport=stdio", "--quiet"]
    }
  }
}
```

## MCP Tools Overview

### `prompt_engine` — Execute Prompts & Chains

The unified execution engine for running prompts with frameworks and gates.

```bash
# Execute a prompt
prompt_engine(command: "analysis_report content:'Q4 metrics'")

# Apply a thinking framework
prompt_engine(command: "@CAGEERF analysis_report content:'Q4 metrics'")

# Chain multiple steps
prompt_engine(command: "research --> analysis --> synthesis")

# Add quality gates inline
prompt_engine(command: "security_audit :: 'cite sources, verify claims'")

# Combine operators
prompt_engine(command: "@ReACT step1 --> step2 :: 'check accuracy'")
```

### `prompt_manager` — Lifecycle Operations

Create, update, delete, and organize prompts without touching files.

```bash
# List available prompts
prompt_manager(action: "list")

# Create a new prompt
prompt_manager(
  action: "create",
  id: "code_review",
  name: "Code Review",
  description: "Review code for issues",
  user_message_template: "Review this code: {{code}}"
)

# Reload prompts after external edits
prompt_manager(action: "reload")
```

### `system_control` — Runtime Administration

Manage frameworks, view analytics, and control system behavior.

```bash
# Check server status
system_control(action: "status")

# Switch active framework
system_control(action: "framework", operation: "switch", framework: "CAGEERF")

# View execution analytics
system_control(action: "analytics")
```

## Symbolic Command Language

Express complex execution flows with intuitive operators:

| **Symbol** | **Name** | **Pipeline Action** | **Visual Mnemonics** |
| :---: | :--- | :--- | :--- |
| `-->` | **Chain** | **Pipes** output from one step to the next | 🔗 **Link** steps together |
| `@` | **Framework** | Injects **Thinking Models** (CAGEERF, ReACT) | 🧠 **Brain** of the operation |
| `::` | **Gate** | Enforces **Quality Checks** before proceeding | 🛡️ **Shield** the output |
| `%` | **Modifier** | Toggles **Execution Modes** (Menu/Clean/Lean) | ⚙️ **Config** the settings |
| `#` | **Style** | Applies **Persona/Tone** presets | 🎨 **Paint** the response |

### Execution Modifiers

Control framework and gate behavior per execution:

- `%clean` — No framework, no gates (minimal execution)
- `%guided` — Full framework + gates (maximum guidance)
- `%lean` — Gates only, skip framework injection
- `%framework` — Framework only, skip gates

```bash
# Skip all guidance for quick iteration
prompt_engine(command: "%clean quick_task input:'test'")

# Full guidance for important work
prompt_engine(command: "%guided analysis_report content:'annual review'")
```

## Thinking Frameworks

Four built-in methodologies to guide structured reasoning:

| Framework   | Description                                                 | Best For                   |
| ----------- | ----------------------------------------------------------- | -------------------------- |
| **CAGEERF** | Context, Analysis, Goals, Execution, Evaluation, Refinement | Research, deep analysis    |
| **ReACT**   | Reasoning + Acting cycles                                   | Problem-solving, debugging |
| **5W1H**    | Who, What, When, Where, Why, How                            | Structured questioning     |
| **SCAMPER** | Substitute, Combine, Adapt, Modify, Put, Eliminate, Reverse | Innovation, ideation       |

```bash
# Apply CAGEERF for structured analysis
prompt_engine(command: "@CAGEERF research_topic subject:'AI safety'")

# Use ReACT for problem-solving
prompt_engine(command: "@ReACT debug_issue error:'connection timeout'")
```

## Quality Gates

Enforce validation criteria on outputs:

```bash
# Inline criteria (simplest approach)
prompt_engine(command: "report :: 'include citations, verify data, note uncertainties'")

# Multiple gate types
prompt_engine(
  command: "security_audit",
  gates: [
    "technical-accuracy",                              # Canonical gate ID
    {"name": "OWASP Check", "description": "OWASP Top 10"},  # Custom check
    {"id": "temp", "criteria": ["No hardcoded secrets"]}     # Full definition
  ]
)
```

## Configuration

Set `MCP_SERVER_ROOT` to your workspace containing `config.json` and `prompts/`:

```bash
MCP_SERVER_ROOT=/path/to/workspace npx claude-prompts-server --transport=stdio
```

Key `config.json` settings:

```json
{
  "frameworks": {
    "enableSystemPromptInjection": true,
    "enableMethodologyGates": true
  },
  "gates": {
    "enabled": true
  },
  "transports": {
    "default": "stdio"
  }
}
```

### Environment Variables

| Variable                  | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `MCP_SERVER_ROOT`         | Server root directory (contains config.json and prompts/) |
| `MCP_PROMPTS_CONFIG_PATH` | Direct path to prompts config file                        |
| `LOG_LEVEL`               | Logging verbosity: debug, info, warn, error               |

### CLI Options

| Option                   | Description                     |
| ------------------------ | ------------------------------- |
| `--transport=stdio\|sse` | Transport mode (default: stdio) |
| `--quiet`                | Minimal logging                 |
| `--verbose`              | Detailed diagnostics            |
| `--debug-startup`        | Extra startup tracing           |
| `--startup-test`         | Boot and exit (sanity check)    |

## Documentation

| Guide                                                                                                       | Description                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [Architecture](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/architecture.md)               | System design and runtime phases      |
| [MCP Tooling](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/mcp-tooling-guide.md)           | Complete tool reference and workflows |
| [Prompt Authoring](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/prompt-authoring-guide.md) | Template structure and metadata       |
| [Chain Workflows](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/chain-workflows.md)         | Multi-step execution patterns         |
| [Gate System](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/enhanced-gate-system.md)        | Validation and quality control        |
| [Operations](https://github.com/minipuft/claude-prompts-mcp/blob/main/docs/operations-guide.md)             | Deployment and configuration          |

## Development

```bash
git clone https://github.com/minipuft/claude-prompts-mcp.git
cd claude-prompts-mcp/server
npm install && npm run build
npm run start:stdio
```

## Contributing

Issues and pull requests welcome at [GitHub](https://github.com/minipuft/claude-prompts-mcp/issues).

## License

[MIT](LICENSE)