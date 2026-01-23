#!/usr/bin/env python3
"""
PreCompact hook: Remind Claude of active chain state before context compaction.

Triggers before: Context compaction (manual /compact or auto)

Reads existing session state and injects a reminder so Claude knows how to
resume the chain after compaction completes.
"""

import json
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import load_session_state, format_chain_reminder


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def main():
    hook_input = parse_hook_input()
    session_id = hook_input.get("session_id", "")

    if not session_id:
        sys.exit(0)

    # Load existing chain state (written by post-prompt-engine.py)
    state = load_session_state(session_id)

    if not state:
        sys.exit(0)

    # Only inject if there's active chain/gate/verify state
    has_chain = state.get("current_step", 0) > 0
    has_gate = state.get("pending_gate") is not None
    has_verify = state.get("pending_shell_verify") is not None

    if not has_chain and not has_gate and not has_verify:
        sys.exit(0)

    # Format reminder using existing function
    reminder = format_chain_reminder(state)

    # Output for Claude to remember after compaction
    hook_response = {
        "hookSpecificOutput": {
            "hookEventName": "PreCompact",
            "additionalContext": f"## Chain State (preserve across compaction)\n{reminder}"
        }
    }
    print(json.dumps(hook_response))
    sys.exit(0)


if __name__ == "__main__":
    main()
