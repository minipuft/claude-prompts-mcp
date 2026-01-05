| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[create\|update\|delete\|reload\|list\|inspect\|switch] | working | yes | The operation to perform: create (new methodology), update (modify existing), delete (remove), list (discover available), inspect (view details), reload (refresh from disk), switch (change active framework). Methodologies are stored in server/methodologies/{id}/ directories. Each methodology directory contains methodology.yaml, phases.yaml, and system-prompt.md. The switch action changes the active framework for all subsequent prompt executions. |
| `confirm` | boolean | working | no | Safety confirmation for delete operation. |
| `description` | string | working | no | Methodology description explaining its purpose and approach (create/update). |
| `enabled` | boolean | working | no | Whether the methodology is enabled. Default: true. |
| `enabled_only` | boolean | working | no | Filter list to enabled methodologies only. Default: true. |
| `gates` | object | working | no | Gate configuration: include (array of gate IDs), exclude (array of gate IDs). |
| `id` | string | working | no | Framework/methodology identifier (lowercase). Required for most actions except list. |
| `methodology` | string | working | no | Optional methodology type identifier. If not provided, auto-derived from id (e.g., 'test-diag' → 'TEST_DIAG'). Typically uppercase. Auto-derived from id when not specified: id.toUpperCase().replace(/-/g, '_') Custom types create standalone methodologies without referencing built-in frameworks Built-in types: CAGEERF, ReACT, 5W1H, SCAMPER |
| `name` | string | working | no | Human-friendly methodology name (create/update). |
| `phases` | array<object> | working | no | Phase definitions for the methodology (create/update). Each phase has id, name, description, prompts. |
| `reason` | string | working | no | Audit reason for switch/reload/delete operations. |
| `system_prompt_guidance` | string | working | no | System prompt guidance injected when this framework is active (create/update). |
| `tool_descriptions` | object | working | no | Tool description overlays when this framework is active. |
