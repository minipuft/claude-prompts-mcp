#!/usr/bin/env python3
"""
Methodology Builder Validation Script

Validates methodology definitions and prepares auto-execute payload for resource_manager.
Uses only Python stdlib for maximum portability.

Scoring System (5 Tiers = 100%):
- Tier 1: Foundation (30%) - metadata, system guidance, phases
- Tier 2: Quality Validation (20%) - methodology_gates with criteria, gates.include
- Tier 3: Authoring Support (25%) - methodology_elements, argument_suggestions, template_suggestions
- Tier 4: Execution (15%) - processing_steps, execution_steps
- Tier 5: Advanced (10%) - tool_descriptions, quality_indicators, execution_flow, judge_prompt

ENFORCEMENT: Methodology creation requires 100% score (all tiers complete).
"""

import json
import re
import sys
from collections import deque
from typing import Any


# =============================================================================
# TIER VALIDATION FUNCTIONS
# =============================================================================

def validate_tier1_foundation(data: dict[str, Any]) -> tuple[int, list[str]]:
    """Validate Tier 1: Foundation (30% total).

    - Metadata (5%): id, name, type, version, enabled
    - System Guidance (15%): systemPromptGuidance ≥100 chars with **Phase**: format
    - Phase Structure (10%): ≥2 phases, each with id/name/description
    """
    score = 0
    missing = []

    # Metadata (5%)
    metadata_fields = ['id', 'name', 'type', 'version', 'enabled']
    metadata_present = sum(1 for f in metadata_fields if data.get(f) is not None)
    if metadata_present == len(metadata_fields):
        score += 5
    else:
        missing_meta = [f for f in metadata_fields if data.get(f) is None]
        missing.append(f"[Tier 1 - Metadata] Missing: {', '.join(missing_meta)}")

    # System Prompt Guidance (15%)
    guidance = data.get('system_prompt_guidance', '')
    if not isinstance(guidance, str) or not guidance.strip():
        missing.append("[Tier 1 - Guidance] Missing system_prompt_guidance")
    elif len(guidance) < 100:
        missing.append(f"[Tier 1 - Guidance] system_prompt_guidance too short ({len(guidance)} chars, need ≥100)")
    else:
        # Check length (8%)
        score += 8
        # Check phase format **PhaseName**: (7%)
        if re.search(r'\*\*\w+\*\*:', guidance):
            score += 7
        else:
            missing.append("[Tier 1 - Guidance] Missing **PhaseName**: format in system_prompt_guidance")

    # Phase Structure (10%)
    phases = data.get('phases', [])
    if not isinstance(phases, list):
        missing.append("[Tier 1 - Phases] phases must be an array")
    elif len(phases) < 2:
        missing.append(f"[Tier 1 - Phases] Need ≥2 phases (have {len(phases)})")
    else:
        # Minimum count (5%)
        score += 5
        # Required fields per phase (5%)
        valid_phases = sum(1 for p in phases if p.get('id') and p.get('name') and p.get('description'))
        if valid_phases == len(phases):
            score += 5
        else:
            missing.append(f"[Tier 1 - Phases] {len(phases) - valid_phases} phases missing id/name/description")

    return score, missing


def validate_tier2_quality(data: dict[str, Any]) -> tuple[int, list[str]]:
    """Validate Tier 2: Quality Validation (20% total).

    - Methodology Gates (15%): ≥2 gates, each with ≥2 validationCriteria
    - Gates Include (5%): gates.include with ≥1 gate ID
    """
    score = 0
    missing = []

    # Methodology Gates (15%)
    gates = data.get('methodology_gates', [])
    if not isinstance(gates, list):
        missing.append("[Tier 2 - Gates] methodology_gates must be an array")
    elif len(gates) < 2:
        missing.append(f"[Tier 2 - Gates] Need ≥2 methodology_gates (have {len(gates)})")
    else:
        # Minimum count (5%)
        score += 5
        # Depth check - each gate needs ≥2 validationCriteria (10%)
        valid_gates = sum(1 for g in gates if len(g.get('validationCriteria', [])) >= 2)
        if valid_gates >= 2:
            score += 10  # Full points when minimum met
        else:
            missing.append(f"[Tier 2 - Gates] Need ≥2 gates with ≥2 validationCriteria (have {valid_gates})")

    # Gates Include (5%)
    gates_config = data.get('gates', {})
    if not isinstance(gates_config, dict):
        missing.append("[Tier 2 - Include] gates must be an object")
    else:
        include_list = gates_config.get('include', [])
        if isinstance(include_list, list) and len(include_list) >= 1:
            score += 5
        else:
            missing.append("[Tier 2 - Include] Missing gates.include with ≥1 gate ID")

    return score, missing


