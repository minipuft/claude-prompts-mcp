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
)
FIELD_MAP = {"enforcementMode": "enforcement_mode"}


def build_call(data: dict[str, Any]) -> dict[str, Any]:
    """Preserve supplied canonical fields, including false, zero and nested values."""
    params: dict[str, Any] = {"resource_type": "gate", "action": "create"}
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
