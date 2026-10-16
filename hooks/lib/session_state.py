"""
Session state manager for Claude Code hooks.
Tracks chain/gate state per conversation session via SQLite (hooks-state.db).
"""

import json
import os
import re
from typing import Any, TypedDict, cast

from _generated.extraction_patterns import EXTRACTION_PATTERNS
from hook_state_store import (
    TABLE_CHAIN_SESSION_STATE,
    cleanup_stale_rows,
    delete_state,
    load_state,
    save_state,
)

# The reserved synthetic review id stage 16 raises for a blocking-unknown interrupt
# (`UNKNOWN_INTERRUPT_GATE_ID`, `decisions/mutation/types.ts`). It is a run-state marker, not a
# gate anyone authored, so every human-facing surface renders the label instead of the dunder.
UNKNOWN_INTERRUPT_GATE_ID = "__unknown_interrupt__"
UNKNOWN_INTERRUPT_LABEL = "blocking unknown interrupt"

GATE_VERDICT_GUIDANCE = (
    'gate_verdict={"overall":"PASS","rationale":"<reason>"}. Use FAIL for unmet criteria. '
    "Follow the returned server template for per_gate, reminders and semantic evaluation."
)


def label_gate_ids(gate_ids: list[str]) -> str:
    """Render pending-review ids for a human: synthetic ids become their label.

    One function for both producers of `pending_gate` — the response-text parser below and
    `db_reader`'s two `currentStepReview.gateIds` readbacks — so a hook's reminder and a hook's
    denial cannot name the same hold differently.
    """
    return ", ".join(
        UNKNOWN_INTERRUPT_LABEL if gate_id == UNKNOWN_INTERRUPT_GATE_ID else gate_id for gate_id in gate_ids
    )


def _load_patterns() -> dict[str, str]:
    """Load the JSON projection, retaining its generated twin when JSON is unavailable."""
    patterns = dict(EXTRACTION_PATTERNS)
    try:
        path = os.path.join(os.path.dirname(__file__), "_generated", "extraction-patterns.json")
        with open(path, encoding="utf-8") as f:
            generated = json.load(f)
        for key, value in generated.items():
            if isinstance(value, str) and value:
                patterns[key] = value
    except (OSError, ValueError):
        pass
    return patterns


_PATTERNS = _load_patterns()


class RunIdentity(TypedDict):
    """The exact run: UUID (`sessionId`), chain id and scope; two scopes can each hold `chain-x#1`."""

    run_id: str
    chain_id: str
    organization_id: str | None
    workspace_id: str | None
    continuity_scope_id: str


class ConversationPauseState(TypedDict):
    kind: str
    node_id: str | None
    paused_at: int


class OwedObligation(TypedDict, total=False):
    kind: str
    node_id: str
    step: int
    review: dict[str, str]


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
    # Blocking-unknown interrupt (hard pause). The verbs are the ones the SERVER printed for
    # this hold, so a hook repeating them cannot offer an exit the run refuses.
    interrupt_verbs: list[str]
    # Delegation state (set by post-prompt-engine hook)
    pending_delegation: bool
    delegation_agent_type: str
    delegation_model_hint: str
    # "blocking" | "detached" — read off the server's rendered handoff (run_in_background value)
    delegation_mode: str
    # Conversation pause. `run_identity` comes only from an exact source: a control packet naming
    # the run, or a state.db row matched on every identity field. `pause_custody` is "owned" (a
    # live server holds the pause), "retained" (its server stopped; the run waits for an explicit
    # claim) or "unconfirmed" (tracked, but no refresh could confirm it).
    run_identity: RunIdentity
    conversation_pause: ConversationPauseState
    owed: list[OwedObligation]
    pause_custody: str


PAUSE_RECOVERY_GUIDANCE = (
    "The server holding this paused workflow is not confirmed live. Claim it with the handoff token "
    "you were given, or abort it; it does not resume on its own."
)


def exact_run_identity(raw: object) -> RunIdentity | None:
    """`raw` as a complete RunIdentity, or None when any field is missing or mistyped."""
    if not isinstance(raw, dict):
        return None
    texts = [raw.get(key) for key in ("run_id", "chain_id", "continuity_scope_id")]
    scopes = [raw.get(key, "") for key in ("organization_id", "workspace_id")]
    if not all(isinstance(value, str) and value for value in texts):
        return None
    if not all(value is None or isinstance(value, str) for value in scopes):
        return None
    return cast(RunIdentity, {key: raw[key] for key in RunIdentity.__annotations__})


