# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Style System** - New `#` operator for response formatting with YAML-based style definitions
  - Syntax simplified from `#style(id)` to `#id` (e.g., `#analytical`, `#procedural`)
  - Each style lives in `server/styles/{id}/` with `style.yaml` + `guidance.md`
  - Default styles: `analytical`, `procedural`, `creative`, `reasoning`
  - New `StyleManager` orchestration layer (mirrors `GateManager` pattern)
  - New `StyleDefinitionLoader` for runtime YAML loading with caching
  - Hot-reload support via `StyleHotReloadCoordinator`
  - Judge menu (`%judge`) now shows styles from StyleManager with descriptions
  - Environment variable: `MCP_STYLES_PATH` for custom styles directory

### Changed
- **Gate System Architecture Alignment** - Gates now use YAML + Markdown file structure mirroring the methodology system
  - Each gate lives in `server/gates/{id}/` with `gate.yaml` + `guidance.md`
  - `guidanceFile` field in YAML references external guidance content
  - Guidance is inlined at load time by `RuntimeGateLoader`
  - Hot-reload support via `GateHotReloadCoordinator`
  - New `GateManager` orchestration layer (mirrors `FrameworkManager`)
  - New `GateRegistry` for lifecycle management (mirrors `MethodologyRegistry`)
  - New `GenericGateGuide` for data-driven gate implementations
- Documentation restructured with Problem/Solution/Expect format
- **BREAKING: Transport Configuration Simplified** - Removed deprecated nested transport config
  - Use `"transport": "stdio"` (or `"sse"` | `"both"`) in config.json
  - Removed `TransportConfig` and `TransportsConfig` interfaces
  - Removed `config.transports` field (legacy nested structure)
  - Migration: Replace `{ "transports": { "default": "stdio" } }` with `{ "transport": "stdio" }`
- **BREAKING: Environment Variable Migration** - Removed deprecated `MCP_SERVER_ROOT` and `MCP_PROMPTS_CONFIG_PATH`
  - Use `MCP_WORKSPACE` for base workspace directory (replaces `MCP_SERVER_ROOT`)
  - Use `MCP_PROMPTS_PATH` for prompts config (replaces `MCP_PROMPTS_CONFIG_PATH`)
  - New env vars: `MCP_CONFIG_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`
  - CLI flags take priority: `--workspace`, `--prompts`, `--config`, `--methodologies`, `--gates`
  - Migration: Replace `MCP_SERVER_ROOT=/path` with `MCP_WORKSPACE=/path`

### Removed
- Legacy JSON gate definitions from `server/src/gates/definitions/` (migrated to YAML+MD)
- Deprecated transport configuration types (`TransportConfig`, `TransportsConfig`)
- Backward compatibility for `config.transports.default` (use `config.transport` instead)
- `MCP_SERVER_ROOT` environment variable (use `MCP_WORKSPACE` instead)
- `MCP_PROMPTS_CONFIG_PATH` environment variable (use `MCP_PROMPTS_PATH` instead)
- Deprecated server root detection strategy from `ServerRootDetector`

## [1.0.1] - 2025-12-06

### Fixed
- Include `methodologies/` folder in published NPM package

## [1.0.0] - 2025-12-06

**First public release** on NPM as [`claude-prompts`](https://www.npmjs.com/package/claude-prompts)

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

---

## Pre-release Development

Development history before the first NPM release.

### November 2025 — Symbolic Command Language

- Implemented symbolic command parser and operator executors
- Added inline gates and LLM validation hooks
- Framework operator edge case handling
- Comprehensive test coverage for chain execution

### October 2025 — Framework & Gate Systems

- Intelligent gate selection with 5-level precedence
- Enhanced category parsing for prompt classification
- Framework methodology integration
- Chain session management with persistence
- Semantic analysis infrastructure groundwork

### September 2025 — CI/CD & Testing

- GitHub Actions pipeline with Docker publishing
- Comprehensive test framework setup
- Package signing with cosign

### June 2025 — Architecture Consolidation

- Project structure refactoring
- Hot-reload system (replaced legacy monolithic adapter)
- Modernized prompt management tools
- Server startup options and CLI help

### March 2025 — Initial Development

- Initial MCP server implementation
- Decentralized prompt storage (from single `prompts.json` to per-category files)
- CRUD operations: create, update, delete, list, refresh
- Prompt chaining and context placeholders
- Cross-platform path support (Windows/Linux/macOS)

---

[Unreleased]: https://github.com/minipuft/claude-prompts-mcp/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/minipuft/claude-prompts-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/minipuft/claude-prompts-mcp/releases/tag/v1.0.0
