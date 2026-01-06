#!/usr/bin/env python3
"""
AfterTool hook: Track chain/gate state from prompt_engine responses.

Triggers after: prompt_engine tool calls

Parses the response to:
1. Track current chain step
2. Detect pending gates
3. Inject reminders for gate reviews

Note: This is a Gemini CLI adaptation of the Claude Code hook.
Uses shared lib from parent hooks/ directory.
"""

import json
import sys
from pathlib import Path

# Add shared hooks lib to path (from parent hooks/ directory)
SCRIPT_DIR = Path(__file__).parent
EXTENSION_ROOT = SCRIPT_DIR.parent.parent
SHARED_LIB = EXTENSION_ROOT / "hooks" / "lib"
sys.path.insert(0, str(SHARED_LIB))

from session_state import (
    load_session_state,
    save_session_state,
    parse_prompt_engine_response,
    format_chain_reminder,
)


def parse_hook_input() -> dict:
    """Parse JSON input from Gemini CLI hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def main():
    hook_input = parse_hook_input()

    # Gemini CLI may use different field names
    tool_name = (
        hook_input.get("tool_name", "") or
        hook_input.get("toolName", "") or
        hook_input.get("name", "")
    )
    session_id = (
        hook_input.get("session_id", "") or
        hook_input.get("sessionId", "")
    )

    # Only process prompt_engine calls
    if "prompt_engine" not in tool_name:
        sys.exit(0)

    tool_response = (
        hook_input.get("tool_response", {}) or
        hook_input.get("toolResponse", {}) or
        hook_input.get("result", {})
    )

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

    # Output in Gemini CLI hook format
    if output_lines:
        output = "\n".join(output_lines)
        hook_response = {
            "hookSpecificOutput": {
                "hookEventName": "AfterTool",
                "additionalContext": output
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
