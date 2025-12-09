# Prompt & Template Authoring Guide

Create reusable prompts that hot-reload instantly. No server restarts. No copy-pasting.

---

## Why This Matters

| Problem                                      | Solution                        | Result                                         |
| -------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Copy-pasting prompts into every conversation | Define once, invoke by ID       | `>>analyze_code file="app.ts"`                 |
| No argument validation                       | Type-safe schemas with patterns | Bad input fails fast with clear errors         |
| Manual multi-step workflows                  | Chain prompts together          | Steps execute automatically, pass data forward |
| Quality inconsistency                        | Built-in gates                  | Every response meets your standards            |

---

## Quick Start

### 1. Create the Metadata

```json
// prompts/development/prompts.json
{
  "id": "code_review",
  "name": "Code Review",
  "category": "development",
  "description": "Review code for issues and improvements",
  "file": "templates/code_review.md",
  "arguments": [
    {
      "name": "code",
      "description": "Code to review",
      "required": true,
      "type": "string"
    },
    {
      "name": "focus",
      "description": "Review focus area",
      "required": false,
      "type": "string"
    }
  ]
}
```

### 2. Create the Template

```markdown
<!-- prompts/development/templates/code_review.md -->

# Code Review

Review the following code for issues, improvements, and best practices.

## Code

{{code}}

{% if focus %}

## Focus Area

Pay special attention to: {{focus}}
{% endif %}

## Review Checklist

- Security vulnerabilities
- Performance issues
- Code clarity
- Error handling
```

### 3. Invoke It

```bash
prompt_engine(command: ">>code_review code='function add(a,b) { return a + b }' focus='type safety'")
```

**Output**: Rendered prompt with your code inserted, ready for Claude to review.

---

## Template Syntax

Templates use **Nunjucks** (not Handlebars). Key differences:

| Task         | Handlebars (Wrong)    | Nunjucks (Correct)                 |
| ------------ | --------------------- | ---------------------------------- |
| Conditionals | `{{#if x}}...{{/if}}` | `{% if x %}...{% endif %}`         |
| Loops        | `{{#each items}}`     | `{% for item in items %}`          |
| Defaults     | N/A                   | `{{value \| default("fallback")}}` |
| Comments     | `{{!-- comment --}}`  | `{# comment #}`                    |

### Variable Insertion

```markdown
## Basic

{{topic}}

## With Default

{{format | default("bullet points")}}

## Conditional Section

{% if include_examples %}

### Examples

{{examples}}
{% endif %}
```

---

## Argument System

Define arguments in your prompt metadata. The server builds Zod schemas automatically.

### Supported Types

| Type      | Input                   | Coercion         | Example Value               |
| --------- | ----------------------- | ---------------- | --------------------------- |
| `string`  | Any text                | None             | `"hello world"`             |
| `number`  | Numeric string          | Parsed to number | `"42"` → `42`               |
| `boolean` | true/false string       | Case-insensitive | `"TRUE"` → `true`           |
| `array`   | JSON or comma-separated | Parsed to array  | `"a,b,c"` → `["a","b","c"]` |
| `object`  | JSON string             | Parsed to object | `'{"key":"val"}'`           |

### Validation Rules

Validation rules are **enforced** at runtime. Invalid input fails fast with actionable retry hints.

```json
{
  "name": "topic",
  "type": "string",
  "required": true,
  "validation": {
    "minLength": 10,
    "maxLength": 200,
    "pattern": "^[A-Za-z0-9 ]+$"
  }
}
```

| Rule            | Enforced     | Purpose                              |
| --------------- | ------------ | ------------------------------------ |
| `minLength`     | Yes          | Ensure sufficient input detail       |
| `maxLength`     | Yes          | Prevent oversized payloads           |
| `pattern`       | Yes          | URL whitelisting, format enforcement |
| `allowedValues` | No (removed) | LLM handles semantic variation       |

**Validation Error Example**:

```
Argument validation failed:
  - topic: Value must contain at least 10 characters

Retry with:
  >>analyze_code topic="<at least 10 chars>"
```

**URL Pattern Example** (for security/whitelisting):

```json
{
  "name": "url",
  "type": "string",
  "required": true,
  "validation": {
    "pattern": "^https://(docs\\.github\\.com|api\\.github\\.com)/"
  }
}
```

### Complete Validation Example

Here's the full workflow for a prompt with validation:

**Step 1: Define metadata with validation** (`prompts/research/prompts.json`):

