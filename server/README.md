# MCP Prompts Server

A comprehensive Model Context Protocol (MCP) server that provides AI prompt management with hot-reloading capabilities, workflow orchestration, and enterprise-grade features.

## Overview

The MCP Prompts Server implements a simplified execution architecture that handles different types of prompt execution:

- **Direct Prompt Processing**: Variable substitution and context-aware processing via UnifiedPromptProcessor
- **Chain Execution**: Sequential multi-step workflows via ChainExecutionStrategy
- **Framework Integration**: Methodology enhancement (CAGEERF/ReACT) applied contextually

## Architecture

### ExecutionCoordinator System

The server uses ExecutionCoordinator with simple decision logic that replaced the complex strategy pattern:

```typescript
// Simplified execution routing with intelligent decision logic
const result = await executionCoordinator.executePrompt(promptId, args, options);
```

#### Core Components

1. **ExecutionCoordinator**: Central orchestration with simple routing logic
2. **UnifiedPromptProcessor**: Handles 90% of prompt processing cases with intelligent parsing
3. **ChainExecutionStrategy**: Sequential execution for complex workflows

### Simplified Execution Architecture

The system supports intelligent routing with two primary execution modes:

| Execution Mode | Framework Integration | Processing | Speed | Best For |
|----------------|----------------------|------------|-------|----------|
| **Direct Processing** | ✅ Context-aware | UnifiedPromptProcessor | Fast | Most prompt execution needs |
| **Chain Execution** | ✅ Per-step enhancement | ChainExecutionStrategy | Variable | Multi-step workflows |

#### Execution Flow

- **Direct Processing**: Intelligent argument handling, context resolution, and framework enhancement via UnifiedPromptProcessor
- **Chain Execution**: Sequential step processing with framework-aware enhancement and conversation state management
- **Framework Integration**: CAGEERF, ReACT, and other methodologies applied contextually based on execution requirements

For detailed information about choosing the right execution type, see the [Execution Types Guide](../docs/execution-types-guide.md).

### Key Components

- **Application Orchestrator**: Multi-phase startup with comprehensive health monitoring
- **Execution Engine**: Unified execution system with performance optimizations
- **Template System**: Nunjucks-powered template processing with advanced features
- **Gate System**: Workflow validation with quality control
- **Hot-Reload System**: Dynamic prompt updates without server restart

### Three-Tier Quality Assurance System

The server implements an intelligent quality assurance model that adapts to execution type:

#### Prompt Execution (No Framework, No Gates)
- **Lightning Fast**: Direct Nunjucks variable substitution
- **Zero Overhead**: Bypasses framework injection and quality gates
- **Best For**: Simple formatting, variable replacement, basic templates

#### Template Execution (Framework-Enhanced)
- **Smart Processing**: Automatic framework detection and injection
- **Methodology Integration**: CAGEERF or ReACT framework enhancement
- **Quality Validation**: Content validation and framework compliance
- **Best For**: Analysis, reasoning, complex content generation

#### Chain Execution (Mixed-Type Support)
- **Per-Step Intelligence**: Each step can be prompt or template type
- **Adaptive Processing**: Routes each step to appropriate execution strategy
- **Inter-Step Validation**: Quality checks between sequential steps
- **Best For**: Multi-step processes with varying complexity

#### Workflow Execution (Comprehensive Gates)
- **Full Validation**: Deep content analysis, structure validation, security gates
- **Framework Compliance**: Methodology adherence checking
- **Dependency Management**: Complex orchestration with branching logic
- **Best For**: Mission-critical processes requiring comprehensive validation

For detailed gate configuration, see the [Enhanced Gate System Guide](../docs/enhanced-gate-system.md).

## Quick Start

### Installation

```bash
cd server
npm install
npm run build
```

### Development

```bash
# Development mode with hot-reloading
npm run dev

# Type checking only
npm run typecheck

# Run tests
npm test
```

### Production

```bash
# STDIO transport (Claude Desktop)
npm run start:stdio

# SSE transport (web clients)
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
  "prompts": "./promptsConfig.json"
}
```

### Prompts Configuration (`promptsConfig.json`)

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

```markdown
# Quick Code Formatter

## System Message
Format code cleanly and consistently.

## User Message Template
Please format this {{language}} code using {{style}} style:

```{{language}}
{{code}}
```

## Arguments
- language: Programming language (required)
- style: Formatting style (required)
- code: Code to format (required)
```

