"""
Session state manager for Claude Code hooks.
Tracks chain/gate state per conversation session via SQLite (hooks-state.db).
"""

import re
from typing import Any, TypedDict, cast

from hook_state_store import (
    TABLE_CHAIN_SESSION_STATE,
    cleanup_stale_rows,
    delete_state,
    load_state,
    save_state,
)


class ChainState(TypedDict, total=False):
    chain_id: str
    current_step: int
    total_steps: int
    pending_gate: str | None
    gate_criteria: list[str]
    last_prompt_id: str
    # Shell verification (Ralph mode)
    pending_shell_verify: str | None
    shell_verify_attempts: int
    # Delegation state (set by post-prompt-engine hook)
    pending_delegation: bool
    delegation_agent_type: str
    delegation_model_hint: str


def load_session_state(session_id: str) -> ChainState | None:
    """Load chain state for a session from SQLite."""
    data = load_state(TABLE_CHAIN_SESSION_STATE, session_id)
    return cast(ChainState, data) if data is not None else None


def save_session_state(session_id: str, state: ChainState) -> None:
    """Save chain state for a session to SQLite."""
    save_state(TABLE_CHAIN_SESSION_STATE, session_id, cast(dict[str, Any], state))


def clear_session_state(session_id: str) -> None:
    """Clear chain state when chain completes."""
    delete_state(TABLE_CHAIN_SESSION_STATE, session_id)


def cleanup_old_sessions(max_age_hours: int = 24) -> int:
    """Delete session rows older than max_age. Returns count deleted."""
    return cleanup_stale_rows(max_age_hours)


def clear_delegation_state(session_id: str) -> None:
    """Clear delegation-specific fields from session state.

    Sets pending_delegation to False (not removed) so callers can check
    state["pending_delegation"] without KeyError.
    """
    state = load_session_state(session_id)
    if not state:
        return
    state["pending_delegation"] = False
    state.pop("delegation_agent_type", None)
    state.pop("delegation_model_hint", None)
    save_session_state(session_id, state)


def parse_prompt_engine_response(response: str | dict) -> ChainState | None:
    """
    Parse prompt_engine response to extract chain/gate state.

    The response typically contains markers like:
    - "Step X of Y"
    - "## Inline Gates" section
    - Gate criteria in the rendered prompt
    """
    if isinstance(response, dict):
        # Handle structured response
        content = response.get("content", "") or str(response)
    else:
        content = str(response)

    state: ChainState = {
        "chain_id": "",
        "current_step": 0,
        "total_steps": 0,
        "pending_gate": None,
        "gate_criteria": [],
        "last_prompt_id": "",
        "pending_shell_verify": None,
        "shell_verify_attempts": 0,
    }

    # Detect step indicators: "Step 1 of 3", "step 2/4", "Progress 1/2",
    # "Chain complete (2/2)", "complete (2/2)", etc.
    step_match = re.search(r"(?:[Ss]tep|[Pp]rogress|[Cc]omplete)\s*\(?(\d+)\s*(?:of|/)\s*(\d+)", content)
    if step_match:
        state["current_step"] = int(step_match.group(1))
        state["total_steps"] = int(step_match.group(2))

    # Detect chain_id from resume token pattern: "chain-<name>#<run>"
    # Must start with "chain-" (hyphen) to avoid matching literal "chain_id" parameter names
    chain_match = re.search(r"(chain-[a-zA-Z0-9_#-]+)", content)
    if chain_match:
        state["chain_id"] = chain_match.group(1)

    # Detect gate/structural review required (from response-assembler.ts)
    # Variants:
    #   **Review Required**                          (current server format)
    #   **Gate Review Required** (attempt X/Y)       (legacy)
    #   **Structural Review Required** (attempt X/Y) (legacy)
    #   **Structural + Gate Review Required**        (legacy)
    # Followed by: **Gates**: gate-id-1, gate-id-2
    gate_review_match = re.search(r"\*\*(?:Structural \+ Gate |Structural |Gate )?Review Required\*\*", content)
    gates_list_match = re.search(r"\*\*Gates\*\*:\s*(.+?)(?:\n|$)", content)

    if gate_review_match or gates_list_match:
        # Extract gate IDs from **Gates**: id1, id2
        if gates_list_match:
            gates_str = gates_list_match.group(1).strip()
            state["pending_gate"] = gates_str  # Store comma-separated gate IDs

        # Fallback: extract gate names from GATE_VERDICTS template in CTA
        if not state["pending_gate"]:
            verdicts_match = re.search(r"GATE_VERDICTS:\s*\n((?:\[\d+\].*\n?)+)", content)
            if verdicts_match:
                gate_labels = re.findall(r"\[\d+\]\s*(?:PASS|FAIL)\s*-\s*([^:]+)", verdicts_match.group(1))
                if gate_labels:
                    state["pending_gate"] = ", ".join(g.strip() for g in gate_labels)

        # Extract attempt info: (attempt X/Y)
        attempt_match = re.search(r"\(attempt\s+(\d+)/(\d+)\)", content)
        if attempt_match:
            # Store attempt count in shell_verify_attempts for now (reusing field)
            state["shell_verify_attempts"] = int(attempt_match.group(1))

    # Fallback: Detect legacy inline gates section
    elif "## Inline Gates" in content:
        # Extract gate names from legacy format
        gate_names = re.findall(r"###\s*([A-Za-z][A-Za-z0-9 _-]+)\n", content)
        if gate_names:
            state["pending_gate"] = gate_names[0].strip()

        # Extract gate criteria
        criteria = re.findall(r"[-•]\s*(.+?)(?:\n|$)", content)
        state["gate_criteria"] = [c.strip() for c in criteria[:5] if c.strip()]

    # Detect shell verification: "Shell verification: npm test"
    verify_match = re.search(r"Shell verification:\s*(.+?)(?:\n|$)", content)
    if verify_match:
        state["pending_shell_verify"] = verify_match.group(1).strip()

    # Detect attempt count: "Attempt 2/5" or "(Attempt 2/5)"
    attempt_match = re.search(r"Attempt\s+(\d+)/(\d+)", content)
    if attempt_match:
        state["shell_verify_attempts"] = int(attempt_match.group(1))

    # Only return state if we found chain/gate/verify info
    if state["current_step"] > 0 or state["pending_gate"] or state["pending_shell_verify"]:
        return state

    return None


