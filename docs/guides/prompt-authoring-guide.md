# Prompt & Template Authoring Guide

> Status: canonical

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

Prompts use YAML format with two patterns based on complexity:

### Pattern 1: Single-File (Simple Prompts)

Best for prompts with short templates. Everything in one `.yaml` file:

```yaml
# prompts/development/quick_check.yaml
id: quick_check
name: Quick Code Check
description: Fast code quality check
# category auto-derived from directory: development

userMessageTemplate: |
  Review this code quickly for obvious issues:

  ```{{language}}
  {{code}}
  ```

  Focus on: security, performance, clarity.

arguments:
  - name: code
    description: Code to review
    required: true
  - name: language
    description: Programming language
    required: false
```

### Pattern 2: Directory (Complex Prompts)

Best for prompts with long templates or system messages:

```
prompts/development/code_review/
├── prompt.yaml           # Metadata + file references
├── user-message.md       # Template content
└── system-message.md     # Optional system prompt
```

**prompt.yaml:**
```yaml
id: code_review
name: Code Review
description: Comprehensive code review with checklist
# category auto-derived from directory path

systemMessageFile: system-message.md
userMessageTemplateFile: user-message.md

arguments:
  - name: code
    description: Code to review
    required: true
  - name: focus
    description: Review focus area
    required: false
```

**user-message.md:**
```markdown
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

### When to Use Each Pattern

| Pattern | Use When |
|---------|----------|
| **Single-file** | Short templates (<50 lines), no system message, simple prompts |
| **Directory** | Long templates, system message needed, multiple components |

### Invoke It

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

### Template References

Stop copy-pasting. Include other prompts or run scripts inline.

#### `{{ref:id}}` — Include Another Prompt

```markdown
{{ref:shared_intro}}

## My Content
Analysis of {{topic}}...
```

Renders `shared_intro` inline. Variables shared with parent.

| Feature | Behavior |
|---------|----------|
| Nesting | Yes (circular refs detected) |
| Variables | Shared with parent |
| Hot-reload | Immediate |

#### `{{script:id}}` — Run Scripts Inline

```markdown
{{script:word_count}}              → Full JSON
{{script:word_count.word_count}}   → Single field
{{script:analyzer file='data.csv'}} → With args
```

**Requires:** `tools: [tool_id]` in `prompt.yaml` + script in `tools/{id}/`.

#### When to Use Which

| | `{{script:id}}` | `tools:` auto-execute |
|-|-----------------|----------------------|
| **Runs** | At render | Before render |
| **You control** | Placement | Schema triggers it |
| **Output** | Inline text | `{{tool_id}}` var |

**Try it:** `>>reference_demo text="hello"`

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

```yaml
arguments:
  - name: topic
    type: string
    required: true
    validation:
      minLength: 10
      maxLength: 200
      pattern: "^[A-Za-z0-9 ]+$"
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

```yaml
arguments:
  - name: url
    type: string
    required: true
    validation:
      pattern: "^https://(docs\\.github\\.com|api\\.github\\.com)/"
```

### Complete Validation Example

Here's the full workflow for a prompt with validation:

**Step 1: Define metadata with validation** (`resources/prompts/research/analyze_topic/prompt.yaml`):

```yaml
id: analyze_topic
name: Analyze Topic
description: Deep analysis of a topic
userMessageTemplateFile: user-message.md

arguments:
  - name: topic
    description: Subject to analyze (10-200 chars)
    required: true
    type: string
    validation:
      minLength: 10
      maxLength: 200
  - name: source_url
    description: Reference URL (must be HTTPS)
    required: false
    type: string
    validation:
      pattern: "^https://"
```

**Step 2: Create the template** (`resources/prompts/research/analyze_topic/user-message.md`):

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

