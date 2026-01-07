# Changelog

All notable changes to the `claude-prompts` npm package will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Streamable HTTP Transport**: New MCP standard transport (since 2025-03-26) via `--transport=streamable-http`.
  - Single `/mcp` endpoint for POST/GET/DELETE operations
  - Session management via `mcp-session-id` header
  - UUID-based stateful sessions
  - Recommended replacement for deprecated SSE transport
  - Full E2E test coverage with `StreamableHttpMcpClient` helper
- **System control session tools**: `system_control(action:"session")` supports `list`, `inspect`, and `clear` for active chain sessions and pending reviews.
- **Gemini hook adapters**: Centralized Gemini BeforeAgent/AfterTool hooks with optional `GEMINI_HOOK_DEBUG=1` logging.
- **Claude Desktop Extension (.mcpb)**: One-click installation for Claude Desktop via `.mcpb` bundle format.
  - Drag-and-drop install into Claude Desktop Settings
  - Optional **Custom Prompts Directory** user config - point to your own prompt templates
  - Production-optimized bundle (~5MB) with all dependencies included
  - Build locally with `npm run pack:mcpb` (from `server/`)
  - Manifest follows [Desktop Extensions spec v0.3](https://www.anthropic.com/engineering/desktop-extensions)
- **Claude Code plugin with hooks**: Install via `/plugin install claude-prompts@minipuft`. Includes hooks that guide model behavior:
  - `prompt-suggest.py` (UserPromptSubmit) — Detects `>>prompt` syntax and suggests correct MCP calls
  - `post-prompt-engine.py` (PostToolUse) — Tracks chain state, reminds about gate reviews
  - `pre-compact.py` (PreCompact) — Cleans up chain session state before context compaction
  - `dev-sync.py` (SessionStart) — Synchronizes development cache on session start
  - Solves: models missing `>>` syntax, forgetting to continue chains, skipping gate reviews
- **Gemini CLI extension**: Install via `gemini extensions install https://github.com/minipuft/claude-prompts-mcp`. Same MCP server with Gemini-specific context file (`GEMINI.md`).
- **Unified resources path**: New `MCP_RESOURCES_PATH` environment variable for pointing to a custom resources directory containing `prompts/`, `gates/`, `methodologies/`, `styles/`, and `scripts/`. Simplifies customization without cloning the repo.
- **Styles path override**: Added `MCP_STYLES_PATH` environment variable for fine-grained style directory control.
- **Template references**: `{{ref:id}}` includes other prompts; `{{script:id}}` runs scripts inline during render.
- **Meta-prompts**: Wizard-style prompts for resource creation without memorizing tool APIs:
  - `>>create_gate` — Guided gate creation with validation
  - `>>create_prompt` — Prompt/chain authoring wizard
  - `>>create_methodology` — Framework authoring wizard
  - Two-phase UX: design guidance → script validation → auto-execute
- **Example prompts**: `examples/reference_demo` shows template reference syntax.
- **Version history system**: All resources (prompts, gates, methodologies) now track version history with automatic snapshots on updates, rollback capability, and version comparison.
  - `history` action: View version history for any resource
  - `rollback` action: Restore a previous version (current state saved automatically before rollback)
  - `compare` action: Unified diff between two versions
  - Configuration via `config.json` (`versioning.enabled`, `versioning.max_versions`, `versioning.auto_version`)
  - Storage in `.history.json` sidecar files alongside resources
  - FIFO pruning when exceeding `max_versions` (default: 50)
- **Script tools**: YAML-defined tools under `server/scripts/` with deterministic trigger types and prompt-scoped tool detection.
- **Script execution**: subprocess runner for scripts (spawned process, working directory sandboxed to the tool directory) plus optional auto-execute wiring for `resource_manager`.
- **Script tools documentation**: New guide at `docs/guides/script-tools.md` covering trigger types, confirmation, and migration.
- **Cursor install**: 1-click Cursor MCP install deeplink in the root README.
- **Release automation**: Release Please + gated npm publish workflow (GitHub Release → npm publish) for the `claude-prompts` package.

### Changed

- **Plugin structure**: Migrated from separate `claude-prompts-plugin` repo to this repo. Plugin files (hooks/, skills/, commands/, mcp.json) now live at repo root; only `plugin.json` remains in `.claude-plugin/`.
- **Prompts**: bundled prompts moved to a YAML directory format (`prompt.yaml` + message templates) for better structure and hot-reloadability.
- **Prompt schema**: `category` now optional—auto-derived from directory path.
- **Tools**: introduced `resource_manager` as the unified CRUD surface for prompts/gates/methodologies; `prompt_manager` remains available with deprecation guidance.
- **TypeScript**: tightened typing/tsconfig strictness and cleaned up types across the execution pipeline.
- **Docs**: reorganized documentation layout and cross-links.
- **Script tools**: Consolidated `mode` parameter into `trigger` + `confirm` options (see Migration below).
- **Dev sync hook**: SessionStart now checks cached `node_modules` and runs `npm install` when required packages are missing.
- **Chain response capture**: Step capture now snapshots the current step at stage entry to avoid mutation during gate review advancement.
- **Release automation**: Release Please publishes non-draft releases; GitHub Releases attach the Claude Desktop `.mcpb` after npm publish while CLI extensions remain repo-based.

### Deprecated

- **SSE Transport**: The `--transport=sse` option is now deprecated. Use `--transport=streamable-http` for HTTP-based MCP connections. SSE remains functional for backwards compatibility.
- **Script tool `mode` parameter**: The `mode` field (`auto`/`manual`/`confirm`) is deprecated. Use `trigger: explicit` instead of `mode: manual`, and `confirm: true` instead of `mode: confirm`. Old configurations are auto-migrated with deprecation warnings.
- **Script tool `confidence` parameter**: Numeric confidence scores are deprecated. Use `strict: true/false` for matching control.

### Migration

**Script tool configuration changes:**

| Old Config        | New Config              |
| ----------------- | ----------------------- |
| `mode: auto`      | (default, remove field) |
| `mode: manual`    | `trigger: explicit`     |
| `mode: confirm`   | `confirm: true`         |
| `confidence: 0.8` | `strict: false`         |
| `confidence: 1.0` | `strict: true`          |

See `docs/guides/script-tools.md` for full documentation.

### Fixed

- **Hot-reload cache**: Disk edits to template files (`user-message.md`, etc.) now refresh on reload.
- **SSE request routing**: SSE handler now respects per-session endpoints and SDK `handlePostMessage` behavior.
- **E2E HTTP harness**: Server startup in tests avoids Jest env flags that skip main entry, and Streamable HTTP responses parse JSON/SSE formats.

## [1.1.0] - 2025-12-08

### Added

- **Style System**: `#id` response styles (e.g., `#analytical`) backed by YAML + Markdown in `server/styles/{id}/`.

### Changed

- **Gates**: migrated to YAML + Markdown directories in `server/gates/{id}/` (hot-reloadable, `guidance.md` inlined at load time).
- Documentation restructured with Problem/Solution/Expect format
- **BREAKING**: transport config flattened (`"transport": "stdio" | "sse" | "both"`; removed legacy `config.transports.*`).
- **BREAKING**: env var migration (`MCP_SERVER_ROOT` → `MCP_WORKSPACE`, `MCP_PROMPTS_CONFIG_PATH` → `MCP_PROMPTS_PATH`; added `MCP_CONFIG_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`).

### Removed

- Legacy JSON gate definitions from `server/src/gates/definitions/` (migrated to YAML + Markdown).
- Deprecated transport configuration types (`TransportConfig`, `TransportsConfig`) and legacy `config.transports.default`.
- Deprecated env vars `MCP_SERVER_ROOT` and `MCP_PROMPTS_CONFIG_PATH`.

## [1.0.1] - 2025-12-06

### Fixed

- Include `methodologies/` folder in published NPM package

## [1.0.0] - 2025-12-06

**First public release** on NPM as `claude-prompts`.

### Added

**MCP Tools**

- `prompt_engine` — Execute prompts with symbolic command language
- `prompt_manager` — Create, update, delete, and inspect prompts
- `system_control` — Framework switching, status, and analytics

**Prompt Management**

- Decentralized storage (per-category JSON files, not one monolithic file)
- Hot reload — Edit prompts without restarting the server
- Nunjucks templating with conditionals, loops, and filters
- Argument validation (type coercion, min/max length, regex patterns)
- Special placeholders (`{{previous_message}}`, chain step variables)
- Prompt inspection and execution type analysis

**Symbolic Command Language**

- Chain operator (`-->`) for sequential multi-step workflows
- Framework operator (`@`) for methodology application
- Gate operator (`::`) for inline quality criteria
- Modifiers (`%clean`, `%guided`, `%lean`, `%framework`)

**Framework Methodologies**

- CAGEERF (Context → Analysis → Goals → Execution → Evaluation → Refinement)
- ReACT (Reasoning + Acting)
- 5W1H (Who, What, When, Where, Why, How)
- SCAMPER (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)
- Runtime switching between methodologies

**Gate System**

- 5-level precedence for quality validation
- Built-in gates (technical-accuracy, code-quality, security, etc.)
- Custom gate definitions via YAML/JSON
- Inline gate specification in commands

**Execution Pipeline**

- 11-stage pipeline architecture
- Chain session persistence and resumption
- Request validation and argument schema enforcement

**Infrastructure**

- STDIO and SSE transport support
- Node.js 24 LTS baseline
- TypeScript 5.9 strict mode
- Jest 30 test framework
