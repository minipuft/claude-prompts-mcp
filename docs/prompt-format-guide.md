# Prompt Format Guide

This document explains the format and structure of prompts in the Claude Custom Prompts server, including the new standardized execution headers and gate validation features introduced in v1.1.0.

## Prompt Configuration System

Prompts are organized in a distributed configuration system:

1. **promptsConfig.json**: The main configuration file that defines categories and imports
2. **Category-specific prompts.json files**: Each category has its own prompts.json file
3. **Markdown template files**: The actual prompt templates are stored as markdown files

### Configuration Structure

For a complete explanation of the configuration structure, see the [Prompt Management](prompt-management.md) documentation.

## Intelligent Prompt File Structure (v1.1.0)

Prompt templates are stored as markdown files with a specific structure. The system now uses **intelligent semantic analysis** to automatically detect execution requirements, making manual configuration unnecessary.

**Key Enhancement**: Execution headers are now **purely optional hints** - the system automatically detects execution types and requirements from prompt content using advanced semantic analysis.

### Intelligent Structure (Recommended)

```markdown
# Prompt Title

Brief description of what the prompt does and its purpose.

## System Message

System instructions for Claude.

## User Message Template

Template for the user message with {{placeholders}}.

## Arguments

- argument1: Description of the first argument
- argument2: Description of the second argument
```

**🧠 Automatic Detection**: The system automatically analyzes your prompt content to determine:

- **Execution Type**: Whether it's a basic prompt, template, or chain
- **Quality Gates**: Appropriate validation based on complexity
- **Execution Requirements**: Whether execution or template return is needed

### Optional Enhancement Headers (Legacy)

If you want to provide explicit hints to Claude (completely optional):

```markdown
# Prompt Title

_Optional execution hints for Claude:_
**🎯 EXECUTION TYPE**: Chain Template | Multi-Step Chain | Template
**⚡ EXECUTION REQUIRED**: This template requires execution / outputs instructions

## Description

Brief description of what the prompt does and its purpose.

## System Message

System instructions for Claude.

## User Message Template

Template for the user message with {{placeholders}}.

## Arguments

- argument1: Description of the first argument
- argument2: Description of the second argument
```

**Note**: Headers like AUTO-EXECUTION, TOOL INTEGRATION, etc. are no longer needed - the system handles execution intelligently.

## Intelligent Analysis System (v1.1.0)

The system now uses advanced semantic analysis to automatically understand prompts without manual configuration:

### Automatic Detection Features

#### **🧠 Semantic Content Analysis**

The system analyzes prompt content using advanced patterns:

- **Chain Detection**: Identifies systematic, multi-step approaches
- **Action Detection**: Recognizes analysis, processing, and execution requirements
- **Instruction Generation**: Detects templates that output step-by-step guidance
- **Template Information**: Identifies prompts that return data vs. executable content

#### **🎯 Intelligent Classification**

Prompts are automatically classified into types:

- **`chain`**: Requires execution with quality validation (confidence-based)
- **`chain`**: Multi-step sequential execution with step tracking
- **`template`**: Returns information or configuration data

#### **🛡️ Auto-Assigned Quality Gates**

Quality gates are intelligently assigned based on:

- **Content Complexity**: More arguments = more validation
- **Analysis Requirements**: Analysis prompts get keyword presence checks
- **Chain Patterns**: Step-by-step content gets completion validation
- **Chain Operations**: Multi-step chains get step completion gates

#### **⚡ Smart Execution Decisions**

The system automatically decides whether to:

- **Execute immediately**: For high-confidence chains
- **Return template info**: For information-only prompts
- **Apply quality gates**: Based on prompt complexity and type

### Usage Examples

#### **Simple Usage (Recommended)**

```bash
# System automatically detects and executes appropriately
>>content_analysis "your content here"

# System auto-detects this is a chain, applies quality gates, executes
>>notes "research data to analyze"

# System detects this is a template info request, returns guidance
>>listprompts
```

