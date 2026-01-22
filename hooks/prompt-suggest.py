#!/usr/bin/env python3
"""
UserPromptSubmit hook: Directive injection for claude-prompts.

Detects >>syntax and operators, outputs:
- systemMessage: Compact user confirmation
- additionalContext: Structured directive for Claude

Architecture:
- Layer 1: MCP-native prompts (via registerPrompt) - standard protocol
- Layer 2: This hook - efficiency layer translating >>syntax to prompt_engine calls

Operators detected (from contract):
- `-->` chain, `::` gate, `@` framework, `#` style, `* N` repetition
"""

import json
import re
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))
sys.path.insert(0, str(Path(__file__).parent / "lib" / "_generated"))

from cache_manager import (
    load_prompts_cache,
    get_prompt_by_id,
    match_prompts_to_intent,
    get_chains_only,
    fuzzy_match_prompt_id,
)
from session_state import load_session_state, format_chain_reminder
from config_loader import is_expanded_output

# Import generated operator patterns (SSOT: server/tooling/contracts/operators.json)
try:
    from operators import detect_operator, detect_all_operators, OPERATORS
    HAS_GENERATED_OPERATORS = True
except ImportError:
    HAS_GENERATED_OPERATORS = False
    OPERATORS = {}

def format_arguments(prompt_id: str, cache: dict) -> dict[str, str]:
    """
    Extract argument info from cached prompt metadata.

    Returns dict of arg_name -> "type (required|optional)"
    If options are available, shows: "opt1 | opt2 | opt3 (required)"
    """
    # Use case-insensitive lookup (prompt_id may be lowercase after normalization)
    prompt = get_prompt_by_id(prompt_id, cache)
    if not prompt:
        return {}
    args = prompt.get("arguments", [])
    result: dict[str, str] = {}
    for arg in args:
        if not isinstance(arg, dict) or not arg.get("name"):
            continue
        name = arg.get("name", "")
        options = arg.get("options")
        if options and isinstance(options, list) and len(options) > 0:
            # Show options inline: "tutorial | howto | reference"
            type_str = " | ".join(options)
        else:
            type_str = arg.get("type", "string")
        req = "required" if arg.get("required") else "optional"
        result[name] = f"{type_str} ({req})"
    return result


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def detect_prompt_invocation(message: str) -> str | None:
    """
    Detect >> prompt invocation syntax.
    Returns the prompt ID/name if found.

    Examples:
        >>deep_analysis -> "deep_analysis"
        >> code_review -> "code_review"
        >>research-comprehensive -> "research-comprehensive"
        @CAGEERF >>analyze -> "analyze"
        #analytical >>report -> "report"
    """
    # Try exact start first
    match = re.match(r'^>>\s*([a-zA-Z0-9_-]+)', message.strip())
    if match:
        # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
        return match.group(1).lower()

    # Also check for >> after operators (@framework, #style)
    match = re.search(r'>>\s*([a-zA-Z0-9_-]+)', message)
    if match:
        # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
        return match.group(1).lower()

    return None


def detect_explicit_request(message: str) -> bool:
    """Detect explicit prompt suggestion requests."""
    triggers = [
        r'\bsuggest\s+prompts?\b',
        r'\blist\s+prompts?\b',
        r'\bavailable\s+prompts?\b',
        r'\bshow\s+prompts?\b',
        r'\bwhat\s+prompts?\b',
        r'\bprompt\s+suggestions?\b',
        r'\brecommend\s+prompts?\b',
    ]
    message_lower = message.lower()
    return any(re.search(trigger, message_lower) for trigger in triggers)


def detect_chain_syntax(message: str) -> list[str]:
    """
    Detect --> chain syntax in message.
    Returns list of prompt IDs in chain order (normalized to lowercase).

    Example: >>analyze --> >>implement --> >>test
    Example with gate: >>a --> >>b :: "criteria"
    """
    # Match: >>prompt_id --> >>prompt_id pattern
    chain_pattern = r'>>\s*([a-zA-Z0-9_-]+)\s*(?:-->|→)'
    raw_matches = re.findall(chain_pattern, message)
    # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
    matches = [m.lower() for m in raw_matches]

    # Get the last prompt (after final -->) by splitting on chain operators
    # then extracting the prompt ID from the last segment
    parts = re.split(r'\s*(?:-->|→)\s*', message)
    if len(parts) > 1:
        last_part = parts[-1]
        last_match = re.match(r'>>\s*([a-zA-Z0-9_-]+)', last_part)
        if last_match:
            matches.append(last_match.group(1).lower())

    return matches


