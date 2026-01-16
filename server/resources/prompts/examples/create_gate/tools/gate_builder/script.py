#!/usr/bin/env python3
"""
Gate Builder Validation Script

Validates gate definitions and prepares auto-execute payload for resource_manager.
Uses only Python stdlib for maximum portability.
"""

import json
import re
import sys
from typing import Any


def validate_id_format(value: str, field_name: str) -> list[str]:
    """Validate ID format: lowercase-hyphenated."""
    errors = []
    pattern = r"^[a-z][a-z0-9-]*$"
    if not re.match(pattern, value):
        errors.append(f"{field_name} '{value}' must be lowercase-hyphenated (e.g., 'code-quality')")
    return errors


def validate_required_fields(data: dict[str, Any]) -> list[str]:
    """Validate all required fields are present."""
    errors = []
    required = ["id", "name", "type", "description"]

    for field in required:
        if field not in data or data[field] is None:
            errors.append(f"Missing required field: {field}")
        elif field == "description" and len(str(data[field])) < 10:
            errors.append("description must be at least 10 characters")
        elif field == "type" and data[field] not in ["validation", "guidance"]:
            errors.append(f"type must be 'validation' or 'guidance', got '{data[field]}'")

    # Validate id format
    if "id" in data and data["id"]:
        errors.extend(validate_id_format(data["id"], "id"))

    return errors


def validate_guidance(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Validate guidance configuration."""
    errors = []
    warnings = []

    has_guidance = "guidance" in data and data["guidance"]
    has_guidance_file = "guidanceFile" in data and data["guidanceFile"]

    if not has_guidance and not has_guidance_file:
        warnings.append(
            "No guidance or guidanceFile specified. Gate will have no guidance content."
        )

    if has_guidance and has_guidance_file:
        warnings.append(
            "Both guidance and guidanceFile specified. Inline guidance will be used."
        )

    return errors, warnings


def validate_pass_criteria(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Validate pass_criteria configuration."""
    errors = []
    warnings = []

    criteria = data.get("pass_criteria", [])
    gate_type = data.get("type", "validation")

    if gate_type == "validation" and not criteria:
        warnings.append(
            "Validation gate has no pass_criteria defined. "
            "Consider adding content_check or pattern_check criteria."
        )

    valid_types = ["content_check", "pattern_check", "llm_self_check", "methodology_compliance"]

    for i, criterion in enumerate(criteria):
        if not isinstance(criterion, dict):
            errors.append(f"pass_criteria[{i}] must be an object")
            continue

        ctype = criterion.get("type")
        if not ctype:
            errors.append(f"pass_criteria[{i}] missing required 'type' field")
        elif ctype not in valid_types:
            errors.append(
                f"pass_criteria[{i}] has invalid type '{ctype}'. "
                f"Valid types: {valid_types}"
            )

    return errors, warnings


def validate_regex_patterns(data: dict[str, Any]) -> list[str]:
    """Validate all regex patterns in pass_criteria are valid."""
    errors = []

    for i, criterion in enumerate(data.get("pass_criteria", [])):
        if not isinstance(criterion, dict):
            continue

        patterns = criterion.get("regex_patterns", [])
        for pattern in patterns:
            try:
                re.compile(pattern)
            except re.error as e:
                errors.append(
                    f"Invalid regex pattern in pass_criteria[{i}]: '{pattern}' - {e}"
                )

    return errors


def validate_activation(data: dict[str, Any]) -> list[str]:
    """Validate activation configuration."""
    warnings = []

    activation = data.get("activation", {})
    if not activation:
        return warnings

    categories = activation.get("prompt_categories", [])
    if not categories and not activation.get("explicit_request", False):
        warnings.append(
            "No prompt_categories specified and explicit_request is false. "
            "Gate may never activate automatically."
        )

    return warnings


def build_resource_manager_params(data: dict[str, Any]) -> dict[str, Any]:
    """Transform validated data into resource_manager parameters."""
    params: dict[str, Any] = {
        "resource_type": "gate",
        "action": "create",
        "id": data["id"],
        "name": data["name"],
        "gate_type": data["type"],  # Map 'type' to 'gate_type' for resource_manager
        "description": data["description"],
    }

    # Optional fields - only include if present
    optional_fields = [
        ("guidance", "guidance"),
        ("guidanceFile", "guidanceFile"),
        ("severity", "severity"),
        ("enforcementMode", "enforcementMode"),
        ("pass_criteria", "pass_criteria"),
        ("retry_config", "retry_config"),
        ("activation", "activation"),
    ]

    for input_field, output_field in optional_fields:
        if input_field in data and data[input_field] is not None:
            params[output_field] = data[input_field]

    return params


def build_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Build summary of gate contents."""
    return {
        "pass_criteria_count": len(data.get("pass_criteria", [])),
        "severity": data.get("severity", "medium"),
        "has_guidance": bool(data.get("guidance") or data.get("guidanceFile")),
        "has_activation": bool(data.get("activation")),
        "has_retry_config": bool(data.get("retry_config")),
    }


def validate_gate(data: dict[str, Any]) -> dict[str, Any]:
    """Main validation function."""
    errors: list[str] = []
    warnings: list[str] = []

    # Required fields validation
    errors.extend(validate_required_fields(data))

    # If required fields are missing, return early
    if errors:
        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
        }

    # Guidance validation
    guidance_errors, guidance_warnings = validate_guidance(data)
    errors.extend(guidance_errors)
    warnings.extend(guidance_warnings)

    # Pass criteria validation
    criteria_errors, criteria_warnings = validate_pass_criteria(data)
    errors.extend(criteria_errors)
    warnings.extend(criteria_warnings)

    # Regex pattern validation
    errors.extend(validate_regex_patterns(data))

    # Activation validation
    warnings.extend(validate_activation(data))

    if errors:
        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
        }

    # Build auto-execute payload
    params = build_resource_manager_params(data)
    summary = build_summary(data)

    return {
        "valid": True,
        "auto_execute": {
            "tool": "resource_manager",
            "params": params,
        },
        "warnings": warnings,
        "summary": summary,
    }


def main() -> None:
    """Read input from stdin, validate, and output result."""
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        result = {
            "valid": False,
            "errors": [f"Invalid JSON input: {e}"],
            "warnings": [],
        }
        print(json.dumps(result, indent=2))
        sys.exit(1)

    result = validate_gate(input_data)
    print(json.dumps(result, indent=2))

    # Exit with non-zero status if validation failed
    if not result["valid"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
