# Gate Authoring

{% if tool_gate_builder %}

## Prepared draft

`valid` means adapter readiness only. This output has not created or canonically validated a gate; it is a non-executing draft.

```json
{{ tool_gate_builder.draft.params | dump(2) }}
```

Review the draft, then call `resource_manager` with it when creation is authorized. Existing task authorization is sufficient; otherwise obtain approval of this concrete draft. The server owns validation at creation; show refusals and revise the draft. Never report success without a successful write receipt and loaded-gate inspection.
{% else %}
Design a gate for:

- **Name:** {{ name }}
- **Purpose:** {{ purpose }}
- **Resource taxonomy:** {{ gate_type | default("custom") }}
- **Behavior:** {{ type | default("validation") }}

1. Inspect a related registered gate using `resource_manager(resource_type:"gate", action:"inspect", id:<reference>)` and use the current contract for supported shapes.
2. Prepare a canonical create payload with id, name, description, guidance, `type` (validation or guidance), and `gate_type` (framework, category, or custom). These two fields describe different concerns.
3. Choose supported `pass_criteria`: `inline_guidance` describes criteria for the client; `framework_compliance` targets framework compliance. `shell_verify` runs its `shell_command` and judges exit status, under the operator's command/directory allowlists. `script_tool` runs a registered script with `script_tool_id` and optional input/timeout/working directory. A declarative criterion does not itself run tests or inspect files.
4. Configure applicable activation, subject, severity, `enforcement_mode`, `block_response_on_fail`, `retry_config`, and evaluation settings. Choose self review or a configured judge through `evaluation`; do not invent criterion fields such as keyword/file-presence checks. Legacy `enforcementMode` is accepted by the adapter and emitted as `enforcement_mode`.
5. Present the complete non-executing create draft and resolve outstanding choices. Gate creation has no `validate` action and no `preview_action:"create"`; do not invent a preview or claim local schema checks prove resource validity.
6. Create when authorized and read the server result. Inspect the resulting gate and verify the receipt, then smoke-test attachment with `prompt_engine(command:">>your_prompt", gates:[<gate_id>])` when that execution is in scope.

For example, a declarative gate may use `pass_criteria:[{"type":"inline_guidance"}]` with concrete pass/fail instructions in guidance. A shell criterion may use `{"type":"shell_verify","shell_command":"npm test","shell_preset":"fast"}`, provided the operator has allowlisted that command and any non-default working directory. Shell environment keys controlling command resolution are refused by the server; ordinary input variables may be supplied when needed.

Output the proposed create payload and unresolved decisions.
{% endif %}

## Existing gate maintenance

Inspect before `update`, review the proposed changes, honor existing authorization, then read the update receipt and inspect/reload the loaded gate. Gate update has no non-mutating update preview. Supported `preview` operations for gates are delete and rollback; they do not authorize the subsequent mutation. Public publication needs its own authorization.
