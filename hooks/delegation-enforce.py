#!/usr/bin/env python3
"""
PreToolUse hook: Enforce delegation when ==> operator requires sub-agent execution.

Fires on Edit|Write|Bash|Task tool calls.

Behavior:
- Task while delegation pending → clear state and allow (agent delegating correctly)
- Read-only tools while delegation pending → allow (research before delegation is fine)
- Action tools (Edit/Write/Bash) while delegation pending → DENY (hard block)
- No delegation pending → no-op
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import clear_delegation_state, load_session_state

# Tools allowed during pending delegation (read-only + delegation itself)
ALLOW_LIST = {"Task", "Read", "Glob", "Grep", "WebSearch", "WebFetch", "ListMcpResourcesTool"}


def log(msg: str) -> None:
    """Print to stderr for --debug visibility."""
    print(f"[delegation-enforce] {msg}", file=sys.stderr)


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

    tool_name = hook_input.get("tool_name", "")

    state = load_session_state(session_id)
    if not state or not state.get("pending_delegation"):
        sys.exit(0)

    agent_type = state.get("delegation_agent_type", "chain-executor")
    model_hint = state.get("delegation_model_hint")

    # Task tool call = agent is delegating correctly — clear state and allow
    if tool_name == "Task":
        log(f"Task tool invoked, clearing delegation state (agent_type={agent_type})")
        clear_delegation_state(session_id)
        sys.exit(0)

    # Read-only tools: allow silently (research before delegation is fine)
    if tool_name in ALLOW_LIST:
        sys.exit(0)

    # Action tools (Edit/Write/Bash) while delegation pending — hard block
    model_part = f' model="{model_hint}"' if model_hint else ""
    log(f"delegation pending, BLOCKING {tool_name} (agent_type={agent_type})")

    response = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Delegation pending: use Task tool "
                f'(subagent_type="{agent_type}"{model_part}) '
                f"before making direct edits. "
                f"The ==> operator requires sub-agent execution."
            ),
        }
    }
    print(json.dumps(response))
    sys.exit(0)


if __name__ == "__main__":
    main()
