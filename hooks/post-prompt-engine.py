#!/usr/bin/env python3
"""
PostToolUse hook: Track chain/gate state from prompt_engine responses.

Triggers after: mcp__claude-prompts__prompt_engine

Parses the response to:
1. Track current chain step
2. Detect pending gates
3. Inject reminders for gate reviews
"""

import json
import re
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import (
    clear_session_state,
    is_subagent_payload,
    load_session_state,
    parse_prompt_engine_response,
    save_session_state,
)

COMPLETION_MARKER = re.compile(r"(?m)^(?:[✓✅][ \t]*)?(?:Chain complete\b|Execution complete\.)")


def _matches_tracked_run(session_id: str, request_id: str, response_id: str, *, require_named: bool = False) -> bool:
    """Bind a terminal response to this conversation's tracked run before clearing it."""
    tracked = load_session_state(session_id) if session_id else None
    if tracked is None:
        return False
    tracked_id = tracked.get("chain_id", "")
    if not tracked_id:
        # A gate-only prompt can have no chain id; its explicit completion still resolves it.
        return not require_named and not response_id
    if request_id and request_id != tracked_id:
        return False
    if response_id and response_id != tracked_id:
        return False
    return request_id == tracked_id or response_id == tracked_id


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def main():
    hook_input = parse_hook_input()

    # A subagent's call arrives under its PARENT's session_id: every save or clear
    # below would land on the parent's chain row, so a worker running its own
    # chain writes nothing here and prints nothing.
    if is_subagent_payload(hook_input):
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    session_id = hook_input.get("session_id", "")

    # Only process prompt_engine calls
    if "prompt_engine" not in tool_name:
        sys.exit(0)

    tool_response = hook_input.get("tool_response", {})
    tool_input = hook_input.get("tool_input", {})

    # A rejected tool response cannot change the previously tracked run, even when its
    # explanation quotes a completion marker or an attempted resolution parameter.
    if isinstance(tool_response, dict) and tool_response.get("isError") is True:
        sys.exit(0)
    succeeded = isinstance(tool_response, dict) and tool_response.get("isError") is False
    request_id = tool_input.get("chain_id", "") if isinstance(tool_input, dict) else ""
    request_id = request_id if isinstance(request_id, str) else ""

    # Parse response for chain/gate state
    if isinstance(tool_response, dict):
        content = tool_response.get("content", "")
        # Handle array of content blocks
        if isinstance(content, list):
            content = " ".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in content)
    else:
        content = str(tool_response)

    state = parse_prompt_engine_response(content)

    if not state:
        abort_match = re.match(r"^🛑 \*\*Chain Cancelled\*\*: `([^`\n]+)`(?:\n|$)", content)
        abort_succeeded = (
            succeeded
            and isinstance(tool_input, dict)
            and tool_input.get("gate_action") == "abort"
            and bool(request_id)
            and abort_match is not None
            and abort_match.group(1) == request_id
            and _matches_tracked_run(session_id, request_id, request_id, require_named=True)
        )
        completed = bool(COMPLETION_MARKER.search(content))
        verdict_completed = (
            succeeded
            and isinstance(tool_input, dict)
            and bool(tool_input.get("gate_verdict"))
            and completed
            and _matches_tracked_run(session_id, request_id, "")
        )
        if abort_succeeded or verdict_completed:
            clear_session_state(session_id)
        sys.exit(0)

    response_id = state.get("chain_id", "")

    # Terminal boundary: an explicit completion marker with nothing pending
    # means the run is over — clear the row instead of saving a snapshot that
    # only the 24h sweep would ever remove. The step numbers alone cannot
    # decide this: "Step 2 of 2" (final step delivered, still in flight) and
    # "Chain complete (2/2)" both parse to 2/2, so the marker text is the
    # discriminator.
    run_is_complete = bool(COMPLETION_MARKER.search(content))
    if run_is_complete and not state.get("pending_gate") and not state.get("pending_shell_verify"):
        if succeeded and _matches_tracked_run(session_id, request_id, response_id):
            clear_session_state(session_id)
        sys.exit(0)

    # Extract chain_id from tool_input (higher priority than regex parsing)
    if request_id:
        state["chain_id"] = request_id

    # Save state for this session
    save_session_state(session_id, state)

    # Detect delegation: RESPONSE (not command prose) contains a delegation CTA
    # and the chain has remaining steps. The server only renders these markers
    # (strategy.ts formatToolCall/getHandoffFooterInstruction) when the next step
    # is actually delegated — a command that merely mentions "==>" in prose must
    # not arm enforcement.
    chain_id = state.get("chain_id", "")
    pending_gate = state.get("pending_gate")
    step = state.get("current_step", 0)
    total = state.get("total_steps", 0)

    subagent_match = re.search(r'subagent_type:\s*"([^"]+)"', content)
    has_delegation_cta = bool(subagent_match) or "Handoff via Task tool" in content

    if has_delegation_cta and step > 0 and step < total and not pending_gate:
        state["pending_delegation"] = True
        # Fallback mirrors CLAUDE_CODE_DEFAULT_AGENT_TYPE (server/src/engine/execution/delegation/
        # strategy.ts). The Claude strategy always emits subagent_type, so this only fires for a
        # CTA shape the regex above does not know.
        state["delegation_agent_type"] = subagent_match.group(1) if subagent_match else "general-purpose"
        # The server pins a detached step (`await: run`) to the background and a blocking one to
        # the foreground; delegation-enforce reads which, off the handoff the server rendered.
        state["delegation_mode"] = "detached" if "run_in_background: true" in content else "blocking"
        save_session_state(session_id, state)

    if pending_gate:
        # CLAUDE DIRECTIVE ONLY: Guide Claude to submit verdict (token-efficient)
        # User sees server's "Gate Review Required" message in tool response
        directive = f'<GATE-REVIEW>chain_id="{chain_id}" gates="{pending_gate}" → Submit gate_verdict</GATE-REVIEW>'

        hook_response = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": directive}}
        print(json.dumps(hook_response))
        sys.exit(0)

    # Imperative directive: force Claude to continue chain
    if step > 0 and total > 0 and step < total:
        directive = (
            f"<CALL-TOOL>\n"
            f'prompt_engine | chain_id:"{chain_id}"\n'
            f"REQUIRED: Continue active chain (step {step}/{total}). "
            f"Do not respond without advancing.\n"
            f"</CALL-TOOL>"
        )
        hook_response = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": directive}}
        print(json.dumps(hook_response))
        sys.exit(0)

    sys.exit(0)  # No output needed


if __name__ == "__main__":
    main()
