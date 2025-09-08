# Prompt Management

This document describes how to manage prompts in the MCP server using the **consolidated prompt management system** through the `prompt_manager` tool and distributed prompts configuration.

## Consolidated Architecture Overview

The MCP server uses **3 consolidated tools** for all prompt management operations:

- **`prompt_manager`**: Complete lifecycle management with intelligent analysis and filtering
- **`prompt_engine`**: Execute prompts with framework integration and gate validation
- **`system_control`**: Framework switching, analytics, and system administration

**Key Benefits:**

- **Action-Based Interface**: Single tools with multiple actions instead of separate tools
- **Intelligent Features**: Type analysis, framework integration, advanced filtering
- **MCP Protocol Only**: No HTTP API - works through MCP-compatible clients

## Distributed Prompts Configuration System

The server organizes prompts using a distributed configuration system where prompts are organized by category, with each category having its own configuration file.

### Key Components

1. **promptsConfig.json** - Main configuration file defining categories and imports
2. **Category-specific prompts.json files** - Each category has its own prompts.json file
3. **Prompt .md files** - Individual prompt templates using Nunjucks templating

## Main Configuration (promptsConfig.json)

The main configuration file defines all available categories and specifies which category-specific prompts.json files to import:

```json
{
  "categories": [
    {
      "id": "general",
      "name": "General",
      "description": "General-purpose prompts for everyday tasks"
    },
    {
      "id": "analysis",
      "name": "Analysis",
      "description": "Analytical and research-focused prompts"
    },
    {
      "id": "development",
      "name": "Development",
      "description": "Software development and coding prompts"
    }
    // More categories...
  ],
  "imports": [
    "prompts/general/prompts.json",
    "prompts/analysis/prompts.json",
    "prompts/development/prompts.json"
    // More imports...
  ]
}
```

### Categories

Each category in the `categories` array has:

- `id` (string) - Unique identifier for the category
- `name` (string) - Display name for the category
- `description` (string) - Description of the category's purpose

### Imports

The `imports` array lists paths to category-specific prompts.json files, relative to the server's working directory.

## Category-Specific Prompts Files

Each category has its own prompts.json file (e.g., `prompts/general/prompts.json`):

```json
{
  "prompts": [
    {
      "id": "content_analysis",
      "name": "Content Analysis",
      "category": "analysis",
      "description": "Systematic analysis of content using structured methodology",
      "file": "content_analysis.md",
      "arguments": [
        {
          "name": "content",
          "description": "The content to analyze",
          "required": true
        },
        {
          "name": "focus",
          "description": "Specific focus area for analysis",
          "required": false
        }
      ]
    }
    // More prompts...
  ]
}
```

Each prompt has:

- `id` (string) - Unique identifier
- `name` (string) - Display name
- `category` (string) - Category this prompt belongs to
- `description` (string) - What the prompt does
- `file` (string) - Path to .md file with template
- `arguments` (array) - Arguments the prompt accepts
- `isChain` (boolean, optional) - Whether this is a chain prompt
- `chainSteps` (array, optional) - Steps for chain prompts
- `onEmptyInvocation` (string, optional) - Behavior when invoked without arguments

## Consolidated Prompt Management

### prompt_manager Tool Actions

The `prompt_manager` tool provides comprehensive prompt lifecycle management through **action-based commands**:

#### Core Actions

- `list` - List and filter prompts with intelligent search
- `create` - Auto-detect type and create appropriate prompt
- `create_prompt` - Create basic prompt (fast variable substitution)
- `create_template` - Create framework-enhanced template
- `update` - Update existing prompts
- `delete` - Delete prompts with safety checks

#### Advanced Actions

- `analyze_type` - Analyze prompt and recommend execution type
- `migrate_type` - Convert between prompt types (prompt ↔ template)
- `modify` - Precision editing of specific sections
- `reload` - Trigger hot-reload of prompt system

### Basic Prompt Management

#### Listing Prompts

