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

### Working Directory

All commands should be run from the `server/` directory: `cd server && npm run build`

Examples:

- `cd server && npm run build` - Compile TypeScript
- `cd server && npm run typecheck` - Validate types only
- `cd server && npm run dev` - Development mode with file watching
- `cd server && npm test` - Run test suite

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

## Project Architecture

### Core System Structure

This is a **Model Context Protocol (MCP) server** that provides AI prompt management with hot-reloading capabilities. The architecture follows a multi-phase orchestration pattern:

1. **Foundation Phase**: Configuration loading, logging setup, core services
2. **Data Loading Phase**: Prompt loading, category parsing, validation
3. **Module Initialization Phase**: Tools, executors, conversation managers
4. **Server Launch Phase**: Transport layer, API endpoints, health monitoring

### Key Components

#### `/server/src/runtime/`

- **Application Runtime** (`application.ts`) - Main entry point with comprehensive health monitoring and graceful shutdown
- **Multi-phase startup** with dependency management and error recovery (Foundation → Data Loading → Module Initialization → Server Launch)
- **Performance monitoring** with memory usage tracking and uptime metrics
- **Startup orchestration** with strategy-based server detection

#### `/server/src/frameworks/`

- **Framework Manager** (`framework-manager.ts`) - Stateless framework orchestration, loads methodology guides and generates framework definitions
- **Framework State Manager** (`framework-state-manager.ts`) - Stateful framework management, tracks active framework and handles switching
- **Methodology Guides** (`adapters/`) - CAGEERF, ReACT, 5W1H, SCAMPER guides providing framework-specific guidance
- **Framework Integration** (`integration/`) - Integration between frameworks and semantic analysis
- **Framework Interfaces** (`interfaces/`) - Type definitions and contracts for framework system

#### `/server/src/execution/`

- **Execution Index** (`index.ts`) - Main execution orchestration and entry point
- **Context Management** (`context/`) - Context resolution and framework injection
- **Argument Parsing** (`parsers/`) - Unified command parsing and argument processing
- **Execution Types** (`types.ts`) - TypeScript interfaces for execution system

#### `/server/src/gates/`

- **Gate Definitions** (`definitions/`) - Gate definition templates and configurations
- **Core Gates** (`core/`) - Core gate validation implementations and processors
- **Gate Templates** (`templates/`) - Reusable gate template structures
- **Main Index** (`index.ts`) - Gate system entry point and orchestration

#### `/server/src/semantic/`

- **Semantic Analysis Engine** - Automatic prompt type detection and analysis capabilities
- **Integration Layer** (`integrations/`) - Framework and analysis system integration
- **Analysis Types** - Type definitions for semantic analysis operations

#### `/server/src/prompts/`

- **Template processor** using Nunjucks with advanced features (conditionals, loops, macros)
- **Prompt registry** for dynamic loading and hot-reloading
- **Converter system** for format transformation and validation
- **Hot-reload manager** - Supports dynamic prompt reloading without server restart
- **Category manager** - Manages prompt organization and categorization

#### `/server/src/mcp-tools/`

**Consolidated MCP Architecture (87.5% tool reduction: 24+ tools → 3 intelligent tools)**

- **Prompt Engine** (`prompt-engine.ts`) - Unified execution with intelligent analysis and semantic detection
- **Prompt Manager** (`prompt-manager.ts`) - Complete lifecycle management with smart filtering and analysis
- **System Control** (`system-control.ts`) - Framework management, analytics, and comprehensive system control
- **Configuration & Error Handling** (`config-utils.ts`, `error-handler.ts`) - Centralized configuration and error management
- **Advanced Filtering** (`filters/`) - Intelligent search and discovery capabilities
- **Response Formatting** (`formatters/`) - Consistent MCP response formatting
- **Validation System** (`validators/`) - Comprehensive input validation and schema checking
- **Type Definitions** (`types/`) - TypeScript interfaces for MCP tool system

#### `/server/src/performance/`

- **Performance Monitor** (`monitor.ts`) - System performance tracking and metrics collection
- **Memory Usage** - Memory monitoring and garbage collection optimization
- **Startup Optimization** - Server startup time optimization and health monitoring

#### `/server/src/metrics/`

- **Usage Analytics** - Prompt usage patterns and execution metrics
- **Performance Metrics** - System performance indicators and benchmarks
- **Health Monitoring** - Server health status and diagnostic collection