```json
{
  "id": "analyze_topic",
  "name": "Analyze Topic",
  "category": "research",
  "description": "Deep analysis of a topic",
  "file": "templates/analyze_topic.md",
  "arguments": [
    {
      "name": "topic",
      "description": "Subject to analyze (10-200 chars)",
      "required": true,
      "type": "string",
      "validation": {
        "minLength": 10,
        "maxLength": 200
      }
    },
    {
      "name": "source_url",
      "description": "Reference URL (must be HTTPS)",
      "required": false,
      "type": "string",
      "validation": {
        "pattern": "^https://"
      }
    }
  ]
}
```

**Step 2: Create the template** (`prompts/research/templates/analyze_topic.md`):

```markdown
# Topic Analysis: {{topic}}

Provide a comprehensive analysis of this topic.

{% if source_url %}

## Reference

Use this source as context: {{source_url}}
{% endif %}

## Analysis Structure

1. Overview and key concepts
2. Current state and trends
3. Implications and recommendations
```

**Step 3: Invoke it**:

```bash
# Valid invocation - passes validation
prompt_engine(command: ">>analyze_topic topic='Machine learning in healthcare diagnostics'")

# Invalid invocation - topic too short
prompt_engine(command: ">>analyze_topic topic='AI'")
# Error: Argument validation failed:
#   - topic: Value must contain at least 10 characters
# Retry with:
#   >>analyze_topic topic="<at least 10 chars>"

# Invalid invocation - URL pattern mismatch
prompt_engine(command: ">>analyze_topic topic='Valid topic here' source_url='http://example.com'")
# Error: Argument validation failed:
#   - source_url: Value must match pattern ^https://
# Retry with:
#   >>analyze_topic topic="<your value>" source_url="https://example.com/..."
```

### Default Values

When an argument isn't provided, `defaultValue` is used automatically:

```json
{
  "name": "format",
  "type": "string",
  "required": false,
  "defaultValue": "markdown"
}
```

**Priority Order**: When an argument is missing, resolution happens in this order:

1. **`arg.defaultValue`** — Prompt author's explicit default (highest priority)
2. **Runtime overrides** — Context-specific defaults passed at execution
3. **Environment variables** — `PROMPT_ARGNAME` (for deployment config)
4. **Empty fallback** — Template conditionals handle missing values

**Example behavior**:

| Invocation | Result |
|------------|--------|
| `>>prompt format="json"` | format = "json" (explicit value) |
| `>>prompt` | format = "markdown" (defaultValue applied) |

Works with all types:

| Type | Example |
|------|---------|
| `string` | `"defaultValue": "brief"` |
| `number` | `"defaultValue": 10` |
| `boolean` | `"defaultValue": true` |
| `array` | `"defaultValue": ["a", "b"]` |

### Handling Missing Arguments

Choose the right pattern based on your use case:

| Scenario | Pattern | Example |
|----------|---------|---------|
| **Must be provided** | `required: true` | User must supply `topic` |
| **Has sensible default** | `required: false` + `defaultValue` | `format` defaults to `"markdown"` |
| **Section is optional** | `required: false` + template conditional | Focus area only shown if provided |

**Pattern 1: Required Arguments**

Use when the prompt cannot function without the value:

```json
{
  "name": "code",
  "required": true,
  "description": "Code to review"
}
```

If missing, execution fails with a clear error:
```
Missing required argument: code
Retry with: >>code_review code="<your code>"
```

**Pattern 2: Optional with Default**

Use when a sensible default exists and the argument should always have a value:

```json
{
  "name": "depth",
  "required": false,
  "defaultValue": "moderate"
}
```

Template uses the value directly (always present):
```markdown
Analysis depth: {{depth}}
```

**Pattern 3: Optional with Conditional**

Use when the entire section should be omitted if the argument isn't provided:

```json
{
  "name": "focus",
  "required": false
}
```

Template conditionally includes the section:
```markdown
{% if focus %}
## Focus Area
Pay special attention to: {{focus}}
{% endif %}
```

**Combining Patterns**

A well-designed prompt often uses all three:

```json
{
  "arguments": [
    { "name": "code", "required": true },
    { "name": "language", "required": false, "defaultValue": "auto-detect" },
    { "name": "focus", "required": false }
  ]
}
```

```markdown
# Code Review

## Code ({{language}})
{{code}}

{% if focus %}
## Focus Area
{{focus}}
{% endif %}
```

