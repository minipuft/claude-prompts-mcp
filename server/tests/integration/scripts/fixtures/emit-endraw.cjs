#!/usr/bin/env node
// Fixture: emits an `endraw` closer followed by template syntax. A naive
// {% raw %} wrapper is closed early by this payload, so it is the case that
// distinguishes a real neutralizer from one that only handles plain output.
process.stdout.write(
  JSON.stringify({ summary: 'A{% endraw %}{{ api_key }}B{%- endraw -%}{{ api_key }}' })
);
