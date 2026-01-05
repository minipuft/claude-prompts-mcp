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

{# DEMO: Inline Script Reference - execute scripts directly in templates #}

## Inline Script Reference

- Full JSON output: {{script:word_count}}
- Field access: {{script:word_count.word_count}}
