#!/usr/bin/env python3
"""
PostToolUse hook: Track chain/gate state from prompt_engine responses.

Triggers after: mcp__claude-prompts__prompt_engine

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
    save_session_state,
    parse_prompt_engine_response,
)


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
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

    # Check if gate review is pending - guide Claude to submit verdict
    chain_id = state.get("chain_id", "")
    pending_gate = state.get("pending_gate")
    step = state.get("current_step", 0)
    total = state.get("total_steps", 0)

    if pending_gate:
        # CLAUDE DIRECTIVE ONLY: Guide Claude to submit verdict (token-efficient)
        # User sees server's "Gate Review Required" message in tool response
        directive = f'<GATE-REVIEW>chain_id="{chain_id}" gates="{pending_gate}" → Submit gate_verdict</GATE-REVIEW>'

        hook_response = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": directive
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)

    # Non-blocking: Just guide Claude to continue chain
    if step > 0 and total > 0 and step < total:
        hook_response = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f'Continue chain: prompt_engine(chain_id="{chain_id}")'
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)

    sys.exit(0)  # No output needed


if __name__ == "__main__":
    main()
