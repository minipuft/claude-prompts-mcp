# Prompt Authoring

{% if tool_prompt_builder %}

## Canonical Validation

`valid` means the adapter prepared a call, not that the resource is valid. Supplied canonical fields and nested definitions are forwarded unchanged; legacy camelCase aliases remain accepted, with canonical values taking precedence.

```json
{{ tool_prompt_builder.auto_execute.params | dump(2) }}
```

{% if tool_prompt_builder_result %}
{{ tool_prompt_builder_result.text }}
{% else %}
Run the prepared `resource_manager` validation call. Validation writes no files or versions.
{% endif %}

Read the canonical validation result, fix errors, and show the complete draft. Create only when authorized; if this task already authorizes creation, do not ask again. Use the same payload with `action:"create"` only after validation succeeds. Verify the write receipt and smoke-render the loaded prompt.
{% else %}
Design a prompt for:

- **Name:** {{ name }}
- **Purpose:** {{ purpose }}
- **Mode:** {{ prompt_type | default("template") }}

1. Inspect related registered prompts with `resource_manager(resource_type:"prompt", action:"inspect", id:<reference>, detail:"full")`. Reuse their conventions and existing child prompts where appropriate.
2. Draft one complete canonical `resource_manager(resource_type:"prompt", action:"validate", ...)` payload. At least one content form is needed: `user_message_template`, `system_message`, or non-empty `chain_steps`. System and user instructions may coexist, and a chain may have an entry template.
3. Declare typed `arguments` including required/default/validation settings where needed. A script prompt supplies complete inline `tools` definitions (id, name, executable script content, runtime, trigger, schema); author-controlled file paths and bare tool IDs are not definitions.
4. Configure only capabilities the purpose needs: `gate_configuration`, `composer`, `injection`, `register_with_mcp` and `mcp_prompt_mode`, `subagent_model` and `agent_type`, or `artifacts`. Inspect current resources and consult the current MCP contract for nested shapes; do not invent parameters or duplicate domain validators.
5. Validate without mutation, resolve errors, and present the complete draft. Create when authorized using the same payload with `action:"create"`. Existing task authorization is sufficient; otherwise obtain approval of the concrete draft.
6. Inspect the write receipt: actual resource root, affected files, refresh/loaded state, current version, and category ship status. Reload if needed and smoke-render before reporting completion.

## Reusable workflows

Chain/workflow design produces a prompt with `chain_steps`, optional `edges`, and `budget`; workflow is an authoring mode, not a resource type. Choose stable node `id`s and `stepName`s. Preserve needed node settings such as args, input/output mappings, retries, framework, inline gates, model/agent, delegated/await, and visibility. Dependency edges compile into an ordered chain; they do not provide conditional branches.

Use existing external `promptId` references only after checking they exist. For new owned children, reference `<chain_id>/<child>` with one child path segment. Creating the parent scaffolds child stubs. Inspect each child by its loaded ID, fill its content, arguments, tools and gates through MCP, then validate the complete assembled workflow with reload/render checks before claiming it is finished. A scaffold is a starting point, not completed authored work.

A persistent chain definition is distinct from `prompt_engine(workflow:{version:1,nodes:...,edges:...,budget:...})`, which submits a workflow run. Detached/delegated workers are spawned by the client using its own agent capabilities; the server sequences and validates their handoffs.

Output the proposed validation payload and the decisions still needed.
{% endif %}

## Existing prompt maintenance

Use `inspect(detail:"full") → preview(preview_action:"update", expected_version:<current>) → update(expected_version:<current>) → receipt → reload/render`. Review the concrete preview and honor existing authorization. Do not recreate an existing ID. Public publication needs its own authorization.

## Semantic gate contract

Author `semantic_evaluation` through the canonical gate create/update contract, then inspect the loaded gate. Criteria declare `id`, `target`, `question`, `evidence_requirements`, `result`, `acceptance`, and `allow_not_applicable` (default false). The server validates nested shapes; builder readiness is not resource validity. A `step_output` target uses actual server-captured output. An artifact target is a valid opaque declaration, but runtime artifact capture is unavailable; do not resolve its id as a filesystem path. Unknown targets and incompatible domains are refused.

Semantic report acceptance requires a structured report with evidence bound to the server-issued frozen review and captured target. Client report bytes and claimed pins are not authority. Bare PASS, stop attestation, and passing tool siblings do not replace the report. Keep requested `evaluation` configuration separate from reported reviewer identity; report acceptance does not establish model accuracy or human approval. `calibration_suite_id` is an opaque public association, not a suite path or private-case lookup. Preserve legacy tool criteria and operator shell command/directory/environment guards.
