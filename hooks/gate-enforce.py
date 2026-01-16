#!/usr/bin/env python3
"""
PreToolUse hook: Enforce gate verdicts on prompt_engine calls.

Blocks:
1. GATE_REVIEW: FAIL without retry attempt
2. Missing gate_verdict when resuming a chain that requires it

Allows Claude to self-correct before the tool executes.
"""

import json
import re
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import load_session_state


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def main():
    hook_input = parse_hook_input()

    tool_name = hook_input.get("tool_name", "")

    # Only process prompt_engine calls
    if "prompt_engine" not in tool_name:
        sys.exit(0)

    tool_input = hook_input.get("tool_input", {})

    # Extract parameters
    chain_id = tool_input.get("chain_id", "")
    gate_verdict = tool_input.get("gate_verdict", "")
    user_response = tool_input.get("user_response", "")

    # Check 1: FAIL verdict should trigger retry guidance
    if gate_verdict:
        # Parse verdict: "GATE_REVIEW: FAIL - reason" or "GATE_REVIEW: PASS - reason"
        fail_match = re.search(r'GATE_REVIEW:\s*FAIL', gate_verdict, re.IGNORECASE)
        if fail_match:
            # Extract the reason
            reason_match = re.search(r'FAIL\s*[-:]\s*(.+)', gate_verdict, re.IGNORECASE)
            reason = reason_match.group(1).strip() if reason_match else "unspecified"

            hook_response = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Gate failed: {reason}. "
                        "Review the gate criteria and retry with improvements. "
                        "Resubmit with GATE_REVIEW: PASS once criteria are met."
                    )
                }
            }
            print(json.dumps(hook_response))
            sys.exit(0)

    # Check 2: Resuming chain without required gate_verdict
    if chain_id and not gate_verdict:
        # Load session state to check if gate was pending
        session_id = hook_input.get("session_id", "")
        state = load_session_state(session_id) if session_id else None

        if state and state.get("pending_gate"):
            hook_response = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Chain resume requires gate verdict. "
                        f"Pending gate: {state['pending_gate']}. "
                        "Include gate_verdict: GATE_REVIEW: PASS|FAIL - <reason>"
                    )
                }
            }
            print(json.dumps(hook_response))
            sys.exit(0)

    # Check 3: Resuming chain without user_response
    if chain_id and not user_response:
        hook_response = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    "Chain resume requires user_response with your output from the previous step. "
                    "Include user_response parameter with the work completed."
                )
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)

    # All checks passed - allow tool execution
    sys.exit(0)


if __name__ == "__main__":
    main()
