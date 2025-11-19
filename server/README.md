# MCP Prompts Server

A comprehensive Model Context Protocol (MCP) server that provides AI prompt management with hot-reloading capabilities, workflow orchestration, and enterprise-grade features.

## Overview

The MCP Prompts Server implements a modernized execution architecture with three-tier processing that handles different types of prompt execution:

- **Direct Prompt Processing**: Lightning-fast variable substitution via UnifiedPromptProcessor (90% of cases)
- **LLM-Driven Chain Execution**: Multi-step workflows orchestrated by PromptExecutionPipeline (10% of cases)
- **Framework Integration**: Methodology enhancement (CAGEERF/ReACT/5W1H/SCAMPER) applied contextually

## Architecture

### ExecutionCoordinator System

The server uses ExecutionCoordinator as a thin orchestration layer that delegates all execution to PromptExecutionPipeline:

```typescript
// Phase 3: Delegation-based execution routing
const result = await executionCoordinator.executePrompt(
  promptId,
  args,
  options
);
// All execution delegated to PromptExecutionPipeline
```

#### Core Components

1. **ExecutionCoordinator**: Thin orchestration layer with delegation pattern
2. **UnifiedPromptProcessor**: Handles 90% of prompt processing with fast variable substitution
3. **PromptExecutionPipeline**: Handles 10% of cases with LLM-driven chain execution and intelligent analysis

### Simplified Execution Architecture

The system supports intelligent routing with three primary execution tiers:

| Execution Tier | Framework Integration   | Processing               | Speed          | Best For                              |
| -------------- | ----------------------- | ------------------------ | -------------- | ------------------------------------- |
| **Prompt**     | ❌ Bypassed for speed   | UnifiedPromptProcessor   | Lightning Fast | Basic variable substitution           |
| **Template**   | ✅ Methodology-aware    | PromptExecutionPipeline | Smart          | Framework-enhanced content generation |
| **Chain**      | ✅ Per-step enhancement | PromptExecutionPipeline | LLM-Driven     | Multi-step workflows                  |

#### Execution Flow

- **Prompt Execution**: Fast path with direct variable substitution via UnifiedPromptProcessor, **bypasses framework injection** for maximum speed
- **Template Execution**: Framework-enhanced processing with **automatic methodology injection** via PromptExecutionPipeline based on active framework
- **Chain Execution**: LLM-driven iterative workflows with **per-step framework injection** and state management via PromptExecutionPipeline
- **Framework Selection**: Rule-based framework selection using FrameworkManager based on execution type, complexity, and user preference
- **Active Framework Management**: FrameworkStateManager maintains current active framework (default: CAGEERF) with runtime switching capabilities

For detailed information about choosing the right execution type, see the [Execution Types Guide](../docs/execution-types-guide.md).

### Key Components

- **Application Orchestrator**: Multi-phase startup with comprehensive health monitoring
- **PromptExecutionPipeline**: Three-tier execution system with intelligent analysis and LLM-driven chains
- **Template System**: Nunjucks-powered template processing with framework injection
- **Gate System**: Quality validation with framework-aware evaluation
- **Hot-Reload System**: Dynamic prompt updates without server restart

### Three-Tier Quality Assurance System

The server implements an intelligent quality assurance model that adapts to execution type:

### Chain Management Commands

Use built-in chain management commands from any MCP client to inspect state without touching internal APIs:

- `validate chain <prompt-id>` – shows chain metadata, defined steps, and configured gates.
- `list chains` – displays active sessions with progress and pending reviews.
- `gates chain <prompt-or-chain-id>` – surfaces prompt-level gate configuration plus any active temporary gates.

These commands are handled directly by the PromptExecutionPipeline, so the information always reflects the canonical execution path and session state.

#### Chain Identifiers

Chains now surface three identifiers, each with a specific purpose:

- **`chain_id`** – The lightweight resume token returned in every chain footer and in `structuredContent`. Pass this value back to `prompt_engine` (`chain_id: "chain-demo#2"`) whenever you want to continue or re-render a multi-step workflow.
- **`chain_run_id`** (archival) – Formerly exposed as `session_id`. This identifier is stored inside `runtime-state/chain-run-registry.json` for compliance and appears only in chain-management readouts. It is never accepted by `prompt_engine`.

If you previously resumed chains with `session_id`, switch to the `Chain:` footer line (or `structuredContent.chain.id`) and send that value as the `chain_id` argument. When continuing a run you can omit the command entirely and call:

```bash
prompt_engine(chain_id:"chain-demo#2", user_response:"<latest output>")
```

or use the shorthand shown in the footer: `chain-demo#2 --> (optional input) --> user_response:"..."`. No more re-sending the original symbolic command.

