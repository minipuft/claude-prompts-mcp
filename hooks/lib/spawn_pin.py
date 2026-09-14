"""
Client-specific spawn-call pinning predicate for delegation enforcement.

The server floor already refuses a resume that lacks the worker's
`HANDOFF RESULT` trailer; that refusal is unconditional and does not depend
on this module. What the server cannot enforce is HOW a client's agent-spawn
tool was invoked — in particular, whether the spawn ran in the foreground.
Claude Code spawns subagents in the BACKGROUND by default (`run_in_background`
absent means background), and a backgrounded worker cannot supply the trailer
before the delegating agent continues. A client-side hook is the only place
that sees the actual tool call and can tighten on top of the server floor.

`spawn_call_is_pinned` is that check: for a known client it verifies the
spawn call's tool_input carries the exact value that pins it to the
foreground. It never loosens the server floor — a client hook may only
tighten, never substitute for the server's own refusal.

The per-client pin table is the single place a new client (or a new
Claude Code parameter) gets added. Codex and Gemini ports of this hook
symlink this file from `hooks/lib` and add one row each once their own
spawn tool exposes a foreground flag; until then they fall through to the
"unknown client" branch below, which reports pinned (nothing to tighten).
"""

import json

# client name -> (tool_input parameter name, value that pins the call to the foreground)
_SPAWN_PIN_TABLE: dict[str, tuple[str, object]] = {
    "claude-code": ("run_in_background", False),
}


def spawn_call_is_pinned(client: str, tool_input: dict) -> tuple[bool, str]:
    """Check whether a spawn-tool call is pinned to the foreground for `client`.

    Looks up `client` in the pin table. A client with no known pin (not yet
    in the table) has nothing to tighten, so it reports pinned with an empty
    reason — the server floor still applies regardless.

    For a known client, the call is pinned only when `tool_input` carries the
    required parameter set to EXACTLY the required value (`is`, not `==`, so
    `0`/`None`/`"false"` do not satisfy a `False` requirement). An absent
    parameter is not pinned — the harness default (background) is the
    original defect this check exists to catch.

    Returns `(True, "")` when pinned (or the client is unknown), else
    `(False, reason)` where `reason` names the parameter and the value to
    set it to.
    """
    pin = _SPAWN_PIN_TABLE.get(client)
    if pin is None:
        return True, ""

    param, required_value = pin
    if tool_input.get(param) is required_value:
        return True, ""

    return (
        False,
        f'set "{param}": {json.dumps(required_value)} on the spawn call to pin it to the foreground',
    )
