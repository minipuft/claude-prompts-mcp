# Claude Prompts MCP - SuperClaude Integration

## Global SuperClaude Architecture Integration

This project inherits and extends the global SuperClaude configuration:

### Core Foundation
@include ~/.claude/CLAUDE.md#Core_Philosophy
@include ~/.claude/CLAUDE.md#Advanced_Token_Economy
@include ~/.claude/CLAUDE.md#Code_Economy
@include ~/.claude/CLAUDE.md#Performance_Standards
@include ~/.claude/CLAUDE.md#Task_Management
@include ~/.claude/CLAUDE.md#Output_Organization

### Enhanced Capabilities
@include ~/.claude/CLAUDE.md#Cognitive_Archetypes
@include ~/.claude/CLAUDE.md#MCP_Integration
@include ~/.claude/CLAUDE.md#Context_Engineering_Architecture
@include ~/.claude/context-engineering/COGNITIVE-ARCHITECTURE.yaml#Neural_Integration
@include ~/.claude/neural-init-command.sh#Neural_Workbench_Integration

### Development Framework & Methodology
@include ~/.claude/CLAUDE.md#C.A.G.E.E.R.F_Framework_Integration
@include ~/.claude/Coding_Agent.md#Enhanced_Context_Phase
@include ~/.claude/Coding_Agent.md#Context_Informed_Architecture
@include ~/.claude/VALIDATION-CHECKPOINT-SYSTEM.md#Validation_Protocols
@include ~/.claude/USER-FLOW-CONTEXTUAL-EDIT-EXAMPLES.md#Contextual_Edit_Mapping
@include /home/minipuft/Applications/CLAUDE.md#Enhanced_Development_Methodology

### Standards & Guidelines
@include ~/.claude/DEVELOPER-NAMING-GUIDE.md#Practical_Naming_Guidelines
@include ~/.claude/DIRECT-INTEGRATION-GUIDE.md#Direct_Integration_Philosophy
@include ~/.claude/CLAUDE.md#Development_Practices
@include ~/.claude/CLAUDE.md#Security_Standards

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
- **Execution Engine** (`engine.ts`) - Strategy pattern-based execution orchestration
- **Conversation Manager** (`conversation.ts`) - Handles conversation state and context management
- **Execution Strategies** (`strategies/`) - Prompt, chain, and workflow execution strategies
- **Template Processor** (`processor/`) - Framework injection and template processing with Nunjucks
- **Framework Injector** (`processor/framework-injector.ts`) - Injects framework-specific system prompts

#### `/server/src/gates/`
- **Gate Registry** (`registry/`) - Manages validation rules and quality gates
- **Gate Evaluators** (`evaluators/`) - Enhanced gate evaluation with framework awareness
- **Gate Integration** (`integration/`) - Framework-aware gate validation
- **Gate Validation** (`validation/`) - Core gate validation logic

#### `/server/src/analysis/`
- **Semantic Analyzer** (`semantic-analyzer.ts`) - Automatic prompt type detection and analysis
- **Framework integration** - Provides analysis to inform framework selection

#### `/server/src/prompts/`
- **Template processor** using Nunjucks with advanced features (conditionals, loops, macros)
- **Prompt registry** for dynamic loading and hot-reloading
- **Converter system** for format transformation and validation
- **Hot-reload manager** - Supports dynamic prompt reloading without server restart
- **Category manager** - Manages prompt organization and categorization

#### `/server/src/mcp-tools/`
**Consolidated MCP Architecture (87.5% tool reduction: 24+ tools → 3 intelligent tools)**
- **Consolidated Prompt Engine** (`consolidated-prompt-engine.ts`) - Unified execution with intelligent analysis and semantic detection
- **Consolidated Prompt Manager** (`consolidated-prompt-manager.ts`) - Complete lifecycle management with smart filtering and analysis  
- **Consolidated System Control** (`consolidated-system-control.ts`) - Framework management, analytics, and comprehensive system control
- **Legacy tool files removed**: ~2,100+ lines of legacy code eliminated for improved maintainability

#### `/server/src/transport/`
- **STDIO transport** for Claude Desktop integration
- **SSE transport** for web-based clients
- **Transport-aware logging** to avoid interference with STDIO protocol

### Configuration System

#### Main Configuration (`server/config.json`)
- Server settings (name, version, port)
- Transport configuration (STDIO/SSE)
- Logging configuration (directory, level)
- Prompts file reference pointing to `promptsConfig.json`

#### Prompts Configuration (`server/promptsConfig.json`)
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

##### Migration Guide Template
```typescript
// OLD SYSTEM (DEPRECATED - Remove by [DATE])
// Use [NEW_SYSTEM] instead. Migration guide: [URL/Section]
// import { OldSystem } from './old-system.js'; // ❌ DON'T USE

// NEW SYSTEM (CURRENT)
import { NewSystem } from './new-system.js'; // ✅ USE THIS
```

##### Current System Deprecations & Recommendations
**IMMEDIATE ACTION REQUIRED:**

1. **Execution Systems Consolidation**:
   - **KEEP**: `ExecutionCoordinator` (actively used by MCP tools)
   - **REMOVED**: `ExecutionEngine` and `EnhancedPromptExecutionStrategy` (unused complexity removed)
   - **DEPRECATE**: `UnifiedPromptProcessor` (consolidated by ExecutionCoordinator)
   - **TIMELINE**: Remove deprecated systems within 2 sprints

2. **Analysis Systems Consolidation**:
   - **KEEP**: `SemanticAnalyzer` (in `/analysis/`)
   - **DEPRECATE**: `FrameworkConsensusEngine`, `FrameworkEnhancementPipeline` (in `/frameworks/analysis/`)
   - **MIGRATION**: Move any unique logic from framework analyzers into main SemanticAnalyzer