```yaml
arguments:
  - name: format
    type: string
    required: false
    defaultValue: markdown
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

| Type | YAML Example |
|------|--------------|
| `string` | `defaultValue: brief` |
| `number` | `defaultValue: 10` |
| `boolean` | `defaultValue: true` |
| `array` | `defaultValue: [a, b]` |

### Handling Missing Arguments

Choose the right pattern based on your use case:

| Scenario | Pattern | Example |
|----------|---------|---------|
| **Must be provided** | `required: true` | User must supply `topic` |
| **Has sensible default** | `required: false` + `defaultValue` | `format` defaults to `"markdown"` |
| **Section is optional** | `required: false` + template conditional | Focus area only shown if provided |

**Pattern 1: Required Arguments**

Use when the prompt cannot function without the value:

```yaml
arguments:
  - name: code
    required: true
    description: Code to review
```

If missing, execution fails with a clear error:
```
Missing required argument: code
Retry with: >>code_review code="<your code>"
```

**Pattern 2: Optional with Default**

Use when a sensible default exists and the argument should always have a value:

```yaml
arguments:
  - name: depth
    required: false
    defaultValue: moderate
```

Template uses the value directly (always present):
```markdown
Analysis depth: {{depth}}
```

**Pattern 3: Optional with Conditional**

Use when the entire section should be omitted if the argument isn't provided:

```yaml
arguments:
  - name: focus
    required: false
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

```yaml
arguments:
  - name: code
    required: true
  - name: language
    required: false
    defaultValue: auto-detect
  - name: focus
    required: false
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

1. Prompt-level: `registerWithMcp: false`
2. Category-level: In category definition
3. Global config: `config.json` → `prompts.registerWithMcp`
4. Default: `true`

```yaml
# Hide internal utility prompt from MCP listings
id: internal_helper
name: Internal Helper
registerWithMcp: false
# ...
```

---

## Gate Configuration

Configure quality gates in your `prompt.yaml`:

```yaml
# resources/prompts/research/my_prompt/prompt.yaml
id: my_prompt
name: My Prompt
description: A prompt with gate configuration
userMessageTemplateFile: user-message.md

gateConfiguration:
  include:
    - technical-accuracy
    - code-quality
  exclude:
    - research-quality
  framework_gates: true
  inline_gate_definitions:
    - name: Custom Check
      type: validation
      scope: execution
      description: Verify specific requirements
      guidance: |
        - Check requirement A
        - Verify requirement B
      pass_criteria: []
```

### Gate Configuration Options

| Field | Type | Purpose |
|-------|------|---------|
| `include` | `string[]` | Add canonical gate IDs |
| `exclude` | `string[]` | Remove auto-assigned gates |
| `framework_gates` | `boolean` | Enable/disable methodology gates |
| `inline_gate_definitions` | `object[]` | Custom gates for this prompt |

### Inline Gate Definition

```yaml
inline_gate_definitions:
  - id: my-gate
    name: My Custom Gate
    type: validation
    scope: execution
    description: What this gate checks
    guidance: Instructions for meeting criteria
    pass_criteria: []
    source: manual
```

**Gate Scopes**:
| Scope | Lifespan |
|-------|----------|
| `execution` | Single prompt execution |
| `session` | Entire chain session |
| `chain` | Multi-step chain execution |
| `step` | Individual chain step only |

---

## Script Tools

Attach validation scripts to prompts. Scripts auto-trigger when user args match the tool's JSON schema.

### Quick Start

**1. Add `tools:` to your prompt.yaml:**

```yaml
id: create_widget
name: Create Widget
tools:
  - widget_builder
```

**2. Create the tool directory:**

```
prompts/development/create_widget/
├── prompt.yaml
├── user-message.md
└── tools/
    └── widget_builder/
        ├── tool.yaml       # Config (trigger, runtime)
        ├── schema.json     # Input validation schema
        └── script.py       # Your validation logic
