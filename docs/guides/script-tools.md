# Script Tools

Run Python, Node, or shell scripts during prompt execution. Scripts validate input, compute results, and can auto-trigger MCP tools.

**Why script tools?** Stop copy-pasting validation logic. Define it once in a schema, let the script handle the rest. Scripts can even chain into other MCP tools automatically.

## Quick Start

Create a word counter tool in 3 files:

```
resources/prompts/utils/word_count/
├── prompt.yaml
└── tools/
    └── counter/
        ├── tool.yaml
        ├── schema.json
        └── script.py
```

**1. Tool config** (`tools/counter/tool.yaml`):
```yaml
id: counter
name: Word Counter
runtime: python
script: script.py
timeout: 5000

execution:
  trigger: schema_match
```

**2. Input schema** (`tools/counter/schema.json`):
```json
{
  "type": "object",
  "properties": {
    "text": { "type": "string", "description": "Text to count" }
  },
  "required": ["text"]
}
```

**3. Script** (`tools/counter/script.py`):
```python
#!/usr/bin/env python3
import json, sys
data = json.load(sys.stdin)
text = data.get("text", "")
print(json.dumps({"words": len(text.split()), "chars": len(text)}))
```

**Use it:**
```
prompt_engine(command: ">>word_count", options: {text: "Hello world"})
```

Result available in template as `{{tool_counter}}`.

---

## How It Works

```
User Input → Schema Match → Script Executes → Output to Template
                              ↓
                    (optional) Auto-Execute MCP Tool
```

| Step | What Happens |
|------|--------------|
| 1. Schema match | User args compared against `schema.json` |
| 2. Script runs | Receives args via stdin (JSON), outputs to stdout |
| 3. Template merge | Output available as `{{tool_<id>}}` |
| 4. Auto-execute | If script returns `auto_execute` block, MCP tool is invoked |

---

## Trigger Types

Control **when** your script activates:

| Trigger | Activates When | Best For |
|---------|----------------|----------|
| `schema_match` | User args match schema (default) | Most tools |
| `explicit` | User passes `tool:<id>` argument | Destructive/expensive ops |
| `always` | Every prompt execution | Logging, metrics |
| `never` | Disabled | WIP features |

### schema_match (Default)

```yaml
execution:
  trigger: schema_match
  strict: false  # ANY required param triggers
```

**Strict mode comparison:**

| Mode | Behavior |
|------|----------|
| `strict: false` | Triggers if ANY required param present |
| `strict: true` | Triggers only if ALL required params present |

### explicit

User must explicitly request:
```
>>my_prompt tool:deploy env:"production"
```

Config:
```yaml
execution:
  trigger: explicit
```

### Confirmation Gate

Add a confirmation step for expensive operations:

```yaml
execution:
  trigger: schema_match
  confirm: true
  confirmMessage: "Run full analysis? Takes ~5 minutes."
```

Flow: Detection → Confirmation prompt → User approves with `tool:<id>` → Execution

---

## Auto-Execute: Chain Scripts to MCP Tools

Scripts can trigger MCP tools automatically. This enables **wizard workflows**: validate input in a script, then invoke `resource_manager`, `prompt_engine`, etc.

### Response Format

Return this JSON structure to trigger auto-execution:

```json
{
  "valid": true,
  "auto_execute": {
    "tool": "resource_manager",
    "params": {
      "resource_type": "methodology",
      "action": "create",
      "id": "my-framework",
      "name": "My Framework"
    }
  },
  "warnings": [],
  "summary": { "phases": 5 }
}
```

If `valid: false`, auto-execute is skipped:

```json
{
  "valid": false,
  "errors": ["Missing required field: phases", "ID must be lowercase"],
  "warnings": []
}
```

### Template Integration

```markdown
{% if tool_builder.valid %}
  {% if tool_builder_result %}
    ## Created Successfully
    {{ tool_builder_result.text }}
  {% else %}
    ## Ready to Create
    Parameters: {{ tool_builder.auto_execute.params | dump }}
  {% endif %}
{% else %}
  ## Validation Failed
  {% for error in tool_builder.errors %}- {{ error }}
  {% endfor %}
{% endif %}
```

