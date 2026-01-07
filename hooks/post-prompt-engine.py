#!/usr/bin/env python3
"""
PostToolUse hook: Track chain/gate state from prompt_engine responses.

Triggers after: mcp__claude-prompts-mcp__prompt_engine

Parses the response to:
1. Track current chain step
2. Detect pending gates
3. Inject reminders for gate reviews
"""

import json
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import (
    load_session_state,
    save_session_state,
    parse_prompt_engine_response,
    format_chain_reminder,
)


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        data = json.load(sys.stdin)
        # Debug: log what we receive
        debug_log = Path(__file__).parent / "debug_hook.log"
        with open(debug_log, "a") as f:
            f.write(f"\n=== PostToolUse Hook ===\n")
            f.write(f"tool_name: {data.get('tool_name', 'MISSING')}\n")
            f.write(f"session_id: {data.get('session_id', 'MISSING')}\n")
            f.write(f"keys: {list(data.keys())}\n")
        return data
    except json.JSONDecodeError:
        return {}


def main():
    hook_input = parse_hook_input()

    tool_name = hook_input.get("tool_name", "")
    session_id = hook_input.get("session_id", "")

    # Only process prompt_engine calls
    if "prompt_engine" not in tool_name:
        sys.exit(0)

    tool_response = hook_input.get("tool_response", {})
    tool_input = hook_input.get("tool_input", {})

    # Parse response for chain/gate state
    if isinstance(tool_response, dict):
        content = tool_response.get("content", "")
        # Handle array of content blocks
        if isinstance(content, list):
            content = " ".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in content
            )
    else:
        content = str(tool_response)

    state = parse_prompt_engine_response(content)

    if not state:
        sys.exit(0)

    # Extract chain_id from tool_input (higher priority than regex parsing)
    if isinstance(tool_input, dict):
        input_chain_id = tool_input.get("chain_id", "")
        if input_chain_id:
            state["chain_id"] = input_chain_id

    # Save state for this session
    save_session_state(session_id, state)

    # Output reminder if gate is pending
    output_lines = []

    if state.get("pending_gate"):
        criteria = state.get("gate_criteria", [])
        criteria_str = " | ".join(c[:40] for c in criteria[:3]) if criteria else ""
        output_lines.append(f"[Gate] {state['pending_gate']}")
        output_lines.append("  Respond: GATE_REVIEW: PASS|FAIL - <reason>")
        if criteria_str:
            output_lines.append(f"  Check: {criteria_str}")

    if state.get("current_step") > 0 and state.get("total_steps") > 0:
        step = state["current_step"]
        total = state["total_steps"]
        if step < total:
            output_lines.append(f"[Chain] Step {step}/{total} - call prompt_engine to continue")

    # Use JSON format for proper PostToolUse hook protocol
    # - additionalContext: injected to Claude for next steps
    if output_lines:
        output = "\n".join(output_lines)
        hook_response = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": output
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)
    else:
        sys.exit(0)  # No output needed


if __name__ == "__main__":
    main()
