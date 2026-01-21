# Template Syntax Reference

> Status: canonical

We use **Nunjucks** (a robust templating engine) extended with custom tags for embedding prompts and scripts.

## Why This Matters

| Problem | Solution | Result |
|---------|----------|--------|
| **Duplication** | `{{ref:id}}` | Shared snippets updated in one place |
| **Static Prompts** | Conditionals | Prompts adapt to input |
| **Data Fetching** | `{{script:id}}` | Real-time data in templates |

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

| Source | Priority | Example |
|--------|----------|---------|
| YAML `options` array | 1 (highest) | `options: ["a", "b", "c"]` |
| Template `{% if x == "val" %}` | 2 | Parsed at cache-generation |
| Description pattern | 3 (lowest) | `'Type: a \| b \| c'` |

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
Word count: {{ script:word_count text=content }}

{# Access JSON properties #}
{{ script:analyzer.score }}
```

---

## Special Variables

Available in all templates automatically.

| Variable | Description |
|----------|-------------|
| `{{input}}` | The raw arguments object passed to the prompt. |
| `{{chain_id}}` | Current chain session ID (if in a chain). |
| `{{step_results}}` | Map of all previous chain step outputs. |
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