def detect_inline_gates(message: str) -> list[str]:
    """
    Detect :: gate syntax in message.
    Returns list of gate criteria/IDs.

    Examples:
        :: 'must check security' -> ["must check security"]
        :: security-check -> ["security-check"]

    Note: Always uses semantic extraction (not generated patterns) because
    we need gate content, not the :: symbol itself.
    """
    # Always use semantic patterns - generated pattern returns operator symbol too
    quoted_pattern = r'::\s*[\'"]([^\'"]+)[\'"]'
    id_pattern = r'::\s*([a-zA-Z][a-zA-Z0-9_-]*)\b'

    quoted = re.findall(quoted_pattern, message)
    ids = re.findall(id_pattern, message)

    return quoted + ids


def detect_framework(message: str) -> str | None:
    """
    Detect @FRAMEWORK syntax in message.
    Returns the framework ID if found (normalized to lowercase).

    Examples:
        @CAGEERF >>analyze -> "cageerf"
        @ReACT >>debug -> "react"

    Note: Framework IDs are normalized to lowercase to align with MCP server storage.
    """
    if HAS_GENERATED_OPERATORS:
        matches = detect_operator(message, 'framework')
        # Normalize to lowercase (MCP server stores framework keys as lowercase)
        return matches[0].lower() if matches else None

    # Fallback: hardcoded pattern
    match = re.search(r'(?:^|\s)@([A-Za-z0-9_-]+)(?=\s|$)', message)
    return match.group(1).lower() if match else None


def detect_repetition(message: str) -> int | None:
    """
    Detect * N repetition syntax in message.
    Returns the repetition count if found.

    Examples:
        >>prompt * 3 -> 3
        >>analyze * 5 --> >>summarize -> 5
    """
    if HAS_GENERATED_OPERATORS:
        matches = detect_operator(message, 'repetition')
        return int(matches[0]) if matches else None

    # Fallback: hardcoded pattern
    match = re.search(r'\s+\*\s*(\d+)(?=\s|$|-->)', message)
    return int(match.group(1)) if match else None


def parse_inline_args(message: str) -> dict[str, str]:
    """
    Parse key:"value" or key:'value' argument patterns from message.
    Only parses quoted values for safety (avoids misparsing URLs/special chars).

    Examples:
        >>prompt content:"hello world" -> {"content": "hello world"}
        >>prompt scope:'global' limit:"10" -> {"scope": "global", "limit": "10"}
    """
    pattern = r'(\w+):["\']([^"\']+)["\']'
    matches = re.findall(pattern, message)
    return dict(matches)


def get_required_args(prompt_info: dict | None, parsed_args: dict[str, str]) -> list[str]:
    """
    Get list of required arguments that haven't been provided.

    Args:
        prompt_info: Prompt metadata from cache (may be None)
        parsed_args: Already parsed arguments from message

    Returns:
        List of required argument names not in parsed_args
    """
    if not prompt_info:
        return []

    args = prompt_info.get("arguments", [])
    required = []
    for arg in args:
        if isinstance(arg, dict) and arg.get("required", False):
            name = arg.get("name", "")
            if name and name not in parsed_args:
                required.append(name)
    return required


def get_chain_step_args(
    prompt_ids: list[str], cache: dict
) -> list[tuple[str, list[dict]]]:
    """Fetch arguments for each prompt in a chain.

    Args:
        prompt_ids: List of prompt IDs in chain order
        cache: Prompts cache dict

    Returns:
        List of (prompt_id, arguments) tuples
    """
    result = []
    for pid in prompt_ids:
        info = get_prompt_by_id(pid, cache)
        args = info.get("arguments", []) if info else []
        result.append((pid, args))
    return result


def format_arg_signature(arg: dict, include_desc: bool = False) -> str:
    """Format a single argument for display.

    Args:
        arg: Argument dict with name, type, required, description
        include_desc: If True, append truncated description for context

    Returns:
        Compact format: name*:type or name*:type (description...)
    """
    name = arg.get("name", "unknown")
    arg_type = arg.get("type", "string")
    required = arg.get("required", False)
    req_marker = "*" if required else ""
    base = f"{name}{req_marker}:{arg_type}"

    if include_desc:
        desc = arg.get("description", "")
        if desc:
            # Truncate long descriptions for token efficiency
            short = desc[:50] + "..." if len(desc) > 50 else desc
            return f"{base} ({short})"
    return base