#### `/server/src/server/transport/`

- **STDIO transport** for Claude Desktop integration
- **SSE transport** for web-based clients
- **Transport-aware logging** to avoid interference with STDIO protocol
- **HTTP request processing and routing** for web-based clients
- **WebSocket handlers** for real-time communication management

### Configuration System

#### Main Configuration (`server/config.json`)

- Server settings (name, version, port)
- Transport configuration (STDIO/SSE)
- Logging configuration (directory, level)
- Prompts file reference pointing to `prompts/promptsConfig.json`

#### Prompts Configuration (`server/prompts/promptsConfig.json`)

- **Category organization** with logical grouping (18 categories including analysis, development, research, content_processing)
- **Modular import system** using category-specific `prompts.json` files in `prompts/[category]/` directories
- **Registration modes** (ID, NAME, or BOTH) with default NAME registration
- **Dynamic imports** - categories are loaded from individual JSON files in subdirectories

### Prompt Organization

#### File Structure

```
server/prompts/
├── category-name/
│   ├── prompts.json          # Category prompt registry
│   ├── prompt-name.md        # Individual prompt files
│   └── ...
└── promptsConfig.json        # Main configuration
```

#### Prompt Format

- **Markdown files** with structured sections
- **Nunjucks templating** with `{{variable}}` syntax
- **Argument definitions** with type information and validation
- **Category association** for organization

### TypeScript Architecture

#### Core Types (`src/types.ts`)

- **Config interfaces** for application configuration
- **PromptData** for prompt metadata and structure
- **Message types** for conversation handling
- **Transport types** for protocol abstraction

#### Key Interfaces

- `PromptData`: Complete prompt structure with metadata, arguments, and configuration
- `PromptArgument`: Typed argument definitions with validation
- `Category`: Prompt organization and categorization
- `MessageContent`: Extensible content type system

### Framework System Architecture

#### Methodology-Driven Design

The core architecture is built around **methodology guides** that provide systematic approaches to prompt creation, processing, and execution. This replaces hard-coded framework logic with flexible, guideline-based behavior.

#### Framework Components

##### Framework Manager (Stateless Orchestration)

- **Location**: `/server/src/frameworks/framework-manager.ts`
- **Purpose**: Loads methodology guides and dynamically generates framework definitions
- **Key Functions**:
  - Initializes methodology guides (CAGEERF, ReACT, 5W1H, SCAMPER)
  - Generates framework definitions from guide metadata
  - Creates execution contexts with framework-specific system prompts
  - Provides framework selection based on criteria

##### Framework State Manager (Stateful Management)

- **Location**: `/server/src/frameworks/framework-state-manager.ts`
- **Purpose**: Tracks active framework state and handles switching
- **Key Functions**:
  - Maintains current active framework (default: CAGEERF)
  - Manages framework switching with validation and history
  - Provides health monitoring and performance metrics
  - Emits framework change events for system coordination

##### Methodology Guides

- **Location**: `/server/src/frameworks/adapters/`
- **Purpose**: Single source of truth for framework behavior
- **Available Frameworks**:
  - **CAGEERF**: Comprehensive structured approach (Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework)
  - **ReACT**: Reasoning and Acting pattern for systematic problem-solving
  - **5W1H**: Who, What, When, Where, Why, How systematic analysis
  - **SCAMPER**: Creative problem-solving (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)

#### Framework Guide Interface

Each methodology guide implements `IMethodologyGuide` with these capabilities:

- **Prompt Creation Guidance**: Structure suggestions, argument recommendations, quality guidance
- **Template Processing**: Framework-specific processing steps and enhancements
- **Execution Steps**: Step-by-step guidance for applying the methodology
- **Methodology Enhancement**: Quality gates and validation criteria
- **Compliance Validation**: Checks prompt compliance with methodology principles

#### Framework Selection & Switching

- **Dynamic Selection**: Frameworks can be selected based on prompt complexity, execution type, and user preference
- **Runtime Switching**: Active framework can be changed via MCP tools (`switch_framework`)
- **State Persistence**: Framework state maintained across sessions with history tracking
- **Performance Monitoring**: Tracks framework switching success rates and response times

#### Integration Points

##### Semantic Analysis Integration

- **Location**: `/server/src/frameworks/integration/framework-semantic-integration.ts`
- **Purpose**: Coordinates semantic analysis results with framework selection
- **Key Features**:
  - Uses semantic analysis to inform framework selection
  - Provides framework-specific execution contexts
  - Maintains separation between analysis (WHAT) and methodology (HOW)

