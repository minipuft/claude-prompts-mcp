# Claude Prompts Server (`/server`)

The Node.js runtime engine that powers the MCP server. It handles prompt orchestration, hot-reloading, and the symbolic execution pipeline.

**Role:** Core Runtime & Orchestrator
**Engine:** Node.js 16+

## Quick Start (Dev Loop)

```bash
# 1. Build & Start (Stdio Mode)
npm install && npm run build
npm run start:stdio

# 2. Start with Hot-Reload (SSE Mode)
npm run dev
```

## Directory Structure

```text
server/
├── src/
│   ├── index.ts              # CLI Entry Point
│   ├── runtime/              # App Lifecycle (Startup/Shutdown)
│   ├── execution/            # Pipeline & Logic Core
│   │   ├── parsers/          # Symbolic Command Parser (>>cmd)
│   │   └── pipeline/         # Execution Stages (Prompt -> Template -> Chain)
│   ├── frameworks/           # Methodology Frameworks (CAGEERF)
│   ├── gates/                # Quality Gate System
│   ├── mcp-tools/            # MCP Tool Implementations
│   └── server/               # Transports (STDIO/SSE)
├── prompts/                  # Prompt Registry (Markdown)
├── config/                   # Runtime Config
└── dist/                     # Build Output
```

## Configuration (`config.json`)

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `server` | `port` | `9090` | Port for SSE transport. |
| `prompts` | `file` | `promptsConfig.json` | Registry config path. |
| `frameworks` | `enableSystemPromptInjection` | `true` | Inject methodology context (once per execution). |
| `analysis` | `semanticAnalysis` | - | LLM integration settings. |

**Framework Injection Notes:**
- Methodology guidance is injected **once per prompt execution**, not continuously
- Use `%clean` modifier to skip injection for specific executions
- Use `%guided` for full methodology + gates, `%lean` for gates only
- Control is per-execution: you decide how often to include the methodology reminder

**Environment Variables:**
- `MCP_SERVER_ROOT`: Override server root.
- `MCP_PROMPTS_CONFIG_PATH`: Direct path to prompts config.
- `LOG_LEVEL`: `debug`, `info`, `warn`, `error`.

### Tool Descriptions (framework-aware)
- Active runtime file: `config/tool-descriptions.json` is regenerated to mirror the current framework/methodology and fuel hot-reload. Do not hand-edit; it will be overwritten.
- Fallback seed: `config/tool-descriptions.fallback.json` is the editable baseline for non-methodology text. Ops/devs update this file when adjusting the default copy.
- Methodology overlays: `methodologies/*/methodology.yaml` provide framework-specific text (SOT for overlays). Contracts under `tooling/contracts/*.json` are the SOT for params/summaries.
- Regeneration loop: on startup or framework switch, the manager loads the seed → applies active framework/methodology overlays → writes the active file. Manual tweaks to the active file are re-harmonized on the next regeneration.

## Architecture & Logic

### 1. Symbolic Parsing
The `UnifiedCommandParser` (`src/execution/parsers`) interprets the symbolic language. It normalizes `>>`, detects JSON wrappers, and routes execution:
- **Chains (`-->`)**: Sequential execution plans.
- **Frameworks (`@`)**: Injected as context overlays.
- **Gates (`::`)**: Post-processing validation steps.
- **Modifiers (`%`)**: Execution flags (e.g., `%guided`).

### 2. Execution Pipeline
`PromptExecutionPipeline` manages the request lifecycle:
1.  **Resolution**: Finds prompt/template in registry.
2.  **Context**: Injects Frameworks + Text References.
3.  **Execution**: Renders template or executes Chain.
4.  **Gating**: Runs enabled validators (Methodology/Quality).

## Docker Deployment

Run the server in a containerized environment with SSE transport enabled by default.

### 1. Build the Image
```bash
# Build locally
docker build -f src/Dockerfile -t claude-prompts-server .
```

### 2. Run the Container
```bash
# Run with SSE transport (default) on port 9090
docker run -p 9090:9090 \
  -e PORT=9090 \
  --name mcp-server \
  claude-prompts-server
```

### 3. Configuration Overrides
You can override settings using environment variables:
```bash
docker run -p 8080:8080 \
  -e PORT=8080 \
  -e LOG_LEVEL=debug \
  -e MCP_TRANSPORT=sse \
  claude-prompts-server
```

### Security & Best Practices
- **Non-Root User:** The image runs as the `node` user by default for security.
- **Healthcheck:** A built-in `HEALTHCHECK` monitors the `/sse` endpoint.
- **ReadOnly Filesystem:** Compatible with read-only root filesystems (mount `/app/logs` and `/tmp` as volumes if needed).

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile `src/` to `dist/`. |
| `npm test` | Run Jest unit/integration tests. |
| `npm run test:watch` | Interactive test runner. |
| `npm run validate:all` | Full CI suite (Lint, Types, Circular Deps). |
| `npm run start:stdio` | Manual CLI testing. |

[Full Documentation](../docs/README.md) | [Contributing](../CONTRIBUTING.md)