#### **Manual Override (When Needed)**

```bash
# Force specific execution mode
>>execute_prompt {"command": ">>content_analysis data", "execution_mode": "chain"}

# Apply stricter gate validation for sensitive chains
>>execute_prompt {"command": ">>notes data", "quality_gates": ["accuracy", "safety"]}
```

### Required Sections

1. **Title** (Level 1 Heading): The name of the prompt
2. **Description** (Level 2 Heading): Brief explanation of the prompt's purpose
3. **User Message Template** (Level 2 Heading): The template for the user message with placeholders

### Optional Sections

1. **System Message** (Level 2 Heading): Instructions for Claude's behavior
2. **Execution Headers** (Bold formatted): New standardized execution guidance
3. **Chain Steps** (Level 2 Heading): For chain prompts, defines the steps in the chain

## Placeholders and Arguments

Placeholders in templates are denoted by double curly braces: `{{argument_name}}`.

### Argument Registration

Arguments are defined in the category's prompts.json file for each prompt:

```json
{
  "prompts": [
    {
      "id": "friendly_greeting",
      "name": "Friendly Greeting",
      "category": "general",
      "description": "A warm, personalized greeting that makes the user feel welcome and valued.",
      "file": "friendly_greeting.md",
      "arguments": [
        {
          "name": "name",
          "description": "The name of the person to greet",
          "required": false
        }
      ]
    }
  ]
}
```

Each argument has the following properties:

- `name`: The name of the argument, used in placeholders
- `description`: Description of the argument's purpose
- `required`: Whether the argument is required (boolean)

## Example Prompt

````markdown
# Code Review

This prompt helps Claude review code and provide feedback.

## System Message

You are an expert code reviewer with deep knowledge of software engineering principles and best practices. Your task is to review code snippets and provide constructive feedback.

## User Message Template

Please review the following {{language}} code:

```{{language}}
{{code}}
```
````

Focus on:

- Code quality
- Potential bugs
- Performance issues
- Security concerns
- Readability and maintainability

{% if best_practices %}
Also check for adherence to {{language}} best practices.
{% endif %}

## Arguments

- language: The programming language of the code (e.g., JavaScript, Python, etc.)
- code: The code snippet to review
- best_practices: Whether to check for language-specific best practices (optional)

````

## Chain Prompt Format

Chain prompts include an additional section that defines the steps in the chain:

```markdown
## Chain Steps

1. promptId: first-step-prompt
   stepName: Initial Analysis
   inputMapping:
     topic: input_topic
   outputMapping:
     keyPoints: analysis_results

2. promptId: second-step-prompt
   stepName: Detailed Exploration
   inputMapping:
     analysisResults: analysis_results
     depth: exploration_depth
   outputMapping:
     detailedFindings: detailed_results
````

Each step includes:

1. **promptId**: The ID of the prompt to execute
2. **stepName**: A descriptive name for the step
3. **inputMapping**: How to map chain inputs to step inputs
4. **outputMapping**: How to map step outputs to chain outputs

## Advanced Templating with Nunjucks (Replacing Conditional Logic)

The template system now uses **Nunjucks** for advanced templating features, providing more power and flexibility than the previous Handlebars-style syntax. This allows for conditional logic, loops, and more, directly within your prompt templates.

### Key Nunjucks Features:

- **Conditional Logic (`{% if %}` ... `{% else %}` ... `{% endif %}`):**
  Control which parts of your template are rendered based on the presence or value of arguments.

  ```nunjucks
  {% if user_role == "admin" %}
  Welcome, Admin! You have full access.
  {% elif user_role == "editor" %}
  Welcome, Editor! You can manage content.
  {% else %}
  Welcome, {{user_name | default("Guest")}}!
  {% endif %}
  ```

- **Loops (`{% for %}` ... `{% endfor %}`):**
  Iterate over arrays or lists. If you pass an argument that is an array (e.g., from a JSON object in your calling code), Nunjucks can loop through it.

  ```nunjucks
  Your selected topics:
  {% for topic in selected_topics %}
  - {{ topic }}
  {% else %}
  No topics selected.
  {% endfor %}
  ```

  _(Note: Ensure list/array arguments are passed in a format Nunjucks can iterate, e.g., as actual arrays in the context.)_

- **Standard Variable Placeholders (`{{variable}}`):**
  Simple variable replacement is handled by Nunjucks as well.

  ```nunjucks
  The current task is: {{task_description}}.
  ```

- \*\*Filters (`{{ variable | filter }}`):
  Nunjucks offers many built-in filters (e.g., `{{ name | lower }}`, `{{ items | length }}`, `{{ title | default("Untitled") }}`) and custom filters can be added globally if needed.

* **Macros (`{% macro %}`), Template Inheritance (`{% extends %}`), and Setting Variables (`{% set %}`):**
  Nunjucks also supports defining reusable macros, template inheritance for creating base templates, and setting temporary variables within templates. These powerful features allow for highly modular and maintainable prompt designs.

  ```nunjucks
  {# Example of setting a variable #}
  {% set greeting = "Hello" %}
  {% if hour > 12 %}{% set greeting = "Good afternoon" %}{% endif %}
  {{ greeting }}, {{ user_name }}!

  {# For macros and inheritance, refer to detailed examples and Nunjucks documentation #}
  ```

  For detailed examples and usage of these advanced features, please see the [Prompt Management](prompt-management.md) guide or the [official Nunjucks documentation](https://mozilla.github.io/nunjucks/templating.html).

### Processing Order:

1.  The entire template is processed by Nunjucks, resolving all Nunjucks tags (`{% ... %}`) and variable placeholders (`{{ ... }}`).
2.  After Nunjucks processing, any text references (e.g., `ref:xyz` for long arguments) are expanded to their full content.

For more details on Nunjucks syntax and features, refer to the official [Nunjucks documentation](https://mozilla.github.io/nunjucks/templating.html).

## File Organization

Prompts are organized in directories by category:

```
prompts/
  category1/
    prompt1.md
    prompt2.md
  category2/
    prompt3.md
    prompt4.md
```

The category is determined by the directory name.

## Prompt IDs

Prompt IDs are generated based on the file path and name:

- For a file at `prompts/category/file.md`, the ID would be `category/file`
- IDs are used to reference prompts in API calls and chain definitions

## Best Practices

1. **Clear Descriptions**: Provide clear descriptions of what the prompt does
2. **Descriptive Arguments**: Clearly describe each argument and whether it's required
3. **Organized Structure**: Use consistent formatting and organization
4. **Meaningful Names**: Use descriptive names for prompts and arguments
5. **Documentation**: Include examples and usage notes where helpful
6. **Testing**: Test prompts with various inputs to ensure they work as expected

## Common Issues

### Missing Placeholders

If a placeholder in the template doesn't have a corresponding argument, it will remain as is in the output.

### Invalid Markdown

If the markdown structure is invalid (missing sections, incorrect headings), the prompt may not load correctly.

### Circular References

In chain prompts, avoid circular references where prompts depend on each other in a loop.

## Advanced Usage

### Multi-paragraph Arguments

For arguments that may contain multiple paragraphs, use triple backticks in the template:

```markdown
## User Message Template

Please analyze the following text:
```

{{long_text}}

```

## Arguments

- long_text: A potentially long text that may contain multiple paragraphs
```

### Dynamic Templates

You can create dynamic templates that adapt based on the provided arguments:

```markdown
## User Message Template

{% if detailed %}
Please provide a detailed analysis of {{topic}}, covering all aspects in depth.
{% else %}
Please provide a brief overview of {{topic}}, highlighting only the key points.
{% endif %}

## Arguments

- topic: The subject to analyze
- detailed: Whether to provide a detailed analysis (true/false)
```