def format_chain_step_args(
    step_data: list[tuple[str, list[dict]]],
    current_step: int = 1,
    total_steps: int = 0,
) -> list[str]:
    """Format chain steps with their arguments (balanced mode).

    Args:
        step_data: List of (prompt_id, arguments) tuples
        current_step: 1-based current step (arrow marker)
        total_steps: Total steps (for header)

    Returns:
        Lines including header and step list
    """
    total = total_steps or len(step_data)
    lines = [f"[MCP Chain] Step {current_step}/{total}"]

    for i, (pid, args) in enumerate(step_data, start=1):
        # Arrow marker for current step
        marker = "→" if i == current_step else " "

        # Balanced: first 2 args get descriptions, rest signature only
        arg_parts = []
        for j, arg in enumerate(args[:5]):  # Max 5 args shown
            sig = format_arg_signature(arg, include_desc=(j < 2))
            arg_parts.append(sig)

        arg_str = ", ".join(arg_parts) if arg_parts else "(no args)"
        lines.append(f"  {marker}{i}. >>{pid}: {arg_str}")

    return lines


def format_chain_preview(prompt_info: dict | None) -> list[str]:
    """
    Format a chain preview showing all steps before execution.

    Args:
        prompt_info: Prompt metadata from cache (may be None)

    Returns:
        Lines for chain preview, or empty list if not a chain
    """
    if not prompt_info or not prompt_info.get("is_chain"):
        return []

    step_names = prompt_info.get("chain_step_names") or []
    total_steps = prompt_info.get("chain_steps", 0)

    if not step_names:
        # Fallback: no step names in cache (backwards compat)
        return [f"[Chain Workflow] {total_steps} steps"]

    lines = [f"[Chain Workflow] {total_steps} steps:"]
    for i, name in enumerate(step_names, 1):
        lines.append(f"  {i}. {name}")

    return lines


def format_tool_call(prompt_id: str, info: dict) -> str:
    """Generate a copy-paste ready tool call."""
    args = info.get("arguments", [])

    if not args:
        return f'prompt_engine(command:">>{prompt_id}")'

    # Build options object
    options_parts = []
    for arg in args:
        name = arg.get("name", "")
        default = arg.get("default")
        placeholder = f'"{default}"' if default else f'"<{name}>"'
        options_parts.append(f'"{name}": {placeholder}')

    options_str = ", ".join(options_parts)
    return f'prompt_engine(command:">>{prompt_id}", options:{{{options_str}}})'


def format_prompt_suggestion(prompt_id: str, info: dict, score: int = 0) -> str:
    """Format a single prompt suggestion. Compact single-line format."""
    chain_tag = f" [{info.get('chain_steps', 0)}]" if info.get("is_chain") else ""
    desc = info.get('description', '')[:60]
    return f"  >>{prompt_id}{chain_tag}: {desc}"


def format_user_message(
    command: str,
    parsed_args: dict[str, str],
    operators: dict[str, list[str]],
    arguments: dict[str, str] | None = None,
    expanded: bool = False,
    prompt_info: dict | None = None,
) -> str:
    """
    Format user-visible confirmation message.

    Args:
        command: The full command string (e.g., ">>deep_analysis" or "@CAGEERF >>analyze")
        parsed_args: Parsed arguments from message
        operators: Detected operators dict
        arguments: Prompt arguments with types (from format_arguments)
        expanded: If True, show detailed multi-line output
        prompt_info: Prompt metadata from cache (for chain preview)

    Returns:
        Compact: "[>>] deep_analysis | content:'foo'"
        Expanded: Multi-line with operators, arguments, and support info
    """
    # Extract prompt ID from command (handle @framework >>prompt syntax)
    # Normalize to lowercase for case-insensitive matching (aligns with MCP server)
    match = re.search(r'>>\s*([a-zA-Z0-9_-]+)', command)
    prompt_id = match.group(1).lower() if match else command.lower()

    if expanded:
        return _format_expanded_message(prompt_id, command, parsed_args, operators, arguments, prompt_info)

    # Compact mode (default)
    parts = [f"[>>] {prompt_id}"]

    # Add parsed args
    if parsed_args:
        arg_strs = [f'{k}:"{v}"' for k, v in list(parsed_args.items())[:3]]
        parts.append(" | " + ", ".join(arg_strs))

    # Add operator indicators (compact)
    op_indicators = []
    if operators.get("chain"):
        op_indicators.append(f"chain:{len(operators['chain'])}steps")
    if operators.get("repetition"):
        op_indicators.append(f"*{operators['repetition'][0]}")
    if operators.get("framework"):
        op_indicators.append(f"@{operators['framework'][0]}")
    if operators.get("style"):
        op_indicators.append(f"#{operators['style'][0]}")
    if operators.get("gate"):
        op_indicators.append(f"gates:{len(operators['gate'])}")

    if op_indicators:
        parts.append(" [" + ", ".join(op_indicators) + "]")

    base_message = "".join(parts)

    # Add chain preview for chain prompts (shows workflow upfront)
    chain_preview = format_chain_preview(prompt_info)
    if chain_preview:
        return base_message + "\n" + "\n".join(chain_preview)

    return base_message