---

## Real-World Example: Methodology Builder

The `create_methodology` prompt uses auto-execute to create new framework methodologies.

### Directory Structure

```
resources/prompts/examples/create_methodology/
├── prompt.yaml
├── user-message.md
└── tools/
    └── methodology_builder/
        ├── tool.yaml      # trigger: schema_match
        ├── schema.json    # Validates methodology structure
        └── script.py      # Returns auto_execute for resource_manager
```

### The Script (Simplified)

```python
#!/usr/bin/env python3
import json, sys

def validate(data):
    errors = []
    if not data.get("id"):
        errors.append("Missing: id")
    if len(data.get("phases", [])) < 2:
        errors.append("Need at least 2 phases")

    if errors:
        return {"valid": False, "errors": errors}

    return {
        "valid": True,
        "auto_execute": {
            "tool": "resource_manager",
            "params": {
                "resource_type": "methodology",
                "action": "create",
                **data
            }
        }
    }

print(json.dumps(validate(json.load(sys.stdin))))
```

### Usage

**Design mode** — Get guidance on creating a methodology:
```
prompt_engine(command: ">>create_methodology", options: {
  name: "FOCUS",
  concept: "targeted problem solving"
})
```

**Creation mode** — Pass all fields, script validates and creates:
```
prompt_engine(command: ">>create_methodology", options: {
  "id": "focus",
  "name": "FOCUS Framework",
  "system_prompt_guidance": "Apply FOCUS:\n\n**Find**: Identify...",
  "phases": [
    {"id": "find", "name": "Find", "description": "Identify the problem"}
  ]
})
```

---

## Meta-Prompt Pattern

Build "wizard" prompts that guide users through complex creation workflows. The template shows different content based on whether the script triggered.

### Two-Phase UX

| Phase | Trigger | Template Shows |
|-------|---------|----------------|
| **Design** | No schema match (missing required fields) | Guidance, examples, field descriptions |
| **Validation** | Schema matches (all required fields present) | Script runs → results, errors, or success |
| **Auto-Execute** | Script returns `valid: true` + `auto_execute` | MCP tool called, result shown |

### Template Structure

```markdown
{% if not tool_builder %}
{# ═══════ DESIGN PHASE ═══════ #}
# Create a Widget

To create a widget, provide these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (lowercase, hyphens) |
| `name` | Yes | Display name |
| `type` | No | Widget type (default: "standard") |

## Example

```
>>create_widget id:"my-widget" name:"My Widget"
```

{% elif tool_builder.valid %}
{# ═══════ VALIDATION PASSED ═══════ #}
  {% if tool_builder_result %}
{# ═══════ AUTO-EXECUTE SUCCEEDED ═══════ #}
## Widget Created Successfully

{{ tool_builder_result.text }}

**Next steps:**
- Test your widget: `>>my_widget`
- Edit: `resource_manager(action:"update", id:"{{tool_builder.output.id}}")`
  {% else %}
{# ═══════ READY TO CREATE ═══════ #}
## Validation Passed

Widget configuration is valid and ready to create.
  {% endif %}
{% else %}
{# ═══════ VALIDATION FAILED ═══════ #}
## Validation Errors

Fix these issues:

{% for error in tool_builder.errors %}- {{ error }}
{% endfor %}

Then retry with the corrected values.
{% endif %}
```

### Working Examples

These meta-prompts demonstrate the pattern:

| Prompt | Creates | Location |
|--------|---------|----------|
| `>>create_gate` | Quality gates | `resources/prompts/examples/create_gate/` |
| `>>create_prompt` | New prompts | `resources/prompts/examples/create_prompt/` |
| `>>create_methodology` | Frameworks | `resources/prompts/examples/create_methodology/` |

---

## Template Variables

Complete reference for script tool variables available in templates:

### Script Output Variables

