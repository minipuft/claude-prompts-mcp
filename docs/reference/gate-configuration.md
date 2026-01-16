# Gate Configuration Reference

> Status: canonical

Full schema for defining reusable quality gates in `resources/gates/{id}/gate.yaml`.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Ad-Hoc Review** | Standardized Config | Same quality bar across the team |
| **Silent Failures** | Severity Levels | Block critical issues, warn on minor ones |
| **Repetition** | Auto-Activation | Gates apply automatically by category |

---

## Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | **Yes** | Unique ID (e.g., `code-quality`). |
| `name` | `string` | **Yes** | Human-readable name. |
| `type` | `string` | No | `validation` (checks) or `guidance` (hints). |
| `description` | `string` | No | Tooltip description. |
| `guidanceFile` | `string` | No | Path to markdown file with instructions. |
| `severity` | `string` | No | `critical`, `high`, `medium`, `low`. Default: `medium`. |
| `enforcementMode` | `string` | No | `blocking` (must pass), `advisory` (warn only). |

---

## Activation Rules

When does this gate apply automatically?

| Field | Type | Description |
|-------|------|-------------|
| `prompt_categories` | `string[]` | Auto-apply to prompts in these folders (e.g., `code`). |
| `explicit_request` | `boolean` | If `true`, only applies when user asks (e.g., `pr-review`). |
| `framework_context` | `string[]` | Applies when using these frameworks (e.g., `CAGEERF`). |

### Example

```yaml
activation:
  prompt_categories: ["development", "api"]
  framework_context: ["ReACT"]
```

---

## Pass Criteria & Retries

Define how strict the gate is.

```yaml
pass_criteria:
  - type: content_check
    min_length: 100
    forbidden_patterns: ["eval(", "innerHTML"]

retry_config:
  max_attempts: 2
  improvement_hints: true
```

| Field | Description |
|-------|-------------|
| `required_patterns` | Strings that MUST appear in the output. |
| `forbidden_patterns` | Strings that MUST NOT appear. |
| `max_attempts` | How many times Claude retries before failing. |
| `improvement_hints` | Feed validation errors back into the retry prompt. |