```bash
# List all prompts
prompt_manager list

# List prompts in specific category
prompt_manager list filter="category:analysis"

# List by execution type
prompt_manager list filter="type:template"

# Combined filters
prompt_manager list filter="category:development type:chain"

# Intent-based search
prompt_manager list filter="intent:debugging"
```

#### Creating Prompts

```bash
# Auto-detect appropriate type
prompt_manager create name="Data Processor" category="analysis" \
  description="Process and analyze data systematically" \
  content="Analyze {{data}} and provide insights on {{focus_area}}"

# Create basic prompt (fast execution)
prompt_manager create_prompt name="Simple Greeting" category="general" \
  description="Basic personalized greeting" \
  content="Hello {{name}}, welcome to {{service}}!" \
  arguments='[{"name":"name","required":true},{"name":"service","required":false}]'

# Create framework-enhanced template
prompt_manager create_template name="Research Analysis" category="analysis" \
  description="Comprehensive research analysis using active methodology" \
  content="Research {{topic}} using systematic approach. Focus on {{aspects}}." \
  arguments='[{"name":"topic","required":true},{"name":"aspects","required":false}]'
```

#### Updating Prompts

```bash
# Update prompt content
prompt_manager update id="data_processor" \
  content="Enhanced analysis of {{data}} with focus on {{methodology}}"

# Update prompt metadata
prompt_manager update id="greeting_prompt" \
  name="Enhanced Greeting" \
  description="Improved greeting with personalization"

# Precision section editing
prompt_manager modify id="analysis_prompt" \
  section="User Message Template" \
  new_content="Analyze {{content}} using {{framework}} methodology"
```

#### Deleting Prompts

```bash
# Delete prompt with safety checks
prompt_manager delete id="old_prompt"

# The system will warn if prompt is referenced by chains or other prompts
```

### Advanced Features

#### Type Analysis & Migration

```bash
# Analyze existing prompt for optimization recommendations
prompt_manager analyze_type id="basic_analysis"
# Returns: execution type, framework suitability, improvement suggestions

# Convert prompt to framework-enhanced template
prompt_manager migrate_type id="simple_prompt" target_type="template"

# Convert template back to basic prompt for speed
prompt_manager migrate_type id="complex_template" target_type="prompt"
```

#### Framework Integration

```bash
# Switch to desired framework before creating templates
system_control switch_framework framework="CAGEERF" reason="Complex analysis needed"

# Create framework-aware template
prompt_manager create_template name="Strategic Analysis" category="business" \
  description="CAGEERF-enhanced strategic analysis" \
  content="Analyze {{situation}} using comprehensive structured approach"

# Templates automatically use active framework methodology
```

#### Chain Prompt Creation

```bash
# Create multi-step chain prompt
prompt_manager create_template name="Research Workflow" category="research" \
  description="Multi-step research and analysis workflow" \
  isChain=true \
  content="Research workflow for {{topic}} with comprehensive analysis" \
  chainSteps='[
    {
      "promptId": "data_collection",
      "stepName": "Data Collection",
      "inputMapping": {"topic": "research_topic"},
      "outputMapping": {"collected_data": "step1_output"}
    },
    {
      "promptId": "data_analysis",
      "stepName": "Analysis",
      "inputMapping": {"data": "step1_output"},
      "outputMapping": {"analysis_result": "final_output"}
    }
  ]'
```

### Intelligent Filtering System

The `prompt_manager list` command supports advanced filtering:

#### Filter Syntax

- **Category**: `category:analysis`, `category:development`
- **Type**: `type:prompt`, `type:template`, `type:chain`
- **Intent**: `intent:debugging`, `intent:analysis`, `intent:creation`
- **Confidence**: `confidence:>80`, `confidence:70-90`
- **Framework**: `framework:CAGEERF`, `framework:ReACT`

#### Advanced Examples

```bash
# Find high-confidence templates in analysis category
prompt_manager list filter="category:analysis type:template confidence:>85"

# Find debugging-related prompts
prompt_manager list filter="intent:debugging"

# Find prompts suitable for current framework
system_control status  # Check active framework
prompt_manager list filter="framework:CAGEERF type:template"
```

