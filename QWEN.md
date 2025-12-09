# Claude Prompts MCP - Global Rules Integration

## 🔗 Global Rules System Integration

@include ~/.claude/CLAUDE.md#Rule_Loading_Hierarchy

**Detected Context**: Node.js TypeScript MCP Server Project
**Active Domain Rules**: JAVASCRIPT.md (ES modules, TypeScript strict mode, Jest testing, Node.js patterns)

**Project-Specific Rule Overrides**:

- **MCP tool usage** → NEVER use direct file operations, ALWAYS use MCP tools
- **Framework switching** → Use methodology guides as single source of truth
- **Hot-reload compatibility** → Maintain registry synchronization

This file provides guidance to Claude Code (claude.ai/code) when working with this Model Context Protocol (MCP) server repository.

## Build and Development Commands

### Essential Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `dist/`
- **Type Check**: `npm run typecheck` - Validates TypeScript types without compilation
- **Start**: `npm start` - Runs the compiled server from `dist/index.js`
- **Development**: `npm run dev` - Watches TypeScript files and restarts on changes
- **Test**: `npm test` - Runs the full Jest suite (unit + integration under `tests/**/*`)

### Transport-Specific Commands

- **STDIO Transport**: `npm run start:stdio` - For MCP clients like Claude Desktop
- **SSE Transport**: `npm run start:sse` - For web-based clients
- **Production**: `npm run start:production` - Quiet mode with STDIO transport
- **Development**: `npm run start:development` - Verbose mode with SSE transport

### Debugging Commands

- **Verbose Mode**: `npm run start:verbose` - Detailed diagnostics and strategy information
- **Debug Startup**: `npm run start:debug` - Extra debugging information
- **Quiet Mode**: `npm run start:quiet` - Minimal output for production
- **Help**: `npm run help` - Show command line options and environment variables

### Quality & Validation Commands

The developer workflow relies on a set of scripts that gatekeep formatting, linting, and lifecycle integrity before any transport-specific tests even run.

- **`npm run lint` / `npm run lint:fix`** — Executes ESLint with the TypeScript plugin suite plus our custom `lifecycle` plugin (`server/eslint-rules/lifecycle.js`). These rules enforce strict typing, forbid imports from legacy paths, and require `@lifecycle canonical|migrating` annotations across gate modules.
- **`npm run format` / `npm run format:fix`** — Runs Prettier 3.x against `src/**/*.{ts,tsx,json,md}` and `tests/**/*.{ts,tsx}`. Formatting is also surfaced via ESLint (`prettier/prettier`), so drift fails CI.
- **`npm run validate:lint`** — Convenience guard that chains the lint and format checks; used by pre-commit hooks and CI jobs.
- **`npm run validate:dependencies`** — Invokes `server/scripts/validate-dependencies.js` to ensure there is exactly one implementation per execution/analysis/runtime/tooling slice and that canonical components (prompt engine, framework managers, runtime bootstraps, methodology guides) are present.
- **`npm run validate:circular`** — Uses `madge` to block circular imports inside `src/`.
- **`npm run validate:all`** — Runs both dependency and circular validators for parity with the Baselining & Guardrails plan.

> **Reminder:** `npm run typecheck` and `npm test` remain canonical gates; run them together with the scripts above whenever touching execution, gates, runtime, or MCP tooling.

### Linting & Formatting Stack

- **ESLint**: Flat config (`server/eslint.config.js`) powered by `@typescript-eslint`, `eslint-plugin-import`, `eslint-plugin-prettier`, and the local `lifecycle` plugin. Strict rules ban `any`, enforce explicit returns, control import ordering, and verify lifecycle annotations. The lifecycle plugin currently watches `src/gates/**` and will be expanded to additional subsystems as migrations close out.
- **Prettier**: Version 3.x with default settings. Formatting is surfaced two ways: explicit scripts (`npm run format`, `npm run format:fix`) and the `prettier/prettier` ESLint rule so CI failures are immediate when files drift.
- **Workflow Hooks**: `npm run validate:lint` provides a single entry point for git hooks/CI so contributors can easily wire `lint-staged` or Husky without duplicating script logic.

## ⚠️ CRITICAL: MCP Tool Usage Requirements

