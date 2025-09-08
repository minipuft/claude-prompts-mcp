# MCP Tools Reference (v1.3.0 - Consolidated Architecture)

This document provides a comprehensive reference for the 3 consolidated MCP (Model Context Protocol) tools that power the Claude Prompts Server. The server implements **87.5% tool consolidation** (24+ tools → 3 consolidated tools) while maintaining full functionality.

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
  step_confirmation?: boolean;        // Optional: Confirm each chain step
  auto_execute_chain?: boolean;       // Optional: Auto-execute all chain steps
  timeout?: number;                   // Optional: Execution timeout (ms)
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

# Chain execution with step confirmation
prompt_engine >>research_chain topic="AI" auto_execute_chain=true step_confirmation=true
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
  isChain=true content="Multi-step research analysis workflow"

# 2. Execute chain with step validation
prompt_engine >>research_chain topic="AI trends" auto_execute_chain=true gate_validation=true

# 3. Monitor chain execution through system status
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

**87.5% Reduction**: 24+ legacy tools → 3 consolidated tools
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

---

## System Requirements

- **MCP Client**: Any MCP-compatible client (Claude Desktop, Cursor Windsurf, etc.)
- **Transport**: STDIO (primary) or SSE (web clients)
- **Node.js**: Version 16 or higher
- **Memory**: ~50MB base usage, scales with prompt library size

---

**Documentation Version**: 1.3.0 (Consolidated Architecture)  
**Last Updated**: 2025-01-30  
**Compatibility**: Universal MCP client support