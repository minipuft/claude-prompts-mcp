#!/usr/bin/env python3
"""Map gate authoring inputs without duplicating server-owned resource validation."""

import json
import sys
from typing import Any

CREATE_FIELDS = (
    "id",
    "name",
    "type",
    "gate_type",
    "description",
    "guidance",
    "pass_criteria",
    "activation",
    "retry_config",
    "subject",
    "severity",
    "enforcement_mode",
    "block_response_on_fail",
    "evaluation",
    "calibration_suite_id",
)
REFUSED_NAMES = {"enforcementMode": "enforcement_mode"}


def refusals(data: dict[str, Any]) -> list[str]:
    """One line per camelCase name received: the name is refused and the snake_case one is shown."""
    return [
        f"'{name}' is not an argument of create_gate; send '{canonical}'."
        for name, canonical in REFUSED_NAMES.items()
        if name in data
    ]


def build_call(data: dict[str, Any]) -> dict[str, Any]:
    """Preserve supplied canonical fields, including false, zero and nested values."""
    params: dict[str, Any] = {"resource_type": "gate", "action": "create"}
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
                "draft": {"tool": "resource_manager", "params": params},
            }
        )
    )


if __name__ == "__main__":
    main()