```

**3. Access results in template:**

```markdown
{% if tool_widget_builder %}
  {% if tool_widget_builder.valid %}
    Widget validated: {{tool_widget_builder.output.name}}
  {% else %}
    Fix these issues: {{tool_widget_builder.errors | join(', ')}}
  {% endif %}
{% else %}
  {# Design phase: show guidance #}
  Provide the widget configuration...
{% endif %}
```

### What Scripts Enable

| Pattern | Description | Example |
|---------|-------------|---------|
| **Validation** | Check user input before execution | Validate YAML syntax, check for conflicts |
| **Two-phase UX** | Design guidance → validation feedback | Meta-prompts like `>>create_gate` |
| **Auto-execute** | Script triggers MCP tool automatically | Create resources after validation passes |

### Template Variables

| Variable | Type | Description |
|----------|------|-------------|
| `{{tool_<id>}}` | object | Full script result |
| `{{tool_<id>.valid}}` | bool | Validation passed? |
| `{{tool_<id>.output}}` | any | Parsed script output |
| `{{tool_<id>.errors}}` | array | Validation errors |
| `{{tool_<id>_result}}` | object | Auto-execute response (if triggered) |

→ **Full guide**: [Script Tools](script-tools.md) — trigger modes, auto-execute, meta-prompt patterns

---

## Chain Authoring

Define multi-step workflows with `chainSteps` in your prompt YAML.

### Basic Chain

```yaml
# resources/prompts/research/research_and_write/prompt.yaml
id: research_and_write
name: Research and Write
category: research
description: Research a topic then write about it
userMessageTemplateFile: user-message.md

chainSteps:
  - promptId: research_topic
    stepName: "Research (1/2)"
  - promptId: write_article
    stepName: "Write (2/2)"
    inputMapping:
      research: steps.research_topic.result
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

Map prior step outputs to semantic names your template can use:

```yaml
chainSteps:
  - promptId: write_article
    stepName: "Write (2/3)"
    inputMapping:
      research: steps.research_topic.result
      outline: steps.create_outline.result
```

Now your template uses `{{research}}` and `{{outline}}` instead of positional variables.

### Using outputMapping

Name your step's output for downstream reference:

```yaml
chainSteps:
  - promptId: analyze_data
    stepName: "Analyze (1/2)"
    outputMapping:
      findings: output
```

Downstream steps can then reference `{{findings}}` directly.

### Using retries

For steps that may fail transiently (e.g., external API calls), specify retry attempts:

```yaml
chainSteps:
  - promptId: fetch_external_data
    stepName: "Fetch (1/2)"
    retries: 2
```

This will retry up to 2 times on failure (3 total attempts). The retries value also overrides the gate retry limit for that step.

→ **Full guide**: [Chains](chains.md) for session management and advanced patterns.

---

## File Organization

Prompts use a directory-based structure. Each prompt gets its own folder:

```
resources/prompts/
├── development/                    # Category
│   ├── category.yaml               # Optional category metadata
│   ├── code_review/                # Prompt directory
│   │   ├── prompt.yaml             # Metadata + config
│   │   ├── user-message.md         # Template content
│   │   └── system-message.md       # Optional system prompt
│   └── write_tests/
│       ├── prompt.yaml
│       └── user-message.md
└── research/
    └── analyze_topic/
        ├── prompt.yaml
        ├── user-message.md
        └── system-message.md
```

### Category Metadata (Optional)

```yaml
# resources/prompts/development/category.yaml
id: development
name: Development
description: Development and coding tools
registerWithMcp: true
```

Categories are auto-derived from directory names if no `category.yaml` exists.

---

## Hot Reload

Edit templates → Changes apply instantly. No server restart needed.

**What triggers reload**:

- Saving `.md` template files
- Saving `prompts.json` metadata files
- `resource_manager(resource_type:"prompt", action:"reload")`

**What doesn't require reload**:

- Gate configuration changes in templates (parsed on each execution)

---

## Testing Your Prompts

### 1. List and Inspect

```bash
# List all prompts
resource_manager(resource_type:"prompt", action:"list")

# Inspect specific prompt
resource_manager(resource_type:"prompt", action:"inspect", id:"code_review")

# Analyze execution type
resource_manager(resource_type:"prompt", action:"analyze_type", id:"code_review")
```

### 2. Test Execution

```bash
# Basic execution
prompt_engine(command: ">>code_review code='function test() {}'")

# With gates
prompt_engine(command: ">>code_review code='...'", gates: ["technical-accuracy"])

# Analyze gates that would apply
resource_manager(resource_type:"prompt", action:"analyze_gates", id:"code_review")
```

### 3. Check for Issues

```bash
# Validate all prompts
resource_manager(resource_type:"prompt", action:"reload")  # Shows warnings for issues
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
| Create prompts without testing        | Run `resource_manager(resource_type:"prompt", action:"reload")` to catch issues |
| Duplicate content across templates    | Use `{{ref:shared/snippet.md}}` references             |

---

## Quick Reference

### Minimal Prompt

```yaml
# resources/prompts/general/hello/prompt.yaml
id: hello
name: Hello
description: Simple greeting
userMessageTemplateFile: user-message.md

arguments:
  - name: name
    required: true
```

```markdown
# user-message.md
Hello, {{name}}! How can I help you today?
```

### Full-Featured Prompt

```yaml
# resources/prompts/research/advanced_analysis/prompt.yaml
id: advanced_analysis
name: Advanced Analysis
description: Deep analysis with validation
systemMessageFile: system-message.md
userMessageTemplateFile: user-message.md
registerWithMcp: true

arguments:
  - name: topic
    description: Subject to analyze
    required: true
    type: string
    validation:
      minLength: 3
      maxLength: 200
  - name: depth
    description: Analysis depth (quick, moderate, or deep)
    required: false
    type: string
    defaultValue: moderate

gateConfiguration:
  include:
    - research-quality
    - technical-accuracy
```

---

## Version History

Resources (prompts, gates, methodologies) automatically track version history. Every update creates a snapshot you can view, compare, or rollback to.

### View History

```bash
# List recent versions
resource_manager(resource_type:"prompt", action:"history", id:"code_review")

# Limit results
resource_manager(resource_type:"prompt", action:"history", id:"code_review", limit:5)
```

Returns timestamped versions with author and reason:

```json
{
  "versions": [
    { "version": "2024-01-15T10:30:00Z", "author": "user", "reason": "Added security checklist" },
    { "version": "2024-01-10T14:20:00Z", "author": "user", "reason": "Initial creation" }
  ]
}
```

### Compare Versions

```bash
# Compare version to current
resource_manager(resource_type:"prompt", action:"compare", id:"code_review", version:"2024-01-10T14:20:00Z")

# Compare two specific versions
resource_manager(resource_type:"prompt", action:"compare", id:"code_review", version:"2024-01-10T14:20:00Z", compare_to:"2024-01-15T10:30:00Z")
```

Returns field-by-field diff showing what changed.

### Rollback

```bash
# Rollback to previous version
resource_manager(resource_type:"prompt", action:"rollback", id:"code_review", version:"2024-01-10T14:20:00Z", reason:"Reverting security changes")
```

Rollback creates a new version (preserving history) with the content from the target version.

### Skip Auto-Versioning

For minor edits that don't need history:

```bash
resource_manager(resource_type:"prompt", action:"update", id:"code_review", skip_version:true, ...)
```

### Configuration

Version history is configured in `config.json`:

```json
{
  "versioning": {
    "enabled": true,
    "max_versions": 50,
    "auto_version_on_update": true
  }
}
```

| Option | Default | Purpose |
|--------|---------|---------|
| `enabled` | `true` | Enable/disable version tracking |
| `max_versions` | `50` | Max versions per resource (FIFO pruning) |
| `auto_version_on_update` | `true` | Create snapshot before updates |

---

## Related Guides

| Guide                                           | Use When                                                     |
| ----------------------------------------------- | ------------------------------------------------------------ |
| [MCP Tooling Guide](../reference/mcp-tools.md)       | Command syntax, operators (`@`, `-->`), modifiers (`%clean`) |
| [Script Tools](script-tools.md)                 | Adding executable scripts to prompts, auto-execute workflows |
| [Chains](chains.md)                             | Multi-step workflow patterns                                 |
| [Gates](gates.md)                               | Quality gate definitions                                     |
| [Architecture](../architecture/overview.md)                 | System internals, pipeline stages                            |
