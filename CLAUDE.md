# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

#### `/server/src/orchestration/`
- **Application Orchestrator** (`index.ts`) - Main entry point with comprehensive health monitoring and graceful shutdown
- **Multi-phase startup** with dependency management and error recovery (Foundation → Data Loading → Module Initialization → Server Launch)
- **Performance monitoring** with memory usage tracking and uptime metrics
- **Conversation Manager** - Handles conversation state and context management
- **Prompt Executor** - Executes individual prompts with template processing
- **Workflow Engine** - Orchestrates multi-step workflows with gate validation
- **Hot-reload system** - Supports dynamic prompt reloading without server restart

#### `/server/src/prompts/`
- **Template processor** using Nunjucks with advanced features (conditionals, loops, macros)
- **Prompt registry** for dynamic loading and hot-reloading
- **Converter system** for format transformation and validation

#### `/server/src/mcp-tools/`
- **Prompt management tools** for create, update, delete, and reload operations
- **Interactive prompt execution** with argument parsing and validation
- **Chain execution** support for multi-step workflows
- **Gate management tools** for workflow validation and quality control
- **Template generation tools** for dynamic prompt creation
- **Workflow management tools** for orchestrating complex multi-step processes

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

#### CAGEERF Framework Integration
- **C.A.G.E.E.R.F methodology** validation in CI/CD pipeline
- **Enhanced Gate System** with semantic analysis and quality validation
- **Template Repository** for dynamic prompt generation
- **Semantic Analyzer** for automatic prompt type detection
- **Enhanced Gate Evaluator** with intelligent workflow validation

#### Workflow and Gate System
- **Gate Registry** manages validation rules and quality gates
- **Gate Evaluators** (both legacy and enhanced) for workflow validation
- **Workflow Engine** orchestrates multi-step processes with gate validation
- **Chain Execution** with step-by-step validation and confirmation options

### Key Development Guidelines

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
- Follow CAGEERF methodology for enterprise-grade prompt quality

#### Error Handling
- Implement comprehensive error boundaries at all orchestration levels
- Use structured logging with appropriate levels (supports both verbose and quiet modes)
- Provide meaningful error messages with diagnostic information
- Include rollback mechanisms for startup failures

#### Testing
- Test transport layer compatibility (STDIO and SSE)
- Validate prompt template rendering with Nunjucks engine
- Check hot-reloading functionality and workflow engine integration
- Verify MCP protocol compliance and CAGEERF framework validation

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

This architecture provides a robust, scalable system for AI prompt management with enterprise-grade features including hot-reloading, comprehensive error handling, and multi-transport support.

## Implementation Workflow & Scratchpad Management

### Active Development Tracking
Claude should maintain active progress tracking using the scratchpad system:

#### Primary Scratchpad (`/plans/implementation-scratchpad.md`)
- **Session Status**: Current phase, active task, date stamp
- **Architecture Notes**: Code structure discoveries and patterns observed
- **Technical Decisions**: Library choices, performance considerations, risk mitigation
- **Progress Tracking**: Completed tasks, next actions, implementation checkpoints
- **Session Notes**: Between-session continuity and quick reference

#### Scratchpad Update Protocol
1. **Session Start**: Update current session status and review previous progress
2. **During Work**: Log technical decisions, discoveries, and implementation notes
3. **Task Completion**: Mark completed tasks and note any issues encountered
4. **Session End**: Update next session goals and current progress status

### TODO-Based Implementation Structure
```
plans/
├── implementation-scratchpad.md     # Main workspace tracking (MANDATORY)
└── mcp-system-enhancements/         # TODO: MCP System Enhancements
    ├── master-implementation-plan.md    # Complete implementation roadmap
    ├── system-design-specification.md   # Technical architecture specification
    ├── implementation-summary.md        # Design completion status
    └── phases/                          # Phase-based implementation
        ├── phase-1/                     # Phase 1: Workflow Foundation
        │   ├── phase-1-workspace.md     # Detailed Phase 1 tasks
        │   └── [artifacts]              # Implementation artifacts
        ├── phase-2/                     # Phase 2: Gate System
        ├── phase-3/                     # Phase 3: Envelope Processing
        ├── phase-4/                     # Phase 4: Template Responses
        └── phase-5/                     # Phase 5: Integration & Testing
```

### Implementation Guidelines

#### Before Starting Work
1. **Review Scratchpad**: Check current session status and previous progress
2. **Update Session Info**: Set current phase, active task, and date
3. **Check Dependencies**: Verify prerequisite tasks are complete

#### During Implementation
1. **Log Discoveries**: Document architecture patterns and code structure insights
2. **Track Decisions**: Record technical choices and rationale
3. **Note Issues**: Document problems encountered and solutions applied
4. **Update Progress**: Mark completed tasks and update status

#### After Completing Tasks
1. **Update Scratchpad**: Mark tasks complete and note any follow-up actions
2. **Session Summary**: Document key accomplishments and next steps
3. **Risk Assessment**: Note any blocking issues or concerns for next session

### Development Workflow Integration
The scratchpad should be integrated with the existing development patterns:

#### Hot-Reloading Development
- Track file changes and their impact on the enhancement implementation
- Document template modifications and their effects on workflow processing
- Note any breaking changes during development

#### Error Handling Enhancement
- Log new error types introduced by workflow/gate/envelope processing
- Document error boundaries and recovery mechanisms
- Track testing of error conditions and edge cases

#### Performance Monitoring
- Note performance impact of new features during development
- Document optimization opportunities and implementation decisions
- Track memory usage and execution time changes

### Cross-Session Continuity
The scratchpad ensures smooth transitions between development sessions:

#### Session Handoff Information
- Current implementation state and blocking issues
- Next priority tasks and their dependencies
- Technical context that might not be obvious from code alone
- Decisions made that affect future implementation phases

This workflow ensures systematic progress tracking and maintains context across extended development sessions while integrating seamlessly with the existing MCP server architecture.