#### Prompt Execution (No Framework, No Gates)

- **Lightning Fast**: Direct Nunjucks variable substitution
- **Zero Overhead**: Bypasses framework injection and quality gates
- **Best For**: Simple formatting, variable replacement, basic templates

#### Template Execution (Framework-Enhanced)

- **Smart Processing**: Rule-based framework selection with conditional injection
- **Methodology Integration**: CAGEERF, ReACT, 5W1H, or SCAMPER framework enhancement based on active framework
- **Quality Validation**: Content validation and framework compliance
- **Best For**: Analysis, reasoning, complex content generation

#### Chain Execution (LLM-Driven Workflows)

- **Iterative Processing**: LLM-guided step-by-step execution with intelligent coordination
- **Context Management**: Conversation state and inter-step data flow management
- **Quality Gate Integration**: Framework-aware validation and methodology compliance
- **Gate Review Lifecycle**: Pending quality reviews are rendered via a dedicated gate-review stage that preserves previous step context, while a follow-up Call-To-Action stage appends standardized “Next Action” footers so resumptions always know which command to run next.
- **Best For**: Multi-step processes requiring sequential reasoning and state management

For detailed gate configuration, see the [Enhanced Gate System Guide](../docs/enhanced-gate-system.md).

### Framework System Architecture

The server implements a sophisticated framework system with systematic methodology application:

#### Framework Components

1. **FrameworkManager** (Stateless): Loads methodology guides and generates framework definitions dynamically
2. **FrameworkStateManager** (Stateful): Tracks active framework and handles runtime switching with performance monitoring
3. **ExecutionPlanning + FrameworkResolution Stages**: Stage 4 plans per-step framework requirements and Stage 6 injects the resolved methodology context before step execution
4. **Methodology Guides**: CAGEERF, ReACT, 5W1H, SCAMPER guides providing framework-specific behavior

#### Framework Selection Process

```typescript
// Rule-based framework selection based on criteria
const framework = frameworkManager.selectFramework({
  executionType: "template",
  complexity: "high",
  userPreference: "CAGEERF", // User preference is primary selection factor
});

// Runtime framework switching
await frameworkStateManager.switchFramework({
  targetFramework: "ReACT",
  reason: "User preference change",
});
```

#### Conditional Framework Injection

- **Prompt Tier**: Framework injection **bypassed** for maximum execution speed
- **Template Tier**: **Automatic injection** of active framework's system prompt and methodology guidance
- **Chain Tier**: **Per-step injection** allowing different frameworks per chain step

#### Available Methodologies

- **CAGEERF**: Comprehensive structured approach (Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework)
- **ReACT**: Reasoning and Acting pattern for systematic problem-solving
- **5W1H**: Who, What, When, Where, Why, How systematic analysis
- **SCAMPER**: Creative problem-solving (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)

## Quick Start

### Installation

```bash
# Clone or navigate to the project
cd /path/to/claude-prompts-mcp/server

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Claude Desktop Integration (Recommended)

1. **Add to Claude Desktop configuration** (typically `~/.claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-prompts-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/claude-prompts-mcp/server/dist/index.js"]
    }
  }
}
```

2. **Restart Claude Desktop** - The server will start automatically when Claude Desktop connects.

### Manual Testing & Development

```bash
# Development mode with hot-reloading
npm run dev

# Type checking only
npm run typecheck

# Run tests
npm test

# Manual STDIO mode (for testing without Claude Desktop)
npm run start:stdio

# Web/SSE mode (for web clients)
npm run start:sse
```

## Configuration

### Main Configuration (`config.json`)

```json
{
  "server": {
    "name": "claude-prompts-mcp",
    "version": "1.0.0"
  },
  "transports": {
    "stdio": { "enabled": true },
    "sse": { "enabled": true, "port": 3000 }
  },
  "logging": {
    "directory": "./logs",
    "level": "INFO"
  },
  "prompts": "./prompts/promptsConfig.json"
}
```

### Prompts Configuration (`prompts/promptsConfig.json`)

```json
{
  "categories": [
    {
      "name": "analysis",
      "displayName": "Analysis & Research",
      "description": "Data analysis and research prompts",
      "promptsFile": "./prompts/analysis/prompts.json"
    }
  ],
  "registrationMode": "NAME"
}
```

## Prompt and Template Development

### Basic Prompt Structure (Fast Variable Substitution)

````markdown
# Quick Code Formatter

## System Message

Format code cleanly and consistently.

## User Message Template

Please format this {{language}} code using {{style}} style:

```{{language}}
{{code}}
```
````

## Arguments

- language: Programming language (required)
- style: Formatting style (required)
- code: Code to format (required)

````

### Framework-Aware Template Structure (Methodology Enhanced)

```markdown
# Code Security Analyzer