def pause_fields(pause: object, owed: object) -> ChainState:
    """Hook-state pause keys from the server's camelCase shapes (the reply packet's
    `run.pause`/`run.obligations` and the projection's `conversationPause`/`owed` agree).
    An absent or malformed pause yields no keys: absence is "not known paused", never "resumed"."""
    if not isinstance(pause, dict) or pause.get("kind") != "conversation":
        return {}
    node_id, paused_at = pause.get("nodeId"), pause.get("pausedAt")
    if not (node_id is None or isinstance(node_id, str)) or type(paused_at) is not int:
        return {}
    obligations: list[OwedObligation] = []
    for item in owed if isinstance(owed, list) else []:
        if isinstance(item, dict) and isinstance(item.get("kind"), str) and type(item.get("step")) is int:
            entry: OwedObligation = {"kind": item["kind"], "node_id": str(item.get("nodeId", "")), "step": item["step"]}
            if isinstance(item.get("review"), dict):
                entry["review"] = {key: str(item["review"].get(key, "")) for key in ("kind", "phase")}
            obligations.append(entry)
    return {
        "conversation_pause": {"kind": "conversation", "node_id": node_id, "paused_at": paused_at},
        "owed": obligations,
    }


def holds_pause_exemption(state: ChainState | None, bound: RunIdentity | None) -> bool:
    """Whether `state` lets a hook relax workflow pressure for the run the host binding names.

    Only a pause a live server holds, on a run whose exact identity equals `bound`. Missing,
    legacy, partial or different identity, and a retained or unconfirmed pause, grant nothing.
    """
    if not state or exact_run_identity(bound) is None:
        return False
    return (
        state.get("pause_custody") == "owned"
        and "conversation_pause" in state
        and exact_run_identity(state.get("run_identity")) == bound
    )


def pause_recovery_guidance(state: ChainState | None) -> str | None:
    """Recovery guidance for a pause no live server is confirmed to hold; never an adoption."""
    if state and "conversation_pause" in state and state.get("pause_custody") != "owned":
        return PAUSE_RECOVERY_GUIDANCE
    return None


def _fallback_interrupt_exits() -> list[str]:
    """Parameter-level exits for an interrupt whose verb list was not captured.

    Reached on the db_reader path (compact recovery reconstructs a hold from
    `chain_sessions.currentStepReview`, where no response text exists) and on a response whose
    interrupt section moved. Derived from the same generated artifact `gate-enforce.py` reads,
    minus `gate_verdict`: a verdict answers a GATE, and no verdict clears this hold.
    """
    try:
        from _generated.resolution_verbs import PENDING_RUN_RESOLUTION_PARAMS

        return sorted(PENDING_RUN_RESOLUTION_PARAMS - {"gate_verdict"})
    except Exception:
        return ["gate_action"]


def interrupt_exits(state: ChainState) -> list[str]:
    """The exits a paused run accepts — the server's own list when it printed one."""
    # Persisted interrupt text may predate the current server resolution vocabulary.
    supported = set(_fallback_interrupt_exits())
    verbs = [verb for verb in state.get("interrupt_verbs", []) if verb and verb.split(":", 1)[0] in supported]
    return verbs if verbs else _fallback_interrupt_exits()


def _interrupt_exits(state: ChainState) -> str:
    return " | ".join(interrupt_exits(state))


def is_subagent_payload(hook_input: dict) -> bool:
    """Did this hook fire inside an Agent-launched subagent?

    A subagent's tool hooks arrive under its PARENT's `session_id`, so state keyed
    by `session_id` belongs to the session that rendered the brief, not to this
    caller. `agent_id` is the documented discriminator ("present only when the hook
    fires inside a subagent call"), measured on real payloads: the plan tracker keyed
    by parent session ab61dbec recorded `agent_id` a2ddec3330ad11b21, whose transcript
    is `ab61dbec…/subagents/agent-a2ddec3330ad11b21.jsonl`. `transcript_path` cannot
    discriminate: inside a subagent it names the parent's transcript (measured
    2026-09-13 on SubagentStop). `agent_type` cannot either: `--agent` sets it too.
    """
    return bool(hook_input.get("agent_id"))


