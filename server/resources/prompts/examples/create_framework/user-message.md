# Framework Authoring

{% if tool_framework_builder %}

## Prepared draft

`valid` means adapter readiness only. This non-executing draft has not created or canonically validated a framework. The adapter does not score completeness or replace server validation.

```json
{{ tool_framework_builder.draft.params | dump(2) }}
```

Review the draft and call `resource_manager` with it when creation is authorized. Existing task authorization is sufficient; otherwise obtain approval of this concrete draft. Resolve server refusals rather than reporting the draft as a successful resource. Inspect the loaded framework and its write receipt before claiming completion.
{% else %}
Design a framework for:

- **Name:** {{ name }}
- **Concept:** {{ concept }}
- **Desired phase count:** {{ phase_count | default("derive from the concept") }}

1. List and inspect related registered frameworks through `resource_manager`. Use the current resources and MCP contract as references; do not copy a fixed phase count, phase naming format, scoring ladder or validation schema into this workflow.
2. Draft a canonical create payload with authored id, name, description, `system_prompt_guidance`, phases, and the framework gates required by the current server contract. The server derives framework type and version; do not supply those fields or use the routing selector `framework` as authored identity.
3. Choose phases and gate criteria that follow the concept and tell the client what to do and what to emit. Derive references between phase IDs, processing steps and execution steps from the draft. The server owns structural validation; the adapter forwards nested definitions unchanged.
4. Include applicable capabilities: `gates`, `enabled`, `tool_descriptions`, `framework_gates`, `framework_elements`, `argument_suggestions`, `template_suggestions`, `template_enhancements`, `processing_steps`, `execution_steps`, `execution_type_enhancements`, `execution_flow`, `quality_indicators`, and `judge_prompt`. Add only fields serving the framework's purpose; a universal five-tier/100-percent checklist is not the contract.
5. Present the complete non-executing create draft and unresolved choices. Framework creation has no `validate` action and no `preview_action:"create"`. Creation performs canonical validation; show server refusals and revise the draft.
6. Create when authorized, verify the write receipt and inspect/reload the framework. Smoke-render a prompt with the explicit framework syntax `^<framework_id> >>your_prompt` when in scope. Do not change the global active framework just to test this draft; switch only when that action is authorized.

Output the proposed create payload and unresolved decisions.
{% endif %}

## Existing framework maintenance

Inspect before `update`, review the proposed changes, honor existing authorization, then read the update receipt and inspect/reload the loaded framework. Framework update has no non-mutating update preview. Supported `preview` operations for frameworks are delete and rollback; they do not authorize the subsequent mutation. Public publication needs its own authorization.

## Semantic gate contract

Author `semantic_evaluation` through the canonical gate create/update contract, then inspect the loaded gate. Criteria declare `id`, `target`, `question`, `evidence_requirements`, `result`, `acceptance`, and `allow_not_applicable` (default false). The server validates nested shapes; builder readiness is not resource validity. A `step_output` target uses actual server-captured output. An artifact target is a valid opaque declaration, but runtime artifact capture is unavailable; do not resolve its id as a filesystem path. Unknown targets and incompatible domains are refused.

Semantic report acceptance requires a structured report with evidence bound to the server-issued frozen review and captured target. Client report bytes and claimed pins are not authority. Bare PASS, stop attestation, and passing tool siblings do not replace the report. Keep requested `evaluation` configuration separate from reported reviewer identity; report acceptance does not establish model accuracy or human approval. `calibration_suite_id` is an opaque public association, not a suite path or private-case lookup. Preserve legacy tool criteria and operator shell command/directory/environment guards.