def validate_tier3_authoring(data: dict[str, Any]) -> tuple[int, list[str]]:
    """Validate Tier 3: Authoring Support (25% total).

    - Methodology Elements (10%): requiredSections ≥2, sectionDescriptions ≥3
    - Argument Suggestions (8%): ≥2 args with methodologyReason
    - Template Suggestions (7%): ≥1 with methodologyJustification
    """
    score = 0
    missing = []

    # Methodology Elements (10%)
    elements = data.get('methodology_elements', {})
    if not isinstance(elements, dict) or not elements:
        missing.append("[Tier 3 - Elements] Missing methodology_elements")
    else:
        required_sections = elements.get('requiredSections', [])
        section_descriptions = elements.get('sectionDescriptions', {})

        if len(required_sections) >= 2:
            score += 5
        else:
            missing.append(f"[Tier 3 - Elements] Need ≥2 requiredSections (have {len(required_sections)})")

        if len(section_descriptions) >= 3:
            score += 5
        else:
            missing.append(f"[Tier 3 - Elements] Need ≥3 sectionDescriptions (have {len(section_descriptions)})")

    # Argument Suggestions (8%)
    args = data.get('argument_suggestions', [])
    if not isinstance(args, list):
        missing.append("[Tier 3 - Arguments] argument_suggestions must be an array")
    else:
        valid_args = sum(1 for a in args if a.get('methodologyReason'))
        if valid_args >= 2:
            score += 8  # Full points when minimum met
        else:
            missing.append(f"[Tier 3 - Arguments] Need ≥2 argument_suggestions with methodologyReason (have {valid_args})")

    # Template Suggestions (7%)
    suggestions = data.get('template_suggestions', [])
    if not isinstance(suggestions, list):
        missing.append("[Tier 3 - Templates] template_suggestions must be an array")
    else:
        valid = sum(1 for s in suggestions if s.get('methodologyJustification'))
        if valid >= 1:
            score += 7  # Full points when minimum met
        else:
            missing.append(f"[Tier 3 - Templates] Need ≥1 template_suggestion with methodologyJustification (have {valid})")

    return score, missing


def validate_tier4_execution(data: dict[str, Any]) -> tuple[int, list[str]]:
    """Validate Tier 4: Execution (15% total).

    - Processing Steps (8%): ≥3 steps with order and methodologyBasis
    - Execution Steps (7%): ≥3 steps with dependencies and expected_output
    """
    score = 0
    missing = []

    # Processing Steps (8%)
    processing = data.get('processing_steps', [])
    if not isinstance(processing, list):
        missing.append("[Tier 4 - Processing] processing_steps must be an array")
    else:
        valid = sum(1 for s in processing if s.get('order') is not None and s.get('methodologyBasis'))
        if valid >= 3:
            score += 8  # Full points when minimum met
        else:
            missing.append(f"[Tier 4 - Processing] Need ≥3 processing_steps with order/methodologyBasis (have {valid})")

    # Execution Steps (7%)
    execution = data.get('execution_steps', [])
    if not isinstance(execution, list):
        missing.append("[Tier 4 - Execution] execution_steps must be an array")
    else:
        valid = sum(1 for s in execution if 'dependencies' in s and s.get('expected_output'))
        if valid >= 3:
            score += 7  # Full points when minimum met
        else:
            missing.append(f"[Tier 4 - Execution] Need ≥3 execution_steps with dependencies/expected_output (have {valid})")

    return score, missing