| Invocation | Result |
|------------|--------|
| `>>review code="x"` | language="auto-detect", no focus section |
| `>>review code="x" language="python"` | language="python", no focus section |
| `>>review code="x" focus="security"` | language="auto-detect", focus section shown |

---

## Special Placeholders

These work in any template without defining arguments:

| Placeholder            | Value                          | Use Case               |
| ---------------------- | ------------------------------ | ---------------------- |
| `{{previous_message}}` | Last non-template user message | Continue conversations |

### Chain Step Variables

In chains, access step data:

| Variable                   | Value                                |
| -------------------------- | ------------------------------------ |
| `{{input}}`                | Current step's arguments (object)    |
| `{{input.argName}}`        | Access specific argument from input  |
| `{{step1_result}}`         | Output from step 1                   |
| `{{step2_result}}`         | Output from step 2                   |
| `{{previous_step_result}}` | Most recent step output              |
| `{{chain_id}}`             | Current chain session ID             |
| `{{step_results}}`         | All step results as object           |

**Example**: Use `{{input}}` to access step arguments:

```markdown
Analyzing topic: {{input.topic}}
Depth level: {{input.depth}}

Based on the research from step 1:
{{step1_result}}

Now synthesize the findings...
```

---

## Prompt Metadata Options

### `registerWithMcp`

Controls whether the prompt appears in MCP client prompt lists.

**Priority chain** (first defined wins):

1. Prompt-level: `"registerWithMcp": false`
2. Category-level: In category definition
3. Global config: `config.json` → `prompts.registerWithMcp`
4. Default: `true`

```json
// Hide internal utility prompt from MCP listings
{
  "id": "internal_helper",
  "registerWithMcp": false,
  ...
}
```

---

## Gate Configuration

Embed quality gates directly in your template. Add a `## Gate Configuration` section at the end:

````markdown
# My Prompt

Your prompt content here...

## Gate Configuration

```json
{
  "include": ["technical-accuracy", "code-quality"],
  "exclude": ["research-quality"],
  "framework_gates": true,
  "inline_gate_definitions": [
    {
      "name": "Custom Check",
      "type": "validation",
      "scope": "execution",
      "description": "Verify specific requirements",
      "guidance": "- Check requirement A\n- Verify requirement B",
      "pass_criteria": []
    }
  ]
}
```
````

````

### Gate Configuration Options

| Field | Type | Purpose |
|-------|------|---------|
| `include` | `string[]` | Add canonical gate IDs |
| `exclude` | `string[]` | Remove auto-assigned gates |
| `framework_gates` | `boolean` | Enable/disable methodology gates |
| `inline_gate_definitions` | `object[]` | Custom gates for this prompt |

### Inline Gate Definition

```json
{
  "id": "my-gate",
  "name": "My Custom Gate",
  "type": "validation",
  "scope": "execution",
  "description": "What this gate checks",
  "guidance": "Instructions for meeting criteria",
  "pass_criteria": [],
  "source": "manual",
  "expires_at": null
}
````

**Gate Scopes**:
| Scope | Lifespan |
|-------|----------|
| `execution` | Single prompt execution |
| `session` | Entire chain session |
| `chain` | Multi-step chain execution |
| `step` | Individual chain step only |

---

## Chain Authoring

Define multi-step workflows with `chainSteps` in your prompt metadata.

### Basic Chain

```json
{
  "id": "research_and_write",
  "name": "Research and Write",
  "chainSteps": [
    {
      "promptId": "research_topic",
      "stepName": "research"
    },
    {
      "promptId": "write_article",
      "stepName": "write",
      "inputMapping": { "research": "step1_result" }
    }
  ]
}
```

### Chain Step Properties

| Property        | Type                    | Required | Purpose                              |
| --------------- | ----------------------- | -------- | ------------------------------------ |
| `promptId`      | `string`                | Yes      | Prompt to execute                    |
| `stepName`      | `string`                | Yes      | Step identifier                      |
| `inputMapping`  | `Record<string,string>` | No       | Map step results to semantic names   |
| `outputMapping` | `Record<string,string>` | No       | Name this step's output for downstream |
| `retries`       | `number`                | No       | Retry attempts on failure (default: 0) |

### Using inputMapping

Instead of positional references like `{{step1_result}}`, use semantic names:

```json
{
  "promptId": "write_article",
  "stepName": "write",
  "inputMapping": { "research": "step1_result", "outline": "step2_result" }
}
```

Now your template can use `{{research}}` and `{{outline}}` instead of positional variables.

### Using outputMapping

Name your step's output for downstream reference:

```json
{
  "promptId": "analyze_data",
  "stepName": "analyze",
  "outputMapping": { "findings": "output" }
}
```

Downstream steps can then reference `{{findings}}` directly.

### Using retries

For steps that may fail transiently (e.g., external API calls), specify retry attempts:

```json
{
  "promptId": "fetch_external_data",
  "stepName": "fetch",
  "retries": 2
}
```

This will retry up to 2 times on failure (3 total attempts). The retries value also overrides the gate retry limit for that step.

---

## File Organization

```
prompts/
├── promptsConfig.json          # Categories + imports
├── development/
│   ├── prompts.json            # Prompt metadata
│   └── templates/
│       ├── code_review.md
│       └── write_tests.md
└── research/
    ├── prompts.json
    └── templates/
        └── analyze_topic.md
