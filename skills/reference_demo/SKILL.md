---
name: Reference Syntax Demo
description: >-
  Demonstrates template reference features - {{ref:id}} for prompt inclusion and {{script:id}} for inline script
  execution
license: MIT
compatibility:
  agent-skills: 1.0.0
metadata:
  resource-type: prompt
  source-hash: dd12123f61d52ce7ad7e876a0db4e1b33e2e423f0bea52527d7594c74cbf8abf
  category: examples
allowed-tools:
  - word_count
managed-by: claude-prompts-skills-sync
managed-client: agent-plugins
managed-scope: project
managed-resource-key: prompt:examples/reference_demo
---

## Arguments

- **text** (required): The text to analyze with the word_count script tool
- **topic**: Optional topic name for the introduction (demonstrates reference feature)

## Usage

{# DEMO: Prompt Reference - includes content from another prompt #}
{{ref:shared_intro}}

---

## Text Analysis Request

Analyze the following text: "{text}"

{# DEMO: Automatic Tool Execution - tool results available as Nunjucks variables #}

## Script Tool Results (Automatic Execution)

The word_count script tool was automatically executed:

- **Word Count**: {{tool_word_count.word_count}}
- **Character Count**: {{tool_word_count.character_count}}
- **Line Count**: {{tool_word_count.line_count}}
- **Unique Words**: {{tool_word_count.unique_words}}

{# DEMO: Inline Script Reference - execute scripts directly in templates #}

## Inline Script Reference

- Full JSON output: {{script:word_count}}
- Field access: {{script:word_count.word_count}}
