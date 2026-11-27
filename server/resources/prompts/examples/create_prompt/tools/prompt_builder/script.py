#!/usr/bin/env python3
"""Map prompt authoring inputs without duplicating server-owned resource validation."""

import json
import sys
from typing import Any

CREATE_FIELDS = (
    "id",
    "name",
    "description",
    "category",
    "user_message_template",
    "system_message",
    "arguments",
    "chain_steps",
    "tools",
    "gate_configuration",
    "composer",
    "injection",
    "register_with_mcp",
    "mcp_prompt_mode",
    "subagent_model",
    "agent_type",
    "edges",
    "budget",
    "artifacts",
)
REFUSED_NAMES = {
    "systemMessage": "system_message",
    "userMessageTemplate": "user_message_template",
    "gateConfiguration": "gate_configuration",
    "chainSteps": "chain_steps",
    "registerWithMcp": "register_with_mcp",
}


def refusals(data: dict[str, Any]) -> list[str]:
    """One line per camelCase name received: the name is refused and the snake_case one is shown."""
    return [
        f"'{name}' is not an argument of create_prompt; send '{canonical}'."
        for name, canonical in REFUSED_NAMES.items()
        if name in data
    ]


def build_call(data: dict[str, Any]) -> dict[str, Any]:
    """Preserve supplied canonical fields, including false, zero and nested values."""
    params: dict[str, Any] = {"resource_type": "prompt", "action": "validate"}
    for key in CREATE_FIELDS:
        if key in data:
            params[key] = data[key]
    return params


def main() -> None:
    data = json.load(sys.stdin)
    if not isinstance(data, dict):
        print(json.dumps({"valid": False, "errors": ["Adapter input must be an object"]}))
        return
    errors = refusals(data)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}))
        return
    params = build_call(data)
    print(
        json.dumps(
            {
                "valid": True,
                "validation_scope": "adapter readiness only; resource_manager owns resource validation",
                "auto_execute": {"tool": "resource_manager", "params": params},
            }
        )
    )


if __name__ == "__main__":
    main()