## Advanced Templating with Nunjucks

The prompt templating system supports **Nunjucks** for dynamic prompt construction:

### Key Features

- **Conditional Logic (`{% if %}`)**: Show/hide content based on arguments
- **Loops (`{% for %}`)**: Iterate over arrays dynamically
- **Standard Placeholders**: `{{variable}}` syntax continues to work
- **Macros (`{% macro %}`)**: Reusable template components
- **Filters (`|`)**: Transform data (upper, lower, default, etc.)

### Template Processing

1. **Nunjucks Rendering**: Process `{% %}` tags and `{{ }}` placeholders
2. **Text Reference Expansion**: Handle long text references (ref:xyz)
3. **Framework Enhancement**: Apply active methodology if template type

### Examples

#### Conditional Logic

```nunjucks
{% if user_name %}
Hello, {{user_name}}! Thanks for providing your name.
{% else %}
Hello there!
{% endif %}

{% if analysis_type == "comprehensive" %}
This requires detailed CAGEERF methodology analysis.
{% elif analysis_type == "quick" %}
Using streamlined ReACT approach.
{% endif %}
```

#### Loops

```nunjucks
Please analyze the following data points:
{% for item in data_list %}
- {{ loop.index }}. {{ item }}
{% endfor %}
```

#### Macros for Reusability

```nunjucks
{% macro analysis_section(title, content, methodology) %}
## {{ title }}
**Methodology**: {{ methodology }}
**Content**: {{ content }}
{% endmacro %}

{{ analysis_section("Market Analysis", market_data, "CAGEERF") }}
{{ analysis_section("Risk Assessment", risk_data, "5W1H") }}
```

#### Filters

```nunjucks
Topic: {{ topic_name | upper }}
Priority: {{ priority_level | default("Medium") }}
Items: {{ item_count | length }} total
Summary: {{ long_text | truncate(100) }}
```

## Integration with Consolidated Architecture

### MCP Tool Coordination

```bash
# Complete workflow using all 3 tools
system_control status                          # Check system state
system_control switch_framework framework="CAGEERF"  # Set methodology
prompt_manager create_template name="..." category="..." # Create template
prompt_engine >>template_name input="data" gate_validation=true # Execute with gates
system_control analytics                       # Monitor performance
```

### Framework-Aware Operations

```bash
# Framework affects template creation and execution
system_control list_frameworks                 # See available frameworks
system_control switch_framework framework="ReACT" reason="Problem-solving focus"

# Templates created after switching inherit framework
prompt_manager create_template name="Problem Solver" category="analysis"

# Execute with framework enhancement
prompt_engine >>problem_solver issue="complex problem" execution_mode="template"
```

### Performance Monitoring

```bash
# Monitor prompt management operations
system_control analytics include_history=true
# Shows: prompt creation stats, execution statistics, framework usage

# Check system health
system_control health
# Includes: prompt loading status, template processing health, framework integration
```

## File Management

### Automatic File Operations

When using `prompt_manager`, the system automatically:

1. **Creates .md files** in appropriate category directories
2. **Updates prompts.json** in category folders
3. **Maintains file consistency** across configuration and files
4. **Triggers hot-reload** to refresh the system

### File Structure

```
prompts/
├── analysis/
│   ├── prompts.json          # Category prompt registry
│   ├── content_analysis.md   # Individual prompt templates
│   └── research_workflow.md
├── development/
│   ├── prompts.json
│   ├── code_review.md
│   └── debugging_guide.md
└── promptsConfig.json        # Main configuration
```

### Generated .md File Structure

```markdown
# Prompt Name

## Description

Prompt description explaining purpose and usage

## System Message

Optional system message for framework enhancement

## User Message Template

Template content with {{variables}} and Nunjucks logic

## Arguments

- name: Description (required/optional)
- focus: Analysis focus area (optional)

## Chain Steps (for chain prompts)

1. Step 1: Data Collection
2. Step 2: Analysis
3. Step 3: Recommendations
```

