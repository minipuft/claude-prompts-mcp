| Name | Type | Status | Required | Description |
| --- | --- | --- | --- | --- |
| `action` | enum[status\|framework\|gates\|analytics\|config\|maintenance\|guide\|injection\|session] | working | yes | The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations), session (manage execution sessions). Single-call operations; sequence multiple admin steps with separate requests. |
| `framework` | string | working | no | Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks. |
| `include_history` | boolean | working | no | Include recorded history where supported. |
| `operation` | string | working | no | Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list; session list/clear/inspect). |
| `persist` | boolean | working | no | When true, gate/framework enable/disable changes are also written to config.json. Applies to gate operations (enable/disable) and framework system enable/disable. Uses SafeConfigWriter; falls back to runtime-only if unavailable. |
| `reason` | string | working | no | Audit reason for framework/gate toggles or admin actions. |
| `search_query` | string | working | no | Filter gates by keyword (matches ID, name, or description). Use with gates:list action. |
| `session_id` | string | working | no | Target session ID or chain ID for session operations. |
| `show_details` | boolean | working | no | Include detailed output (status/analytics/framework/gate reports). |
| `topic` | string | working | no | Guide topic when requesting guidance. |