def _format_expanded_message(
    prompt_id: str,
    command: str,
    parsed_args: dict[str, str],
    operators: dict[str, list[str]],
    arguments: dict[str, str] | None = None,
    prompt_info: dict | None = None,
) -> str:
    """
    Format expanded multi-line user message with full details.
    """
    lines = [f"[MCP] >>{prompt_id}"]

    # Add chain workflow preview for chain prompts
    chain_preview = format_chain_preview(prompt_info)
    if chain_preview:
        lines.extend(chain_preview)

    # Show operators with descriptions
    if operators:
        op_parts = []
        if operators.get("chain"):
            op_parts.append(f"chain ({len(operators['chain'])} steps)")
        if operators.get("framework"):
            op_parts.append(f"@{operators['framework'][0]}")
        if operators.get("style"):
            op_parts.append(f"#{operators['style'][0]}")
        if operators.get("repetition"):
            op_parts.append(f"repeat ×{operators['repetition'][0]}")
        if operators.get("gate"):
            gate_list = ", ".join(operators['gate'][:2])
            op_parts.append(f"gates: {gate_list}")
        if op_parts:
            lines.append(f"  Operators: {' | '.join(op_parts)}")

    # Show arguments with types (always show, even if empty)
    arg_strs = [f"{k}: {v}" for k, v in list((arguments or {}).items())[:4]]
    args_line = ', '.join(arg_strs) if arg_strs else "(none)"
    lines.append(f"  Arguments: {args_line}")

    # Show provided options
    if parsed_args:
        opt_strs = [f'{k}="{v}"' for k, v in list(parsed_args.items())[:3]]
        lines.append(f"  Provided: {', '.join(opt_strs)}")

    return "\n".join(lines)


def format_directive(
    command: str,
    parsed_args: dict[str, str],
    required_args: list[str],
    operators: dict[str, list[str]],
    arguments: dict[str, str] | None = None,
    prompt_info: dict | None = None,
) -> str:
    """
    Format structured directive for Claude.

    Args:
        command: The full command string
        parsed_args: Parsed arguments from message
        required_args: Required args not yet provided
        operators: Detected operators dict
        arguments: Prompt arguments with types (from format_arguments)
        prompt_info: Prompt metadata from cache (for chain workflow context)

    Returns:
        Structured directive string for additionalContext
    """
    lines = [f"[TOOL:prompt_engine] {command}"]

    # Add chain workflow context for Claude (shows full workflow upfront)
    if prompt_info and prompt_info.get("is_chain"):
        step_names = prompt_info.get("chain_step_names") or []
        if step_names:
            lines.append(f"chain_workflow: {json.dumps(step_names)}")
            lines.append("Execute steps sequentially. Wait for each step to complete before proceeding.")

    # Add detected operators if any
    if operators:
        lines.append(f"operators: {json.dumps(operators)}")

    # Add prompt arguments with types (always show)
    lines.append(f"arguments: {json.dumps(arguments if arguments else {})}")

    # Add parsed options
    if parsed_args:
        lines.append(f"options: {json.dumps(parsed_args)}")

    # Add required args that are missing
    if required_args:
        lines.append(f"required: {json.dumps(required_args)}")

    lines.append("Execute immediately.")

    return "\n".join(lines)


