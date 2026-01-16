# Prompt YAML Schema

> Status: canonical

The definitive reference for `prompt.yaml` configuration fields.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Guesswork** | Strict Schema | Errors caught at load time |
| **Silent Failures** | Type Validation | Bad inputs fail fast |
| **Hidden Features** | Explicit Config | Full control over MCP behavior |

---

## Root Fields

Top-level properties for `prompt.yaml`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | **Yes** | Unique identifier (e.g., `code_review`). Used in `>>id`. |
| `name` | `string` | **Yes** | Human-readable name for MCP clients. |
| `description` | `string` | No | Tooltip description shown in clients. |
| `userMessageTemplate` | `string` | No* | Inline content. *One of `...Template` or `...File` required.* |
| `userMessageTemplateFile` | `string` | No* | Path to external `.md` file. |
| `systemMessageFile` | `string` | No | Path to system prompt file. |
| `registerWithMcp` | `boolean` | No | Show in client lists? Default `true`. |
| `tools` | `string[]` | No | Script tools to attach (auto-trigger). |
| `gateConfiguration` | `object` | No | Quality gate settings. |

### Example

```yaml
id: analyze_data
name: Data Analysis
description: Analyzes CSV data using Python
userMessageTemplateFile: user-message.md
registerWithMcp: true
tools: [csv_validator]
```

---

## Arguments Schema

Defines inputs passed to the prompt (`>>prompt arg='value'`).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | — | Argument name (used in template `{{name}}`). |
| `type` | `string` | `string` | `string`, `number`, `boolean`, `array`, `object`. |
| `required` | `boolean` | `false` | If true, execution fails if missing. |
| `defaultValue` | `any` | — | Used if argument is missing. |
| `description` | `string` | — | shown in MCP client UI. |
| `validation` | `object` | — | Validation rules. |

### Validation Rules

| Rule | Type | Description |
|------|------|-------------|
| `minLength` | `number` | Minimum string length. |
| `maxLength` | `number` | Maximum string length. |
| `pattern` | `string` | Regex pattern to match (e.g., `^https://`). |

### Example

```yaml
arguments:
  - name: url
    type: string
    required: true
    validation:
      pattern: "^https://"
  - name: retries
    type: number
    defaultValue: 3
```

---

## Gate Configuration

Control which quality gates apply to this prompt.

| Field | Type | Description |
|-------|------|-------------|
| `include` | `string[]` | Canonical gate IDs to enforce. |
| `exclude` | `string[]` | Auto-assigned gates to ignore. |
| `framework_gates` | `boolean` | Enable methodology gates? Default `true`. |
| `inline_gate_definitions` | `object[]` | Custom gate rules for this prompt. |

### Example

```yaml
gateConfiguration:
  include: ["technical-accuracy"]
  exclude: ["creative-writing"]
  framework_gates: false
```
