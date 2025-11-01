# MCP Tools Reference (v1.4.0 - Phase 2A Conditional Branching)

This document provides a comprehensive reference for the 3 intelligent MCP (Model Context Protocol) tools that power the Claude Prompts Server. The server implements **intelligent command routing** with built-in command detection and multi-strategy parsing while maintaining full functionality.

## Architecture Overview

The server uses **three consolidated tools** that provide complete prompt management and execution capabilities:

- **`prompt_engine`** - Universal execution with systematic analysis and structural detection
- **`prompt_manager`** - Complete lifecycle management with smart filtering and type analysis  
- **`system_control`** - Framework management, switching performance analytics, and system administration

## Interaction Model

MCP clients execute server capabilities by sending tool requests. Each tool uses Zod schema validation for type safety and provides structured responses with comprehensive error handling.

---

## Core Consolidated Tools

### `prompt_engine` 🎯

**Universal Prompt Executor**: Systematically executes prompts, templates, and chains with structural analysis and quality gate validation. Automatically detects execution type and handles step-by-step progression.

**Key Capabilities**:
- **Structural Analysis**: File structure detection for execution routing (prompt/template/chain)
- **Framework Integration**: Applies active framework methodology (CAGEERF, ReACT, 5W1H, SCAMPER)
- **Quality Gates**: Configurable validation with systematic retry mechanisms
- **LLM-Driven Chains**: Step-by-step workflow coordination with state management

**Parameters**:

```typescript
{
  command: string;                    // Required: Command to execute (>>prompt_name args)
  execution_mode?: "auto" | "template" | "chain";  // Optional: Override detection
  gate_validation?: boolean;          // Optional: Enable quality gates
  llm_driven_execution?: boolean;     // Optional: Enable LLM-driven chain coordination (requires semantic LLM integration)
  force_restart?: boolean;            // Optional: Force restart chain from beginning, clearing all state
  session_id?: string;                // Optional: Specific session ID to use or resume
  chain_uri?: string;                 // Optional: Full chain URI for precise session control
}
```

**Execution Types**:
- **Prompt**: Basic variable substitution (fastest, no framework injection)
- **Template**: Framework-enhanced processing with methodology injection
- **Chain**: LLM-driven sequential execution with step validation

**Example Usage**:
```bash
# Basic execution with structural detection
prompt_engine >>content_analysis text="my data"

# Force template execution with framework enhancement
prompt_engine >>analysis_prompt input="data" execution_mode="template"

# Chain execution with LLM coordination (requires semantic LLM integration enabled)
prompt_engine >>research_chain topic="AI" llm_driven_execution=true
```

#### Chain Execution Parameters

For chain execution, the prompt engine supports advanced session management and URI-based control:

**Session Control Parameters**:
- `force_restart` - Clear all existing state and restart from beginning
- `session_id` - Resume specific session ID
- `chain_uri` - Use URI-based control for precise session management

**Example Session Control Usage**:
```bash
# Auto-resume existing session (default behavior)
prompt_engine >>research_chain topic="AI"

# Force restart from beginning
prompt_engine >>research_chain topic="AI" force_restart=true

# Resume specific session
prompt_engine >>research_chain topic="AI" session_id="chain-session-1234"

# URI-based control
prompt_engine >>research_chain chain_uri="chain://research_chain?force_restart=true"
```

#### Chain URI Syntax

Chain URIs provide precise control over chain execution with the following syntax:

**URI Format**:
```
chain://chainId[/sessionId[/stepId]][?queryParams]
```

**Components**:
- `chainId` - Chain identifier (required)
- `sessionId` - Specific session ID (optional)
- `stepId` - Specific step ID (optional, for future use)
- `queryParams` - Execution options as query parameters

**Query Parameters**:
- `force_restart=true` - Force restart clearing all state
- `framework=CAGEERF` - Specify framework methodology
- `error_handling=continue` - Error handling strategy
- `max_retries=5` - Maximum retry attempts per step
- `conditional_mode=true` - Enable conditional branching execution (Phase 2A)
- `conditional_debug=true` - Enable conditional execution debugging

**URI Examples**:
```bash
# Basic execution with auto-session resolution
prompt_engine chain_uri="chain://research_pipeline"

# Force restart with query parameters
prompt_engine chain_uri="chain://research_pipeline?force_restart=true"

# Specific session resumption
prompt_engine chain_uri="chain://research_pipeline/session-abc123"

# Custom framework and options
prompt_engine chain_uri="chain://research_pipeline?framework=CAGEERF"

# Complex configuration
prompt_engine chain_uri="chain://research_pipeline?force_restart=true&framework=ReACT&error_handling=continue"

# Conditional branching mode (NEW in Phase 2A)
prompt_engine chain_uri="chain://research_pipeline?conditional_mode=true"

# Conditional debugging and enhanced workflow
prompt_engine chain_uri="chain://research_pipeline?conditional_mode=true&conditional_debug=true"
```

