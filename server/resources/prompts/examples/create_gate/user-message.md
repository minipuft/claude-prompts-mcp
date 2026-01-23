# Create Gate

## System Message

You are a quality gate architect specializing in gate design for the Claude Prompts MCP system. Your task is to create production-quality validation gates that match the standards of existing gates like code-quality and educational-clarity.

## User Message

{% if tool_gate_builder %}
{# Auto-execute workflow: gate input was provided and validated #}

{% if tool_gate_builder.valid %}
{% if tool_gate_builder_result %}
{# Auto-execute completed successfully #}

## Gate Created Successfully

{{ tool_gate_builder_result.text }}

**Summary:**

- **ID:** `{{ tool_gate_builder.auto_execute.params.id }}`
- **Name:** {{ tool_gate_builder.auto_execute.params.name }}
- **Type:** {{ tool_gate_builder.auto_execute.params.type }}
- **Pass Criteria:** {{ tool_gate_builder.summary.pass_criteria_count }}
- **Severity:** {{ tool_gate_builder.summary.severity }}

{% if tool_gate_builder.warnings | length > 0 %}

### Warnings (non-blocking)

{% for warning in tool_gate_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

**Next Steps:**

1. Test the gate: `prompt_engine(">>your_prompt :: '{{ tool_gate_builder.auto_execute.params.id }}'")`
2. List gates: `system_control(action:"gates", operation:"list")`

{% else %}
{# Validation passed but auto-execute not available #}

## Gate Validated

The gate definition passed validation. Call `resource_manager` with the following parameters:

```json
{{ tool_gate_builder.auto_execute.params | dump(2) }}
```

{% if tool_gate_builder.warnings | length > 0 %}

### Warnings (non-blocking)

{% for warning in tool_gate_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

{% endif %}
{% else %}
{# Validation failed #}

## Validation Failed

The gate definition has errors that need to be fixed:

{% for error in tool_gate_builder.errors %}

- {{ error }}
  {% endfor %}

{% if tool_gate_builder.warnings | length > 0 %}

### Warnings

{% for warning in tool_gate_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

Please fix the errors above and try again with corrected gate definition.

{% endif %}

{% else %}
{# Design workflow: no gate input provided, guide LLM to design #}

Create a new quality gate with the following specifications:

**Name:** {{name}}
**Purpose:** {{purpose}}
{% if gate_type %}**Type:** {{gate_type}}{% endif %}

---

## Reference: Existing Gate Examples

### Example 1: Code Quality Gate

**gate.yaml:**

```yaml
id: code-quality
name: Code Quality Standards
type: validation
description: Ensures generated code follows best practices and quality standards
guidanceFile: guidance.md

pass_criteria:
  - type: content_check
    min_length: 100
    required_patterns:
      - try
      - catch
      - //
      - function
      - const
    forbidden_patterns:
      - TODO
      - FIXME
      - hack
      - password123
  - type: pattern_check
    regex_patterns:
      - 'function\s+\w+\s*\('
      - '\/\/.*\w+'
      - 'try\s*\{'

retry_config:
  max_attempts: 2
  improvement_hints: true
  preserve_context: true

activation:
  prompt_categories:
    - code
    - development
  explicit_request: false
```

**guidance.md:**

```markdown
**Code Quality Standards:**

- Include error handling and input validation
- Add inline comments for complex logic
- Follow consistent naming conventions
- Consider edge cases and boundary conditions
- Optimize for readability over cleverness
- Include basic documentation/docstrings
- Follow security best practices
```

### Example 2: Educational Clarity Gate

**gate.yaml:**

```yaml
id: educational-clarity
name: Educational Content Clarity
type: validation
description: Ensures educational content is clear, well-structured, and pedagogically sound
guidanceFile: guidance.md

pass_criteria:
  - type: content_check
    min_length: 400
    required_patterns:
      - example
      - step
      - understand
      - learn
  - type: pattern_check
    keyword_count:
      example: 2
      for example: 1
    regex_patterns:
      - '^##\s+.*$'
      - '^\d+\.\s+.*$'
      - '^\s*[-*]\s+.*$'

retry_config:
  max_attempts: 2
  improvement_hints: true
  preserve_context: true

activation:
  prompt_categories:
    - education
    - documentation
  explicit_request: false
```

---

## Schema Reference

### gate.yaml Fields

| Field             | Type   | Required | Description                                           |
| ----------------- | ------ | -------- | ----------------------------------------------------- |
| `id`              | string | Yes      | Lowercase-hyphenated identifier                       |
| `name`            | string | Yes      | Human-readable name                                   |
| `type`            | enum   | Yes      | `validation` (pass/fail) or `guidance` (advisory)     |
| `description`     | string | Yes      | Brief description of what the gate validates          |
| `guidanceFile`    | string | No       | Path to guidance.md (default: 'guidance.md')          |
| `guidance`        | string | No       | Inline guidance content (alternative to file)         |
| `severity`        | enum   | No       | `critical`, `high`, `medium`, `low` (default: medium) |
| `enforcementMode` | enum   | No       | `blocking`, `advisory`, `informational`               |
| `pass_criteria`   | array  | No       | Validation criteria definitions                       |
| `retry_config`    | object | No       | Retry behavior configuration                          |
| `activation`      | object | No       | When to activate the gate                             |

### Pass Criteria Types

| Type                     | Fields                                                        | Description                          |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------ |
| `content_check`          | min_length, max_length, required_patterns, forbidden_patterns | Check content length and patterns    |
| `pattern_check`          | regex_patterns, keyword_count                                 | Regex matching and keyword frequency |
| `llm_self_check`         | prompt_template, pass_threshold                               | LLM-based validation                 |
| `methodology_compliance` | methodology, min_compliance_score, quality_indicators         | Framework compliance                 |

### Retry Configuration

```yaml
retry_config:
  max_attempts: 2 # How many retry attempts allowed
  improvement_hints: true # Include hints for improvement
  preserve_context: true # Keep context between retries
```

### Activation Rules

```yaml
activation:
  prompt_categories: # Categories that trigger this gate
    - code
    - development
  frameworks: # Frameworks that trigger this gate
    - cageerf
  explicit_request: false # Only activate when explicitly requested
```

---

## Your Task

Based on **{{name}}** with purpose "{{purpose}}":

1. **Choose gate type**: {% if gate_type %}{{gate_type}}{% else %}validation or guidance{% endif %}
2. **Write clear description** explaining what the gate validates
3. **Define pass_criteria** with appropriate types for your use case
4. **Create guidance content** with actionable standards
5. **Configure activation** for appropriate prompt categories

---

## How to Create the Gate

Make a **second `prompt_engine` call** to `>>create_gate` with all fields in the `options` parameter. The script tool will automatically detect the schema match and create the gate files.

**Example call:**

```text
prompt_engine(
  command: ">>create_gate",
  options: {
    "id": "your-gate-id",
    "name": "Your Gate Name",
    "type": "validation",
    "description": "What this gate validates",
    "guidance": "**Standards:**\n- Criterion 1\n- Criterion 2",
    "pass_criteria": [...],
    "activation": {...}
  }
)
```

---

## Required Fields (in `options`)

| Field         | Type   | Description                                                         |
| ------------- | ------ | ------------------------------------------------------------------- |
| `id`          | string | Lowercase-hyphenated identifier (e.g., "api-docs", "test-coverage") |
| `name`        | string | Human-readable name                                                 |
| `type`        | enum   | `validation` or `guidance`                                          |
| `description` | string | What the gate validates                                             |

## Optional Fields (for full configuration)

| Field             | Type   | Description                                           |
| ----------------- | ------ | ----------------------------------------------------- |
| `guidance`        | string | Inline guidance content (markdown)                    |
| `guidanceFile`    | string | Path to guidance.md file                              |
| `severity`        | enum   | `critical`, `high`, `medium`, `low`                   |
| `enforcementMode` | enum   | `blocking`, `advisory`, `informational`               |
| `pass_criteria`   | array  | Validation criteria objects                           |
| `retry_config`    | object | `{max_attempts, improvement_hints, preserve_context}` |
| `activation`      | object | `{prompt_categories, frameworks, explicit_request}`   |

---

## JSON Structure Reference

```json
{
  "id": "<lowercase-hyphenated>",
  "name": "<Human Readable Name>",
  "type": "validation",
  "description": "What this gate validates",
  "severity": "medium",
  "enforcementMode": "blocking",
  "guidance": "**Standards:**\n- Criterion 1\n- Criterion 2\n- Criterion 3",
  "pass_criteria": [
    {
      "type": "content_check",
      "min_length": 100,
      "required_patterns": ["pattern1", "pattern2"],
      "forbidden_patterns": ["bad_pattern"]
    },
    {
      "type": "pattern_check",
      "regex_patterns": ["regex1", "regex2"],
      "keyword_count": {
        "keyword": 2
      }
    }
  ],
  "retry_config": {
    "max_attempts": 2,
    "improvement_hints": true,
    "preserve_context": true
  },
  "activation": {
    "prompt_categories": ["category1", "category2"],
    "frameworks": [],
    "explicit_request": false
  }
}
```

**Requirements:**

- Gate IDs: lowercase-hyphenated (e.g., `api-docs`, `test-coverage`)
- Type: Must be `validation` or `guidance`
- Either `guidance` (inline) or `guidanceFile` (path to .md file)
- pass_criteria: At least one criterion for validation gates
- Regex patterns: Must be valid regular expressions

{% endif %}