##### Framework-Aware Gates

- **Location**: `/server/src/gates/integration/framework-aware-gates.ts`
- **Purpose**: Gate validation that adapts to active framework
- **Key Features**:
  - Framework-specific validation criteria
  - Methodology-aware quality gates
  - Adaptive gate evaluation based on framework context

##### Framework Injection

- **Location**: `/server/src/execution/processor/framework-injector.ts`
- **Purpose**: Injects framework-specific guidance into execution context
- **Key Features**:
  - Dynamic system prompt generation from methodology guides
  - Framework-enhanced template processing
  - Execution context augmentation with methodology guidance

### Execution Strategy Architecture

#### Strategy Pattern Implementation

The system uses the strategy pattern to handle different types of prompt execution:

##### Execution Engine

- **Location**: `/server/src/execution/engine.ts`
- **Purpose**: Orchestrates execution using appropriate strategy
- **Key Functions**:
  - Strategy selection based on execution mode (prompt/chain/workflow)
  - Context management across execution phases
  - Error handling and recovery
  - Performance monitoring and logging

##### Execution Strategies

- **Location**: `/server/src/execution/strategies/`
- **Available Strategies**:
  - **Prompt Strategy**: Single prompt execution with framework injection
  - **Chain Strategy**: Sequential multi-step prompt execution with state management
  - **Workflow Strategy**: Complex workflow execution with gate validation and branching logic

#### Template Processing Pipeline

1. **Template Loading**: Nunjucks template loaded from prompt definition
2. **Framework Injection**: Active methodology guide provides system prompt enhancements
3. **Variable Substitution**: User arguments processed through template
4. **Context Enhancement**: Framework-specific context added to execution
5. **Execution**: Strategy-appropriate execution with monitoring

#### Conversation Management

- **Location**: `/server/src/execution/conversation.ts`
- **Purpose**: Manages conversation state across execution strategies
- **Key Features**:
  - Message history tracking
  - Context preservation between steps
  - Framework-aware conversation enhancement
  - State persistence for long-running workflows

### Development Patterns

#### Hot-Reloading System

- **File watching** for prompt changes
- **Registry updates** without server restart
- **Template recompilation** on modification
- **MCP client notification** of changes

#### Error Handling

- **Comprehensive error boundaries** at all levels
- **Graceful degradation** for partial failures
- **Health monitoring** with periodic validation
- **Rollback mechanisms** for startup failures

#### Template Processing

- **Nunjucks engine** with full feature support
- **Dynamic variable substitution** from arguments
- **Conditional logic** and loops in templates
- **Macro system** for reusable components

### MCP Integration

#### Protocol Implementation

- **Model Context Protocol SDK** integration
- **Tool registration** for prompt management
- **Conversation management** with state tracking
- **Transport abstraction** for multiple client types

#### Available MCP Tools (User Interface)

The server exposes 3 consolidated MCP tools that users interact with:

- **`prompt_engine`** - Execute prompts with intelligent analysis and semantic detection
- **`prompt_manager`** - Create, update, delete, and manage prompts with smart filtering
- **`system_control`** - Framework switching, analytics, health monitoring, and system management

#### Client Compatibility

- **Claude Desktop** via STDIO transport
- **Cursor Windsurf** via STDIO transport
- **Web clients** via SSE transport
- **Custom MCP clients** via standard protocol

### Performance Considerations

#### Startup Optimization

- **Strategy-based server detection** with early termination
- **Environment variable bypass** for instant path detection
- **Conditional logging** based on verbosity level
- **Dependency management** with proper initialization order

#### Runtime Performance

- **Memory usage monitoring** with periodic reporting
- **Health check validation** every 30 seconds
- **Diagnostic collection** for troubleshooting
- **Graceful shutdown** with resource cleanup

### Enhanced Systems

#### Framework System Integration

- **Methodology-driven architecture** with CAGEERF, ReACT, 5W1H, SCAMPER framework guides
- **Dynamic framework switching** with runtime state management and performance monitoring
- **Framework-aware quality gates** that adapt validation criteria based on active methodology
- **Semantic analysis integration** for intelligent framework selection
- **Framework injection system** for methodology-specific system prompt enhancement

#### Execution Strategy System