def main():
    hook_input = parse_hook_input()

    # Get user's message from hook input
    # UserPromptSubmit provides the user's prompt in 'user_prompt' field
    user_message = hook_input.get("user_prompt", "") or hook_input.get("prompt", "") or hook_input.get("message", "")
    session_id = hook_input.get("session_id", "")

    if not user_message:
        # No message to process
        sys.exit(0)

    cache = load_prompts_cache()
    if not cache:
        # No cache available - silent exit
        sys.exit(0)

    # Check for direct prompt invocation (>>prompt_id) or chain syntax
    invoked_prompt = detect_prompt_invocation(user_message)
    chain_prompts = detect_chain_syntax(user_message)
    is_prompt_invocation = invoked_prompt or (chain_prompts and len(chain_prompts) > 0)

    if is_prompt_invocation:
        # === DIRECTIVE MODE: >>syntax detected ===
        # Generate split output: compact systemMessage + structured directive

        # Detect operators - use semantic detection for chain/gate (need content),
        # use generated patterns for framework/style/repetition (symbol detection OK)
        operators: dict[str, list[str]] = {}

        # Chain and gate ALWAYS use semantic extraction (need prompt IDs / gate criteria)
        if chain_prompts and len(chain_prompts) > 1:
            operators["chain"] = chain_prompts

        inline_gates = detect_inline_gates(user_message)
        if inline_gates:
            operators["gate"] = inline_gates

        # Framework, style, repetition use generated patterns when available
        if HAS_GENERATED_OPERATORS:
            for op_id in ['framework', 'style', 'repetition']:
                matches = detect_operator(user_message, op_id)
                if matches:
                    operators[op_id] = matches
        else:
            # Fallback: manual detection for remaining operators
            framework = detect_framework(user_message)
            if framework:
                operators["framework"] = [framework]
            repetition = detect_repetition(user_message)
            if repetition:
                operators["repetition"] = [str(repetition)]

        # Parse inline arguments (quoted only)
        parsed_args = parse_inline_args(user_message)

        # Get prompt info from cache
        prompt_info = get_prompt_by_id(invoked_prompt, cache) if invoked_prompt else None

        # Early return for unknown prompts: provide fuzzy suggestions without tool call
        # This saves tokens by avoiding a failing server round-trip
        if invoked_prompt and prompt_info is None:
            suggestions = fuzzy_match_prompt_id(invoked_prompt, cache)

            if suggestions:
                message = f"Unknown prompt '{invoked_prompt}'. Did you mean: {', '.join(suggestions)}?"
            else:
                message = f"Unknown prompt '{invoked_prompt}'. No similar prompts found."

            # Return message WITHOUT directive (no tool call needed)
            hook_response = {
                "systemMessage": message,
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": f"Prompt '{invoked_prompt}' not found. Suggest user correct the name."
                }
            }
            print(json.dumps(hook_response))
            sys.exit(0)

        # Get required args that are missing
        required_args = get_required_args(prompt_info, parsed_args)

        # Get argument type info for LLM guidance
        arguments = format_arguments(invoked_prompt, cache) if invoked_prompt else None

        # Use full message as command (server parses it)
        # Preserve @framework, #style prefixes and all operators
        command = user_message.strip()

        # Format outputs (check config for expanded mode)
        # Pass prompt_info for chain workflow visibility
        expanded = is_expanded_output()
        system_message = format_user_message(
            command, parsed_args, operators, arguments, expanded, prompt_info
        )
        directive = format_directive(
            command, parsed_args, required_args, operators, arguments, prompt_info
        )

        hook_response = {
            "systemMessage": system_message,  # Compact user confirmation
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": directive  # Structured directive for Claude
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)

    # === INFORMATIONAL MODE: No >>syntax ===
    # Fall back to suggestions/chain state (no tool directive)
    output_lines = []

    # Check for active chain state from previous prompt_engine calls
    if session_id:
        session_state = load_session_state(session_id)
        if session_state:
            chain_state_inline = format_chain_reminder(session_state, mode="inline")
            if chain_state_inline:
                output_lines.append(chain_state_inline)

    # Check for explicit suggestion request
    if detect_explicit_request(user_message):
        matches = match_prompts_to_intent(user_message, cache, max_results=3)

        if matches:
            output_lines.append("[MCP Suggestions]")
            for prompt_id, info, _score in matches:
                output_lines.append(format_prompt_suggestion(prompt_id, info))
        else:
            chains = get_chains_only(cache)
            if chains:
                output_lines.append("[MCP Chains]")
                for prompt_id, info in list(chains.items())[:3]:
                    output_lines.append(format_prompt_suggestion(prompt_id, info))

    # Output informational context (same to both user and Claude)
    if output_lines:
        output = "\n".join(output_lines)
        hook_response = {
            "systemMessage": output,
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": output
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)
    else:
        sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[MCP Hook Error] {e}", file=sys.stderr)
        sys.exit(1)  # Exit 1 for actual errors