3. **Circular Dependency Fixes Required**:
   - **BREAK**: `execution-coordinator.ts` ↔ `strategies/index.ts` circular import
   - **SOLUTION**: Extract common interfaces to separate file, use dependency injection

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

### Context Memory System
This project maintains comprehensive context across sessions through the neural workbench:

```
context-memory/
├── PROJECT-CONTEXT.yaml     # Neural integration configuration
├── working-memory.md        # Current session context  
├── episodic-memory.md       # Project history and major events
├── semantic-memory.md       # Technical knowledge and patterns
└── procedural-memory.md     # Development workflows and procedures
```

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

#### Test Structure and Commands
- **Unit Tests**: `npm run test:unit` - Test individual components in isolation
- **Integration Tests**: `npm run test:integration` - Test component interactions
- **Performance Tests**: `npm run test:performance` - Validate performance benchmarks
- **E2E Tests**: `npm run test:e2e` - End-to-end workflow validation
- **Coverage**: `npm run test:coverage` - Generate coverage reports
- **Watch Mode**: `npm run test:watch` - Continuous testing during development
- **CI Tests**: `npm run test:ci` - Optimized for CI/CD pipelines

#### Test Configuration
- **Jest Configuration**: Uses ES modules with `ts-jest` preset
- **Test Timeout**: 30 seconds for integration tests involving server startup
- **Single Worker**: Tests run with `maxWorkers: 1` to avoid conflicts
- **Setup**: All tests use `tests/setup.ts` for common initialization

#### Framework-Specific Testing
- **CAGEERF Framework**: `npm run test:cageerf-framework` - Validate methodology guide implementations
- **MCP Tools**: `npm run test:mcp-tools` - Test MCP protocol compliance
- **Server Integration**: `npm run test:server-integration` - Test full server functionality
- **Performance Memory**: `npm run test:performance-memory` - Memory usage validation
- **All Enhanced Tests**: `npm run test:all-enhanced` - Run all framework and integration tests
- **CI Startup**: `npm run test:ci-startup` - CI/CD startup validation
- **Legacy Tests**: `npm run test:legacy` - Legacy test server compatibility

#### Architecture Validation Commands
- **Dependency Validation**: `npm run validate:dependencies` - Check for duplicate/overlapping systems
- **Architecture Validation**: `npm run validate:architecture` - Verify proper dependency hierarchy
- **Circular Dependency Check**: `npm run validate:circular` - Detect circular imports using madge
- **Complete Validation**: `npm run validate:all` - Run all validation checks

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

#### Architectural Decision Records (ADRs)
**REQUIRED for all system changes:**

##### ADR Template
```markdown
## ADR-XXX: [Decision Title]

**Date**: YYYY-MM-DD
**Status**: Proposed/Accepted/Deprecated/Superseded

### Context
What problem are we solving? What systems exist currently?

### Decision
What are we doing? What system are we deprecating/removing?

### Consequences
- Positive: Benefits of the change
- Negative: Costs and risks
- Migration Impact: What needs to be updated

### Systems Affected
- **Removing**: List deprecated systems with removal timeline
- **Adding**: New systems with justification
- **Migration Path**: Step-by-step guide for developers
```

##### ADR Storage
- Create ADRs in `/docs/adr/` directory
- Link ADRs in PR descriptions
- Reference ADRs in system deprecation comments

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

### Environment and Deployment

#### Development Environment Setup
- **Node.js Version**: Minimum Node.js 16 (specified in package.json engines)
- **TypeScript Compilation**: Use `tsc` for compilation, `tsc -w` for watch mode
- **Environment Variables**: Use `MCP_SERVER_ROOT` and `MCP_PROMPTS_CONFIG_PATH` for path overrides
- **Transport Testing**: Use `start:stdio` for Claude Desktop, `start:sse` for web clients

#### CI/CD Integration
- **Cross-Platform Testing**: Automated testing on Ubuntu, Windows, macOS with Node.js 16, 18, 20
- **Quality Gates**: TypeScript compilation, build success, test passing, and server startup validation
- **Artifact Generation**: Build artifacts uploaded for successful Ubuntu + Node 18 builds
- **PR Validation**: Automated PR comments with validation results and breaking change detection

## Neural Workbench & SuperClaude Integration

### `/init` Command Protocol
When using `/init`, the following MCP-specific initialization is executed:

```bash
# Neural workbench initialization  
neural init /home/minipuft/Applications/claude-prompts-mcp
neural validate /home/minipuft/Applications/claude-prompts-mcp

# MCP server validation
cd server && npm run typecheck && npm run build && npm test
```

### Project Integration Summary
This MCP server features full SuperClaude integration with:
- **87.5% Tool Consolidation**: 24+ tools → 3 intelligent tools  
- **Multi-Methodology Support**: CAGEERF, ReACT, 5W1H, SCAMPER with dynamic switching
- **Cross-Platform Compatibility**: Ubuntu, Windows, macOS with Node.js 16, 18, 20
- **Enterprise-Grade Architecture**: Multi-phase orchestration with comprehensive error handling
- **Neural Workbench**: Context-aware development with persistent memory systems

---

**Version**: Claude Prompts MCP Server v1.1.0 with SuperClaude Integration  
**Last Updated**: 2025-01-30  
**Integration Level**: Full SuperClaude + Neural Workbench + Enhanced CAGEERF  
**Compatibility**: Claude Desktop, Cursor Windsurf, Web Clients, Custom MCP Clients