| Variable | Type | When Available | Description |
|----------|------|----------------|-------------|
| `{{tool_<id>}}` | object | After schema match | Full script result object |
| `{{tool_<id>.valid}}` | boolean | After script runs | Whether validation passed |
| `{{tool_<id>.output}}` | any | If script returns `output` | Parsed output data |
| `{{tool_<id>.errors}}` | string[] | If `valid: false` | Validation error messages |
| `{{tool_<id>.warnings}}` | string[] | Always | Non-blocking warnings |
| `{{tool_<id>.summary}}` | object | Optional | Metadata for display |
| `{{tool_<id>.auto_execute}}` | object | If auto-execute configured | MCP tool params |

### Auto-Execute Variables

| Variable | Type | When Available | Description |
|----------|------|----------------|-------------|
| `{{tool_<id>_result}}` | object | After auto-execute completes | MCP tool response |
| `{{tool_<id>_result.text}}` | string | On success | Response message |
| `{{tool_<id>_result.error}}` | string | On failure | Error message |

### Conditional Patterns

**Check if script triggered:**
```nunjucks
{% if tool_counter %}
  Script ran: {{tool_counter.output.words}} words
{% else %}
  Waiting for input...
{% endif %}
```

**Check validation status:**
```nunjucks
{% if tool_builder.valid %}
  Ready to proceed
{% else %}
  Errors: {{tool_builder.errors | join(', ')}}
{% endif %}
```

**Check auto-execute result:**
```nunjucks
{% if tool_builder_result %}
  Created: {{tool_builder_result.text}}
{% elif tool_builder.valid %}
  Validation passed, awaiting creation
{% endif %}
```

---

## Runtime Support

| Runtime | Value | Interpreter |
|---------|-------|-------------|
| Python | `python` | `python3` |
| Node.js | `node` | `node` |
| Shell | `shell` | `bash` / `sh` |
| Auto | `auto` | Detected from extension |

---

## Configuration Reference

### tool.yaml

```yaml
id: my_tool              # Unique identifier
name: My Tool            # Display name
description: Does things # Optional
runtime: python          # python | node | shell | auto
script: script.py        # Relative to tool directory
timeout: 30000           # Max execution time (ms)
enabled: true            # Set false to disable
workingDir: .            # Script working directory (relative to tool dir)

# Environment variables (explicit pass-through)
env:
  MY_VAR: "static_value"           # Static value
  API_KEY: "${API_KEY}"            # Pass-through from parent env

execution:
  trigger: schema_match  # schema_match | explicit | always | never
  strict: false          # Require ALL params (schema_match only)
  confirm: false         # Require user confirmation
  confirmMessage: "..."  # Custom confirmation text
```

### schema.json

Standard JSON Schema. Required params trigger `schema_match`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "input": { "type": "string", "description": "Main input" },
    "verbose": { "type": "boolean", "default": false }
  },
  "required": ["input"]
}
```

---

## Best Practices

| Do | Don't |
|----|-------|
| Use `schema_match` for most tools | Use `always` for expensive operations |
| Use `explicit` for destructive actions | Skip validation in auto-execute scripts |
| Keep timeouts reasonable (5-30s) | Set timeout > 5 minutes |
| Return structured JSON | Print debug output to stdout |
| Validate before building `auto_execute` | Trust user input blindly |

---

## Security Model

Scripts run like npm/pip packages: you trust the author. Version-control and code-review are your safeguards.

### Protections

| Protection | What It Does |
|------------|--------------|
| Process isolation | Separate subprocess per script |
| Timeout | Default 30s, max 5min — kills runaway scripts |
| Working directory | Locked to tool folder |
| Env filtering | Only safe vars inherited (no leaked API keys) |
| Input validation | JSON Schema checked before execution |
| Auto-execute whitelist | Only approved MCP tools can trigger |

### Environment Variables

Your `ANTHROPIC_API_KEY` won't leak into scripts. Only safe runtime vars pass through:

| Inherited | Blocked (must pass explicitly) |
|-----------|-------------------------------|
| `PATH`, `HOME`, `USER`, `SHELL` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| `NODE_ENV`, `PYTHONPATH`, `VIRTUAL_ENV` | `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL` |
| `LANG`, `LC_ALL`, `EDITOR`, `CI` | Any credential or secret |

**Need a blocked var?** Pass it explicitly in `tool.yaml`:

```yaml
env:
  DATABASE_URL: "${DATABASE_URL}"
  MY_API_KEY: "${MY_API_KEY}"
