# Template Syntax Reference

We use **Nunjucks** (a robust templating engine) extended with custom tags for embedding prompts and scripts.

## Why This Matters

| Problem            | Solution        | Result                               |
| ------------------ | --------------- | ------------------------------------ |
| **Duplication**    | `{{ref:id}}`    | Shared snippets updated in one place |
| **Static Prompts** | Conditionals    | Prompts adapt to input               |
| **Data Fetching**  | `{{script:id}}` | Real-time data in templates          |

---

## Standard Nunjucks

Common patterns you'll use daily.

### Variables

```django
{# Basic substitution #}
Hello {{ name }}

{# With default value #}
Format: {{ format | default("markdown") }}

{# Nested objects #}
{{ user.profile.email }}
```

### Conditionals

```django
{% if detailed %}
  Here is the full analysis...
{% else %}
  Here is the summary...
{% endif %}
```

### Equality Conditionals (Options Discovery)

Use equality checks for arguments with discrete options. The server automatically extracts these as discoverable options at cache-generation time.

```django
{# These options are auto-extracted: tutorial, howto, reference #}
{% if doc_type == "tutorial" %}
  Focus on learning outcomes...
{% elif doc_type == "howto" %}
  Focus on problem-solving...
{% elif doc_type == "reference" %}
  Focus on completeness...
{% endif %}
```

**Extraction behavior:**

| Source                         | Priority    | Example                    |
| ------------------------------ | ----------- | -------------------------- |
| YAML `options` array           | 1 (highest) | `options: ["a", "b", "c"]` |
| Template `{% if x == "val" %}` | 2           | Parsed at cache-generation |
| Description pattern            | 3 (lowest)  | `'Type: a \| b \| c'`      |

**Hook output example:**

```
doc_type: tutorial | howto | reference (required)
```

### Loops

```django
{% for item in items %}
  - {{ item }}
{% endfor %}
```

---

## Custom Extensions

Features specific to this MCP server.

### 1. `{{ref:id}}` — Includes

Embed another prompt or template file inline.

```django
{# Include by Prompt ID #}
{{ ref:shared_header }}

{# Include by Relative Path #}
{{ ref:../snippets/footer.md }}
```

**Variables**: The included template shares the parent's context.

### 2. `{{script:id}}` — Script Execution

Run a script tool and insert its output.

```django
{# Run script 'word_count' #}
Word count: {{script:word_count text=content}}

{# Access JSON properties #}
{{script:analyzer.score}}
```

**No space after `{{`.** The resolver matches `{{script:` literally, so a spaced
`{{ script:word_count }}` is never resolved — and Nunjucks then fails to parse it as an
expression, which fails the whole render rather than rendering nothing.

#### Approval

A reference is the prompt author asking to run something, which is not the same as the
caller asking. So `execution.confirm` is honored here exactly as it is on the declarative
`tools:` route:

| Tool sets                   | `{{script:id}}` behavior                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| `confirm: false`            | Runs during rendering.                                                         |
| `confirm: true`             | Refuses, unless the invocation names the tool as `tool:<id>` in its arguments. |
| nothing (`confirm` omitted) | Treated as `true` — the default requires approval.                             |

A refusal raises `ScriptConfirmationRequiredError` and aborts the render; it does not
silently produce an empty value. Because the render aborted, there is no pending state to
resume against, so re-running the command does not approve an inline reference the way it
does a declarative one — pass `tool:<id>`:

```
>>my_prompt text:"..." tool:analyzer
```

`server/resources/prompts/examples/reference_demo` ships both cases side by side —
`word_count` (`confirm: false`) and `text_digest` (`confirm: true`).

#### Output limits and escaping

- Script stdout is capped (default 50,000 characters, `maxOutputChars`). Exceeding the cap
  is a **failure**, not a trim — a truncated JSON payload is a different value, not a
  shorter one, so `{{script:id.field}}` would otherwise render empty with nothing
  reporting the loss.
- Script output is inserted as literal text. Template syntax a script emits is **not**
  evaluated, so a script returning remote or user-supplied data cannot inject
  `{{ ... }}` or `{% ... %}` into the surrounding prompt.

---

## Special Variables

Available in all templates automatically.

| Variable               | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `{{input}}`            | The raw arguments object passed to the prompt. |
| `{{chain_id}}`         | Current chain session ID (if in a chain).      |
| `{{step_results}}`     | Map of all previous chain step outputs.        |
| `{{previous_message}}` | The last user message (for context awareness). |

---

## Escaping

If you need to show literal curly braces (like in code examples), use `raw` blocks:

```django
Here is a React component:

{% raw %}
function App() {
  return <div>{hello}</div>
}
{% endraw %}
```

A `raw` block also suppresses script execution, so a prompt can document the syntax without
running anything:

```django
{% raw %}{{script:word_count text=content}}{% endraw %}
```

That renders as literal text and executes no script. Without the block the reference resolves
during rendering, which is how a prompt's own explanatory table can run a tool.
