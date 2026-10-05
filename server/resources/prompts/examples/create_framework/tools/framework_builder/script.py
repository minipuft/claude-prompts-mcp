#!/usr/bin/env python3
"""Map framework authoring inputs without duplicating server-owned resource validation."""

import json
import sys
from typing import Any

CREATE_FIELDS = (
    "id",
    "name",
    "description",
    "system_prompt_guidance",
    "phases",
    "gates",
    "tool_descriptions",
    "enabled",
    "framework_gates",
    "template_suggestions",
    "framework_elements",
    "argument_suggestions",
    "judge_prompt",
    "processing_steps",
    "execution_steps",
    "execution_type_enhancements",
    "template_enhancements",
    "execution_flow",
    "quality_indicators",
)
FIELD_MAP = {}


def build_call(data: dict[str, Any]) -> dict[str, Any]:
    """Preserve supplied canonical fields, including false, zero and nested values."""
    params: dict[str, Any] = {"resource_type": "framework", "action": "create"}
    for key in CREATE_FIELDS:
        if key in data:
            params[key] = data[key]
    for source, target in FIELD_MAP.items():
        if source in data and target not in data:
            params[target] = data[source]
    return params


def main() -> None:
    data = json.load(sys.stdin)
    if not isinstance(data, dict):
        print(json.dumps({"valid": False, "errors": ["Adapter input must be an object"]}))
        return
    params = build_call(data)
    print(
        json.dumps(
            {
                "valid": True,
                "validation_scope": "adapter readiness only; resource_manager owns resource validation",
                "draft": {"tool": "resource_manager", "params": params},
            }
        )
    )


if __name__ == "__main__":
    main()