def validate_tier5_advanced(data: dict[str, Any]) -> tuple[int, list[str]]:
    """Validate Tier 5: Advanced (10% total).

    - Tool Descriptions (4%): ≥1 tool override
    - Quality Indicators (3%): ≥2 phases with keywords and patterns
    - Execution Flow (2%): pre/post/validation hooks
    - Judge Prompt (1%): judge_prompt content
    """
    score = 0
    missing = []

    # Tool Descriptions (4%)
    tools = data.get('tool_descriptions', {})
    if isinstance(tools, dict) and len(tools) >= 1:
        score += 4  # Full points when minimum met
    else:
        missing.append("[Tier 5 - Tools] Need ≥1 tool_descriptions entry")

    # Quality Indicators (3%)
    indicators = data.get('quality_indicators', {})
    if isinstance(indicators, dict):
        valid = sum(1 for p in indicators.values() if
                   isinstance(p, dict) and p.get('keywords') and p.get('patterns'))
        if valid >= 2:
            score += 3  # Full points when minimum met
        else:
            missing.append(f"[Tier 5 - Indicators] Need ≥2 quality_indicators phases with keywords/patterns (have {valid})")
    else:
        missing.append("[Tier 5 - Indicators] Missing quality_indicators")

    # Execution Flow (2%)
    flow = data.get('execution_flow', {})
    if isinstance(flow, dict):
        has_hooks = any([
            flow.get('preProcessingSteps'),
            flow.get('postProcessingSteps'),
            flow.get('validationSteps')
        ])
        if has_hooks:
            score += 2
        else:
            missing.append("[Tier 5 - Flow] Need execution_flow with pre/post/validation hooks")
    else:
        missing.append("[Tier 5 - Flow] Missing execution_flow")

    # Judge Prompt (1%)
    if data.get('judge_prompt'):
        score += 1
    else:
        missing.append("[Tier 5 - Judge] Missing judge_prompt")

    return score, missing


# =============================================================================
# SCORING AND VALIDATION
# =============================================================================