**Smart Error Recovery**:
When chains get stuck in failed state, the system provides actionable guidance with specific recovery options including restart URIs, session resume URIs, and troubleshooting recommendations.

#### Advanced Conditional Branching (Phase 2A)

The system now supports sophisticated conditional execution with safe JavaScript expression evaluation for dynamic workflow control.

**Conditional Chain Definition Example**:
```json
{
  "id": "analysis_workflow",
  "name": "Conditional Analysis Workflow",
  "steps": [
    {
      "id": "data_validation",
      "promptId": "validate_data",
      "name": "Data Validation",
      "order": 0,
      "dependencies": [],
      "conditionalExecution": {
        "type": "always",
        "description": "Always validate input data"
      }
    },
    {
      "id": "simple_analysis",
      "promptId": "basic_analysis",
      "name": "Simple Analysis",
      "order": 1,
      "dependencies": ["data_validation"],
      "conditionalExecution": {
        "type": "conditional",
        "expression": "utils.length(steps.data_validation.result) < 1000",
        "description": "Use simple analysis for small datasets"
      }
    },
    {
      "id": "complex_analysis",
      "promptId": "advanced_analysis",
      "name": "Complex Analysis",
      "order": 2,
      "dependencies": ["data_validation"],
      "conditionalExecution": {
        "type": "conditional",
        "expression": "utils.length(steps.data_validation.result) >= 1000",
        "description": "Use advanced analysis for large datasets"
      }
    },
    {
      "id": "error_recovery",
      "promptId": "handle_errors",
      "name": "Error Recovery",
      "order": 3,
      "dependencies": ["simple_analysis", "complex_analysis"],
      "conditionalExecution": {
        "type": "skip_if_success",
        "description": "Only run if previous steps had errors"
      }
    }
  ]
}
```

**Conditional Execution Types**:
- `always` - Always execute this step
- `conditional` - Execute based on JavaScript expression evaluation
- `skip_if_error` - Skip if current step has errors
- `skip_if_success` - Skip if current step succeeded (run only on failure)
- `branch_to` - Branch to specific step based on condition
- `skip_to` - Skip to specific step (future use)

**Expression Evaluation Context**:
Conditional expressions have access to:
- `steps` - Results from previous steps (e.g., `steps.data_validation.result`)
- `vars` - Chain variables (e.g., `vars.userInput`)
- `utils` - Utility functions for safe operations

**Available Utility Functions**:
- `utils.exists(value)` - Check if value exists (not null/undefined)
- `utils.contains(string, substring)` - Check if string contains substring
- `utils.length(value)` - Get length of string, array, or object
- `utils.toNumber(value)` - Convert to number safely
- `utils.toString(value)` - Convert to string safely
- `utils.matches(string, regex)` - Test regex pattern

**Security Features**:
- **Expression Validation**: Dangerous patterns (eval, require, process) are blocked
- **Timeout Protection**: Expressions timeout after 5 seconds
- **Sandboxed Execution**: No access to global objects or Node.js APIs
- **Safe Evaluation**: Uses isolated execution context

**Conditional Execution Examples**:
```bash
# Enable conditional mode for advanced workflow control
prompt_engine >>analysis_workflow data="large_dataset" conditional_mode=true

# Enable debugging to see conditional evaluation details
prompt_engine >>analysis_workflow data="test" conditional_mode=true conditional_debug=true

# Combine with URI syntax for precise control
prompt_engine chain_uri="chain://analysis_workflow?conditional_mode=true&conditional_debug=true&framework=CAGEERF"
```

### `prompt_manager` 📋

**Complete Lifecycle Management**: Create, update, delete, analyze, and manage prompts with advanced filtering and type analysis capabilities.

**Key Capabilities**:
- **Smart Filtering**: Advanced filter syntax (category:, type:, confidence:, etc.)
- **Type Analysis**: Automatic execution type detection and classification
- **Lifecycle Management**: Full CRUD operations with hot-reload support
- **Migration Tools**: Convert between prompt types and analyze existing prompts

**Actions Available**:
- `list` - List and filter prompts with advanced search
- `create` - Create new prompts with type detection
- `create_prompt` - Create basic prompt (fast variable substitution)
- `create_template` - Create framework-enhanced template
- `update` - Update existing prompts
- `delete` - Remove prompts with cleanup
- `analyze_type` - Analyze prompt and recommend execution type
- `migrate_type` - Convert between prompt and template types
- `modify` - Modify specific sections of prompts

