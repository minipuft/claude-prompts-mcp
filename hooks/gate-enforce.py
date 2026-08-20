#!/usr/bin/env python3
"""
PreToolUse hook: Enforce gate verdicts on prompt_engine calls.

Blocks:
1. GATE_REVIEW: FAIL without retry attempt
2. Chain resumes carrying NO pending-gate resolution parameter while a gate is pending.
   The accepted resolution verbs (gate_verdict, gate_action, cancel, ...) are generated
   from the server contract into lib/_generated/resolution_verbs.py — never hardcoded
   here, so the hook cannot deny an exit the server supports.

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


def load_resolution_params() -> frozenset[str] | None:
    """Load the pending-gate resolution verbs generated from the server contract.

    The set is emitted by server/scripts/generate-contracts.ts from parameters flagged
    `resolvesPendingGate` in tooling/contracts/prompt-engine.json, so this hook accepts
    exactly the moves the server accepts. A hardcoded model here rotted twice — it denied
    `gate_action: "abort"` and `cancel: true`, trapping sessions behind their own pending
    gate (2026-08-20).

    Returns None when the artifact is missing or unreadable: the caller fails open,
    because the server enforces gates authoritatively and a broken hook must never
    re-create the trap.
    """
    try:
        from _generated.resolution_verbs import PENDING_GATE_RESOLUTION_PARAMS

        return PENDING_GATE_RESOLUTION_PARAMS
    except Exception:
        return None


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

    # Check 1: FAIL verdict should trigger retry guidance.
    # gate_verdict has two schema shapes: the structured object
    # {overall, rationale, per_gate[]} (preferred) and the legacy
    # "GATE_REVIEW: FAIL - reason" string.
    if isinstance(gate_verdict, dict):
        if gate_verdict.get("overall", "").upper() == "FAIL":
            reason = str(gate_verdict.get("rationale", "unspecified"))[:50]

            hook_response = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Gate FAIL: {reason}. Review the failing criteria, "
                        "address the gaps in your output, then resubmit your verdict."
                    ),
                }
            }
            print(json.dumps(hook_response))
            sys.exit(0)
    elif gate_verdict:
        # Parse verdict: "GATE_REVIEW: FAIL - reason" or "GATE_REVIEW: PASS - reason"
        fail_match = re.search(r"GATE_REVIEW:\s*FAIL", gate_verdict, re.IGNORECASE)
        if fail_match:
            # Extract the reason
            reason_match = re.search(r"FAIL\s*[-:]\s*(.+)", gate_verdict, re.IGNORECASE)
            reason = reason_match.group(1).strip()[:50] if reason_match else "unspecified"

            hook_response = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Gate FAIL: {reason}. Review the failing criteria, "
                        "address the gaps in your output, then resubmit your verdict."
                    ),
                }
            }
            print(json.dumps(hook_response))
            sys.exit(0)

    # Check 2: Resuming chain without any resolution parameter while a gate is pending.
    # Any contract-flagged resolution verb (gate_verdict, gate_action, cancel, ...) passes:
    # they are all server-supported responses to a pending gate, and denying them is how a
    # gate blocks its own abort.
    if chain_id:
        resolution_params = load_resolution_params()
        if resolution_params is None:
            # Fail open: without the generated verb set this hook cannot tell a valid
            # resolution from a bare resume — the server still enforces the gate.
            sys.exit(0)

        if not any(tool_input.get(name) for name in resolution_params):
            # Load session state to check if gate was pending
            session_id = hook_input.get("session_id", "")
            state = load_session_state(session_id) if session_id else None

            if state and state.get("pending_gate"):
                gate = state["pending_gate"]
                exits = ", ".join(sorted(resolution_params - {"gate_verdict"}))
                hook_response = {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            f"Gate review required: {gate}. Review your output against the "
                            "gate criteria and submit gate_verdict. If the gate cannot be "
                            f"satisfied, these parameters also resolve it: {exits}."
                        ),
                    }
                }
                print(json.dumps(hook_response))
                sys.exit(0)

    # All checks passed - allow tool execution
    sys.exit(0)


if __name__ == "__main__":
    main()