def calculate_completeness_score(data: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Calculate methodology completeness score (0-100%) using 5-tier system.

    Returns:
        Tuple of (total_score, details) where details contains per-tier breakdown.
    """
    all_missing = []
    tier_scores = {}

    # Tier 1: Foundation (30%)
    t1_score, t1_missing = validate_tier1_foundation(data)
    tier_scores['tier1_foundation'] = {'score': t1_score, 'max': 30}
    all_missing.extend(t1_missing)

    # Tier 2: Quality Validation (20%)
    t2_score, t2_missing = validate_tier2_quality(data)
    tier_scores['tier2_quality'] = {'score': t2_score, 'max': 20}
    all_missing.extend(t2_missing)

    # Tier 3: Authoring Support (25%)
    t3_score, t3_missing = validate_tier3_authoring(data)
    tier_scores['tier3_authoring'] = {'score': t3_score, 'max': 25}
    all_missing.extend(t3_missing)

    # Tier 4: Execution (15%)
    t4_score, t4_missing = validate_tier4_execution(data)
    tier_scores['tier4_execution'] = {'score': t4_score, 'max': 15}
    all_missing.extend(t4_missing)

    # Tier 5: Advanced (10%)
    t5_score, t5_missing = validate_tier5_advanced(data)
    tier_scores['tier5_advanced'] = {'score': t5_score, 'max': 10}
    all_missing.extend(t5_missing)

    total = min(t1_score + t2_score + t3_score + t4_score + t5_score, 100)

    return total, {
        'tiers': tier_scores,
        'missing': all_missing,
    }


def get_completeness_level(score: int) -> str:
    """Map score to completeness level."""
    if score < 30:
        return "incomplete"
    elif score < 50:
        return "minimal"
    elif score < 75:
        return "standard"
    else:
        return "full"


# =============================================================================
# STRUCTURAL VALIDATION (existing functions, refactored)
# =============================================================================

def validate_id_format(value: str, pattern: str, field_name: str) -> list[str]:
    """Validate ID format against pattern."""
    errors = []
    if not re.match(pattern, value):
        errors.append(f"{field_name} '{value}' must match pattern {pattern}")
    return errors


def validate_phase_consistency(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Validate that gates and steps reference valid phases."""
    errors = []
    warnings = []

    phases = data.get("phases", [])
    phase_ids = {p.get("id") for p in phases if p.get("id")}
    phase_names = {p.get("name") for p in phases if p.get("name")}
    valid_references = phase_ids | phase_names

    # Check methodology_gates reference valid phases
    for gate in data.get("methodology_gates", []):
        area = gate.get("methodologyArea")
        if area and area not in valid_references:
            errors.append(
                f"Gate '{gate.get('id', 'unknown')}' references unknown phase '{area}'. "
                f"Valid phases: {sorted(valid_references)}"
            )

    # Check execution_steps reference valid phases
    for step in data.get("execution_steps", []):
        phase = step.get("methodologyPhase")
        if phase and phase not in valid_references:
            warnings.append(
                f"Execution step '{step.get('id', 'unknown')}' references "
                f"unknown methodologyPhase '{phase}'"
            )

    # Check quality_indicators keys match phases
    for phase_key in data.get("quality_indicators", {}).keys():
        if phase_key not in phase_ids:
            warnings.append(
                f"Quality indicator for unknown phase '{phase_key}'. "
                f"Expected one of: {sorted(phase_ids)}"
            )

    return errors, warnings


def validate_execution_dependencies(data: dict[str, Any]) -> list[str]:
    """Validate execution step dependencies are valid and acyclic."""
    errors = []

    steps = data.get("execution_steps", [])
    if not steps:
        return errors

    step_ids = {s.get("id") for s in steps if s.get("id")}

    # Build adjacency list for cycle detection
    graph: dict[str, list[str]] = {}
    for step in steps:
        step_id = step.get("id")
        if not step_id:
            continue
        deps = step.get("dependencies", [])
        graph[step_id] = []
        for dep in deps:
            if dep not in step_ids:
                errors.append(
                    f"Execution step '{step_id}' depends on unknown step '{dep}'"
                )
            else:
                graph[step_id].append(dep)

    # Detect cycles using Kahn's algorithm
    in_degree = {node: 0 for node in graph}
    for deps in graph.values():
        for dep in deps:
            if dep in in_degree:
                in_degree[dep] += 1

    queue = deque([node for node, degree in in_degree.items() if degree == 0])
    processed = 0

    while queue:
        node = queue.popleft()
        processed += 1
        for dep in graph.get(node, []):
            in_degree[dep] -= 1
            if in_degree[dep] == 0:
                queue.append(dep)

    if processed != len(graph):
        errors.append(
            "Circular dependency detected in execution_steps. "
            "Check that dependencies form a directed acyclic graph."
        )

    return errors


def validate_regex_patterns(data: dict[str, Any]) -> list[str]:
    """Validate all regex patterns in quality_indicators are valid."""
    errors = []

    for phase_id, indicators in data.get("quality_indicators", {}).items():
        patterns = indicators.get("patterns", [])
        for pattern in patterns:
            try:
                re.compile(pattern)
            except re.error as e:
                errors.append(
                    f"Invalid regex pattern in quality_indicators.{phase_id}: "
                    f"'{pattern}' - {e}"
                )

    return errors


def validate_processing_steps(data: dict[str, Any]) -> list[str]:
    """Validate processing_steps have valid order values."""
    errors = []

    steps = data.get("processing_steps", [])
    if not steps:
        return errors

    orders_seen = set()
    for step in steps:
        order = step.get("order")
        if order is not None:
            if not isinstance(order, int) or order < 1:
                errors.append(
                    f"Processing step '{step.get('id', 'unknown')}' has invalid order: {order}. "
                    "Must be a positive integer."
                )
            elif order in orders_seen:
                errors.append(
                    f"Duplicate order value {order} in processing_steps"
                )
            else:
                orders_seen.add(order)

    return errors


# =============================================================================
# PAYLOAD BUILDING
# =============================================================================

def build_resource_manager_params(data: dict[str, Any]) -> dict[str, Any]:
    """Transform validated data into resource_manager parameters."""
    params: dict[str, Any] = {
        "resource_type": "methodology",
        "action": "create",
        "id": data["id"],
        "name": data["name"],
        "system_prompt_guidance": data["system_prompt_guidance"],
        "phases": data["phases"],
    }

    # Optional fields - only include if present
    optional_fields = [
        "type",
        "version",
        "enabled",
        "description",
        "gates",
        "methodology_gates",
        "template_suggestions",
        "methodology_elements",
        "argument_suggestions",
        "processing_steps",
        "execution_steps",
        "template_enhancements",
        "execution_flow",
        "execution_type_enhancements",
        "quality_indicators",
        "tool_descriptions",
        "judge_prompt",
    ]

    for field in optional_fields:
        if field in data and data[field] is not None:
            params[field] = data[field]

    return params


def build_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Build summary of methodology contents."""
    return {
        "phases": len(data.get("phases", [])),
        "methodology_gates": len(data.get("methodology_gates", [])),
        "processing_steps": len(data.get("processing_steps", [])),
        "execution_steps": len(data.get("execution_steps", [])),
        "quality_indicator_phases": len(data.get("quality_indicators", {})),
        "template_suggestions": len(data.get("template_suggestions", [])),
        "argument_suggestions": len(data.get("argument_suggestions", [])),
        "tool_descriptions": len(data.get("tool_descriptions", {})),
    }


# =============================================================================
# MAIN VALIDATION
# =============================================================================

def validate_methodology(data: dict[str, Any]) -> dict[str, Any]:
    """Main validation function.

    ENFORCEMENT: Requires 100% score for methodology creation.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # Validate id format if present
    if "id" in data and data["id"]:
        errors.extend(validate_id_format(
            data["id"],
            r"^[a-z][a-z0-9-]*$",
            "id"
        ))

    # Calculate completeness score (the 5-tier system)
    score, score_details = calculate_completeness_score(data)
    level = get_completeness_level(score)

    # ENFORCEMENT: Require 100% score for creation
    if score < 100:
        # Add tier-specific missing fields as errors
        errors.extend(score_details['missing'])

        # Add quick start hint for very low scores
        if score < 30:
            errors.insert(0,
                "[Quick Start] For Tier 1 (Foundation), provide: "
                "id, name, type, version, enabled, "
                "system_prompt_guidance (≥100 chars with **Phase**: format), "
                "and ≥2 phases with {id, name, description}"
            )

        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
            "score": score,
            "level": level,
            "tier_breakdown": score_details['tiers'],
            "message": f"Methodology creation requires 100% score. Current: {score}% ({level}). "
                       f"Complete all 5 tiers to match CAGEERF standard.",
        }

    # If 100% score, run structural validations
    phase_errors, phase_warnings = validate_phase_consistency(data)
    errors.extend(phase_errors)
    warnings.extend(phase_warnings)

    errors.extend(validate_execution_dependencies(data))
    errors.extend(validate_regex_patterns(data))
    errors.extend(validate_processing_steps(data))

    if errors:
        return {
            "valid": False,
            "errors": errors,
            "warnings": warnings,
            "score": score,
            "level": level,
            "tier_breakdown": score_details['tiers'],
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
        "score": score,
        "level": level,
        "tier_breakdown": score_details['tiers'],
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

    result = validate_methodology(input_data)
    print(json.dumps(result, indent=2))

    # Exit with non-zero status if validation failed
    if not result["valid"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