### Framework-Aware Template Structure (Methodology Enhanced)

```markdown
# Code Security Analyzer

## System Message
You are a security expert specialized in code analysis.

## User Message Template
Analyze this {{language}} code for security vulnerabilities:

```{{language}}
{{code}}
```

Provide comprehensive analysis including:
- Vulnerability assessment
- Risk prioritization
- Remediation recommendations

## Arguments
- language: Programming language (required)
- code: Code to analyze (required)
```

### Chain Execution

```json
{
  "id": "analysis-chain",
  "name": "Analysis Chain",
  "isChain": true,
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
```

### Workflow Definition

```json
{
  "id": "complex-workflow",
  "name": "Complex Analysis Workflow",
  "steps": [
    {
      "id": "validate",
      "name": "Validate Input",
      "type": "gate",
      "config": { "gateId": "input-validation" },
      "dependencies": []
    },
    {
      "id": "process",
      "name": "Process Data",
      "type": "prompt",
      "config": { "promptId": "data-processor" },
      "dependencies": ["validate"]
    }
  ],
  "dependencies": {
    "nodes": ["validate", "process"],
    "edges": [["validate", "process"]]
  }
}
```

## Performance Features

### Caching and Optimization

- **Strategy Selection Caching**: Optimized prompt-to-strategy mapping
- **Memory Management**: Automatic cleanup and size limits
- **Performance Monitoring**: Real-time metrics and diagnostics
- **Batch Processing**: Queue-based execution optimization

### Monitoring

```typescript
// Get execution statistics
const stats = executionEngine.getExecutionStats();

// Get performance metrics
const metrics = executionEngine.getPerformanceMetrics();

// Memory optimization
executionEngine.optimizeMemory();
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

### Environment Variables

```bash
# Override server root detection
export MCP_SERVER_ROOT=/path/to/server

# Direct path to prompts config
export MCP_PROMPTS_CONFIG_PATH=/path/to/promptsConfig.json
```

## Testing

### Test Structure

- **Unit Tests**: Individual component testing
- **Integration Tests**: Full system testing
- **Performance Tests**: Benchmarking and optimization validation
- **Strategy Tests**: Execution strategy validation

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="ExecutionEngine"

# Run performance tests
npm test -- tests/orchestration/strategies/execution-engine-performance.test.ts
```

## Client Integration

### Claude Desktop

Add to Claude Desktop configuration:

```json
{
  "mcpServers": {
    "claude-prompts-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/server/dist/index.js"],
      "env": {
        "MCP_SERVER_ROOT": "/absolute/path/to/server"
      }
    }
  }
}
```

### Web Clients

Use SSE transport:

```javascript
const eventSource = new EventSource('http://localhost:3000/events');
eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  // Handle MCP messages
};
```

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

### Enhanced MCP Tools

- **prompt_engine**: Universal execution tool with automatic type detection
- **prompt_manager**: Comprehensive prompt and template management
  - **create_prompt**: Create basic prompts for variable substitution
  - **create_template**: Create framework-aware templates
  - **analyze_type**: Analyze execution type and framework requirements
  - **migrate_type**: Convert between execution types
- **system_control**: Framework switching and system management

### Enhanced ExecutionEngine Methods

```typescript
// Execute with automatic type detection
await executionEngine.execute(promptId, args, options);

// Execute basic prompt (fast path)
await executionEngine.executePrompt(promptId, args);

// Execute framework-enhanced template
await executionEngine.executeTemplateWithFramework(promptId, args);

// Get execution statistics by type
executionEngine.getExecutionStats(); // includes prompt/template/chain/workflow metrics

// Analyze execution type
const analysis = semanticAnalyzer.analyze(promptData);
// Returns: { executionType: 'prompt'|'template'|'chain'|'workflow', requiresFramework: boolean }
```

## Contributing

1. Follow TypeScript best practices
2. Include comprehensive tests
3. Update documentation
4. Ensure hot-reloading compatibility
5. Validate MCP protocol compliance

### Architecture Guidelines

- Use strategy pattern for extensible execution types
- Implement comprehensive error boundaries
- Follow dependency injection patterns
- Maintain backward compatibility
- Optimize for performance and memory usage

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
- GitHub Issues: Report bugs and feature requests
- Documentation: See `/docs` for detailed guides
- Examples: Check `/examples` for usage patterns