def load_session_state(session_id: str) -> ChainState | None:
    """Load chain state for a session from SQLite."""
    data = load_state(TABLE_CHAIN_SESSION_STATE, session_id)
    return cast(ChainState, data) if data is not None else None


def save_session_state(session_id: str, state: ChainState) -> None:
    """Save chain state for a session to SQLite."""
    save_state(TABLE_CHAIN_SESSION_STATE, session_id, cast(dict[str, Any], state))


def clear_session_state(session_id: str) -> None:
    """Clear chain state after the tracked run terminates."""
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
    state.pop("delegation_mode", None)
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
    step_match = re.search(_PATTERNS["step"], content)
    if step_match:
        state["current_step"] = int(step_match.group(1))
        state["total_steps"] = int(step_match.group(2))

    # Detect chain_id from resume token pattern: "chain-<name>#<run>"
    # Must start with "chain-" (hyphen) to avoid matching literal "chain_id" parameter names
    chain_match = re.search(_PATTERNS["chainId"], content)
    if chain_match:
        state["chain_id"] = chain_match.group(1)

    # Detect gate/structural review required (from response-assembler.ts)
    # Variants:
    #   **Review Required**                          (current server format)
    #   **Gate Review Required** (attempt X/Y)       (legacy)
    #   **Structural Review Required** (attempt X/Y) (legacy)
    #   **Structural + Gate Review Required**        (legacy)
    # Followed by: **Gates**: gate-id-1, gate-id-2
    gate_review_match = re.search(_PATTERNS["gateHeader"], content)
    gates_list_match = re.search(_PATTERNS["gatesList"], content)

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

        # Sentinel: a review was required but neither extraction found gate ids.
        # Leaving pending_gate as None here would make state claim "no review
        # pending" while the server is still waiting for a verdict — that gap
        # let downstream callers (e.g. delegation arming) act as if the gate
        # had already cleared. "review" is not indexed as a gate id anywhere;
        # it is only ever formatted into reminder/denial text or truth-tested.
        if not state["pending_gate"]:
            state["pending_gate"] = "review"

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

    # Detect a HARD-PAUSED blocking-unknown interrupt (plan row 3.1). The server holds the run on
    # the reserved `__unknown_interrupt__` review and issues NO step, and its response carries no
    # "Review Required" header — so without this branch the parse above leaves pending_gate None
    # and every downstream consumer reads a held run as a free one.
    if re.search(_PATTERNS["interruptHeader"], content):
        state["pending_gate"] = UNKNOWN_INTERRUPT_LABEL
        verbs_match = re.search(_PATTERNS["interruptVerbs"], content)
        if verbs_match:
            state["interrupt_verbs"] = [
                line.lstrip("- ").strip() for line in verbs_match.group(1).splitlines() if line.strip()
            ]

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
        elif gate == UNKNOWN_INTERRUPT_LABEL:
            line2 = f"→ {_interrupt_exits(state)}"
        elif gate:
            line2 = f"→ {GATE_VERDICT_GUIDANCE}"
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

    if gate == UNKNOWN_INTERRUPT_LABEL:
        lines.append(f"[Interrupt] {gate} - Resolve with: {_interrupt_exits(state)}")
    elif gate:
        lines.append(f"[Gate] {gate} - Submit: {GATE_VERDICT_GUIDANCE}")

    if verify_cmd:
        lines.append(f"[Verify] `{verify_cmd}` - Attempt {verify_attempts}/5")
        lines.append("Run implementation, then prompt_engine validates with shell command")

    return "\n".join(lines)


def format_gate_directive(state: ChainState) -> str:
    """Render the pending hold's instruction without offering a gate verdict for an interrupt."""
    chain_id = state.get("chain_id", "")
    gate = state.get("pending_gate")
    if gate == UNKNOWN_INTERRUPT_LABEL:
        return f'<INTERRUPT>chain_id="{chain_id}"\n{format_chain_reminder(state)}</INTERRUPT>'
    return f'<GATE-REVIEW>chain_id="{chain_id}" gates="{gate}" → Submit gate_verdict</GATE-REVIEW>'
