# Prompt Authoring

{% if tool_prompt_builder %}

## Canonical Validation

The local adapter only maps author-facing camelCase fields to the canonical resource-manager contract. Structural validation belongs to `resource_manager`.

{% if tool_prompt_builder_result %}
{{ tool_prompt_builder_result.text }}

The draft has only been previewed. Nothing should be created until the user confirms the validated draft. After confirmation, call `resource_manager` with the same payload and change `action` from `validate` to `create`.
{% else %}
The adapter prepared this non-mutating validation call:

```json
{{ tool_prompt_builder.auto_execute.params | dump(2) }}
```

{% endif %}

{% else %}
Design a prompt for:

- **Name:** {{ name }}
- **Purpose:** {{ purpose }}
- **Type:** {{ prompt_type | default("template") }}

Use this bounded workflow:

1. Inspect related prompts and reuse established vocabulary.
2. Draft one canonical payload for `resource_manager(resource_type:"prompt", action:"validate", ...)`.
3. Use exactly one content form: `user_message_template`, non-empty `chain_steps`, or `system_message`. A chain may also have an entry template when justified.
4. Define arguments as typed objects. If the prompt owns a script tool, include the complete tool definition (`id`, `name`, executable `script`, runtime/trigger settings, and JSON Schema); do not provide tool IDs or author-controlled file paths.
5. Run `validate`. Present errors/warnings and the normalized draft. Do not write if validation fails.
6. Ask for confirmation of the validated draft. Only then run the same payload with `action:"create"`.
7. Return the write receipt: resource root, affected files, category ship status, refresh status, loaded state, and current version. Smoke-render the prompt after creation.

For an existing prompt, do not recreate it. Use:

`inspect(detail:"full") → update(dry_run:true, expected_version:<current>) → approval → update(expected_version:<current>) → reload → render smoke test → receipt`

Do not publish, announce, or otherwise make authored material public without explicit confirmation.

Output the proposed validation payload as JSON, followed by only the unresolved design decisions.
{% endif %}