**NEVER use direct file manipulation when working with this MCP server.** The server provides structured MCP tools that MUST be used instead.

### ❌ FORBIDDEN Operations

- `Update()`, `Edit()`, `MultiEdit()`, `Write()` - Direct file operations
- Direct modification of JSON files in `/prompts/` directories
- Creating new prompt files manually
- Bash commands that modify prompt files

### ✅ REQUIRED: Use MCP Tools

- **prompt_manager** - All prompt/chain creation, modification, deletion
- **system_control** - Server management, framework switching, analytics
- **prompt_engine** - Prompt execution, chain operations, scaffolding

**References**:

- [MCP Tools Reference](./docs/mcp-tools-reference.md) - Complete tool documentation
- [Symbolic Command Language Guide](./docs/symbolic-command-language.md) - Step-by-step workflows

**Example of CORRECT usage**:

```bash
# Wrong: Update(~/prompts/chain.json)
# Right: prompt_manager(action: "update", id: "chain_name", ...)

# Wrong: Write(~/prompts/new_prompt.md)
# Right: prompt_manager(action: "create", id: "new_prompt", ...)
```

**Why this matters**: Direct file operations bypass MCP protocol compliance, break hot-reloading, cause registry desynchronization, and lead to "no structured content provided" errors.

## CI/CD Pipeline

### GitHub Actions Workflows

The project uses GitHub Actions for automated testing and validation:

#### Main CI Pipeline (`.github/workflows/ci.yml`)

- **Triggers**: Push to `main`/`develop` branches, Pull Requests to `main`
- **Matrix Testing**: Node.js versions 16, 18, 20 across Ubuntu, Windows, macOS
- **Validation Steps**: TypeScript checking, build validation, test execution, server startup
- **CAGEERF Integration**: Validates all CAGEERF framework modules compile and load
- **Artifacts**: Uploads build artifacts for successful Ubuntu + Node 18 builds

#### PR Validation (`.github/workflows/pr-validation.yml`)

- **Triggers**: Pull request events (opened, synchronized, reopened)
- **Quality Gates**: TypeScript, build, tests, CAGEERF validation, MCP tools validation
- **Feedback**: Automated PR comments with validation results and changed files analysis
- **Compatibility**: Checks for breaking changes when targeting main branch

#### MCP Protocol Compliance (`.github/workflows/mcp-compliance.yml`)

- **Triggers**: Push to `main`/`develop` branches, Pull Requests to `main` (when MCP-related files change)
- **Monitored Paths**: `server/src/mcp-tools/**`, `server/src/transport/**`, `server/src/runtime/**`
- **Validation**: MCP SDK version compliance, protocol implementation validation, tool registration checks
- **Purpose**: Ensures all changes maintain MCP protocol compatibility and standards

### Quality Gates

- **Mandatory**: TypeScript compilation, build success, test passing, server startup
- **CAGEERF Validation**: All analyzer modules, template tools, and MCP integrations
- **Code Quality**: No sensitive files, proper TypeScript structure, dependency consistency

## Nunjucks Dynamic Chain Orchestration Strategy

**Decision**: Keep Nunjucks for dynamic chain orchestration - templates render on EACH step with access to previous results, enabling result-based conditionals and adaptive instructions.

**Chain Step Variable Access**: Step 1 outputs → Step 2 inputs (+ Step 1 outputs) → Step 3 inputs (+ all previous outputs). Templates use `{% if score < 0.7 %}` conditionals for quality-driven adaptation.

**Capabilities**: Quality-driven adaptation (adjust instructions based on previous step quality/validation), complexity-based branching (adapt to source/topic count), error recovery (adapt based on failure types), format modification (based on content characteristics)

**Best Practices**: Progressive instruction clarity (more specific as quality decreases), error context preservation, metric-driven branching (multiple quality metrics), accumulated state tracking, self-documenting templates

**Performance**: Template rendering <50ms/step, variable substitution ~1ms/100 vars, conditionals ~0.5ms/condition, templates cached in production (jsonUtils.ts)

**Limitations**: Cannot change next prompt (static chain), no recursive execution, no dynamic library selection (requires execution engine)

