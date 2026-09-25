"""
The measured Claude Code tool-hook payload, shared by every test that needs a
subagent twin.

Inside an Agent-launched subagent the payload keeps the PARENT's `session_id`
and `transcript_path` and adds `agent_id`/`agent_type` (measured on real
payloads, see `session_state.is_subagent_payload`). A parent/subagent twin built
here therefore differs in `agent_id` alone.
"""


def real_payload(
    session_id: str,
    tool_name: str,
    tool_input: dict,
    *,
    agent_id: str | None,
    event: str = "PreToolUse",
    tool_response: dict | None = None,
) -> dict:
    payload = {
        "session_id": session_id,
        "transcript_path": f"/home/u/.claude/projects/-proj/{session_id}.jsonl",
        "cwd": "/home/u/proj",
        "permission_mode": "bypassPermissions",
        "hook_event_name": event,
        "tool_name": tool_name,
        "tool_input": tool_input,
        "tool_use_id": "toolu_01",
    }
    if tool_response is not None:
        payload["tool_response"] = tool_response
    if agent_id:
        payload.update({"agent_id": agent_id, "agent_type": "general-purpose"})
    return payload
