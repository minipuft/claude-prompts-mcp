#!/usr/bin/env python3
"""
Prompt Builder Validation Script

Validates prompt definitions and prepares auto-execute payload for resource_manager.
Uses only Python stdlib for maximum portability.
"""

import json
import re
import sys
from typing import Any


def validate_id_format(value: str, field_name: str) -> list[str]:
    """Validate ID format: lowercase with underscores."""
    errors = []
    pattern = r"^[a-z][a-z0-9_]*$"
    if not re.match(pattern, value):
        errors.append(
            f"{field_name} '{value}' must be lowercase with underscores (e.g., 'code_review')"
        )
    return errors


def validate_required_fields(data: dict[str, Any]) -> list[str]:
    """Validate all required fields are present."""
    errors = []
    required = ["id", "name", "category", "description"]

    for field in required:
        if field not in data or data[field] is None:
            errors.append(f"Missing required field: {field}")
        elif field == "description" and len(str(data[field])) < 10:
            errors.append("description must be at least 10 characters")

    # Validate id format
    if "id" in data and data["id"]:
        errors.extend(validate_id_format(data["id"], "id"))

    return errors


def validate_content_source(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Validate that prompt has content source (template or chain steps)."""
    errors = []
    warnings = []

    has_user_template = data.get("userMessageTemplate") or data.get("userMessageTemplateFile")
    has_chain_steps = data.get("chainSteps") and len(data.get("chainSteps", [])) > 0

    if not has_user_template and not has_chain_steps:
        errors.append(
            "Prompt must have either userMessageTemplate/userMessageTemplateFile or chainSteps"
        )

    if has_user_template and has_chain_steps:
        warnings.append(
            "Both userMessageTemplate and chainSteps provided. "
            "For chain prompts, the template is typically for the entry point only."
        )

    return errors, warnings


def validate_arguments(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Validate argument definitions."""
    errors = []
    warnings = []

    arguments = data.get("arguments", [])
    arg_names = set()

    valid_types = ["string", "number", "boolean", "array", "object"]

    for i, arg in enumerate(arguments):
        if not isinstance(arg, dict):
            errors.append(f"arguments[{i}] must be an object")
            continue

        # Required fields
        if not arg.get("name"):
            errors.append(f"arguments[{i}] missing required 'name' field")
        else:
            name = arg["name"]
            if name in arg_names:
                errors.append(f"Duplicate argument name: '{name}'")
            arg_names.add(name)

            # Validate name format
            if not re.match(r"^[a-z][a-z0-9_]*$", name):
                errors.append(
                    f"Argument name '{name}' must be lowercase with underscores"
                )

        if not arg.get("type"):
            errors.append(f"arguments[{i}] missing required 'type' field")
        elif arg["type"] not in valid_types:
            errors.append(
                f"arguments[{i}] has invalid type '{arg['type']}'. "
                f"Valid types: {valid_types}"
            )

        if not arg.get("description"):
            errors.append(f"arguments[{i}] missing required 'description' field")

    # Check if template references match arguments
    template = data.get("userMessageTemplate", "")
    if template:
        referenced = set(re.findall(r"\{\{(\w+)\}\}", template))
        for ref in referenced:
            if ref not in arg_names and ref not in ("previous", "step", "chain"):
                warnings.append(
                    f"Template references '{{{{ref}}}}' but no argument named '{ref}' is defined"
                )

    return errors, warnings


def validate_chain_steps(data: dict[str, Any]) -> list[str]:
    """Validate chain step definitions."""
    errors = []

    steps = data.get("chainSteps", [])
    if not steps:
        return errors

    step_ids = set()

    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            errors.append(f"chainSteps[{i}] must be an object")
            continue

        if not step.get("promptId"):
            errors.append(f"chainSteps[{i}] missing required 'promptId' field")
        else:
            prompt_id = step["promptId"]
            if prompt_id in step_ids:
                # Not necessarily an error, but note it
                pass
            step_ids.add(prompt_id)

        if not step.get("stepName"):
            errors.append(f"chainSteps[{i}] missing required 'stepName' field")

        # Validate retries if present
        retries = step.get("retries")
        if retries is not None:
            if not isinstance(retries, int) or retries < 0 or retries > 5:
                errors.append(
                    f"chainSteps[{i}] retries must be an integer between 0 and 5"
                )

    return errors


def validate_gate_configuration(data: dict[str, Any]) -> list[str]:
    """Validate gate configuration."""
    warnings = []

    gate_config = data.get("gateConfiguration", {})
    if not gate_config:
        return warnings

    include = gate_config.get("include", [])
    exclude = gate_config.get("exclude", [])

    # Check for overlap
    overlap = set(include) & set(exclude)
    if overlap:
        warnings.append(
            f"Gates {overlap} are in both include and exclude lists"
        )

    # Validate inline gate definitions
    inline_gates = gate_config.get("inline_gate_definitions", [])
    for i, gate in enumerate(inline_gates):
        if not gate.get("name"):
            warnings.append(f"inline_gate_definitions[{i}] missing 'name'")
        if not gate.get("description"):
            warnings.append(f"inline_gate_definitions[{i}] missing 'description'")

    return warnings


def build_resource_manager_params(data: dict[str, Any]) -> dict[str, Any]:
    """Transform validated data into resource_manager parameters."""
    params: dict[str, Any] = {
        "resource_type": "prompt",
        "action": "create",
        "id": data["id"],
        "name": data["name"],
        "category": data["category"],
        "description": data["description"],
    }

    # Content source
    if data.get("userMessageTemplate"):
        params["user_message_template"] = data["userMessageTemplate"]
    if data.get("userMessageTemplateFile"):
        params["user_message_template_file"] = data["userMessageTemplateFile"]
    if data.get("systemMessage"):
        params["system_message"] = data["systemMessage"]
    if data.get("systemMessageFile"):
        params["system_message_file"] = data["systemMessageFile"]

    # Optional fields
    if data.get("arguments"):
        params["arguments"] = data["arguments"]
    if data.get("gateConfiguration"):
        params["gate_configuration"] = data["gateConfiguration"]
    if data.get("chainSteps"):
        params["chain_steps"] = data["chainSteps"]
    if data.get("registerWithMcp") is not None:
        params["register_with_mcp"] = data["registerWithMcp"]
    if data.get("tools"):
        params["tools"] = data["tools"]

    return params


def build_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Build summary of prompt contents."""
    has_chain = bool(data.get("chainSteps"))
    return {
        "prompt_type": "chain" if has_chain else "single",
        "argument_count": len(data.get("arguments", [])),
        "chain_steps": len(data.get("chainSteps", [])),
        "has_system_message": bool(
            data.get("systemMessage") or data.get("systemMessageFile")
        ),
        "has_gates": bool(data.get("gateConfiguration")),
        "register_with_mcp": data.get("registerWithMcp", False),
    }


def validate_prompt(data: dict[str, Any]) -> dict[str, Any]:
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

    # Content source validation
    content_errors, content_warnings = validate_content_source(data)
    errors.extend(content_errors)
    warnings.extend(content_warnings)

    # Arguments validation
    arg_errors, arg_warnings = validate_arguments(data)
    errors.extend(arg_errors)
    warnings.extend(arg_warnings)

    # Chain steps validation
    errors.extend(validate_chain_steps(data))

    # Gate configuration validation
    warnings.extend(validate_gate_configuration(data))

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

    result = validate_prompt(input_data)
    print(json.dumps(result, indent=2))

    # Exit with non-zero status if validation failed
    if not result["valid"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
