#!/usr/bin/env python3
"""
PostToolUse hook: Track chain/gate state from prompt_engine responses.

Triggers after: mcp__claude-prompts__prompt_engine

Parses the response to:
1. Track current chain step
2. Detect pending gates
3. Inject reminders for gate reviews
4. Track a conversation pause from an applied `conversation_control` packet only, read from the
   structured content in whichever shape the host sends (`read_tool_response`); reply text (and the
   structured `message`, which carries the recovery token) is never stored.
5. Clear the tracked run on an abort whose `run_control` outcome is `cancelled`, and on a completion
   marker in the reply text. Every read of `tool_response` goes through `read_tool_response`: under
   Claude Code no MCP payload carries `isError`, so the absence of an error is the success signal.
"""

import json
import re
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_state import (
    UNKNOWN_INTERRUPT_LABEL,
    ChainState,
    RunIdentity,
    clear_session_state,
    exact_run_identity,
    format_gate_directive,
    is_subagent_payload,
    load_session_state,
    parse_prompt_engine_response,
    pause_fields,
    read_tool_response,
    save_session_state,
)

COMPLETION_MARKER = re.compile(r"(?m)^(?:[✓✅][ \t]*)?(?:Chain complete\b|Execution complete\.)")
# The outcomes a packet carries only when the control applied (conversation-control-response.ts);
# `refused` -- busy, paused-run refusals, wrong scope -- never applies, since no MCP payload under
# Claude Code carries `isError` to say so.
PAUSE_OUTCOMES = frozenset({"paused", "already-paused", "claimed"})
APPLIED_OUTCOMES = PAUSE_OUTCOMES | {"resumed"}
# What a resumed run's owed obligation restores when the tracker lost the hold (e.g. a claim).
OBLIGATION_HOLDS = {"blocking-unknown": UNKNOWN_INTERRUPT_LABEL, "review": "review", "exhausted-retry": "review"}


def _control_packet(structured: dict | None) -> dict | None:
    """The structured content's `conversation_control`, or None when it carries none."""
    packet = structured.get("conversation_control") if structured is not None else None
    return packet if isinstance(packet, dict) and packet.get("kind") == "conversation_control" else None


def _packet_identity(run: object) -> RunIdentity | None:
    """The packet run's exact identity in hook-state keys, or None when any field is missing."""
    run = run if isinstance(run, dict) else {}
    scope = run.get("scope") if isinstance(run.get("scope"), dict) else {}
    raw = {"run_id": run.get("runId"), "chain_id": run.get("chainId"), "organization_id": scope.get("organizationId")}
    raw |= {"workspace_id": scope.get("workspaceId"), "continuity_scope_id": scope.get("continuityScopeId")}
    return exact_run_identity(raw)


def _apply_control_packet(session_id: str, request_id: str, packet: dict) -> None:
    """Record a pause, claim or resume of this conversation's exact run; anything else is a no-op."""
    run = packet.get("run")
    identity = _packet_identity(run)
    outcome = packet.get("outcome")
    if not isinstance(run, dict) or identity is None or outcome not in APPLIED_OUTCOMES:
        return
    if request_id and request_id != identity["chain_id"]:
        return
    tracked = load_session_state(session_id) or {}
    same_run = tracked.get("chain_id") == identity["chain_id"]
    if same_run and exact_run_identity(tracked.get("run_identity")) not in (None, identity):
        return  # same chain id, another run or scope
    # The same run keeps every hold detail (unknown verbs, delegation, shell verification).
    state: ChainState = {**tracked} if same_run else {"pending_gate": None}
    if outcome == "resumed":
        for key in ("conversation_pause", "owed", "pause_custody"):
            state.pop(key, None)
        owed = [item for item in run.get("obligations") or [] if isinstance(item, dict)]
        holds = [OBLIGATION_HOLDS[item["kind"]] for item in owed if item.get("kind") in OBLIGATION_HOLDS]
        if holds and not state.get("pending_gate"):
            state["pending_gate"] = holds[0]
    else:
        fields = pause_fields(run.get("pause"), run.get("obligations"))
        if not fields:
            return
        state.update(fields)
        state["pause_custody"] = "owned"
    step = run.get("step") if isinstance(run.get("step"), dict) else {}
    state.update({"chain_id": identity["chain_id"], "run_identity": identity})
    state["current_step"], state["total_steps"] = int(step.get("current") or 0), int(step.get("total") or 0)
    save_session_state(session_id, state)


def _abort_cancelled_tracked_run(session_id: str, request_id: str, structured: dict | None) -> bool:
    """Whether an abort reply's `run_control` says this conversation's tracked run is cancelled.

    Only `cancelled` releases the run; `release-incomplete` still holds verify-loop state and
    `not-applied` changed nothing. The reply text cannot decide: a failed release leads with the
    same "Chain Cancelled" words, and natively the text is not even sent beside the packet.
    """
    packet = structured.get("run_control") if structured is not None else None
    if not isinstance(packet, dict) or packet.get("action") != "abort" or packet.get("outcome") != "cancelled":
        return False
    chain_id = packet.get("chainId")
    if not request_id or not isinstance(chain_id, str):
        return False
    if not _matches_tracked_run(session_id, request_id, chain_id, require_named=True):
        return False
    identity = exact_run_identity((load_session_state(session_id) or {}).get("run_identity"))
    return identity is None or packet.get("runId") in (None, identity["run_id"])


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
    content, structured, is_error = read_tool_response(tool_response)
    if is_error is True:
        sys.exit(0)
    request_id = tool_input.get("chain_id", "") if isinstance(tool_input, dict) else ""
    request_id = request_id if isinstance(request_id, str) else ""

    # A control reply decides by its packet alone -- its outcome, not a host error flag, says
    # whether it applied; its text never pauses, resumes or saves.
    packet = _control_packet(structured)
    if packet is not None:
        _apply_control_packet(session_id, request_id, packet)
        sys.exit(0)
    if isinstance(tool_input, dict) and tool_input.get("gate_action") in ("pause", "resume"):
        sys.exit(0)  # a pause or resume reply without its packet proves neither
    if isinstance(tool_input, dict) and tool_input.get("gate_action") == "abort":
        # An abort reply decides by its run_control packet alone and never saves a snapshot.
        if _abort_cancelled_tracked_run(session_id, request_id, structured):
            clear_session_state(session_id)
        sys.exit(0)

    state = parse_prompt_engine_response(content)

    if not state:
        verdict_completed = (
            isinstance(tool_input, dict)
            and bool(tool_input.get("gate_verdict"))
            and bool(COMPLETION_MARKER.search(content))
            and _matches_tracked_run(session_id, request_id, "")
        )
        if verdict_completed:
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
        if _matches_tracked_run(session_id, request_id, response_id):
            clear_session_state(session_id)
        sys.exit(0)

    # Extract chain_id from tool_input (higher priority than regex parsing)
    if request_id:
        state["chain_id"] = request_id

    # A prompt run for another chain (or none) during a discussion must not erase the paused run's
    # pause and exact identity; only that run's own replies change its row.
    tracked = load_session_state(session_id) if session_id else None
    if tracked and "conversation_pause" in tracked and state.get("chain_id", "") != tracked.get("chain_id"):
        sys.exit(0)

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
        directive = format_gate_directive(state)

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