## System Message
You are a security expert specialized in code analysis.

## User Message Template
Analyze this {{language}} code for security vulnerabilities:

```{{language}}
{{code}}
````

Provide comprehensive analysis including:

- Vulnerability assessment
- Risk prioritization
- Remediation recommendations

## Arguments

- language: Programming language (required)
- code: Code to analyze (required)

````

### Chain Execution

```json
{
  "id": "analysis-chain",
  "name": "Analysis Chain",
  "chainSteps": [
    {
      "promptId": "data-extraction",
      "stepName": "Extract Data",
      "inputMapping": { "source": "input" },
      "outputMapping": { "extracted_data": "output" }
    },
    {
      "promptId": "data-analysis",
      "stepName": "Analyze Data",
      "inputMapping": { "data": "extracted_data" },
      "outputMapping": { "analysis_result": "output" }
    }
  ]
}
````

#### Chain Identifiers

- **Chain ID (`chain_id`)** is surfaced in every chain response footer and is the identifier clients should reuse when referencing or resuming a workflow.
- **Session ID** now remains internal for analytics/metrics and is no longer displayed to the LLM.
- To advance a chain step, rerun the original command (optionally including the `chain_id` field) and provide the latest step output via `user_response` or the `previous_step_output` extra payload. The engine captures that response before emitting the next set of instructions.

### Enhanced Chain Configuration

```json
{
  "id": "analysis-chain",
  "name": "Enhanced Analysis Chain",
  "executionMode": "chain",
  "chainSteps": [
    {
      "promptId": "data-validation",
      "stepName": "Validate Input Data",
      "inputMapping": { "source": "input" },
      "outputMapping": { "validated_data": "output" }
    },
    {
      "promptId": "advanced-analysis",
      "stepName": "Perform Analysis",
      "inputMapping": { "data": "validated_data" },
      "outputMapping": { "analysis_result": "output" }
    }
  ],
  "gates": [
    {
      "type": "validation",
      "requirements": [{ "type": "content_length", "criteria": { "min": 50 } }]
    }
  ]
}
```

## Performance Features

### Caching and Optimization

- **Three-Tier Execution Caching**: Optimized routing between prompt/template/chain execution
- **Memory Management**: Automatic cleanup and size limits
- **Performance Monitoring**: Real-time metrics and diagnostics
- **Consolidated Tool Architecture**: 87.5% reduction in tool complexity

### Monitoring

```typescript
// Get execution statistics from coordinator
const stats = executionCoordinator.getExecutionStats();

// Get framework state and analytics
const analytics = frameworkStateManager.getAnalytics();

// System health monitoring
const health = applicationOrchestrator.getHealthStatus();
```

## Development Commands

### Essential Commands

```bash
# Build TypeScript
npm run build

# Type checking
npm run typecheck

# Development mode
npm run dev

# Run tests
npm test

# Start production server
npm start
```

### Transport-Specific

```bash
# STDIO transport (Claude Desktop)
npm run start:stdio

# SSE transport (web clients)
npm run start:sse

# Development with verbose logging
npm run start:verbose
```

### Environment Variables (Optional)

```bash
# Optional: Optimize server root detection (streamlined detection system)
export MCP_SERVER_ROOT=/path/to/claude-prompts-mcp/server

# Optional: Direct path to prompts config (automatic detection available)
export MCP_PROMPTS_CONFIG_PATH=/path/to/claude-prompts-mcp/server/prompts/promptsConfig.json
```

**Detection Strategy:** The server uses streamlined detection with 3 core strategies:

1. **Script path analysis** (most reliable - works in 99% of cases)
2. **Module path detection** (reliable fallback for edge cases)
3. **Common directory patterns** (covers remaining scenarios)

Environment variables provide **guaranteed detection** but are not required for normal operation.

## Troubleshooting

### Common Installation Issues

1. **"Cannot find module" errors**

   ```bash
   # Ensure you're in the server directory
   cd /path/to/claude-prompts-mcp/server

   # Clean install
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   ```

2. **Claude Desktop not connecting**

   - Verify absolute paths in configuration (no relative paths like `./` or `~/`)
   - Ensure the `dist/index.js` file exists after running `npm run build`
   - Check Claude Desktop logs for connection errors
   - Restart Claude Desktop after configuration changes

3. **Permission errors**

   ```bash
   # Fix file permissions
   chmod +x dist/index.js
   ```

4. **TypeScript compilation errors**

   ```bash
   # Check for syntax errors
   npm run typecheck

   # Clean build
   npm run build
   ```

### Verifying Installation