```

### What Scripts CAN Do

| Capability | Example |
|------------|---------|
| Filesystem access | Read configs, write temp files |
| Network requests | Call APIs, fetch data |
| Child processes | Run other scripts, shell commands |
| Passed env vars | Use explicitly configured secrets |

Full process capabilities by design. The trust boundary is *who writes the script*, not *what the script can do*.

---

## Migration from Deprecated Config

### `mode` → `trigger` / `confirm`

| Old | New |
|-----|-----|
| `mode: auto` | Remove (default) |
| `mode: manual` | `trigger: explicit` |
| `mode: confirm` | `confirm: true` |

### `confidence` → `strict`

| Old | New |
|-----|-----|
| `confidence: 0.8` | `strict: false` |
| `confidence: 1.0` | `strict: true` |

---

## Inline Script References

Execute scripts inline during template rendering using `{{script:id}}` syntax. Unlike auto-execute patterns, inline references resolve **before** template processing, making results available immediately.

### Syntax

| Pattern | Description | Example Output |
|---------|-------------|----------------|
| `{{script:id}}` | Full JSON output | `{"count": 42, "status": "ok"}` |
| `{{script:id.field}}` | Access specific field | `42` |
| `{{script:id key='val'}}` | Pass inline arguments | Varies by script |

### Basic Usage

```markdown
## Analysis Results

Row count: {{script:analyzer.row_count}}
Status: {{script:analyzer.status}}

Full data: {{script:analyzer}}
```

### Inline Arguments

Pass arguments directly in the reference:

```markdown
<!-- String values (use quotes) -->
{{script:formatter text='Hello World'}}

<!-- Numbers and booleans (no quotes) -->
{{script:calculator num=42 verbose=true}}

<!-- Multiple arguments -->
{{script:analyzer file='data.csv' format='json' limit=100}}
```

Inline arguments **override** context variables with the same name.

### Script Discovery

Scripts are searched in priority order:

1. **Prompt-local**: `resources/prompts/{category}/{prompt}/tools/{script_id}/`
2. **Workspace**: `resources/scripts/{script_id}/`

First match wins. Prompt-local scripts take priority.

### Error Handling

Script execution is **blocking**. Errors stop template processing:

| Error | When | Message |
|-------|------|---------|
| `ScriptNotRegisteredError` | Script not found | Lists searched paths |
| `ScriptExecutionFailedError` | Script exits non-zero | Includes stderr |
| `InvalidFieldAccessError` | Field doesn't exist | Lists available fields |
| `InvalidScriptOutputError` | Field access on non-object | Shows raw output |

### Caching

Duplicate references in the same template execute only **once**:

```markdown
<!-- Script runs once, both show "42" -->
Count: {{script:analyzer.count}}
Again: {{script:analyzer.count}}
```

Cache key includes script ID, field access, and inline arguments. Different arguments = different execution.

### Combining with Template Variables

Script references resolve first, then template variables:

```markdown
<!-- Works: script runs, then {{name}} replaces -->
The {{script:analyzer.row_count}} rows belong to {{name}}.

<!-- Also works: context passed to script -->
Analysis for {{name}}: {{script:analyzer user='{{name}}'}}
```

### Comparison: Auto-Execute vs Inline References

| Feature | Auto-Execute | Inline Reference |
|---------|--------------|------------------|
| Trigger | Schema match | Template pattern |
| Template var | `{{tool_<id>}}` | `{{script:id}}` |
| Arguments | User args + context | Inline + context |
| MCP chaining | Yes (`auto_execute`) | No |
| Error behavior | Validation result | Blocking exception |
| Use case | Wizard workflows | Data injection |

---

## Related

- [Prompt Authoring Guide](prompt-authoring-guide.md) — Template structure and arguments
- [MCP Tools Reference](../reference/mcp-tools.md) — `prompt_engine` command syntax
- [Chains](chains.md) — Multi-step workflows
