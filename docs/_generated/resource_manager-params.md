| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[create\|update\|delete\|reload\|list\|inspect\|analyze_type\|analyze_gates\|guide\|switch\|history\|rollback\|compare] | working | yes | Operation to perform. Type-specific: analyze_type/guide (prompt), switch (methodology). Versioning: history/rollback/compare (all types). |
| `activation` | object | working | no | [Gate] Activation rules: prompt_categories, frameworks, explicit_request. |
| `arguments` | array<{name,required?,description?,type?}> | working | no | [Prompt] Argument definitions for the prompt. |
| `category` | string | working | no | [Prompt] Category tag for the prompt. |
| `chain_steps` | array<step> | working | no | [Prompt] Chain steps definition for multi-step prompts. |
| `confirm` | boolean | working | no | Safety confirmation for delete operation. |
| `description` | string | working | no | Resource description explaining its purpose (create/update). |
| `detail` | enum[summary\|full] | working | no | [Prompt] Inspect detail level. |
| `enabled` | boolean | working | no | [Methodology] Whether the methodology is enabled. |
| `enabled_only` | boolean | working | no | Filter list to enabled resources only. Default: true. |
| `execution_hint` | enum[single\|chain] | working | no | [Prompt] Hint for execution type on creation. |
| `filter` | string | working | no | [Prompt] List filter query. |
| `format` | enum[table\|json\|text] | working | no | [Prompt] Output format for list/inspect. |
| `from_version` | number | working | no | [Versioning] Starting version number for compare action. |
| `gate_configuration` | object | working | no | [Prompt] Gate configuration: include (array), exclude (array), framework_gates (boolean). |
| `gate_type` | enum[validation\|guidance] | working | no | [Gate] Gate type: validation (pass/fail) or guidance (advisory). Default: validation. |
| `gates` | object | working | no | [Methodology] Gate configuration: include, exclude arrays. |
| `guidance` | string | working | no | [Gate] Gate guidance content - the criteria or instructions. |
| `id` | string | working | no | Resource identifier. Required for create, update, delete, inspect, reload, switch. |
| `limit` | number | working | no | [Versioning] Max versions to return in history. Default: 10. |
| `methodology` | string | working | no | [Methodology] Methodology type identifier. Use action:'list' to see registered methodologies. |
| `name` | string | working | no | Human-friendly name for the resource (create/update). |
| `pass_criteria` | array<string> | working | no | [Gate] Structured pass criteria definitions. |
| `persist` | boolean | working | no | [Methodology] For switch: persist the change to config. Default: false. |
| `phases` | array<object> | working | no | [Methodology] Phase definitions and advanced fields. Core: id, name, description. Advanced fields (methodology_gates, processing_steps, execution_steps, etc.) are also accepted. |
| `reason` | string | working | no | Audit reason for reload/delete/switch operations. |
| `resource_type` | enum[prompt\|gate\|methodology] | working | yes | Type of resource to manage. Routes to appropriate handler. |
| `retry_config` | object | working | no | [Gate] Retry configuration: max_attempts, improvement_hints. |
| `search_query` | string | working | no | [Prompt] Search query for filtering (list action). |
| `section` | enum[name\|description\|system_message\|user_message_template\|arguments\|chain_steps] | working | no | [Prompt] Targeted update section. |
| `section_content` | string | working | no | [Prompt] Content for targeted section updates. |
| `skip_version` | boolean | working | no | [Versioning] Skip auto-versioning on update. Default: false. |
| `system_message` | string | working | no | [Prompt] Optional system message for the prompt. |
| `system_prompt_guidance` | string | working | no | [Methodology] System prompt guidance injected when active. |
| `to_version` | number | working | no | [Versioning] Ending version number for compare action. |
| `tool_descriptions` | object | working | no | [Methodology] Tool description overlays when active. |
| `tools` | array<{id,name,script,description?,runtime?,schema?,trigger?,confirm?,strict?,timeout?}> | working | no | [Prompt] Script tools to create with the prompt. Each tool creates files in tools/{id}/ subdirectory. Required: id, name, script. Optional: description, runtime (python\|node\|shell\|auto), schema (JSON Schema object), trigger (schema_match\|explicit\|always\|never), confirm, strict, timeout. |
| `user_message_template` | string | working | no | [Prompt] Prompt body/template with Nunjucks placeholders. |
| `version` | number | working | no | [Versioning] Target version number for rollback action. |