def format_chain_reminder(state: ChainState, mode: str = "full") -> str:
    """Format a reminder about active chain state.

    Args:
        state: Chain state to format
        mode: "full" for compact-recovery (multi-line), "inline" for prompt-suggest (two-line)
    """
    chain_id = state.get("chain_id", "")
    step = state["current_step"]
    total = state["total_steps"]
    gate = state.get("pending_gate")
    verify_cmd = state.get("pending_shell_verify")
    verify_attempts = state.get("shell_verify_attempts", 1)

    if mode == "inline":
        # Two-line hybrid: Line 1 = status, Line 2 = action
        parts = []
        if step > 0:
            chain_label = chain_id if chain_id else "active"
            parts.append(f"[{chain_label}] {step}/{total}")
        if gate:
            parts.append(f"Gate: {gate}")
        if verify_cmd:
            parts.append(f"Verify: {verify_attempts}/5")
        line1 = " | ".join(parts) if parts else ""

        # Line 2: Clear continuation instruction
        if verify_cmd:
            line2 = f"→ Shell verify: `{verify_cmd}` will validate"
        elif gate:
            line2 = '→ gate_verdict="GATE_REVIEW: PASS|FAIL - <reason>"'
        elif step > 0 and step < total:
            line2 = f'→ prompt_engine(chain_id:"{chain_id}") to continue'
        else:
            line2 = ""

        return f"{line1}\n{line2}".strip() if line1 else ""

    # Full format for compact-recovery SessionStart hook (preserves context across compaction)
    lines = []
    if step > 0:
        if chain_id:
            lines.append(f"[Chain] {chain_id} - Step {step}/{total}")
        else:
            lines.append(f"[Chain] Step {step}/{total}")

    if gate:
        lines.append(f'[Gate] {gate} - Submit: gate_verdict="GATE_REVIEW: PASS|FAIL - <reason>"')

    if verify_cmd:
        lines.append(f"[Verify] `{verify_cmd}` - Attempt {verify_attempts}/5")
        lines.append("Run implementation, then prompt_engine validates with shell command")

    return "\n".join(lines)
