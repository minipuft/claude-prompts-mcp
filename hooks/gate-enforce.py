#!/usr/bin/env python3
"""
PreToolUse hook: Validate verdict parameter shape and pending-run resolution.

Blocks:
1. Non-object gate_verdict or malformed overall/rationale fields.
2. Chain resumes carrying NO pending-run resolution parameter while the run is HOLDING.
   Two holds reach this check: an ordinary gate review, and the reserved
   `__unknown_interrupt__` synthetic review a blocking unknown raises under
   `budget.pauseOnBlocking`. They are denied with different prose because they accept
   different exits — no gate_verdict clears an interrupt — but by ONE rule.
   The accepted resolution parameters (gate_verdict, gate_action) are generated
   from the server contract into lib/_generated/resolution_verbs.py — never hardcoded
   here, so the hook cannot deny an exit the server supports.
3. Workflow mutations on a run this conversation holds paused (owned, exact identity): denied
   with resume-or-abort. Controls (gate_action pause/resume/abort by name, handoff, claim_token)
   always reach the server, which decides them; retry/skip/accept_alternative are mutations.

Allows Claude to self-correct before the tool executes.
"""

import json
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import (
    UNKNOWN_INTERRUPT_LABEL,
    ChainState,
    exact_run_identity,
    holds_pause_exemption,
    interrupt_exits,
    is_subagent_payload,
    load_session_state,
)

# The gate_action values that control a run rather than work it (contract enum, prompt-engine.json).
RUN_CONTROLS = frozenset({"pause", "resume", "abort"})


def is_run_control(tool_input: dict) -> bool:
    """A pause/resume/abort or custody call: the server decides it, so no hold may block it."""
    claim = tool_input.get("claim_token")
    return tool_input.get("gate_action") in RUN_CONTROLS or tool_input.get("handoff") is True or isinstance(claim, str)


def paused_instruction(state: ChainState | None, chain_id: str) -> str | None:
    """The resume-or-abort instruction when this conversation owns an exact pause of `chain_id`."""
    identity = exact_run_identity(state.get("run_identity")) if state else None
    if not state or identity is None or identity["chain_id"] != chain_id or not holds_pause_exemption(state, identity):
        return None
    step, total = state.get("current_step", 0), state.get("total_steps", 0)
    at = f" at step {step} of {total}" if step and total else ""
    return (
        f"Workflow paused for conversation{at}: `{chain_id}`. This call would change the run, so it "
        "was not sent. Discuss with the user; when ready, resume explicitly with "
        f'prompt_engine(chain_id:"{chain_id}", gate_action:"resume") and follow the action it returns '
        'in a separate call, or end the run with gate_action:"abort".'
    )


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def load_resolution_params() -> frozenset[str] | None:
    """Load the pending-run resolution verbs generated from the server contract.

    The set is emitted by server/scripts/generate-contracts.ts from parameters flagged
    `resolvesPendingRun` in tooling/contracts/prompt-engine.json, so this hook accepts
    exactly the moves the server accepts. A hardcoded model here rotted twice — it denied
    `gate_action: "abort"`, trapping sessions behind their own pending gate.

    Returns None when the artifact is missing or unreadable: the caller fails open,
    because the server enforces gates authoritatively and a broken hook must never
    re-create the trap.
    """
    try:
        from _generated.resolution_verbs import PENDING_RUN_RESOLUTION_PARAMS

        return PENDING_RUN_RESOLUTION_PARAMS
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
    gate_verdict = tool_input.get("gate_verdict")

    # Shape admission only: an honest FAIL must reach the server's authoritative judgment.
    if "gate_verdict" in tool_input and (
        not isinstance(gate_verdict, dict)
        or gate_verdict.get("overall") not in ("PASS", "FAIL")
        or not isinstance(gate_verdict.get("rationale"), str)
        or not gate_verdict["rationale"].strip()
    ):
        hook_response = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    'gate_verdict requires an object with overall "PASS" or "FAIL" and a '
                    "non-empty rationale. Follow the returned server template for per_gate, "
                    "reminders and semantic evaluation."
                ),
            }
        }
        print(json.dumps(hook_response))
        sys.exit(0)

    # Check 2 reads the pending gate by session_id, and a subagent's call arrives under its
    # PARENT's: a worker resuming its own run is not held by the parent's review. The server
    # still gates the worker's run. Shape admission reads only the caller's own verdict, so it
    # applies to a worker as it does to its parent.
    if is_subagent_payload(hook_input):
        sys.exit(0)

    # Check 2: Resuming chain without any resolution parameter while a gate is pending.
    # Any contract-flagged resolution verb (gate_verdict, gate_action) passes:
    # they are all server-supported responses to a pending gate, and denying them is how a
    # gate blocks its own abort.
    session_id = hook_input.get("session_id", "")
    state = load_session_state(session_id) if chain_id and session_id else None
    paused = None if is_run_control(tool_input) else paused_instruction(state, chain_id)
    if paused:
        # Check 3 precedes check 2: while paused, every hold waits behind the explicit resume.
        output = {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": paused}
        print(json.dumps({"hookSpecificOutput": output}))
        sys.exit(0)

    # Check 2 admits pause/resume/abort through the generated verb set; handoff is custody, not a verb.
    if chain_id and tool_input.get("handoff") is not True:
        resolution_params = load_resolution_params()
        if resolution_params is None:
            # Fail open: without the generated verb set this hook cannot tell a valid
            # resolution from a bare resume — the server still enforces the gate.
            sys.exit(0)

        if not any(tool_input.get(name) for name in resolution_params):
            if state and state.get("pending_gate"):
                gate = state["pending_gate"]
                if gate == UNKNOWN_INTERRUPT_LABEL:
                    # A blocking-unknown interrupt is NOT a gate review: the run issued no step
                    # and no gate_verdict clears it, so a message telling the caller to submit
                    # one would name an exit the server refuses. The verbs come from the run's
                    # own interrupt section (session_state captures what the server printed).
                    reason = (
                        f"Chain paused: {gate}. The run issued no step and no gate_verdict "
                        "clears this hold. Resolve it with one of: "
                        f"{', '.join(interrupt_exits(state))}."
                    )
                else:
                    exits = ", ".join(sorted(resolution_params - {"gate_verdict"}))
                    reason = (
                        f"Gate review required: {gate}. Review your output against the "
                        "gate criteria and submit gate_verdict. If the gate cannot be "
                        f"satisfied, these parameters also resolve it: {exits}."
                    )
                hook_response = {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                }
                print(json.dumps(hook_response))
                sys.exit(0)

    # All checks passed - allow tool execution
    sys.exit(0)


if __name__ == "__main__":
    main()