**Advanced Filtering**:
```bash
# Filter by category
prompt_manager list filter="category:analysis"

# Filter by execution type
prompt_manager list filter="type:template"

# Combined filters
prompt_manager list filter="category:code type:template"

# Intent-based search
prompt_manager list filter="intent:debugging"
```

**Example Usage**:
```bash
# List all prompts with advanced filtering
prompt_manager list

# Create framework-enhanced template
prompt_manager create_template name="code_analyzer" category="development" \
  content="Analyze {{code}} for security and performance issues"

# Create conditional chain with branching logic (Phase 2A)
prompt_manager create_template name="conditional_analysis" category="analysis" \
  content="Dynamic analysis workflow with conditional branching" \
  chain_steps='[
    {
      "promptId": "data_check",
      "stepName": "Data Validation",
      "conditionalExecution": {"type": "always"}
    },
    {
      "promptId": "simple_analysis",
      "stepName": "Simple Analysis",
      "conditionalExecution": {
        "type": "conditional",
        "expression": "utils.length(steps.data_check.result) < 1000"
      }
    },
    {
      "promptId": "complex_analysis",
      "stepName": "Complex Analysis",
      "conditionalExecution": {
        "type": "conditional",
        "expression": "utils.length(steps.data_check.result) >= 1000"
      }
    }
  ]'

# Analyze existing prompt type
prompt_manager analyze_type prompt_id="my_prompt"

# Update prompt content
prompt_manager update id="analysis_prompt" content="new template content"
```

### `system_control` ⚙️

**Framework Management & System Administration**: Control framework switching, monitor switching performance, manage system health, and access comprehensive analytics.

**Key Capabilities**:
- **Framework Switching**: Runtime methodology switching (CAGEERF, ReACT, 5W1H, SCAMPER)
- **Switching Performance**: Track switching mechanics (timing, success rate, error count)
- **System Health**: Monitor server health, module status, and resource usage
- **Usage Analytics**: Framework usage statistics and system performance metrics

**Actions Available**:
- `status` - Comprehensive system status and framework state
- `switch_framework` - Change active framework methodology
- `list_frameworks` - Show available frameworks with details
- `analytics` - System performance analytics and usage metrics
- `health` - Health monitoring and diagnostic information
- `diagnostics` - Detailed system diagnostics and recommendations
- `reset_metrics` - Reset framework switching performance metrics
- `switch_history` - View framework switching history
- `config` - System configuration management

**Framework Management**:
```bash
# Check current framework status
system_control status

# Switch framework methodology
system_control switch_framework framework="ReACT" reason="Problem-solving focus"

# View available frameworks
system_control list_frameworks show_details=true

# Get framework switching history
system_control switch_history limit=10
```

**Analytics & Monitoring**:
```bash
# View system analytics
system_control analytics include_history=true

# Check system health
system_control health

# Run diagnostics
system_control diagnostics

# Reset switching performance metrics
system_control reset_metrics confirm=true
```

---

## Tool Response Format

All tools return standardized responses with consistent error handling:

```typescript
interface ToolResponse {
  content: Array<{
    type: "text" | "resource";
    text?: string;
    resource?: {
      uri: string;
      text: string;
    };
  }>;
  isError?: boolean;
}
```

---

## Framework System Integration

### Available Frameworks

The system provides **4 proven methodologies** for systematic thinking:

- **CAGEERF**: Comprehensive structured approach (Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework)
- **ReACT**: Reasoning and Acting pattern for systematic problem-solving
- **5W1H**: Who, What, When, Where, Why, How systematic analysis  
- **SCAMPER**: Creative problem-solving (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)

### Framework Selection

Framework selection uses **rule-based logic** based on:
- **User Preference**: Manual selection takes priority
- **Execution Type**: Templates get framework enhancement, prompts bypass for speed
- **Structural Complexity**: Basic structural analysis informs suggestions
- **Current Active Framework**: Templates use the currently active methodology

### Switching Performance Metrics

The system tracks **framework switching mechanics** (not effectiveness):
- **Switch Count**: Total number of framework switches
- **Switch Success Rate**: Percentage of successful framework switches  
- **Switch Time**: Average time for framework switching operations
- **Error Count**: Number of failed switching attempts

**Note**: Metrics track switching performance, not methodology effectiveness or output quality.

---

## Usage Examples

### Complete Workflow Example

```bash
# 1. Check system status and active framework
system_control status

# 2. Switch to appropriate framework for your task
system_control switch_framework framework="CAGEERF" reason="Complex analysis needed"

# 3. List relevant prompts
prompt_manager list filter="category:analysis type:template"

# 4. Execute analysis with framework enhancement
prompt_engine >>comprehensive_analysis data="my research data" execution_mode="template"

# 5. Check switching performance
system_control analytics
```