- **Strategy pattern implementation** with prompt, chain, and workflow execution strategies
- **Execution engine orchestration** with context management and error recovery
- **Template processing pipeline** with framework injection and Nunjucks template processing
- **Conversation state management** with framework-aware conversation enhancement

#### Gate Validation System

- **Gate Registry** manages validation rules and quality gates with framework awareness
- **Enhanced Gate Evaluators** with intelligent workflow validation and methodology-specific criteria
- **Framework-aware gates** that adapt validation based on active framework context
- **Multi-level validation** supporting validation, approval, condition, and quality gate types

#### Advanced Analysis System

- **Semantic Analyzer** for automatic prompt type detection and execution strategy recommendation
- **Framework-semantic integration** coordinating analysis results with methodology selection
- **Execution type detection** (prompt/chain/workflow) with framework-appropriate handling
- **Quality assessment** with framework-specific validation criteria

### Key Development Guidelines

#### **CRITICAL: System Consolidation & Anti-Proliferation Rules**

##### Single Source of Truth Principle

- **Each functional area MUST have exactly ONE primary implementation**
- **Before adding ANY new system, explicitly identify and remove/deprecate the old system**
- **Multiple systems serving the same purpose are FORBIDDEN** - leads to confusion and circular dependencies
- **Example Resolved**: ExecutionEngine and EnhancedPromptExecutionStrategy removed - ExecutionCoordinator with UnifiedPromptProcessor is the unified solution

##### Deprecation Before Addition Protocol

- **NEVER add new systems without explicit deprecation of old ones**
- **Required steps when creating new systems**:
  1. Document what existing system it replaces in the PR/commit message
  2. Add deprecation warnings to old system files
  3. Create migration guide in CLAUDE.md
  4. Set timeline for old system removal (typically 1-2 sprints)
  5. Actually remove the old system - do not leave both

##### Dependency Direction Enforcement

- **Establish clear architectural hierarchy** - lower layers cannot import from higher layers
- **Bidirectional imports are STRICTLY FORBIDDEN**
- **Example Fix Required**: `execution-coordinator.ts` ↔ `strategies/index.ts` circular import must be broken
- **Use dependency injection or event patterns** instead of circular imports

##### Consolidation Over Addition Policy

- **Strong preference for enhancing existing systems vs creating new ones**
- **Question before coding**: "Can this functionality be added to an existing system?"
- **Require architectural justification** for creating parallel systems
- **Code reviews must verify no duplicate functionality is being introduced**

#### Framework Development Rules

##### Methodology Guides as Single Source of Truth

- **Never hard-code framework behavior** - All framework logic must come from methodology guides
- **Methodology guides define framework identity** - `frameworkId`, `frameworkName`, `methodology` in guides
- **Dynamic framework generation** - Framework definitions generated from guide metadata, not static configuration
- **Guide-driven enhancements** - All framework-specific behavior (system prompts, quality gates, validation) comes from guide methods

##### Domain Cohesion Principles

- **Framework logic belongs in `/frameworks`** - Keep all framework-related logic centralized
- **Separate stateless from stateful** - Framework manager (stateless orchestration) separate from state manager (stateful tracking)
- **Clear separation of concerns** - Analysis (WHAT the prompt needs) separate from methodology (HOW to approach it)
- **Integration points are explicit** - Framework integration clearly defined in `/integration` directory

##### Methodology Guide Development

- **Implement `IMethodologyGuide` interface** - All guides must follow the established contract
- **Provide comprehensive guidance** - Implement all required methods: `guidePromptCreation`, `guideTemplateProcessing`, `guideExecutionSteps`, `enhanceWithMethodology`, `validateMethodologyCompliance`
- **Framework-specific quality gates** - Each guide defines its own validation criteria and quality gates
- **Template enhancement suggestions** - Guides provide specific suggestions for improving prompts
- **Methodology validation** - Guides can validate prompt compliance with their methodology principles

##### Framework Integration Standards

- **No direct framework coupling** - Other systems integrate through framework manager, not directly with guides
- **Event-driven communication** - Framework state changes communicated through events
- **Semantic analysis coordination** - Framework selection informed by, but not dependent on, semantic analysis
- **Gate system integration** - Gates adapt to active framework but remain framework-agnostic in core logic

#### System Migration & Deprecation Guidelines

##### Deprecation Protocol (MANDATORY)

When deprecating any system or component:

1. **Add deprecation warnings** to the file header with replacement system name
2. **Update all import statements** to use new system
3. **Create migration script** if data/config changes are needed
4. **Document breaking changes** in CHANGELOG.md and PR description
5. **Set removal timeline** (usually 2-4 weeks for internal systems)
6. Offer a **optional** separate phase to the user for complete removal

#### Configuration Management

- Use environment variables for path overrides (`MCP_SERVER_ROOT`, `MCP_PROMPTS_CONFIG_PATH`)
- Maintain separation between server config and prompts config
- Follow modular import patterns for prompt organization
- Configure absolute paths for reliable Claude Desktop integration

#### Prompt Development

- Use Nunjucks templating for dynamic content with full feature support
- Define clear argument structures with validation
- Organize prompts by logical categories (18 predefined categories available)
- Test templates with various input scenarios
- Follow active framework methodology for systematic prompt quality

#### Error Handling

- Implement comprehensive error boundaries at all orchestration levels
- Use structured logging with appropriate levels (supports both verbose and quiet modes)
- Provide meaningful error messages with diagnostic information
- Include rollback mechanisms for startup failures

#### Testing

- Test transport layer compatibility (STDIO and SSE)
- Validate prompt template rendering with Nunjucks engine
- Check hot-reloading functionality and workflow engine integration
- Verify MCP protocol compliance and framework system validation
- Test framework switching functionality and state persistence

### Environment Setup

#### Required Environment Variables

- `MCP_SERVER_ROOT`: Override server root directory detection (recommended for Claude Desktop)
- `MCP_PROMPTS_CONFIG_PATH`: Direct path to prompts configuration file (bypasses server root detection)

#### Development Environment

- Node.js 16+ required (specified in package.json engines)
- TypeScript compilation with `tsc`
- File watching for hot-reloading via `npm run dev`
- Transport-specific testing modes (STDIO for desktop clients, SSE for web)

#### Performance Optimization

- Use environment variables for fastest startup (bypasses directory detection strategies)
- Configure absolute paths in Claude Desktop for reliable integration
- Enable verbose mode (`--verbose`) for detailed diagnostic information during development

This architecture provides a robust, scalable system for AI prompt management with enterprise-grade features including methodology-driven framework selection, execution strategy patterns, hot-reloading, comprehensive error handling, and multi-transport support.

## Project-Specific Development Integration

### MCP-Specific Development Standards

**Project-Specific Requirements:**

- **System Architecture Analysis**: Understand MCP server structure, framework system, and execution strategies
- **Integration Point Mapping**: Components affected by changes (frameworks/, execution/, mcp-tools/, etc.)
- **Performance Impact Assessment**: Baseline metrics and performance-sensitive areas for MCP protocol
- **Client Compatibility Check**: Maintain Claude Desktop, web client, and MCP protocol compatibility

**MCP Development Focus Areas:**

- **Framework System**: Changes must work with all 4 methodology guides (CAGEERF, ReACT, 5W1H, SCAMPER)
- **Hot-Reload Compatibility**: File watching and registry updates for prompt management
- **Multi-Transport Support**: Validate STDIO and SSE transport compatibility
- **Tool Consolidation**: Maintain 87.5% reduction (24+ → 3 intelligent tools)

## Coding Guidelines and Development Rules

### Enhanced Search System Implementation

The system now includes advanced search capabilities implemented in `consolidated-prompt-manager.ts`:

#### Search Filter Syntax

- **Category Filtering**: `category:code`, `category:analysis`, `category:research`
- **Intent-Based Discovery**: `intent:debugging`, `intent:analysis`, `intent:research`
- **Execution Type Filtering**: `type:prompt`, `type:template`, `type:chain`, `type:workflow`
- **Confidence-Based Filtering**: `confidence:>80`, `confidence:<100`, `confidence:70-90`
- **Quality Gate Filtering**: `gates:yes`, `gates:no`
- **Execution Requirements**: `execution:required`, `execution:optional`
- **Text Search**: Supports fuzzy matching and partial word matching
- **Combined Filters**: Multiple filters can be combined: `category:code type:workflow confidence:>80`

#### Search Implementation Rules

- **Fuzzy Text Matching**: Searches support partial word matching and multiple search terms
- **Intent-Based Matching**: Maps user intents to relevant prompts using semantic analysis
- **Category-Aware Results**: Results are organized by category with proper filtering
- **LLM-Optimized Output**: Results include usage examples, confidence indicators, and actionable descriptions

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

