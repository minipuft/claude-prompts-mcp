| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[create\|update\|delete\|reload\|list\|inspect\|analyze_type\|analyze_gates\|guide] | working | yes | The operation to perform: create (new prompt), update (modify existing), delete (remove), list (discover IDs), inspect (view details), analyze_type/analyze_gates (get recommendations), reload (refresh from disk), guide (get action suggestions). Single-shot operations; chain multiple calls when sequencing edits or reloads. Required fields per action: create (id, name, description, user_message_template, optional arguments/chain_steps), update (id + section/section_content or fields), delete (id + confirm), reload (reason optional), list/inspect/analyze/guide use filters/detail as needed. |
| `arguments` | array<{name,required?,description?,type?}> | working | no | Prompt arguments metadata (create/update). |
| `category` | string | working | no | Category tag (create/update). |
| `chain_steps` | array<step> | working | no | Chain steps definition (create/update for chains). |
| `confirm` | boolean | working | no | Safety confirmation (delete). |
| `description` | string | working | no | Prompt description (create/update). |
| `detail` | enum[summary\|full] | working | no | Inspect detail level. |
| `execution_hint` | enum[single\|chain] | working | no | Hint for execution type on creation. |
| `filter` | string | working | no | List filter query (list action). |
| `format` | enum[table\|json\|text] | working | no | Output format for list/inspect. |
| `id` | string | working | no | Prompt identifier (required for most actions). |
| `name` | string | working | no | Human-friendly name (create/update). |
| `reason` | string | working | no | Audit reason (reload/delete). |
| `section` | enum[name\|description\|system_message\|user_message_template\|arguments\|chain_steps] | working | no | Targeted update section. |
| `section_content` | string | working | no | Content for targeted section updates. |
| `system_message` | string | working | no | Optional system message (create/update). |
| `user_message_template` | string | working | no | Prompt body/template (create/update). |
