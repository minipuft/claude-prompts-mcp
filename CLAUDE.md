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
- **Test**: `npm test` - Runs the test server using `../test_server.js`

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

- [MCP Tool Usage Guide](./docs/mcp-tool-usage-guide.md) - Complete tool documentation
- [Chain Modification Examples](./docs/chain-modification-examples.md) - Step-by-step workflows

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
- **adapters/**: Methodology guide implementations | **integration/**: Framework-semantic analysis bridge | **interfaces/**: Type definitions

#### `/server/src/execution/`
- **index.ts**: Execution orchestration | **context/**: Context resolution, framework injection | **routing/**: Lightweight command routing (149 lines, replaced 1,354-line legacy system, 84% reduction)
- **execution-context.ts**: Type definitions | **parsers/**: Legacy compatibility (deprecated)

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

**server/config.json**: Server settings, transport config (STDIO/SSE), logging, prompts reference
**prompts/promptsConfig.json**: 18 categories (analysis, development, research, etc.), modular imports via `prompts/[category]/prompts.json`, registration modes (ID, NAME, BOTH)

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
**Methodology Guides** (`adapters/`): Single source of truth for framework behavior

**IMethodologyGuide Interface**: Prompt creation guidance (structure/arguments/quality), template processing (framework-specific steps), execution steps (methodology application), methodology enhancement (quality gates/validation), compliance validation

**Framework Selection & Switching**: Dynamic selection (complexity/execution type/preference), runtime switching via MCP tools (`switch_framework`), state persistence (cross-session history), performance monitoring

**Integration Points**:
- **Semantic Analysis** (`framework-semantic-integration.ts`): Coordinates analysis results with framework selection, maintains WHAT vs HOW separation
- **Framework-Aware Gates** (`framework-aware-gates.ts`): Adaptive gate validation with framework-specific criteria
- **Framework Injection** (`framework-injector.ts`): Dynamic system prompt generation from methodology guides, framework-enhanced template processing

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

**Configuration**: Env vars for path overrides (`MCP_SERVER_ROOT`, `MCP_PROMPTS_CONFIG_PATH`), separate server/prompts config, modular imports, absolute paths for Claude Desktop

**Error Handling**: Comprehensive boundaries (all orchestration levels), structured logging (verbose/quiet modes), meaningful error messages (diagnostics), rollback mechanisms (startup failures)

**Testing**: Transport layer (STDIO/SSE), Nunjucks template rendering, hot-reloading, MCP protocol compliance, framework system validation, framework switching, state persistence

**Environment Variables**: `MCP_SERVER_ROOT` (override server root, recommended for Claude Desktop), `MCP_PROMPTS_CONFIG_PATH` (direct path to prompts config, bypasses root detection)

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
- **Command Routing System**: Lightweight routing optimized for LLM interactions (see Command Format Specification below)

### Command Format Specification

**CommandRouter** (149 lines, replaced 1,354-line legacy system, 84% reduction): Simplified router optimized for LLM interactions

**Formats**: Simple (`>>prompt_name arguments`), JSON (`{"command": ">>prompt_name", "args": {...}}`), Key=value (`key="value"`), Single argument (text → first param)

**Built-in Commands**: `listprompts`/`list_prompts`/`listprompt` (list prompts), `help`/`commands` (help), `status`/`health` (diagnostics), `analytics`/`metrics` (metrics)

**Resolution**: Case-insensitive, match by ID or name, no typo correction (LLMs exact), clear error messages (suggest `>>listprompts`)

**Arguments**: Auto-detect JSON (parsed directly), single arg (→ first param), key=value format, simple text (→ first arg or `input`). Type handling: LLMs send correct types, Zod validation at MCP tool level, optional `z.coerce.number()` if needed

**Template Variables**: `{{previous_message}}` (conversation history), `{{arg_name}}` (any prompt arg), framework-specific context (auto-injected)

**Removed Features** (LLM-optimized): Typo correction, type coercion, smart content mapping, content-aware inference, env var defaults

**References**: `docs/parser-migration-guide.md`, `plans/parser-simplification-refactor.md`, `server/src/execution/routing/command-router.ts`

## Coding Guidelines and Development Rules

### Enhanced Search System Implementation

**Advanced search** (`consolidated-prompt-manager.ts`): Category (`category:code`), intent (`intent:debugging`), type (`type:chain`), confidence (`confidence:>80`, `confidence:70-90`), gates (`gates:yes`), execution (`execution:required`), text (fuzzy/partial word), combined filters (`category:code type:workflow confidence:>80`)

**Features**: Fuzzy text matching (partial words, multiple terms), intent-based matching (semantic analysis), category-aware results, LLM-optimized output (usage examples, confidence indicators, actionable descriptions)

### TypeScript Development Standards

#### Type Safety Requirements

- **Strict TypeScript**: All code must compile with strict TypeScript settings
- **Explicit Typing**: Avoid `any` types - use proper interfaces and generic types
- **Parameter Typing**: Always provide explicit types for function parameters, especially in callbacks and array methods
- **Interface Implementation**: All framework guides must implement `IMethodologyGuide` interface completely

#### ES Module Standards

- **ES Module Syntax**: Use `import`/`export` syntax, not CommonJS `require()`
- **File Extensions**: Import paths must include `.js` extension (TypeScript compiles to `.js`)
- **Module Resolution**: Follow the moduleNameMapper in jest.config.cjs for consistent resolution

### Testing Standards

#### Testing & Validation Commands

**Essential**: `npm run test:ci` (complete suite), `test:all-enhanced` (framework/MCP validation), `validate:all` (dependencies/circular), `test:ci-startup` (server startup)

**Performance**: `test:performance-memory` (GC profiling), `test:establish-baselines` (benchmarking baselines), Node scripts (comprehensive metrics), integration Test 6 (parsing performance)

**Deprecated**: ❌ `test:performance` (Jest tests for legacy architecture) → Use Node scripts

**Quality Standards**: Jest config (ES modules, 30s timeout, single worker, `tests/setup.ts`), Global Rules integration (evidence-based criteria), architecture compliance (single source of truth)

#### Hybrid Testing Strategy

**Node.js Scripts** (`tests/scripts/*.js`, 3,665 lines, 13 scripts): Integration/E2E/performance/lifecycle/MCP protocol tests | Tests compiled `dist/` code (production environment) | No transformation layer (real ES modules) | Simple Node.js + imports | Examples: `integration-mcp-tools.js`, `integration-server-startup.js`

**Jest Unit Tests** (`tests/unit/*.test.ts`, 2,411 lines, 13 files): Pure unit tests (formatters, parsers, utilities) | Better assertions, mocking, coverage metrics, parallel execution | Limitations: Jest transforms TS→CommonJS, `import.meta.url` needs eval workaround, can't test `dist/` imports | Examples: `response-formatter.test.ts`, `semantic-analyzer-three-tier.test.ts`

**Use Node.js for**: Server startup/lifecycle, MCP protocol, real module interactions, performance benchmarks
**Use Jest for**: Pure logic (no imports), formatters/utilities, complex mocking

**Jest ES Module Fix** (`jsonUtils.ts`): Lazy initialization with `eval('import.meta.url')` prevents Jest parse-time errors while supporting production ES modules

**Running**: `npm run test:integration` (Node.js), `npx jest` (Jest unit), `npm run test:ci` (complete), `node tests/scripts/[name].js` (specific Node.js), `npx jest tests/unit/[name].test.ts` (specific Jest)

### Code Quality Standards

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

**Consolidated Tool Changes**: Tool schema updates (Zod validation), response format (consistent `ToolResponse`), error handling (`handleError()` function), filter support (add to intelligent filtering), test coverage (`test:mcp-tools`)

**Framework System Changes**: Methodology guides = single source (never bypass), test framework switching (MCP tools), validate interface compliance (all required methods), ensure decoupled integration points

## 🚀 Enhanced Development Standards Integration

**Evidence-Based Development**: Prohibited (best|optimal|faster|secure|better|improved|enhanced|always|never|guaranteed), Required (may|could|potentially|typically|often|sometimes|measured|documented), Evidence (testing confirms|metrics show|benchmarks prove|data indicates|documentation states)

**Research & Validation**: Citations (official docs, version compatibility, sources documented), Context7 (library/MCP protocol docs lookup), WebSearch (official sources, TypeScript/Node.js patterns), workflow (research → validate → implement), MCP SDK compatibility (all changes)

**Environment & Deployment**: Dev setup (Node.js 16+, TypeScript strict, env vars: `MCP_SERVER_ROOT`, `MCP_PROMPTS_CONFIG_PATH`), transport testing (`start:stdio` Claude Desktop, `start:sse` web clients), CI/CD (cross-platform Ubuntu/Windows/macOS, Node 16/18/20, evidence-based quality gates)

**Performance Budgets**: Server startup <3s, tool response <500ms, framework switching <100ms, memory <128MB

---

**Integration**: @include ~/.claude/CLAUDE.md + MCP Protocol Compliance