```bash
# Test the server manually
node dist/index.js --help

# Run the test suite
npm test

# Check if MCP tools are working
# After connecting to Claude Desktop, try: /mcp
```

## Testing

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: Full system testing with PromptExecutionPipeline
- **Performance Tests**: Three-tier execution benchmarking
- **Framework Tests**: CAGEERF, ReACT, 5W1H, SCAMPER validation

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="PromptExecutionPipeline"

# Run framework tests
npm run test:cageerf-framework

# Run MCP tools tests
npm run test:mcp-tools
```

## Advanced Integration

### Web Clients (Alternative to Claude Desktop)

For web-based integrations, use SSE transport:

```bash
# Start SSE server
npm run start:sse
```

```javascript
// Connect to SSE endpoint
const eventSource = new EventSource("http://localhost:3000/events");
eventSource.onmessage = function (event) {
  const data = JSON.parse(event.data);
  // Handle MCP messages
};
```

### Custom MCP Clients

For custom integrations, the server supports both STDIO and SSE transports. See the [MCP Protocol Documentation](https://modelcontextprotocol.io) for implementation details.

## Error Handling

### Graceful Degradation

- **Startup Failures**: Rollback mechanisms for partial initialization
- **Execution Errors**: Comprehensive error boundaries
- **Template Errors**: Detailed error reporting with context
- **Performance Issues**: Automatic optimization and cleanup

### Logging

- **Structured Logging**: JSON-formatted logs with context
- **Log Levels**: DEBUG, INFO, WARN, ERROR
- **Transport-Aware**: Prevents STDIO interference
- **Performance Tracking**: Execution timing and metrics

## API Reference

### Consolidated MCP Tools (87.5% Reduction: 24+ → 3 Tools)

- **prompt_engine**: Universal execution with intelligent analysis, semantic detection, and LLM-driven chain coordination
- **prompt_manager**: Complete lifecycle management with smart filtering, type analysis, and configurable semantic analysis
- **system_control**: Framework management, analytics, health monitoring, and comprehensive system administration

The `prompt_manager` MCP tool (implemented by `ConsolidatedPromptManager`) is the sole mutation entry point for prompt files; it orchestrates category maintenance and markdown writes while the `src/prompts/*` modules remain focused on loading/hot-reload. Always use the MCP tool (or APIs that delegate to it) to keep the pipeline and prompt registry in sync.

### ExecutionCoordinator Methods (Phase 3)

```typescript
// Execute with delegation to PromptExecutionPipeline
await executionCoordinator.executePrompt(promptId, args, options);

// Get execution statistics (three-tier model)
const stats = executionCoordinator.getExecutionStats();
// Returns: { promptExecutions, templateExecutions, chainExecutions, failedExecutions }

// Set prompt execution service for delegation
executionCoordinator.setPromptExecutionService(promptExecutionService);
```

### PromptExecutionPipeline Methods

```typescript
// Universal execution with intelligent type detection
const result = await promptExecutionService.executePrompt(command, options);

// Semantic analysis with configurable analyzer
const analysis = semanticAnalyzer.analyze(promptData);
// Returns: { executionType: 'prompt'|'template'|'chain', requiresFramework: boolean }
```

### Framework System Methods

```typescript
// Framework selection and management
const framework = frameworkManager.selectFramework({
  executionType: "template",
  complexity: "high",
});

// Runtime framework switching
await frameworkStateManager.switchFramework({
  targetFramework: "CAGEERF",
  reason: "Complexity requires structured approach",
});

// Framework injection (conditional based on execution tier)
const injectionResult = await frameworkInjector.injectFrameworkContext(
  prompt,
  semanticAnalysis
);

// Get current framework state and health
const state = frameworkStateManager.getCurrentState();
const health = frameworkStateManager.getSystemHealth();
```

## Contributing

1. Follow TypeScript best practices
2. Include comprehensive tests
3. Update documentation
4. Ensure hot-reloading compatibility
5. Validate MCP protocol compliance

### Architecture Guidelines

- **Delegation Pattern**: ExecutionCoordinator delegates all execution to PromptExecutionPipeline for simplified coordination
- **Three-Tier Architecture**: Optimized routing between prompt (fast), template (framework-enhanced), and chain (LLM-driven) execution
- **Conditional Framework Integration**: Framework injection applied selectively based on execution tier requirements
- **Intelligent Routing**: Implement command routing with built-in detection and multi-strategy parsing
- **Comprehensive Error Boundaries**: Implement error handling at all orchestration levels
- **Backward Compatibility**: Maintain compatibility through ExecutionCoordinator interface while leveraging modern delegation architecture

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

- GitHub Issues: Report bugs and feature requests
- Documentation: See `/docs` for detailed guides
- Examples: Check `/examples` for usage patterns
