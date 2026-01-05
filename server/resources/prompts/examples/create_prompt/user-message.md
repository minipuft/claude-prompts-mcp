# Create Prompt

## System Message

You are a prompt architect specializing in prompt design for the Claude Prompts MCP system. Your task is to create production-quality prompts and chains that follow established patterns.

## User Message

{% if tool_prompt_builder %}
{# Auto-execute workflow: prompt input was provided and validated #}

{% if tool_prompt_builder.valid %}
{% if tool_prompt_builder_result %}
{# Auto-execute completed successfully #}

## Prompt Created Successfully

{{ tool_prompt_builder_result.text }}

**Summary:**

- **ID:** `{{ tool_prompt_builder.auto_execute.params.id }}`
- **Name:** {{ tool_prompt_builder.auto_execute.params.name }}
- **Category:** {{ tool_prompt_builder.auto_execute.params.category }}
- **Type:** {{ tool_prompt_builder.summary.prompt_type }}
- **Arguments:** {{ tool_prompt_builder.summary.argument_count }}
  {% if tool_prompt_builder.summary.chain_steps > 0 %}- **Chain Steps:** {{ tool_prompt_builder.summary.chain_steps }}{% endif %}

{% if tool_prompt_builder.warnings | length > 0 %}

### Warnings (non-blocking)

{% for warning in tool_prompt_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

**Next Steps:**

1. Test the prompt: `prompt_engine(">>{{ tool_prompt_builder.auto_execute.params.id }}")`
2. List prompts: `resource_manager(resource_type:"prompt", action:"list")`

{% else %}
{# Validation passed but auto-execute not available #}

## Prompt Validated

The prompt definition passed validation. Call `resource_manager` with the following parameters:

```json
{{ tool_prompt_builder.auto_execute.params | dump(2) }}
```

{% if tool_prompt_builder.warnings | length > 0 %}

### Warnings (non-blocking)

{% for warning in tool_prompt_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

{% endif %}
{% else %}
{# Validation failed #}

## Validation Failed

The prompt definition has errors that need to be fixed:

{% for error in tool_prompt_builder.errors %}

- {{ error }}
  {% endfor %}

{% if tool_prompt_builder.warnings | length > 0 %}

### Warnings

{% for warning in tool_prompt_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

Please fix the errors above and try again with corrected prompt definition.

{% endif %}

{% else %}
{# Design workflow: no prompt input provided, guide LLM to design #}

Create a new prompt with the following specifications:

**Name:** {{name}}
**Purpose:** {{purpose}}
{% if prompt_type %}**Type:** {{prompt_type}}{% endif %}

---

## Reference: Existing Prompt Examples

### Example 1: Simple Prompt (Minimal)

**prompt.yaml:**

```yaml
id: reasoning
name: Reasoning Structure
category: guidance
description: Step-by-step reasoning structure
systemMessageFile: system-message.md
userMessageTemplateFile: user-message.md
```

### Example 2: Prompt with Arguments and Gates

**prompt.yaml:**

```yaml
id: implementation_gap_analysis
name: Implementation Gap Analysis
category: development
description: >-
  Identifies gaps between documented/expected behavior and actual implementation.
systemMessageFile: system-message.md
userMessageTemplateFile: user-message.md

arguments:
  - name: focus_area
    type: string
    description: The subsystem or feature area to analyze
  - name: symptom
    type: string
    description: The observed behavior that triggered this analysis
  - name: related_files
    type: string
    description: Known files related to the issue (optional)
    required: false

gateConfiguration:
  include:
    - technical-accuracy
    - code-quality
  inline_gate_definitions:
    - name: Actionable Findings
      type: quality
      scope: execution
      description: Each gap must have specific file:line locations
      pass_criteria:
        - Every gap includes exact file paths
        - Remediation steps are specific
  framework_gates: true
```

### Example 3: Chain Prompt (Multi-Step Workflow)

**prompt.yaml:**

```yaml
id: pr_review_chain
name: PR Review Chain
category: pr-review
description: >-
  Complete PR review workflow: diff analysis, security audit, performance check,
  and approval summary.
systemMessageFile: system-message.md
userMessageTemplateFile: user-message.md

arguments:
  - name: pr_title
    type: string
    description: Title of the pull request
  - name: pr_description
    type: string
    description: Description/body of the pull request
  - name: diff_content
    type: string
    description: The full diff content to review

gateConfiguration:
  include:
    - pr-security
    - pr-performance
  framework_gates: false

chainSteps:
  - promptId: pr_diff_analysis
    stepName: Diff Analysis (Step 1 of 4)
  - promptId: pr_security_audit
    stepName: Security Audit (Step 2 of 4)
  - promptId: pr_performance_check
    stepName: Performance Check (Step 3 of 4)
  - promptId: pr_approval_summary
    stepName: Approval Summary (Step 4 of 4)
```

---

## Schema Reference

### prompt.yaml Fields

| Field                     | Type    | Required | Description                      |
| ------------------------- | ------- | -------- | -------------------------------- |
| `id`                      | string  | Yes      | Lowercase-underscored identifier |
| `name`                    | string  | Yes      | Human-readable name              |
| `category`                | string  | Yes      | Prompt category for organization |
| `description`             | string  | Yes      | Brief description of the prompt  |
| `systemMessageFile`       | string  | No\*     | Path to system-message.md        |
| `systemMessage`           | string  | No\*     | Inline system message            |
| `userMessageTemplateFile` | string  | No\*     | Path to user-message.md          |
| `userMessageTemplate`     | string  | No\*     | Inline user message template     |
| `arguments`               | array   | No       | Argument definitions             |
| `gateConfiguration`       | object  | No       | Gate configuration               |
| `chainSteps`              | array   | No       | Chain step definitions           |
| `registerWithMcp`         | boolean | No       | Register as MCP tool             |
| `tools`                   | array   | No       | Script tool references           |

\*Must have either `userMessageTemplate`/`userMessageTemplateFile` OR `chainSteps`

### Argument Definition

```yaml
arguments:
  - name: my_arg # Required: argument name
    type: string # Required: string|number|boolean|array|object
    description: What it is # Required: description
    required: false # Optional: default true
    defaultValue: 'text' # Optional: default value
    validation: # Optional: validation rules
      pattern: '^[a-z]+$'
      minLength: 1
      maxLength: 100
```

### Gate Configuration

```yaml
gateConfiguration:
  include: # Gate IDs to include
    - code-quality
    - technical-accuracy
  exclude: # Gate IDs to exclude
    - verbose-gate
  framework_gates: true # Include active framework's gates
  inline_gate_definitions: # Define gates inline
    - name: Custom Check
      type: quality
      scope: execution
      description: What to check
      pass_criteria:
        - Criterion 1
        - Criterion 2
```

### Chain Step Definition

```yaml
chainSteps:
  - promptId: step_1_prompt # Required: ID of prompt to execute
    stepName: Step 1 Name # Required: Display name
    inputMapping: # Optional: map previous output to input
      arg_name: '{{previous.output_field}}'
    outputMapping: # Optional: extract from response
      output_field: '$.data.field'
    retries: 2 # Optional: retry count (default: 0)
```

---

## Your Task

Based on **{{name}}** with purpose "{{purpose}}":

1. **Choose prompt type**: {% if prompt_type %}{{prompt_type}}{% else %}single or chain{% endif %}
2. **Write clear description** explaining what the prompt does
3. **Define arguments** with types and descriptions
4. **Create system/user messages** with `{{variable}}` placeholders
5. **Configure gates** if quality validation is needed
6. **Define chain steps** if multi-step workflow

---

## How to Create the Prompt

Make a **second `prompt_engine` call** to `>>create_prompt` with all fields in the `options` parameter. The script tool will automatically detect the schema match and create the prompt.

**Example call (single prompt):**

```text
prompt_engine(
  command: ">>create_prompt",
  options: {
    "id": "my_prompt",
    "name": "My Prompt",
    "category": "development",
    "description": "What this prompt does",
    "userMessageTemplate": "Analyze the following:\n\n{{content}}\n\nProvide insights on {{focus}}.",
    "arguments": [
      {"name": "content", "type": "string", "description": "Content to analyze"},
      {"name": "focus", "type": "string", "description": "Focus area"}
    ]
  }
)
```

**Example call (chain prompt):**

```text
prompt_engine(
  command: ">>create_prompt",
  options: {
    "id": "review_chain",
    "name": "Review Chain",
    "category": "review",
    "description": "Multi-step review workflow",
    "chainSteps": [
      {"promptId": "step1", "stepName": "Initial Review"},
      {"promptId": "step2", "stepName": "Deep Dive"},
      {"promptId": "step3", "stepName": "Summary"}
    ]
  }
)
```

---

## Required Fields (in `options`)

| Field         | Type   | Description                                            |
| ------------- | ------ | ------------------------------------------------------ |
| `id`          | string | Lowercase-underscored identifier (e.g., "code_review") |
| `name`        | string | Human-readable name                                    |
| `category`    | string | Prompt category (e.g., "development", "analysis")      |
| `description` | string | What the prompt does                                   |

Plus ONE of:

- `userMessageTemplate` or `userMessageTemplateFile` (for single prompts)
- `chainSteps` (for chain prompts)

## Optional Fields

| Field               | Type    | Description                           |
| ------------------- | ------- | ------------------------------------- |
| `systemMessage`     | string  | Inline system message                 |
| `systemMessageFile` | string  | Path to system-message.md             |
| `arguments`         | array   | Argument definitions                  |
| `gateConfiguration` | object  | Gate configuration                    |
| `registerWithMcp`   | boolean | Register as MCP tool (default: false) |
| `tools`             | array   | Script tool IDs to use                |

---

## JSON Structure Reference

### Single Prompt

```json
{
  "id": "<lowercase_underscored>",
  "name": "<Human Readable Name>",
  "category": "<category>",
  "description": "What this prompt does",
  "systemMessage": "You are an expert at...",
  "userMessageTemplate": "Analyze {{content}} with focus on {{focus}}.",
  "arguments": [
    {
      "name": "content",
      "type": "string",
      "description": "Content to analyze",
      "required": true
    },
    {
      "name": "focus",
      "type": "string",
      "description": "Focus area",
      "required": false,
      "defaultValue": "general"
    }
  ],
  "gateConfiguration": {
    "include": ["code-quality"],
    "framework_gates": true
  }
}
```

### Chain Prompt

```json
{
  "id": "<lowercase_underscored>",
  "name": "<Human Readable Name>",
  "category": "<category>",
  "description": "Multi-step workflow description",
  "arguments": [{ "name": "input", "type": "string", "description": "Initial input" }],
  "chainSteps": [
    {
      "promptId": "step1_prompt",
      "stepName": "Step 1: Analysis"
    },
    {
      "promptId": "step2_prompt",
      "stepName": "Step 2: Synthesis",
      "inputMapping": {
        "analysis_result": "{{previous.output}}"
      }
    }
  ],
  "gateConfiguration": {
    "include": ["technical-accuracy"],
    "framework_gates": false
  }
}
```

**Requirements:**

- Prompt IDs: lowercase with underscores (e.g., `code_review`, `deep_analysis`)
- Arguments: Each must have name, type, and description
- Templates: Use `{{variable}}` syntax for argument placeholders
- Chain steps: Must reference existing prompt IDs
- Inline vs file: Use inline for short content, files for longer content

{% endif %}