**Essential Commands:**
- `npm run test:ci` - Complete test suite (unit + integration + performance)
- `npm run test:all-enhanced` - Enhanced framework and MCP validation
- `npm run validate:all` - Core validation (dependencies + circular) - **architectural layer validation temporarily disabled during rework**
- `npm run validate:all-with-architecture` - Full validation including architectural layer checks (use when needed)
- `npm run test:ci-startup` - Server startup validation

**Development Commands:**
- `npm run test:watch` - Continuous testing | `npm run test:coverage` - Coverage reports
- `npm run test:consolidated-tools` - MCP tools validation | `npm run test:methodology-guides` - Framework validation

**Quality Standards:**
- **Jest Configuration**: ES modules, 30s timeout, single worker, `tests/setup.ts`
- **Validation Integration**: Global Rules quality gates with evidence-based criteria
- **Architecture Compliance**: Single source of truth principle enforcement

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

#### Pre-Development Checklist (MANDATORY)

Before starting any feature or system:

1. **System Overlap Check**: Run `npm run validate:all` to detect existing systems
2. **Architecture Review**: Can this be added to an existing system instead of creating new one?
3. **Dependency Check**: Will this create circular dependencies? Use `npm run validate:circular`
4. **Single Source Verification**: Does this violate "one system per function" rule?

#### Code Changes

- **System Validation First**: Run `npm run validate:all` before committing
- **Type Check**: Always run `npm run typecheck` before committing
- **Build Verification**: Run `npm run build` to ensure compilation succeeds
- **Test Validation**: Run relevant test suites for changed components
- **Hot-Reload Testing**: Verify changes work with `npm run dev` and hot-reloading

#### Consolidated Tool Changes

When modifying the consolidated MCP tools:

1. **Tool Schema Updates**: Update Zod schema validation for new parameters or options
2. **Response Format**: Maintain consistent `ToolResponse` interface across all tools
3. **Error Handling**: Use standardized `handleError()` function for consistent error responses
4. **Filter Support**: Add new filter types to intelligent filtering system in prompt manager
5. **Test Coverage**: Verify changes work with relevant test suites (`npm run test:mcp-tools`)

#### Framework System Changes

When modifying framework components:

1. **Methodology guides are single source of truth** - never bypass guide methods
2. **Test framework switching** using MCP tools after changes
3. **Validate guide interface compliance** with all required methods
4. **Ensure integration points remain decoupled** from direct guide access

## 🚀 Enhanced Development Standards Integration

### Evidence-Based Development Protocol

**Required Language Standards** (from Global Rules):
- **Prohibited**: "best|optimal|faster|secure|better|improved|enhanced|always|never|guaranteed"
- **Required**: "may|could|potentially|typically|often|sometimes|measured|documented"
- **Evidence**: "testing confirms|metrics show|benchmarks prove|data indicates|documentation states"

**Research & Validation Standards**:
- **Citations**: Official documentation required | Version compatibility verified | Sources documented
- **Context7 Integration**: External libraries and documentation lookup for MCP protocol compliance
- **WebSearch**: Official sources and current information for TypeScript/Node.js patterns
- **Evidence before implementation**: Research → validate → implement (Global Rules workflow)

### Quality Gates & Progressive Validation

**Critical Thinking Standards** (from Global Rules):
- **Critical** → Block | **High** → Warn | **Medium** → Advise | **Low** → Note
- **Evidence-based assessment**: Claims require supporting data from benchmarks
- **Challenge assumptions**: Question MCP protocol conventional wisdom respectfully
- **Alternative approaches**: Consider multiple framework switching solutions before choosing

**MCP-Specific Quality Gates**:
- **Protocol Compliance**: All changes must maintain MCP SDK compatibility
- **Transport Compatibility**: Changes validated against both STDIO and SSE transports
- **Hot-Reload Integrity**: Registry synchronization verified after modifications
- **Framework System**: Methodology guide compliance validated for all framework changes

### Session Management & Task Intelligence

**Auto-Detection Triggers**: High complexity (multi-file changes) → TodoWrite | Medium (single-file) → brief tracking | Simple (edits) → direct execution
**MCP Workflow**: Single in_progress task | Immediate TodoWrite updates | Framework state preservation across hot-reload

### Environment & Deployment

