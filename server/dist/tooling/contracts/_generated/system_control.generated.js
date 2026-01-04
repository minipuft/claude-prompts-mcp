export const system_controlParameters = [
    {
        "name": "action",
        "type": "enum[status|framework|gates|analytics|config|maintenance|guide|injection]",
        "description": "The operation to perform: status (runtime overview), framework (switch/enable/disable methodologies), gates (manage quality gates), analytics (usage metrics), config (view/modify settings), maintenance (restart), guide (get recommendations).",
        "required": true,
        "status": "working",
        "compatibility": "canonical",
        "examples": [
            "system_control({\"action\":\"status\",\"show_details\":true})",
            "system_control({\"action\":\"framework\",\"operation\":\"switch\",\"framework\":\"CAGEERF\",\"reason\":\"enable methodology\"})",
            "system_control({\"action\":\"gates\",\"operation\":\"disable\",\"reason\":\"maintenance\",\"persist\":true})"
        ],
        "notes": [
            "Single-call operations; sequence multiple admin steps with separate requests."
        ]
    },
    {
        "name": "operation",
        "type": "string",
        "description": "Sub-command for the selected action (e.g., framework switch/list/enable/disable; gates enable/disable/status/health/list).",
        "status": "working",
        "compatibility": "canonical"
    },
    {
        "name": "framework",
        "type": "string",
        "description": "Target framework for switch operations. Use system_control(action:'framework', operation:'list') to see available frameworks.",
        "status": "working",
        "compatibility": "canonical"
    },
    {
        "name": "reason",
        "type": "string",
        "description": "Audit reason for framework/gate toggles or admin actions.",
        "status": "working",
        "compatibility": "canonical"
    },
    {
        "name": "persist",
        "type": "boolean",
        "description": "When true, gate/framework enable/disable changes are also written to config.json.",
        "status": "working",
        "compatibility": "canonical",
        "notes": [
            "Applies to gate operations (enable/disable) and framework system enable/disable.",
            "Uses SafeConfigWriter; falls back to runtime-only if unavailable."
        ]
    },
    {
        "name": "show_details",
        "type": "boolean",
        "description": "Include detailed output (status/analytics/framework/gate reports).",
        "status": "working",
        "compatibility": "canonical"
    },
    {
        "name": "include_history",
        "type": "boolean",
        "description": "Include recorded history where supported.",
        "status": "working",
        "compatibility": "canonical"
    },
    {
        "name": "topic",
        "type": "string",
        "description": "Guide topic when requesting guidance.",
        "status": "working",
        "compatibility": "canonical"
    },
    {
        "name": "search_query",
        "type": "string",
        "description": "Filter gates by keyword (matches ID, name, or description). Use with gates:list action.",
        "status": "working",
        "compatibility": "canonical"
    }
];
export const system_controlCommands = [
    {
        "id": "status",
        "summary": "Runtime status overview (framework, gates, health).",
        "parameters": [
            "action",
            "show_details"
        ],
        "status": "working"
    },
    {
        "id": "framework:switch",
        "summary": "Switch active framework with audit reason.",
        "parameters": [
            "action",
            "framework",
            "reason"
        ],
        "status": "working"
    },
    {
        "id": "framework:enable",
        "summary": "Enable framework system (with optional persistence to config).",
        "parameters": [
            "action",
            "operation",
            "reason",
            "persist"
        ],
        "status": "working"
    },
    {
        "id": "framework:disable",
        "summary": "Disable framework system (with optional persistence to config).",
        "parameters": [
            "action",
            "operation",
            "reason",
            "persist"
        ],
        "status": "working"
    },
    {
        "id": "framework:list",
        "summary": "List available frameworks.",
        "parameters": [
            "action",
            "operation",
            "show_details"
        ],
        "status": "working"
    },
    {
        "id": "framework:list_methodologies",
        "summary": "List methodology guides.",
        "parameters": [
            "action",
            "operation",
            "show_details"
        ],
        "status": "working"
    },
    {
        "id": "gates:enable",
        "summary": "Enable gate system (with optional persistence to config).",
        "parameters": [
            "action",
            "operation",
            "reason",
            "persist"
        ],
        "status": "working"
    },
    {
        "id": "gates:disable",
        "summary": "Disable gate system (with optional persistence to config).",
        "parameters": [
            "action",
            "operation",
            "reason",
            "persist"
        ],
        "status": "working"
    },
    {
        "id": "gates:status",
        "summary": "Gate system status overview.",
        "parameters": [
            "action",
            "operation"
        ],
        "status": "working"
    },
    {
        "id": "gates:health",
        "summary": "Gate system health details.",
        "parameters": [
            "action",
            "operation"
        ],
        "status": "working"
    },
    {
        "id": "gates:list",
        "summary": "List available canonical gates with optional search filtering. Shortcut: >>gates [search]",
        "parameters": [
            "action",
            "operation",
            "search_query"
        ],
        "status": "working"
    },
    {
        "id": "analytics",
        "summary": "Retrieve analytics summary with optional detail/history.",
        "parameters": [
            "action",
            "show_details",
            "include_history"
        ],
        "status": "working"
    },
    {
        "id": "config",
        "summary": "Configuration operations (list/get/set/restore/validate).",
        "parameters": [
            "action",
            "operation",
            "reason"
        ],
        "status": "working"
    },
    {
        "id": "maintenance",
        "summary": "Maintenance operations (restart).",
        "parameters": [
            "action",
            "operation",
            "reason"
        ],
        "status": "working"
    },
    {
        "id": "guide",
        "summary": "Guidance on available system operations.",
        "parameters": [
            "action",
            "topic"
        ],
        "status": "working"
    }
];
export const system_controlMetadata = { tool: 'system_control', version: 1 };
//# sourceMappingURL=system_control.generated.js.map