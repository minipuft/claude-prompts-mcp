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
        "last_prompt_id": ""
    }

    import re

    # Detect step indicators: "Step 1 of 3", "step 2/4", "Progress 1/2", etc.
    step_match = re.search(r'(?:[Ss]tep|[Pp]rogress)\s+(\d+)\s*(?:of|/)\s*(\d+)', content)
    if step_match:
        state["current_step"] = int(step_match.group(1))
        state["total_steps"] = int(step_match.group(2))

    # Detect chain_id from resume token pattern
    chain_match = re.search(r'chain[-_]([a-zA-Z0-9_-]+)', content)
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

    # Only return state if we found chain/gate info
    if state["current_step"] > 0 or state["pending_gate"]:
        return state

    return None


def format_chain_reminder(state: ChainState) -> str:
    """Format a reminder about active chain state. Compact format."""
    lines = []

    if state["current_step"] > 0:
        lines.append(f"[Chain] Step {state['current_step']}/{state['total_steps']}")

    if state["pending_gate"]:
        criteria = state.get("gate_criteria", [])
        criteria_str = " | ".join(c[:40] for c in criteria[:3]) if criteria else ""
        lines.append(f"[Gate] {state['pending_gate']} - Respond: GATE_REVIEW: PASS|FAIL - <reason>")
        if criteria_str:
            lines.append(f"  Check: {criteria_str}")

    return "\n".join(lines)
