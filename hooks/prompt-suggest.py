#!/usr/bin/env python3
"""
UserPromptSubmit hook: Context injection for claude-prompts.

Detects and provides guidance for:
- `>>prompt_id` - Prompt invocation with args, types, tool call
- `>>a --> >>b` - Chain syntax with step info
- `:: 'criteria'` - Inline gate syntax (reminds Claude of responsibility)
- Active chain state - Shows current step, pending gates

Output: Rich context injected for Claude to act on.
"""

import json
import re
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from cache_manager import (
    load_prompts_cache,
    get_prompt_by_id,
    match_prompts_to_intent,
    get_chains_only,
)
from session_state import load_session_state, format_chain_reminder


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
    """
    match = re.match(r'^>>\s*([a-zA-Z0-9_-]+)', message.strip())
    if match:
        return match.group(1)
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
    Returns list of prompt IDs in chain order.

    Example: >>analyze --> >>implement --> >>test
    Example with gate: >>a --> >>b :: "criteria"
    """
    # Match: >>prompt_id --> >>prompt_id pattern
    chain_pattern = r'>>\s*([a-zA-Z0-9_-]+)\s*(?:-->|→)'
    matches = re.findall(chain_pattern, message)

    # Get the last prompt (after final -->) by splitting on chain operators
    # then extracting the prompt ID from the last segment
    parts = re.split(r'\s*(?:-->|→)\s*', message)
    if len(parts) > 1:
        last_part = parts[-1]
        last_match = re.match(r'>>\s*([a-zA-Z0-9_-]+)', last_part)
        if last_match:
            matches.append(last_match.group(1))

    return matches


def detect_inline_gates(message: str) -> list[str]:
    """
    Detect :: gate syntax in message.
    Returns list of gate criteria/IDs.

    Examples:
        :: 'must check security' -> ["must check security"]
        :: security-check -> ["security-check"]
    """
    # Match :: 'quoted criteria' or :: gate_id
    quoted_pattern = r'::\s*[\'"]([^\'"]+)[\'"]'
    id_pattern = r'::\s*([a-zA-Z][a-zA-Z0-9_-]*)\b'

    quoted = re.findall(quoted_pattern, message)
    ids = re.findall(id_pattern, message)

    return quoted + ids


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

    output_lines = []
    chain_state_inline = ""

    # Check for active chain state from previous prompt_engine calls
    if session_id:
        session_state = load_session_state(session_id)
        if session_state:
            chain_state_inline = format_chain_reminder(session_state, mode="inline")

    # Check for chain syntax FIRST (to avoid duplicate output with single prompt)
    chain_prompts = detect_chain_syntax(user_message)
    is_chain_invocation = chain_prompts and len(chain_prompts) > 1

    # Check for direct prompt invocation (>>prompt_id)
    # Skip if chain detected - chain output will show all prompts
    invoked_prompt = detect_prompt_invocation(user_message)
    if invoked_prompt and not is_chain_invocation:
        # Look up the specific prompt
        prompt_info = get_prompt_by_id(invoked_prompt, cache)

        if prompt_info:
            # Line 1: [MCP] >>id (category) | Step counter if active session
            category = prompt_info.get("category", "unknown")
            # Check for active session with step tracking
            active_session = load_session_state(session_id) if session_id else None
            if active_session and active_session.get("total_steps", 0) > 0:
                current = active_session.get("current_step", 1)
                total = active_session.get("total_steps", 0)
                header = f"[MCP] >>{invoked_prompt} ({category}) | Step {current}/{total}"
            else:
                chain_tag = f" [{prompt_info.get('chain_steps', 0)} steps]" if prompt_info.get("is_chain") else ""
                header = f"[MCP] >>{invoked_prompt} ({category}){chain_tag}"
            output_lines.append(header)

            # Line 2: Args OR chain continuation instruction
            args = prompt_info.get("arguments", [])
            if chain_state_inline and "\n" in chain_state_inline:
                # Show continuation instruction from chain state
                output_lines.append(chain_state_inline.split("\n")[1])
            elif args:
                if isinstance(args[0], dict):
                    # Show descriptions for first 5 args (token-efficient)
                    # Remaining args shown without description to keep output compact
                    formatted = []
                    for i, a in enumerate(args):
                        include_desc = i < 5  # First 5 get descriptions
                        formatted.append(format_arg_signature(a, include_desc))
                    arg_str = ", ".join(formatted)
                else:
                    arg_str = ", ".join(args)
                output_lines.append(f"  Args: {arg_str}")
        else:
            # Prompt not found - suggest similar
            output_lines.append(f"[MCP Prompt Not Found] >>{invoked_prompt}")
            matches = match_prompts_to_intent(invoked_prompt, cache, max_results=3)
            if matches:
                output_lines.append("Did you mean:")
                for pid, pinfo, score in matches:
                    output_lines.append(format_prompt_suggestion(pid, pinfo, score))

    # Output chain info (already detected above)
    if is_chain_invocation:
        step_args = get_chain_step_args(chain_prompts, cache)
        # Determine current step: 1 for new chains, or from session state
        current_step = 1
        if session_id:
            active_session = load_session_state(session_id)
            if active_session:
                current_step = active_session.get("current_step", 1)
        output_lines.extend(format_chain_step_args(step_args, current_step))

    # Check for inline gate syntax
    inline_gates = detect_inline_gates(user_message)
    if inline_gates:
        gates_str = " | ".join(g[:40] for g in inline_gates[:3])
        output_lines.append(f"[Gates] {gates_str}")
        output_lines.append("  Respond: GATE_REVIEW: PASS|FAIL - <reason>")

    # If no prompt invoked but chain state exists, show it standalone
    if chain_state_inline and not invoked_prompt and not chain_prompts:
        output_lines.append(chain_state_inline)

    # Check for explicit suggestion request
    elif detect_explicit_request(user_message) and not invoked_prompt:
        matches = match_prompts_to_intent(user_message, cache, max_results=3)

        if matches:
            output_lines.append("[MCP Suggestions]")
            for prompt_id, info, score in matches:
                output_lines.append(format_prompt_suggestion(prompt_id, info, score))
        else:
            chains = get_chains_only(cache)
            if chains:
                output_lines.append("[MCP Chains]")
                for prompt_id, info in list(chains.items())[:3]:
                    output_lines.append(format_prompt_suggestion(prompt_id, info))

    # Use JSON format for proper hook protocol
    # - systemMessage: shown to user
    # - additionalContext: injected to Claude
    if output_lines:
        output = "\n".join(output_lines)
        hook_response = {
            "systemMessage": output,  # Visible to user
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": output  # Context for Claude
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