## Troubleshooting

### Common Issues

#### Tool Not Found Errors

- **Issue**: `create_category tool not found`
- **Solution**: Use `prompt_manager` with action: `prompt_manager create_category`

#### Legacy Tool References

- **Issue**: Documentation mentions `update_prompt` standalone tool
- **Solution**: Use consolidated tool: `prompt_manager update id="..." content="..."`

#### HTTP API Errors

- **Issue**: HTTP fetch examples don't work
- **Solution**: MCP server uses MCP protocol only - use MCP-compatible clients

#### Framework Integration Issues

- **Issue**: Templates not getting framework enhancement
- **Solution**: Verify active framework with `system_control status` and use `create_template` action

### Debug Commands

```bash
# Check system health including prompt loading
system_control health

# Verify prompt registration
prompt_manager list

# Check framework integration
system_control status

# View comprehensive diagnostics
system_control diagnostics
```

## Best Practices

### Prompt Type Selection

- **Basic Prompts**: Use `create_prompt` for simple variable substitution (fastest)
- **Framework Templates**: Use `create_template` for analysis, reasoning, complex tasks
- **Chains**: Use `isChain=true` for multi-step workflows requiring state management

### Framework Integration

- Switch to appropriate framework before creating templates
- Use `analyze_type` to get recommendations for existing prompts
- Use `migrate_type` to upgrade prompts for framework enhancement

### Organization

- Group related prompts into logical categories
- Use descriptive names and comprehensive descriptions
- Leverage Nunjucks for maintainable, reusable templates
- Test prompts with various argument combinations

### Performance Optimization

- Use basic prompts for simple operations (bypasses framework overhead)
- Use templates when methodology enhancement adds value
- Monitor performance with `system_control analytics`
- Consider prompt complexity vs. execution speed trade-offs

## Advanced Workflows

### Template Development Workflow

```bash
# 1. Analyze requirements
prompt_manager analyze_type id="existing_prompt"  # If converting existing

# 2. Set appropriate framework
system_control switch_framework framework="CAGEERF"

# 3. Create framework-enhanced template
prompt_manager create_template name="Advanced Analysis" category="research"

# 4. Test execution with gates
prompt_engine >>advanced_analysis input="test data" gate_validation=true

# 5. Monitor performance
system_control analytics
```

### Chain Development Workflow

```bash
# 1. Create individual step prompts
prompt_manager create_template name="collect_data" category="research"
prompt_manager create_template name="analyze_data" category="research"
prompt_manager create_template name="generate_insights" category="research"

# 2. Create chain prompt linking steps
prompt_manager create_template name="research_pipeline" category="research" \
  isChain=true \
  chainSteps='[{"promptId":"collect_data","stepName":"Collection"}, ...]'

# 3. Execute complete chain
prompt_engine >>research_pipeline topic="market analysis" auto_execute_chain=true

# 4. Monitor chain execution
system_control status  # Check execution state
```

## Migration from Legacy Tools

If you have references to old tool names:

| Legacy Tool             | Consolidated Usage                  |
| ----------------------- | ----------------------------------- |
| `create_category`       | `prompt_manager create_category`    |
| `update_prompt`         | `prompt_manager create` or `update` |
| `delete_prompt`         | `prompt_manager delete`             |
| `modify_prompt_section` | `prompt_manager modify`             |
| `reload_prompts`        | `prompt_manager reload`             |
| `listprompts`           | `prompt_manager list`               |

**Key Changes:**

- **No HTTP API**: Use MCP protocol through compatible clients
- **Action-Based**: Single tools with actions instead of separate tools
- **Enhanced Features**: Type analysis, framework integration, intelligent filtering
- **Consolidated**: 3 tools instead of 24+ legacy tools

---

The consolidated prompt management system provides sophisticated prompt lifecycle management while maintaining simplicity and performance. The `prompt_manager` tool offers comprehensive capabilities from basic CRUD operations to advanced features like type analysis, framework integration, and intelligent filtering, all within the efficient 3-tool consolidated architecture.
