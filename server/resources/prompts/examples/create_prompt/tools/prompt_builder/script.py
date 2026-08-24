#!/usr/bin/env python3
"""Map prompt-authoring inputs to the canonical resource_manager validation action."""

import json
import sys
from typing import Any

FIELD_MAP = {
    "systemMessage": "system_message",
    "userMessageTemplate": "user_message_template",
    "gateConfiguration": "gate_configuration",
    "chainSteps": "chain_steps",
    "registerWithMcp": "register_with_mcp",
}

PASSTHROUGH = {
    "id", "name", "category", "description", "arguments", "tools",
}


def build_validation_call(data: dict[str, Any]) -> dict[str, Any]:
    params: dict[str, Any] = {"resource_type": "prompt", "action": "validate"}
    for key in PASSTHROUGH:
        if key in data:
            params[key] = data[key]
    for source, target in FIELD_MAP.items():
        if source in data:
            params[target] = data[source]
    return params


def main() -> None:
    data = json.load(sys.stdin)
    params = build_validation_call(data)
    print(json.dumps({
        "valid": True,
        "auto_execute": {"tool": "resource_manager", "params": params},
        "summary": {
            "content_forms": [
                key for key in ("userMessageTemplate", "systemMessage", "chainSteps")
                if data.get(key)
            ],
            "argument_count": len(data.get("arguments", [])),
            "tool_count": len(data.get("tools", [])),
        },
    }))


if __name__ == "__main__":
    main()
