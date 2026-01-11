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
{# ═══════ DESIGN WORKFLOW ═══════ #}
{# No prompt input provided - guide LLM to design based on prompt_type #}

Create a new prompt with the following specifications:

**Name:** {{name}}
**Purpose:** {{purpose}}
{% if prompt_type %}**Type:** {{prompt_type}}{% endif %}

---

{% if prompt_type == "script" %}
{# ═══════ SCRIPT-TOOL PROMPT TYPE ═══════ #}

## Script-Tool Prompt: Two-Phase Workflow

Script-enhanced prompts validate input and can auto-execute MCP tools. Creation requires two phases:

### Phase 1: Create Tool Files

Create this directory structure relative to prompt location:

```
resources/prompts/{{category | default("development")}}/{{id | default("my_prompt")}}/
├── prompt.yaml           # Metadata (tools: [tool_id])
├── user-message.md       # Nunjucks template with tool output access
└── tools/
    └── {{id | default("my_tool")}}/
        ├── tool.yaml     # Runtime config
        ├── schema.json   # Input validation (triggers schema_match)
        └── script.py     # Validation logic
```

**1. tool.yaml** (runtime configuration):

```yaml
id: { { id | default("my_tool") } }
name: { { name | default("My Tool") } }
runtime: python
script: script.py
timeout: 30000
enabled: true

execution:
  trigger: schema_match # Auto-detect from user args
  strict: false # ANY required param triggers
```

**2. schema.json** (input validation - triggers schema_match):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "input_field": {
      "type": "string",
      "description": "Main input for validation"
    }
  },
  "required": ["input_field"]
}
```

**3. script.py** (validation with MCP-specific output format):

```python
#!/usr/bin/env python3
import json
import sys

def validate(data):
    errors = []
    warnings = []

    # Validation logic
    if not data.get("input_field"):
        errors.append("Missing required: input_field")

    if errors:
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Auto-execute MCP tool on success (optional)
    return {
        "valid": True,
        "auto_execute": {
            "tool": "resource_manager",
            "params": {
                "resource_type": "prompt",
                "action": "create",
                # ... transformed params
            }
        },
        "warnings": warnings,
        "summary": {"field_count": len(data)}
    }

if __name__ == "__main__":
    print(json.dumps(validate(json.load(sys.stdin))))
```

**4. user-message.md** (template with tool output access):

```markdown
{% raw %}{% if tool_{{id | default("my_tool")}} %}
{% if tool_{{id | default("my_tool")}}.valid %}
{% if tool_{{id | default("my_tool")}}_result %}

## Success

{{ tool_{{id | default("my_tool")}}\_result.text }}
{% else %}

## Validated

Ready to execute.
{% endif %}
{% else %}

## Validation Errors

{% for error in tool_{{id | default("my_tool")}}.errors %}- {{ error }}
{% endfor %}
{% endif %}
{% else %}

## Design Phase

Provide input to validate...
{% endif %}{% endraw %}
```

### Phase 2: Register Prompt

After creating tool files, call `>>create_prompt` with all fields:

```text
prompt_engine(
  command: ">>create_prompt",
  options: {
    "id": "{{id | default("my_prompt")}}",
    "name": "{{name | default("My Prompt")}}",
    "category": "{{category | default("development")}}",
    "description": "{{purpose | default("Validates and processes input")}}",
    "userMessageTemplateFile": "user-message.md",
    "tools": ["{{id | default("my_tool")}}"],
    "arguments": [
      {"name": "input_field", "type": "string", "description": "Main input"}
    ]
  }
)
```

### Template Variables (Script Output)

| Variable                                    | Type    | Description           |
| ------------------------------------------- | ------- | --------------------- |
| `{% raw %}{{tool_<id>}}{% endraw %}`        | object  | Full script result    |
| `{% raw %}{{tool_<id>.valid}}{% endraw %}`  | boolean | Validation passed     |
| `{% raw %}{{tool_<id>.errors}}{% endraw %}` | array   | Validation errors     |
| `{% raw %}{{tool_<id>_result}}{% endraw %}` | object  | Auto-execute response |

### Reference Example

See `plugin_doctor` for a complete script-tool implementation:
`resources/prompts/development/plugin_doctor/`

{% elif prompt_type == "chain" %}
{# ═══════ CHAIN PROMPT TYPE ═══════ #}

## Chain Prompt: Multi-Step Workflow

Chain prompts execute multiple prompts in sequence, passing data between steps.

### Chain Structure

```yaml
id: { { id | default("my_chain") } }
name: { { name | default("My Chain") } }
category: { { category | default("development") } }
description: { { purpose | default("Multi-step workflow") } }
userMessageTemplateFile: user-message.md

arguments:
  - name: initial_input
    type: string
    description: Starting input for the chain

chainSteps:
  - promptId: step1_prompt
    stepName: 'Step 1: Analysis'
  - promptId: step2_prompt
    stepName: 'Step 2: Synthesis'
    inputMapping:
      analysis: steps.step1_prompt.result
  - promptId: step3_prompt
    stepName: 'Step 3: Summary'
    inputMapping:
      synthesis: steps.step2_prompt.result
```

### Chain Step Properties

| Property        | Type   | Required | Description                       |
| --------------- | ------ | -------- | --------------------------------- |
| `promptId`      | string | Yes      | Prompt to execute                 |
| `stepName`      | string | Yes      | Display name                      |
| `inputMapping`  | object | No       | Map previous outputs to step args |
| `outputMapping` | object | No       | Name this step's output           |
| `retries`       | number | No       | Retry attempts (0-5)              |

### Input/Output Mapping

```yaml
chainSteps:
  - promptId: analyze
    stepName: 'Analyze'
    outputMapping:
      findings: output # Name the output

  - promptId: synthesize
    stepName: 'Synthesize'
    inputMapping:
      data: steps.analyze.result # Reference previous step
      findings: '{% raw %}{{findings}}{% endraw %}' # Or use named output
```

### Template Variables (Chain Steps)

| Variable                                        | Description              |
| ----------------------------------------------- | ------------------------ |
| `{% raw %}{{input}}{% endraw %}`                | Current step's arguments |
| `{% raw %}{{step1_result}}{% endraw %}`         | Output from step 1       |
| `{% raw %}{{previous_step_result}}{% endraw %}` | Most recent step output  |
| `{% raw %}{{chain_id}}{% endraw %}`             | Current chain session ID |

### Create Chain Prompt

```text
prompt_engine(
  command: ">>create_prompt",
  options: {
    "id": "{{id | default("my_chain")}}",
    "name": "{{name | default("My Chain")}}",
    "category": "{{category | default("development")}}",
    "description": "{{purpose | default("Multi-step workflow")}}",
    "arguments": [
      {"name": "initial_input", "type": "string", "description": "Starting input"}
    ],
    "chainSteps": [
      {"promptId": "step1", "stepName": "Step 1"},
      {"promptId": "step2", "stepName": "Step 2", "inputMapping": {"prev": "steps.step1.result"}}
    ]
  }
)
```

**Note:** Referenced prompts (`step1`, `step2`) must exist before chain execution.

{% else %}
{# ═══════ TEMPLATE PROMPT TYPE (DEFAULT) ═══════ #}

## Template Prompt: Basic Structure

### Minimal Example

```yaml
id: { { id | default("my_prompt") } }
name: { { name | default("My Prompt") } }
category: { { category | default("development") } }
description: { { purpose | default("What this prompt does") } }
userMessageTemplateFile: user-message.md

arguments:
  - name: content
    type: string
    description: Main content to process
```

### With Arguments and Gates

```yaml
id: { { id | default("my_prompt") } }
name: { { name | default("My Prompt") } }
category: { { category | default("development") } }
description: { { purpose | default("What this prompt does") } }
systemMessageFile: system-message.md
userMessageTemplateFile: user-message.md

arguments:
  - name: content
    type: string
    description: Content to analyze
    required: true
  - name: focus
    type: string
    description: Focus area
    required: false
    defaultValue: general

gateConfiguration:
  include:
    - code-quality
  framework_gates: true
```

### Template Syntax (Nunjucks)

```markdown
# Analysis: {% raw %}{{focus | default("General")}}{% endraw %}

{% raw %}{{content}}{% endraw %}

{% raw %}{% if include_examples %}{% endraw %}

## Examples

{% raw %}{{examples}}{% endraw %}
{% raw %}{% endif %}{% endraw %}
```

### Argument Types

| Type      | Input                   | Coercion         |
| --------- | ----------------------- | ---------------- |
| `string`  | Any text                | None             |
| `number`  | Numeric                 | Parsed           |
| `boolean` | true/false              | Case-insensitive |
| `array`   | JSON or comma-separated | Parsed           |
| `object`  | JSON string             | Parsed           |

### Create Template Prompt

```text
prompt_engine(
  command: ">>create_prompt",
  options: {
    "id": "{{id | default("my_prompt")}}",
    "name": "{{name | default("My Prompt")}}",
    "category": "{{category | default("development")}}",
    "description": "{{purpose | default("What this prompt does")}}",
    "userMessageTemplate": "Process: {% raw %}{{content}}{% endraw %}\n\nFocus: {% raw %}{{focus}}{% endraw %}",
    "arguments": [
      {"name": "content", "type": "string", "description": "Content to process"},
      {"name": "focus", "type": "string", "description": "Focus area", "required": false, "defaultValue": "general"}
    ]
  }
)
```

{% endif %}

---

## Required Fields (all types)

| Field         | Type   | Description                |
| ------------- | ------ | -------------------------- |
| `id`          | string | Lowercase with underscores |
| `name`        | string | Human-readable name        |
| `category`    | string | Organization category      |
| `description` | string | What the prompt does       |

Plus ONE of:

- `userMessageTemplate` / `userMessageTemplateFile`
- `chainSteps` (for chains)

## Your Task

Based on **{{name}}** with purpose "{{purpose}}":

{% if prompt_type == "script" %}

1. Create tool files using Write tool (tool.yaml, schema.json, script.py)
2. Create user-message.md with Nunjucks conditionals for tool output
3. Call `>>create_prompt` with `tools: [tool_id]` to register
   {% elif prompt_type == "chain" %}
4. Ensure step prompts exist (create them first if needed)
5. Define chainSteps with proper inputMapping
6. Call `>>create_prompt` with chainSteps array
   {% else %}
7. Design the template with `{% raw %}{{variable}}{% endraw %}` placeholders
8. Define arguments with types and validation
9. Call `>>create_prompt` with all fields
   {% endif %}

{% endif %}