**Future**: Dynamic step selection, recursive execution with quality thresholds, LLM-driven orchestration, automatic quality gates

**Reference**: `/plans/nunjucks-dynamic-chain-orchestration.md`

## Project Architecture

### Core System Structure

**MCP server** with AI prompt management and hot-reloading. Multi-phase orchestration: Foundation → Data Loading → Module Initialization → Server Launch.

### Key Components

#### `/server/src/runtime/`

- **application.ts**: Main entry with health monitoring, graceful shutdown, multi-phase startup, performance tracking

#### `/server/src/frameworks/`

- **framework-manager.ts**: Stateless orchestration, loads methodology guides (CAGEERF, ReACT, 5W1H, SCAMPER), generates framework definitions
- **framework-state-manager.ts**: Stateful management, tracks active framework, handles switching with validation/history
- **methodology/guides/**: Methodology guide implementations | **integration/**: Framework-semantic analysis bridge | **types/**: Type definitions

#### `/server/src/execution/`

- **index.ts**: Execution orchestration | **context/**: Context resolution, framework injection | **parsers/**: Unified command parsing system with symbolic operator support
- **execution-context.ts**: Type definitions | **operators/**: Operator executors (chain, framework, gate)

#### `/server/src/gates/`

- **definitions/**: Gate templates | **core/**: Validation implementations | **templates/**: Reusable structures | **index.ts**: Orchestration

#### `/server/src/semantic/`

- **Semantic Analysis Engine**: Auto prompt type detection | **integrations/**: Framework integration | **Analysis Types**: Type definitions

#### `/server/src/prompts/`

- **Nunjucks template processor** (conditionals, loops, macros) | **Prompt registry** (dynamic loading, hot-reload) | **Converter system** | **Category manager**

#### `/server/src/mcp-tools/`

- **prompt-engine.ts**: Execution with analysis/semantic detection | **prompt-manager.ts**: Lifecycle management, smart filtering | **system-control.ts**: Framework management, analytics
- **config-utils.ts, error-handler.ts**: Config/error management | **filters/**: Search capabilities | **formatters/**: Response formatting | **validators/**: Input validation

#### `/server/src/performance/` & `/server/src/metrics/`

- Performance monitoring, memory tracking, usage analytics, health diagnostics

#### `/server/src/server/transport/`

- **STDIO** (Claude Desktop) | **SSE** (web clients) | Transport-aware logging | HTTP routing | WebSocket handlers

### Configuration System

**File Organization** (consolidated to `/server/` directory):

```
/server/
├── config.json                          (static config: server settings, transport, logging)
├── tool-descriptions/
│   └── tool-descriptions.json          (static config: MCP tool metadata, rarely changes)
└── runtime-state/
    ├── framework-state.json            (runtime state: active framework, enable/disable)
    ├── chain-sessions.json             (runtime state: chain execution sessions)
    └── gate-system-state.json          (runtime state: gate system metrics)
```

**Configuration Files**:

- **server/config.json**: Server settings, transport config (STDIO/SSE), logging, prompts reference
- **server/tool-descriptions/tool-descriptions.json**: MCP tool metadata, hot-reload capable but static in practice
- **prompts/promptsConfig.json**: 10 categories (analysis, development, education, documentation, debugging, content_processing, architecture, general, testing, codebase-setup), modular imports via `prompts/[category]/prompts.json`, registration modes (ID, NAME, BOTH)

**Runtime State Files** (persist across server restarts):

- **server/runtime-state/framework-state.json**: Active framework selection, enable/disable status, switching history
- **server/runtime-state/chain-sessions.json**: Chain execution sessions with step state tracking (survives STDIO transport restarts)
- **server/runtime-state/gate-system-state.json**: Gate system enable/disable, validation metrics, health status

### Prompt Organization

**File Structure**: `server/prompts/[category]/` containing `prompts.json` registry + `*.md` prompt files
**Prompt Format**: Markdown with Nunjucks `{{variable}}` templating, typed argument definitions, category association

### TypeScript Architecture

**Core Types** (`src/types.ts`): Config interfaces, PromptData (metadata/structure), Message types, Transport types
**Key Interfaces**: PromptData, PromptArgument (validation), Category (organization), MessageContent (extensible)

### Framework System Architecture

**Methodology-Driven Design**: Core architecture uses methodology guides (CAGEERF, ReACT, 5W1H, SCAMPER) providing systematic approaches to prompt creation/processing/execution, replacing hard-coded logic with flexible, guideline-based behavior.

**Framework Manager** (`framework-manager.ts`): Stateless orchestration, loads methodology guides, generates framework definitions, creates execution contexts with framework-specific system prompts
**Framework State Manager** (`framework-state-manager.ts`): Stateful management, tracks active framework (default: CAGEERF), handles switching with validation/history, health monitoring, performance metrics, event emission
**Methodology Guides** (`methodology/guides/`): Single source of truth for framework behavior

**IMethodologyGuide Interface**: Prompt creation guidance (structure/arguments/quality), template processing (framework-specific steps), execution steps (methodology application), methodology enhancement (quality gates/validation), compliance validation

**Framework Selection & Switching**: Dynamic selection (complexity/execution type/preference), runtime switching via MCP tools (`switch_framework`), state persistence (cross-session history), performance monitoring

**Integration Points**:

- **Semantic Analysis** (`framework-semantic-integration.ts`): Coordinates analysis results with framework selection, maintains WHAT vs HOW separation
- **Framework-Aware Gates** (`framework-aware-gates.ts`): Adaptive gate validation with framework-specific criteria
- **Prompt Guidance Service** (`frameworks/prompt-guidance/service.ts`): Dynamic system prompt generation from methodology guides, framework-enhanced template processing

### Execution Strategy Architecture

**Strategy Pattern**: Handles different execution types (prompt/chain/workflow)
**Execution Engine** (`engine.ts`): Strategy selection, context management, error handling/recovery, performance monitoring
**Strategies** (`strategies/`): Prompt (single execution + framework injection), Chain (sequential multi-step + state management), Workflow (complex execution + gate validation/branching)
**Template Pipeline**: Template loading → Framework injection → Variable substitution → Context enhancement → Execution
**Conversation Management** (`conversation.ts`): Message history, context preservation, framework-aware enhancement, state persistence

### Development Patterns

**Hot-Reloading**: File watching, registry updates without restart, template recompilation, MCP client notification
**Error Handling**: Comprehensive boundaries, graceful degradation, health monitoring, rollback mechanisms
**Template Processing**: Nunjucks engine (conditionals, loops, macros), dynamic variable substitution

### MCP Integration

**Protocol Implementation**: MCP SDK integration, tool registration, conversation management, transport abstraction
**3 Consolidated MCP Tools**: `prompt_engine` (execution + analysis), `prompt_manager` (lifecycle + filtering), `system_control` (framework switching + analytics)

### Performance Considerations

**Startup**: Strategy-based detection (early termination), env variable bypass, conditional logging, dependency management
**Runtime**: Memory monitoring (periodic reporting), health checks (30s intervals), diagnostics, graceful shutdown

### Enhanced Systems

**Framework System**: Methodology-driven architecture (4 guides), dynamic switching, framework-aware gates, semantic analysis integration, injection system
**Execution Strategy**: Strategy pattern (3 types), engine orchestration, template pipeline, conversation state management
**Gate Validation**: Registry (framework awareness), enhanced evaluators (methodology-specific criteria), multi-level validation
**Advanced Analysis**: Semantic analyzer (auto type detection), framework-semantic integration, execution type detection, quality assessment

### Key Development Guidelines

**Core Rules**: ONE primary implementation per functional area, explicit deprecation required before adding new systems

**Dependency Direction**: Clear hierarchy (no bidirectional imports), use dependency injection/event patterns instead of circular imports

**Consolidation Over Addition**: Enhance existing systems vs creating new ones, require architectural justification for parallel systems, verify no duplicate functionality

**Framework Development**: Methodology guides = single source of truth (never hard-code), dynamic generation from guide metadata, guide-driven enhancements (system prompts, quality gates, validation)

**Domain Cohesion**: Framework logic in `/frameworks`, separate stateless (manager) from stateful (state manager), clear separation (analysis WHAT vs methodology HOW), explicit integration points (`/integration`)

**Methodology Guide Development**: Implement `IMethodologyGuide` interface (all required methods: `guidePromptCreation`, `guideTemplateProcessing`, `guideExecutionSteps`, `enhanceWithMethodology`, `validateMethodologyCompliance`), framework-specific quality gates, template enhancement suggestions, methodology validation

**Framework Integration**: No direct coupling (integrate via framework manager), event-driven communication, semantic analysis coordination (informed by, not dependent on), gates adapt to framework (remain framework-agnostic in core)

**Configuration**: CLI flags and env vars for path overrides (`MCP_WORKSPACE`, `MCP_CONFIG_PATH`, `MCP_PROMPTS_PATH`, `MCP_METHODOLOGIES_PATH`, `MCP_GATES_PATH`), separate server/prompts config, modular imports, absolute paths for Claude Desktop

**Error Handling**: Comprehensive boundaries (all orchestration levels), structured logging (verbose/quiet modes), meaningful error messages (diagnostics), rollback mechanisms (startup failures)

**Testing**: Transport layer (STDIO/SSE), Nunjucks template rendering, hot-reloading, MCP protocol compliance, framework system validation, framework switching, state persistence

**Environment Variables**: `MCP_WORKSPACE` (base workspace directory for prompts, config, etc.), `MCP_PROMPTS_PATH` (direct path to prompts config), `MCP_CONFIG_PATH` (direct path to config.json). CLI flags take priority: `--workspace`, `--prompts`, `--config`, `--methodologies`, `--gates`

**Lifecycle Management**: For refactoring and migration work, refer to `~/.claude/REFACTORING.md` domain rules for universal lifecycle state tagging, module boundary enforcement, and deletion criteria patterns.

## Project-Specific Development Integration

### MCP-Specific Development Standards

**Project-Specific Requirements:**

- **System Architecture Analysis**: Understand MCP server structure, framework system, and execution strategies
- **Integration Point Mapping**: Components affected by changes (frameworks/, execution/, mcp-tools/, etc.)
- **Performance Impact Assessment**: Baseline metrics and performance-sensitive areas for MCP protocol
- **Client Compatibility Check**: Maintain Claude Desktop, web client, and MCP protocol compatibility

**MCP Development Focus Areas:**

- **Framework System**: Changes must work with all methodology guides
- **Hot-Reload Compatibility**: File watching and registry updates for prompt management
- **Multi-Transport Support**: Validate STDIO and SSE transport compatibility
- **Command Parsing System**: Unified parsing with symbolic operator support optimized for LLM interactions (see Command Format Specification below)

### Command Format Specification

**Command Parser** (`command-parser.ts`, ~750 lines): Multi-strategy parsing system with symbolic operator support optimized for LLM interactions

**Formats**: Simple (`>>prompt_name arguments`), JSON (`{"command": ">>prompt_name", "args": {...}}`), Key=value (`key="value"`), Single argument (text → first param), Symbolic operators (`-->`, `@`, `::`)

**Built-in Commands**: `listprompts`/`list_prompts`/`listprompt` (list prompts), `help`/`commands` (help), `status`/`health` (diagnostics), `analytics`/`metrics` (metrics)

**Resolution**: Case-insensitive, match by ID or name, no typo correction (LLMs exact), clear error messages (suggest `>>listprompts`)

**Arguments**: Auto-detect JSON (parsed directly), single arg (→ first param), key=value format, simple text (→ first arg or `input`). Type handling: LLMs send correct types, Zod validation at MCP tool level, optional `z.coerce.number()` if needed

**Template Variables**: `{{previous_message}}` (conversation history), `{{arg_name}}` (any prompt arg), framework-specific context (auto-injected)

**Symbolic Operators**: Chain operator (`-->`), Framework operator (`@`), Gate operator (`::`), integrated with session management for stateful execution

**References**: `docs/symbolic-command-language.md`, `server/src/execution/parsers/command-parser.ts`, `server/src/execution/parsers/symbolic-operator-parser.ts`

### Symbolic Command Language Development

**Symbolic Command System**: Operator-based workflow creation that eliminates template file requirements for common patterns. Five core operators provide instant workflow composition with session-aware execution.

#### Operator Development Standards

**Core Operators** (Implemented):

- **Chain Operator (`-->`)**: Sequential multi-step execution with context propagation ✅
- **Framework Operator (`@`)**: Temporary framework switching with automatic restoration ✅
- **Gate Operator (`::`)**: Inline quality validation with LLM feedback integration ✅
- **Parallel Operator (`+`)**: Reserved for future implementation 🔮
- **Conditional Operator (`?`)**: Reserved for future implementation 🔮

#### Operator Implementation Guidelines

**Parser Integration**:

- **SymbolicCommandParser**: Use existing operator detection patterns in `server/src/execution/parsers/symbolic-operator-parser.ts`
- **Precedence Handling**: Framework > Conditional > Parallel > Chain > Gate
- **Type Safety**: All operators must implement `SymbolicOperator` interface from `types/operator-types.ts`
- **Error Handling**: Comprehensive error boundaries with meaningful user messages

**Executor Pattern**:

- **Operator Executors**: Follow established pattern in `server/src/execution/operators/`
- **Session Integration**: All operators must work with `ChainSessionManager` for stateful execution
- **Framework Awareness**: Operators should respect active framework and temporary overrides
- **Gate Integration**: Quality gates must integrate with existing gate registry system

#### Development Rules for Symbolic Commands

**Operator Creation**:

- **Interface Compliance**: Implement appropriate operator interface (`ChainOperator`, `FrameworkOperator`, etc.)
- **Executor Implementation**: Create corresponding executor following established patterns
- **Test Coverage**: Unit tests for parser detection, integration tests for execution
- **Documentation**: Update operator reference and user guide with examples

**Session Management**:

- **State Persistence**: Operators must maintain session state across MCP invocations
- **Context Propagation**: Use `previous_step_output` for step-to-step data flow
- **Resume Logic**: Ensure identical command replay continues execution correctly
- **Cleanup**: Proper session cleanup on completion or timeout

**Framework Integration**:

- **Temporary Switching**: Framework operators must restore original framework after execution
- **Methodology Guides**: Use existing framework system, never hard-code framework behavior
- **State Validation**: Validate framework state before and after operations
- **Error Recovery**: Handle framework switching failures gracefully

#### Testing Requirements

**Unit Testing**:

- **Parser Detection**: Test operator pattern recognition and edge cases
- **Type Validation**: Verify operator interface compliance and type safety
- **Executor Logic**: Test individual operator execution in isolation
- **Error Scenarios**: Comprehensive error handling and recovery testing

**Integration Testing**:

- **Session Management**: Multi-step execution with resume functionality
- **Framework Switching**: Temporary override and restoration validation
- **Gate Evaluation**: Inline gate creation and validation testing
- **Complex Compositions**: Multi-operator workflow validation

**Performance Testing**:

- **Parser Performance**: <5ms overhead for operator detection
- **Execution Performance**: Framework switching <50ms, gate evaluation <500ms
- **Session Efficiency**: Minimal memory footprint for session storage
- **Concurrent Sessions**: Multiple session execution without interference

#### Documentation Standards

**Operator Reference**:

- **Syntax Specification**: Complete syntax with examples and edge cases
- **Behavior Description**: Detailed execution behavior and integration points
- **Implementation Details**: Technical reference for developers
- **Migration Guidance**: How to convert traditional chains to symbolic commands

**User Documentation**:

- **Quick Start**: Simple examples for immediate adoption
- **Advanced Patterns**: Complex composition examples and best practices
- **Troubleshooting**: Common issues and resolution strategies
- **Migration Guide**: Step-by-step conversion from template files

#### Architecture Compliance

**Domain Separation**:

- **Parser Logic**: Keep in `/execution/parsers/symbolic-operator-parser.ts`
- **Operator Executors**: Implement in `/execution/operators/` directory
- **Type Definitions**: Use existing interfaces in `/execution/parsers/types/`
- **Integration Points**: Use established patterns for framework and gate integration

**System Integration**:

- **MCP Protocol**: All operators must work within existing MCP tool structure
- **Hot-Reloading**: Operators must respect prompt registry changes
- **Transport Compatibility**: Work with both STDIO and SSE transports
- **Backward Compatibility**: Never break existing prompt/chain functionality

#### Quality Assurance

**Code Quality**:

- **TypeScript Strict**: All operator code must compile with strict settings
- **Interface Compliance**: Implement all required methods and properties
- **Error Handling**: Comprehensive error boundaries with meaningful messages
- **Performance**: Meet established performance budgets for parsing and execution

**Testing Coverage**:

- **95%+ Coverage**: Unit tests for all operator components
- **Integration Validation**: End-to-end workflow testing
- **Edge Case Handling**: Comprehensive error scenario testing
- **Performance Benchmarks**: Regular performance regression testing

**Documentation Validation**:

- **Example Accuracy**: All examples must work with current implementation
- **API Consistency**: Documentation must match actual behavior
- **Migration Completeness**: Clear guidance for converting existing workflows
- **Troubleshooting Coverage**: Common issues documented with solutions

**TypeScript & Testing Standards**: Refer to `~/.claude/JAVASCRIPT.md` domain rules for TypeScript strict mode requirements, ES module standards, Jest configuration, test strategies, and quality standards.

### MCP-Specific Code Quality Standards

#### Consolidated Tool Development Rules

- **Single Responsibility**: Each consolidated tool handles one major functional area (execution, management, system control)
- **Intelligent Filtering**: Support advanced filter syntax in prompt manager for discovery and organization
- **Response Consistency**: All tools return standardized `ToolResponse` interface with consistent error handling
- **Backwards Compatibility**: Maintain API compatibility when adding new features or filter types

#### Framework Development Rules

- **Methodology Guides**: All framework behavior must come from methodology guides, never hard-coded
- **Interface Compliance**: New methodology guides must implement all required `IMethodologyGuide` methods
- **Domain Separation**: Framework logic stays in `/frameworks`, semantic analysis in `/analysis`
- **Integration Points**: Framework integration must be explicit and documented in `/integration` directory

#### MCP Tool Development

- **Tool Registration**: All MCP tools must be registered with proper Zod schema validation
- **Error Handling**: Use the utility `handleError()` function for consistent error responses
- **Response Format**: All tool responses must use the standardized `ToolResponse` interface
- **Argument Validation**: Validate all required fields using `validateRequiredFields()` helper

### Development Workflow Standards

**Pre-Development Checklist (MANDATORY)**: System overlap check (`npm run validate:all`), architecture review (add to existing vs create new?), dependency check (`validate:circular`), single source verification

**Code Changes**: Validation first (`validate:all`), type check (`typecheck`), build verification (`build`), test validation (relevant suites), hot-reload testing (`npm run dev`)

**Consolidated Tool Changes**: Tool schema updates (Zod validation), response format (consistent `ToolResponse`), error handling (`handleError()` function), filter support (add to intelligent filtering), test coverage (ensure scenarios exist in the Jest suite via `npm run test:jest` or targeted `npx jest --runTestsByPath ...`)

**Framework System Changes**: Methodology guides = single source (never bypass), test framework switching (MCP tools), validate interface compliance (all required methods), ensure decoupled integration points

## 🚀 Enhanced Development Standards Integration

**Evidence-Based Development**: Prohibited (best|optimal|faster|secure|better|improved|enhanced|always|never|guaranteed), Required (may|could|potentially|typically|often|sometimes|measured|documented), Evidence (testing confirms|metrics show|benchmarks prove|data indicates|documentation states)

**Research & Validation**: Citations (official docs, version compatibility, sources documented), Context7 (library/MCP protocol docs lookup), WebSearch (official sources, TypeScript/Node.js patterns), workflow (research → validate → implement), MCP SDK compatibility (all changes)

**Environment & Deployment**: Dev setup (Node.js 24+, TypeScript strict, env vars: `MCP_WORKSPACE`, `MCP_PROMPTS_PATH`), transport testing (`start:stdio` Claude Desktop, `start:sse` web clients), CI/CD (cross-platform Ubuntu/Windows/macOS, evidence-based quality gates)

**Performance Budgets**: Server startup <3s, tool response <500ms, framework switching <100ms, memory <128MB

---

**Integration**: @include ~/.claude/CLAUDE.md + MCP Protocol Compliance
