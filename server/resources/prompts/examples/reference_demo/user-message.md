{# DEMO: Prompt Reference - includes content from another prompt #}
{{ref:shared_intro}}

---

## Text Analysis Request

Analyze the following text: "{{text}}"

{# DEMO: Automatic Tool Execution - tool results available as Nunjucks variables #}
{% if tool_word_count %}

## Script Tool Results (Automatic Execution)

The word_count script tool was automatically executed:

- **Word Count**: {{tool_word_count.word_count}}
- **Character Count**: {{tool_word_count.character_count}}
- **Line Count**: {{tool_word_count.line_count}}
- **Unique Words**: {{tool_word_count.unique_words}}
  {% else %}
  Please analyze the text and provide insights.
  {% endif %}

{# DEMO: Confirm-gated tool on the declarative route - awaits approval, so this
block stays empty until the invocation names tool:text_digest #}
{% if tool_text_digest %}

## Confirm-Gated Tool (Declarative, Approved)

`text_digest` sets `execution.confirm: true`, so it ran only because this
invocation named it:

- **Digest**: {{tool_text_digest.digest}}
- **Length**: {{tool_text_digest.length}}
  {% else %}

## Confirm-Gated Tool (Declarative, Awaiting Approval)

`text_digest` sets `execution.confirm: true` and this invocation did not name it,
so it has not run. Add `tool:text_digest` to the arguments to approve it.
{% endif %}

{# DEMO: Inline Script Reference - execute scripts directly in templates #}

## Inline Script Reference (Automatic)

`word_count` sets `confirm: false`, so an inline reference runs it directly:

- Full JSON output: {{script:word_count}}
- Field access: {{script:word_count.word_count}}

## What This Demonstrates

Two tools live in this one prompt, and each keeps its own `confirm` setting on
both routes:

| Tool          | `confirm` | Declared in `tools:` | Inline reference                                      |
| ------------- | --------- | -------------------- | ----------------------------------------------------- |
| `word_count`  | `false`   | runs automatically   | {% raw %}`{{script:word_count}}` runs{% endraw %}     |
| `text_digest` | `true`    | waits for approval   | {% raw %}`{{script:text_digest}}` refuses{% endraw %} |

Those two cells sit inside a `raw` block, which is what lets this table print the
syntax instead of executing it. Without it the resolver would read the table's
own explanation as a live reference and run `text_digest` — the documentation
would trigger the very thing it describes.

The setting belongs to the tool, not to the route that reaches it. An inline
reference is the prompt author asking, which is not the same as you asking — so
a confirm-required tool referenced inline stops and tells you to add
`tool:<id>`, rather than running because a template mentioned it.