**Development Setup**: Node.js 16+ | TypeScript strict mode | Environment variables: `MCP_SERVER_ROOT`, `MCP_PROMPTS_CONFIG_PATH`
**Transport Testing**: `npm run start:stdio` (Claude Desktop) | `npm run start:sse` (web clients)
**CI/CD**: Cross-platform testing (Ubuntu/Windows/macOS, Node 16/18/20) | Quality gates with evidence-based validation

### Development Workflow Standards

#### Pre-Development Checklist (MANDATORY)
1. **System Validation**: `npm run validate:all` → `npm run test:ci-startup`
2. **Framework Review**: Document current state, plan methodology guide optimizations
3. **Performance Baseline**: `npm run build && time npm run start:test`

#### During Development Quality Gates
**After significant changes (>50 lines)**: `npm run typecheck && npm run test:ci`
**MCP Protocol Compliance**: `npm run test:consolidated-tools && npm run test:methodology-guides`

#### Completion Checklist
**Before marking work complete**: `npm run typecheck && npm run test:ci && npm run validate:all && npm run test:all-enhanced`

#### Performance Budgets
- Server startup: <3s | Tool response: <500ms | Framework switching: <100ms | Memory: <256MB

## 🎯 MCP-Specific Enhanced Development Integration

### Domain Rule Auto-Detection & Integration

**Intelligent Context Detection:**
- **Project Detection**: Node.js TypeScript MCP Server → Auto-loads JAVASCRIPT.md domain rules
- **Framework Context**: MCP SDK integration → Applies protocol-specific patterns from domain rules
- **Critical Dependencies**: Framework system, semantic analysis, transport layer → Extra validation
- **Performance Baselines**: MCP protocol response times, framework switching speed → Benchmark tracking

### Context Engineering Architecture (MCP)

**MCP Protocol Context Sources:**
- **Framework System Documentation**: `/src/frameworks/` methodology guide implementations
- **Transport Layer Context**: STDIO vs SSE transport compatibility requirements
- **Critical Dependencies**: Hot-reload manager, prompt registry, MCP tool consolidation
- **Performance Baselines**: Server startup time, tool response latency, framework switching speed
- **Integration Points**: Claude Desktop, web clients, custom MCP client compatibility

### Enhanced Multi-Agent Development Coordination (MCP)

**MCP Development Coordination Structure:**
```
mcp-server-root/
├── CLAUDE.md                           # This file - MCP-specific development guide with global integration
├── plans/                              # Development coordination center
│   ├── mcp-server-status.md           # MCP server health, protocol compliance, transport status
│   ├── framework-coordination.md      # Multi-methodology guide status and switching coordination
│   ├── mcp-dependencies.md            # MCP SDK dependencies and protocol compatibility mapping
│   └── architecture-decisions.md      # MCP-specific technical decisions and rationale
```

### MCP Session Protocol

**Session Start**: Review `plans/mcp-server-status.md` | Check framework health | Verify transport functionality
**During Development**: Track MCP tool changes | Document protocol decisions | Monitor performance
**Session End**: Update completion status | Consolidate protocol knowledge | Setup next priorities

### Context Discovery Protocol (MCP-Enhanced)

**MCP-Specific Context Extensions:**
- **MCP Protocol Architecture**: Document location of MCP SDK integration and transport implementations
- **Framework Context**: Methodology guide context sources and framework switching patterns
- **Critical Dependencies**: MCP tools requiring extra validation due to protocol coupling
- **Performance Baselines**: MCP protocol-sensitive areas requiring transport layer benchmarking
- **Integration Points**: Claude Desktop, web clients, and custom MCP client compatibility requirements

### Development Guidelines (MCP Integration)

**MCP-Specific Guidelines:**
- **Protocol-First Analysis**: Complete systematic MCP protocol discovery before implementation
- **Direct MCP Integration**: Solve MCP protocol problems directly, coordinate with transport systems
- **Framework-Friendly Code**: Clear methodology guide naming, minimal abstraction, maintainable patterns
- **Protocol-Aware Changes**: Use MCP SDK dependency analysis to prevent transport layer breaking changes

**MCP Performance Standards**: Environment variables for fast startup | Absolute paths for Claude Desktop | Framework monitoring | Registry sync optimization

---

**CLAUDE.md Version**: 2.1.0 - Consolidated Global Rules Integration
**Last Updated**: 2025-09-27
**Integration**: @include ~/.claude/CLAUDE.md + MCP Protocol Compliance
