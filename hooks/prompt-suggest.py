#!/usr/bin/env python3
"""
UserPromptSubmit hook: Context injection for claude-prompts-mcp.

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
    """
    # Match: >>prompt_id --> >>prompt_id pattern
    chain_pattern = r'>>\s*([a-zA-Z0-9_-]+)\s*(?:-->|→)'
    matches = re.findall(chain_pattern, message)

    # Also get the last item (no --> after it)
    final_match = re.search(r'(?:-->|→)\s*>>\s*([a-zA-Z0-9_-]+)\s*$', message)
    if final_match:
        matches.append(final_match.group(1))

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


def format_arg_signature(arg: dict) -> str:
    """Format a single argument for display. Compact: name*:type"""
    name = arg.get("name", "unknown")
    arg_type = arg.get("type", "string")
    required = arg.get("required", False)
    req_marker = "*" if required else ""
    return f"{name}{req_marker}:{arg_type}"


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
    # UserPromptSubmit provides the user's prompt
    user_message = hook_input.get("prompt", "") or hook_input.get("message", "")
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

    # Check for direct prompt invocation (>>prompt_id)
    invoked_prompt = detect_prompt_invocation(user_message)
    if invoked_prompt:
        # Look up the specific prompt
        prompt_info = get_prompt_by_id(invoked_prompt, cache)

        if prompt_info:
            # Line 1: [MCP] >>id (category) | Chain state if active
            chain_tag = f" [{prompt_info.get('chain_steps', 0)} steps]" if prompt_info.get("is_chain") else ""
            header = f"[MCP] >>{invoked_prompt} ({prompt_info.get('category', 'unknown')}){chain_tag}"
            if chain_state_inline:
                header += f" | {chain_state_inline.split(chr(10))[0]}"  # First line of state
            output_lines.append(header)

            # Line 2: Args OR chain continuation instruction
            args = prompt_info.get("arguments", [])
            if chain_state_inline and "\n" in chain_state_inline:
                # Show continuation instruction from chain state
                output_lines.append(chain_state_inline.split("\n")[1])
            elif args:
                if isinstance(args[0], dict):
                    arg_str = ", ".join(format_arg_signature(a) for a in args)
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

    # Check for chain syntax
    chain_prompts = detect_chain_syntax(user_message)
    if chain_prompts and len(chain_prompts) > 1:
        # Build the full chain command string
        full_chain = ' --> '.join([f'>>{p}' for p in chain_prompts])

        output_lines.append(f"[MCP Chain] {len(chain_prompts)} steps")
        output_lines.append(f'  prompt_engine(command:"{full_chain}")')

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
