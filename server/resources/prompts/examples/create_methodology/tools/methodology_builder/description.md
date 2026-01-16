# Methodology Builder

Validates and transforms methodology definitions for automatic creation via `resource_manager`.

## Purpose

This tool bridges the gap between methodology design and creation by:

1. Validating all methodology fields against a comprehensive schema
2. Checking phase consistency (gates reference valid phases, etc.)
3. Validating regex patterns in quality indicators
4. Ensuring execution step dependencies are acyclic
5. Preparing the auto-execute payload for seamless methodology creation

## Input

A complete methodology definition matching the CAGEERF quality standard:

| Field                    | Required | Description                               |
| ------------------------ | -------- | ----------------------------------------- |
| `id`                     | Yes      | Lowercase-hyphenated identifier           |
| `name`                   | Yes      | Human-readable name                       |
| `system_prompt_guidance` | Yes      | Multiline guidance with **Phase**: format |
| `phases`                 | Yes      | Array of phase definitions (min 2)        |
| `methodology_gates`      | No       | Quality gates with validation criteria    |
| `processing_steps`       | No       | Ordered methodology processing steps      |
| `execution_steps`        | No       | Steps with dependency graph               |
| `quality_indicators`     | No       | Keywords/patterns per phase               |
| `template_suggestions`   | No       | Prompt enhancement suggestions            |
| `methodology_elements`   | No       | Required/optional sections                |
| `argument_suggestions`   | No       | Suggested prompt arguments                |

## Output

```json
{
  "valid": true,
  "auto_execute": {
    "tool": "resource_manager",
    "params": {
      "resource_type": "methodology",
      "action": "create",
      "id": "...",
      ...all validated fields...
    }
  },
  "warnings": [],
  "summary": {
    "phases": 6,
    "methodology_gates": 4,
    "processing_steps": 6,
    "execution_steps": 6,
    "quality_indicator_phases": 4
  }
}
```

## Validation Rules

1. **Phase Consistency**: All `methodologyArea` references in gates must match a defined phase
2. **Execution Dependencies**: Dependencies must reference valid step IDs (no circular dependencies)
3. **Regex Patterns**: All patterns in `quality_indicators` must be valid regular expressions
4. **ID Format**: IDs must be snake_case or lowercase-hyphenated as appropriate
5. **Required Fields**: All required fields must be present with valid values

## Auto-Execute

When validation passes, the tool outputs `auto_execute` metadata that triggers automatic `resource_manager` call without requiring an LLM round-trip. This creates the methodology immediately.

## Usage

This tool is automatically triggered when the `create_methodology` prompt is executed with methodology design input.