### Chain Workflow Example

```bash
# 1. Create analysis chain
prompt_manager create_template name="research_chain" category="research" \
  content="Multi-step research analysis workflow" \
  chain_steps='[{"promptId":"data_collection","stepName":"Data Collection"},{"promptId":"analysis_step","stepName":"Analysis"},{"promptId":"summary_step","stepName":"Summary"}]'

# 2. Execute chain with step validation and LLM coordination
prompt_engine >>research_chain topic="AI trends" llm_driven_execution=true gate_validation=true

# 3. Monitor chain execution through system status
system_control status
```

### Conditional Branching Workflow Example (Phase 2A)

```bash
# 1. Create conditional analysis chain with branching logic
prompt_manager create_template name="adaptive_analysis" category="analysis" \
  content="Adaptive analysis with conditional execution paths" \
  chain_steps='[
    {
      "promptId": "input_assessment",
      "stepName": "Input Assessment",
      "conditionalExecution": {"type": "always"}
    },
    {
      "promptId": "quick_analysis",
      "stepName": "Quick Analysis",
      "conditionalExecution": {
        "type": "conditional",
        "expression": "utils.contains(steps.input_assessment.result, \"simple\")"
      }
    },
    {
      "promptId": "deep_analysis",
      "stepName": "Deep Analysis",
      "conditionalExecution": {
        "type": "conditional",
        "expression": "utils.contains(steps.input_assessment.result, \"complex\")"
      }
    },
    {
      "promptId": "error_handler",
      "stepName": "Error Recovery",
      "conditionalExecution": {"type": "skip_if_success"}
    }
  ]'

# 2. Execute conditional chain with debugging enabled
prompt_engine >>adaptive_analysis input="complex data analysis task" \
  conditional_mode=true conditional_debug=true

# 3. Alternative execution with URI syntax for precise control
prompt_engine chain_uri="chain://adaptive_analysis?conditional_mode=true&conditional_debug=true&framework=CAGEERF"

# 4. Monitor conditional execution and branching decisions
system_control status
```

---

## Error Handling

All tools implement comprehensive error handling:

- **Validation Errors**: Invalid parameters or missing required fields
- **Execution Errors**: Prompt execution failures with detailed context
- **System Errors**: Framework switching failures or system issues
- **Recovery Suggestions**: Actionable guidance for resolving issues

---

## Performance Characteristics

### Execution Speed Comparison

```
Prompt Execution:    50-200ms    (basic variable substitution)
Template Execution:  200-800ms   (framework enhancement + validation)
Chain Execution:     Variable    (depends on step count and LLM response time)
```

### Tool Consolidation Benefits

**Intelligent Routing**: Enhanced command detection with automatic tool routing
- **Simplified Interface**: Single tools handle multiple related functions
- **Consistent Experience**: Standardized response format and error handling
- **Reduced Complexity**: Easier to learn and use
- **Maintained Functionality**: All original capabilities preserved

---

## Migration from Legacy Tools

If you have references to old tool names, here's the mapping:

| Legacy Tool | Consolidated Tool | Action |
|------------|------------------|---------|
| `execute_prompt` | `prompt_engine` | Direct replacement |
| `listprompts` | `prompt_manager` | `list` action |
| `update_prompt` | `prompt_manager` | `create` or `update` actions |
| `delete_prompt` | `prompt_manager` | `delete` action |
| `modify_prompt_section` | `prompt_manager` | `modify` action |
| `reload_prompts` | `system_control` | `reload` action |
| `execution_analytics` | `system_control` | `analytics` action |

### API Parameter Changes

**Chain Creation Simplified** (v1.2.0+):

| Old API (Deprecated) | New API |
|---------------------|---------|
| `isChain=true` | ❌ **Removed** - redundant parameter |
| `chain_steps='[...]'` | ✅ **Chain detection automatic** |

**Migration Example**:
```bash
# ❌ OLD - Don't use isChain anymore
prompt_manager create name="chain" isChain=true chain_steps='[...]'

# ✅ NEW - Chain detected automatically from steps
prompt_manager create name="chain" chain_steps='[{"promptId":"step1","stepName":"Step 1"}]'
```

---

## System Requirements

- **MCP Client**: Any MCP-compatible client (Claude Desktop, Cursor Windsurf, etc.)
- **Transport**: STDIO (primary) or SSE (web clients)
- **Node.js**: Version 16 or higher
- **Memory**: ~50MB base usage, scales with prompt library size

---

**Documentation Version**: 1.4.0 (Phase 2A Conditional Branching)
**Last Updated**: 2025-01-30
**Compatibility**: Universal MCP client support with advanced conditional workflow capabilities
