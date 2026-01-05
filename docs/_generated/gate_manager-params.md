| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[create\|update\|delete\|reload\|list\|inspect] | working | yes | The operation to perform: create (new gate), update (modify existing), delete (remove), list (discover IDs), inspect (view details), reload (refresh from disk). Gates are stored as YAML files in server/gates/{id}/ directories. Each gate directory contains gate.yaml (configuration) and guidance.md (criteria content). |
| `activation` | object | working | no | Activation rules: prompt_categories (array), frameworks (array), explicit_request (boolean). |
| `confirm` | boolean | working | no | Safety confirmation for delete operation. |
| `description` | string | working | no | Gate description explaining its purpose (create/update). |
| `enabled_only` | boolean | working | no | Filter list to enabled gates only. Default: true. |
| `guidance` | string | working | no | Gate guidance content - the criteria or instructions to apply (create/update). |
| `id` | string | working | no | Gate identifier (kebab-case). Required for create, update, delete, inspect, reload. |
| `name` | string | working | no | Human-friendly gate name (create/update). |
| `pass_criteria` | array<object> | working | no | Structured pass criteria definitions (create/update). |
| `reason` | string | working | no | Audit reason for reload/delete operations. |
| `retry_config` | object | working | no | Retry configuration: max_attempts, improvement_hints, preserve_context. |
| `type` | enum[validation\|guidance] | working | no | Gate type: validation (pass/fail criteria) or guidance (advisory). Default: validation. |