```

### promptsConfig.json

```json
{
  "categories": [
    { "id": "development", "name": "Development", "description": "Dev tools" },
    { "id": "research", "name": "Research", "description": "Research helpers" }
  ],
  "imports": ["development/prompts.json", "research/prompts.json"]
}
```

---

## Hot Reload

Edit templates → Changes apply instantly. No server restart needed.

**What triggers reload**:

- Saving `.md` template files
- Saving `prompts.json` metadata files
- `prompt_manager(action: "reload")`

**What doesn't require reload**:

- Gate configuration changes in templates (parsed on each execution)

---

## Testing Your Prompts

### 1. List and Inspect

```bash
# List all prompts
prompt_manager(action: "list")

# Inspect specific prompt
prompt_manager(action: "inspect", id: "code_review")

# Analyze execution type
prompt_manager(action: "analyze_type", id: "code_review")
```

### 2. Test Execution

```bash
# Basic execution
prompt_engine(command: ">>code_review code='function test() {}'")

# With gates
prompt_engine(command: ">>code_review code='...'", gates: ["technical-accuracy"])

# Analyze gates that would apply
prompt_manager(action: "analyze_gates", id: "code_review")
```

### 3. Check for Issues

```bash
# Validate all prompts
prompt_manager(action: "reload")  # Shows warnings for issues
```

Common warnings:

- `Template has placeholders without arguments: xyz` — Add argument or use special placeholder
- `Arguments not used in template: abc` — Remove unused argument
- `Handlebars syntax detected` — Convert to Nunjucks syntax

---

## Common Mistakes

| Don't                                 | Do Instead                                             |
| ------------------------------------- | ------------------------------------------------------ |
| Use Handlebars syntax (`{{#if}}`)     | Use Nunjucks (`{% if %}...{% endif %}`)                |
| Hardcode framework names in templates | Use `@Framework` operator at invocation                |
| Skip argument validation              | Define `validation` rules for user-facing inputs       |
| Create prompts without testing        | Run `prompt_manager(action: "reload")` to catch issues |
| Duplicate content across templates    | Use `{{ref:shared/snippet.md}}` references             |

---

## Quick Reference

### Minimal Prompt

```json
{
  "id": "hello",
  "name": "Hello",
  "category": "general",
  "description": "Simple greeting",
  "file": "templates/hello.md",
  "arguments": [{ "name": "name", "required": true }]
}
```

```markdown
# Hello

Hello, {{name}}! How can I help you today?
```

### Full-Featured Prompt

```json
{
  "id": "advanced_analysis",
  "name": "Advanced Analysis",
  "category": "research",
  "description": "Deep analysis with validation",
  "file": "templates/advanced_analysis.md",
  "registerWithMcp": true,
  "arguments": [
    {
      "name": "topic",
      "description": "Subject to analyze",
      "required": true,
      "type": "string",
      "validation": { "minLength": 3, "maxLength": 200 }
    },
    {
      "name": "depth",
      "description": "Analysis depth (quick, moderate, or deep)",
      "required": false,
      "type": "string",
      "defaultValue": "moderate"
    }
  ]
}
```

---

## Related Guides

| Guide                                           | Use When                                                     |
| ----------------------------------------------- | ------------------------------------------------------------ |
| [MCP Tooling Guide](mcp-tools.md)       | Command syntax, operators (`@`, `-->`), modifiers (`%clean`) |
| [Chains](chains.md)                             | Multi-step workflow patterns                                 |
| [Gates](gates.md)                               | Quality gate definitions                                     |
| [Architecture](architecture.md)                 | System internals, pipeline stages                            |
