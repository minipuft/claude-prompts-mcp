"""
Session state manager for Claude Code hooks.
Tracks chain/gate state per conversation session.

Uses workspace resolution (MCP_WORKSPACE > CLAUDE_PLUGIN_ROOT > development fallback).
"""

import json
from pathlib import Path
from typing import TypedDict

from workspace import get_cache_dir


class ChainState(TypedDict):
    chain_id: str
    current_step: int
    total_steps: int
    pending_gate: str | None
    gate_criteria: list[str]
    last_prompt_id: str
    # Shell verification (Ralph mode)
    pending_shell_verify: str | None  # The command being verified
    shell_verify_attempts: int        # Current attempt count


def _get_session_state_dir() -> Path:
    """
    Get session state directory using workspace resolution.

    Priority:
      1. MCP_WORKSPACE/server/cache/sessions
      2. CLAUDE_PLUGIN_ROOT/server/cache/sessions
      3. Development fallback (relative to this script)
    """
    dev_fallback = Path(__file__).parent.parent.parent / "server" / "cache"
    cache_dir = get_cache_dir(dev_fallback)
    return cache_dir / "sessions"


SESSION_STATE_DIR = _get_session_state_dir()


def get_session_state_path(session_id: str) -> Path:
    """Get path to session state file."""
    SESSION_STATE_DIR.mkdir(parents=True, exist_ok=True)
    return SESSION_STATE_DIR / f"{session_id}.json"


def load_session_state(session_id: str) -> ChainState | None:
    """Load chain state for a session."""
    state_path = get_session_state_path(session_id)
    if not state_path.exists():
        return None

    try:
        with open(state_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def save_session_state(session_id: str, state: ChainState) -> None:
    """Save chain state for a session."""
    state_path = get_session_state_path(session_id)
    try:
        with open(state_path, "w") as f:
            json.dump(state, f, indent=2)
    except IOError:
        pass


def clear_session_state(session_id: str) -> None:
    """Clear chain state when chain completes."""
    state_path = get_session_state_path(session_id)
    if state_path.exists():
        state_path.unlink()


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
        "shell_verify_attempts": 0
    }

    import re

    # Detect step indicators: "Step 1 of 3", "step 2/4", "Progress 1/2", etc.
    step_match = re.search(r'(?:[Ss]tep|[Pp]rogress)\s+(\d+)\s*(?:of|/)\s*(\d+)', content)
    if step_match:
        state["current_step"] = int(step_match.group(1))
        state["total_steps"] = int(step_match.group(2))

    # Detect chain_id from resume token pattern (capture full ID including prefix)
    chain_match = re.search(r'(chain[-_][a-zA-Z0-9_#-]+)', content)
    if chain_match:
        state["chain_id"] = chain_match.group(1)

    # Detect inline gates section
    if "## Inline Gates" in content or "Gate" in content:
        # Extract gate names
        gate_names = re.findall(r'###\s*([A-Za-z][A-Za-z0-9 _-]+)\n', content)
        if gate_names:
            state["pending_gate"] = gate_names[0].strip()

        # Extract gate criteria
        criteria = re.findall(r'[-•]\s*(.+?)(?:\n|$)', content)
        state["gate_criteria"] = [c.strip() for c in criteria[:5] if c.strip()]

    # Detect shell verification: "Shell verification: npm test"
    verify_match = re.search(r'Shell verification:\s*(.+?)(?:\n|$)', content)
    if verify_match:
        state["pending_shell_verify"] = verify_match.group(1).strip()

    # Detect attempt count: "Attempt 2/5" or "(Attempt 2/5)"
    attempt_match = re.search(r'Attempt\s+(\d+)/(\d+)', content)
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
        mode: "full" for PreCompact (multi-line), "inline" for prompt-suggest (two-line)
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
            line2 = "→ GATE_REVIEW: PASS|FAIL - <reason>"
        elif step > 0 and step < total:
            line2 = f"→ prompt_engine(chain_id:\"{chain_id}\") to continue"
        else:
            line2 = ""

        return f"{line1}\n{line2}".strip() if line1 else ""

    # Full format for PreCompact (preserves context across compaction)
    lines = []
    if step > 0:
        if chain_id:
            lines.append(f"[Chain] {chain_id} - Step {step}/{total}")
        else:
            lines.append(f"[Chain] Step {step}/{total}")

    if gate:
        lines.append(f"[Gate] {gate} - Respond: GATE_REVIEW: PASS|FAIL - <reason>")

    if verify_cmd:
        lines.append(f"[Verify] `{verify_cmd}` - Attempt {verify_attempts}/5")
        lines.append("Run implementation, then prompt_engine validates with shell command")

    return "\n".join(lines)
