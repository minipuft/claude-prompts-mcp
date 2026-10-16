"""
Regression tests for the 2026-08 session-deadlock fixes.

Three defects combined to make delegation enforcement arm on a prose mention
of "==>", fail to record which gate ids were pending, and then never
self-clear on this client — blocking every Bash/Edit/Agent call for the rest
of the session.

Defect 1 (hooks/post-prompt-engine.py): arming must come from the response's
delegation CTA markers (subagent_type / "Handoff via Task tool"), not a
substring check on the command text.

Defect 2 (hooks/lib/session_state.py): when "**Review Required**" matches but
no gate ids can be extracted, pending_gate must not silently stay None — it
must carry a sentinel ("review") so state does not claim "no review pending"
while the server is still waiting on a verdict.

Defect 3 (hooks/delegation-enforce.py + hooks/hooks.json): this client
reports its subagent tool as "Agent", not "Task" — the clear condition and
ALLOW_LIST must recognize it, and task-tracking calls (TaskCreate, etc.)
caught by the unanchored hooks.json matcher must not be treated as action
tools.
"""

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

# Import hyphenated-filename hook modules directly (same pattern as
# test_gate_enforce_verdict.py).
_post_spec = importlib.util.spec_from_file_location("post_prompt_engine", HOOKS_DIR / "post-prompt-engine.py")
post_prompt_engine = importlib.util.module_from_spec(_post_spec)
_post_spec.loader.exec_module(post_prompt_engine)

_deleg_spec = importlib.util.spec_from_file_location("delegation_enforce", HOOKS_DIR / "delegation-enforce.py")
delegation_enforce = importlib.util.module_from_spec(_deleg_spec)
_deleg_spec.loader.exec_module(delegation_enforce)

from hook_payloads import real_payload
from session_state import (
    format_chain_reminder,
    load_session_state,
    parse_prompt_engine_response,
    save_session_state,
)


def run_post_prompt_engine(monkeypatch, capsys, *, session_id, content, tool_input=None, is_error=None):
    """Simulate a post-prompt-engine.py PostToolUse invocation."""
    payload = {
        "session_id": session_id,
        "tool_name": "mcp__claude-prompts__prompt_engine",
        "tool_input": tool_input or {},
        "tool_response": {"content": content},
    }
    if is_error is not None:
        payload["tool_response"]["isError"] = is_error
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        post_prompt_engine.main()
    out = capsys.readouterr().out
    return excinfo.value.code, (json.loads(out) if out.strip() else {})


def run_delegation_enforce(monkeypatch, capsys, *, session_id, tool_name, tool_input=None):
    """Simulate a delegation-enforce.py PreToolUse invocation."""
    payload = {"session_id": session_id, "tool_name": tool_name, "tool_input": tool_input or {}}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        delegation_enforce.main()
    out = capsys.readouterr().out
    return excinfo.value.code, (json.loads(out) if out.strip() else {})


# ── Defect 1: arm from response CTA, not command prose ─────────────────────


class TestDefect1DelegationArming:
    def test_prose_mention_of_operator_does_not_arm(self, patch_workspace, monkeypatch, capsys):
        """A command whose PROSE mentions '==>' (e.g. a feature description)
        must not arm delegation enforcement — nothing was actually delegated.
        Would fail before the fix (old code armed on `"==>" in command`).
        """
        session_id = "defect1-prose"
        content = "Step 1 of 3\n\nContinuing the chain. No delegation CTA here."
        tool_input = {"command": "Add support for the ==> delegation operator in docs"}

        code, _ = run_post_prompt_engine(
            monkeypatch, capsys, session_id=session_id, content=content, tool_input=tool_input
        )
        assert code == 0

        state = load_session_state(session_id)
        assert state is not None
        assert not state.get("pending_delegation")

    def test_delegation_cta_markers_arm_and_extract_agent_type(self, patch_workspace, monkeypatch, capsys):
        """A response carrying the server's delegation CTA markers
        (subagent_type + 'Handoff via Task tool') with a remaining step must
        arm pending_delegation and extract the agent type.
        """
        session_id = "defect1-cta"
        content = 'Step 1 of 3\n\n→ Tool: Task\n→ Parameters:\n  • subagent_type: "Explore"\nHandoff via Task tool\n'

        code, _ = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0

        state = load_session_state(session_id)
        assert state is not None
        assert state.get("pending_delegation") is True
        assert state.get("delegation_agent_type") == "Explore"

    @pytest.mark.parametrize(("pin", "mode"), [("true", "detached"), ("false", "blocking")])
    def test_delegation_cta_records_the_mode_the_server_pinned(self, patch_workspace, monkeypatch, capsys, pin, mode):
        """Tier 4: the server pins a detached step's spawn to the background and a blocking
        one to the foreground; the hook records which, so delegation-enforce holds the spawn to
        the pin the server actually printed."""
        session_id = f"detached-mode-{mode}"
        content = (
            'Step 2 of 3\n\n→ Tool: Task\n→ Parameters:\n  • subagent_type: "general-purpose"\n'
            f"  • run_in_background: {pin}\nHandoff via Task tool\n"
        )
        code, _ = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0
        assert load_session_state(session_id).get("delegation_mode") == mode

    def test_delegation_cta_without_subagent_type_falls_back_to_general_purpose(
        self, patch_workspace, monkeypatch, capsys
    ):
        session_id = "defect1-fallback"
        content = "Step 1 of 2\n\nHandoff via Task tool\n"

        code, _ = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is True
        assert state.get("delegation_agent_type") == "general-purpose"


# ── Defect 2: unparsed review-required sets a sentinel, not None ───────────


class TestDefect2GateSentinel:
    def test_review_required_without_gates_line_sets_sentinel(self):
        """'**Review Required**' with neither a **Gates**: line nor a parsable
        GATE_VERDICTS block must not leave pending_gate as None. Would fail
        before the fix (state['pending_gate'] stayed None).
        """
        content = "**Review Required**\n\nPlease review the output before continuing."
        state = parse_prompt_engine_response(content)
        assert state is not None
        assert state["pending_gate"] == "review"

    def test_review_required_with_gates_line_still_extracts_ids(self):
        """Sanity: the sentinel only fires when extraction genuinely fails —
        a normal **Gates**: line still wins."""
        content = "**Review Required**\n**Gates**: code-quality, test-coverage\n"
        state = parse_prompt_engine_response(content)
        assert state["pending_gate"] == "code-quality, test-coverage"

    def test_format_chain_reminder_tolerates_sentinel(self):
        """Consumer 1: format_chain_reminder must format the sentinel as
        plain text, not index into it."""
        state = {
            "chain_id": "chain-demo#1",
            "current_step": 1,
            "total_steps": 3,
            "pending_gate": "review",
            "pending_shell_verify": None,
            "shell_verify_attempts": 1,
        }
        full = format_chain_reminder(state, mode="full")
        assert "[Gate] review" in full
        inline = format_chain_reminder(state, mode="inline")
        assert "Gate: review" in inline

    def test_post_prompt_engine_directive_tolerates_sentinel(self, patch_workspace, monkeypatch, capsys):
        """Consumer 2: post-prompt-engine.py's `if pending_gate:` branch must
        still fire (sentinel is truthy) and format without crashing."""
        session_id = "defect2-consumer"
        content = "**Review Required**\n\nNo gates line present."

        code, out = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0
        directive = out["hookSpecificOutput"]["additionalContext"]
        assert 'gates="review"' in directive


# ── Defect 3: clear-and-allow recognizes this client's tool name ───────────


class TestDefect3ClearCondition:
    def _arm(self, session_id: str) -> None:
        save_session_state(
            session_id,
            {
                "chain_id": "chain-demo#1",
                "current_step": 1,
                "total_steps": 3,
                "pending_gate": None,
                "pending_delegation": True,
                "delegation_agent_type": "general-purpose",
            },
        )

    def test_agent_tool_clears_state_and_allows(self, patch_workspace, monkeypatch, capsys):
        """This build reports its subagent tool as 'Agent'. Would fail before
        the fix (old code only cleared on tool_name == 'Task', so the block
        could never self-clear on this client). Pinned to the foreground
        (run_in_background: false) per R2 — see test_delegation_spawn_pin.py
        for the non-pinned deny cases this same branch now covers."""
        session_id = "defect3-agent"
        self._arm(session_id)

        code, out = run_delegation_enforce(
            monkeypatch,
            capsys,
            session_id=session_id,
            tool_name="Agent",
            tool_input={"run_in_background": False},
        )
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is False

    def test_taskcreate_allowed_without_deny(self, patch_workspace, monkeypatch, capsys):
        """TaskCreate (a task-tracking call, not an action tool) is caught by
        the unanchored hooks.json matcher but must be allowed, not denied."""
        session_id = "defect3-taskcreate"
        self._arm(session_id)

        code, out = run_delegation_enforce(monkeypatch, capsys, session_id=session_id, tool_name="TaskCreate")
        assert code == 0
        assert out == {}
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

        # ALLOW_LIST membership does not clear delegation state — only Task/Agent do.
        state = load_session_state(session_id)
        assert state.get("pending_delegation") is True

    def test_bash_denied_while_delegation_pending(self, patch_workspace, monkeypatch, capsys):
        """Sanity: action tools are still hard-blocked while pending."""
        session_id = "defect3-bash"
        self._arm(session_id)

        code, out = run_delegation_enforce(monkeypatch, capsys, session_id=session_id, tool_name="Bash")
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"


# ── P6.18: a subagent's calls are not the delegating session's ─────────────


class TestSubagentPayloadIsNotTheDelegator:
    def _run(self, monkeypatch, capsys, payload):
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
        with pytest.raises(SystemExit) as excinfo:
            delegation_enforce.main()
        out = capsys.readouterr().out
        return excinfo.value.code, (json.loads(out) if out.strip() else {})

    def _arm(self, session_id: str) -> None:
        TestDefect3ClearCondition()._arm(session_id)

    def test_subagent_bash_allowed_and_state_untouched(self, patch_workspace, monkeypatch, capsys):
        sid = "p618-sub-bash"
        self._arm(sid)
        payload = real_payload(sid, "Bash", {"command": "ls"}, agent_id="acce70004ef9a4142")
        code, out = self._run(monkeypatch, capsys, payload)
        assert (code, out) == (0, {})
        assert load_session_state(sid).get("pending_delegation") is True

    def test_parent_bash_still_denied(self, patch_workspace, monkeypatch, capsys):
        sid = "p618-parent-bash"
        self._arm(sid)
        code, out = self._run(monkeypatch, capsys, real_payload(sid, "Bash", {"command": "ls"}, agent_id=None))
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert load_session_state(sid).get("pending_delegation") is True

    def test_parent_agent_call_still_clears(self, patch_workspace, monkeypatch, capsys):
        sid = "p618-parent-agent"
        self._arm(sid)
        payload = real_payload(sid, "Agent", {"run_in_background": False}, agent_id=None)
        code, out = self._run(monkeypatch, capsys, payload)
        assert (code, out) == (0, {})
        assert load_session_state(sid).get("pending_delegation") is False

    def test_subagent_agent_call_does_not_clear_parent(self, patch_workspace, monkeypatch, capsys):
        """A worker spawning its own helper has not delegated the parent's step."""
        sid = "p618-sub-agent"
        self._arm(sid)
        payload = real_payload(sid, "Agent", {"run_in_background": False}, agent_id="acce70004ef9a4142")
        code, out = self._run(monkeypatch, capsys, payload)
        assert (code, out) == (0, {})
        assert load_session_state(sid).get("pending_delegation") is True


class TestQualifiedRunBinding:
    TOKEN = "chain-Team-Legacy/Child_Name/9deep#01"

    def test_claim_return_and_delegation_preserve_exact_text_id(self, patch_workspace, monkeypatch, capsys):
        content = (
            f"Progress 1/3\nHANDOFF RESULT chain={self.TOKEN} node=work attempt=1 claim=receipt\n"
            'subagent_type: "general-purpose"\nHandoff via Task tool'
        )
        code, out = run_post_prompt_engine(
            monkeypatch,
            capsys,
            session_id="qualified-claim",
            content=content,
            is_error=False,
        )
        state = load_session_state("qualified-claim")
        assert code == 0 and state["chain_id"] == self.TOKEN
        assert state["pending_delegation"] is True
        assert self.TOKEN in out["hookSpecificOutput"]["additionalContext"]

    @pytest.mark.parametrize("terminal", ["abort", "complete"])
    @pytest.mark.parametrize("binding", ["exact", "wrong-request", "wrong-response", "refusal"])
    def test_truthful_terminal_clearing_keeps_exact_run_binding(
        self,
        patch_workspace,
        monkeypatch,
        capsys,
        terminal,
        binding,
    ):
        sid = f"qualified-{terminal}-{binding}"
        tracked = {"chain_id": self.TOKEN, "current_step": 1, "total_steps": 3, "pending_gate": "review"}
        save_session_state(sid, tracked)
        other = "chain-Team-Legacy/Child_Name/9deep#2"
        request = other if binding == "wrong-request" else self.TOKEN
        response = other if binding == "wrong-response" else self.TOKEN
        content = (
            f"🛑 **Chain Cancelled**: `{response}`\n"
            if terminal == "abort"
            else f"Chain complete (3/3)\nChain: `{response}`\n"
        )
        code, _ = run_post_prompt_engine(
            monkeypatch,
            capsys,
            session_id=sid,
            content=content,
            tool_input={"chain_id": request, **({"gate_action": "abort"} if terminal == "abort" else {})},
            is_error=binding == "refusal",
        )
        assert code == 0
        assert load_session_state(sid) == (None if binding == "exact" else tracked)


# ── T3.3: an owned exact pause suspends only the delegation demand ─────────

PAUSE_RUN = {"runId": "r", "chainId": "chain-demo#1", "step": {"current": 1, "total": 3}, "obligations": []}
PAUSE_RUN["scope"] = {"organizationId": None, "workspaceId": "w", "continuityScopeId": "w"}
# Unpinned Task/Agent spawns are denied while delegation is pending; a pinned Agent would clear it.
DEMAND_CALLS = [("Edit", {}), ("Write", {}), ("Bash", {"command": "ls"}), ("Task", {}), ("Agent", {})]
DEMAND_CALLS.append(("Agent", {"run_in_background": False}))
FOREIGN = {"run_id": "r", "organization_id": None, "workspace_id": "w", "continuity_scope_id": "w"}


def run_control(monkeypatch, capsys, session_id, action, outcome, pause=None):
    """A pause/resume reply in the shape Claude Code delivers: a JSON string of structuredContent."""
    packet = {"kind": "conversation_control", "outcome": outcome, "run": {**PAUSE_RUN, "pause": pause}}
    payload = {"session_id": session_id, "tool_name": "mcp__claude-prompts__prompt_engine"}
    payload["tool_input"] = {"chain_id": "chain-demo#1", "gate_action": action}
    payload["tool_response"] = json.dumps({"conversation_control": packet, "message": f"{outcome}."})
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit):
        post_prompt_engine.main()
    capsys.readouterr()


class TestConversationPauseSuspendsDelegationDemand:
    def _paused(self, monkeypatch, capsys, sid: str) -> dict:
        TestDefect3ClearCondition()._arm(sid)
        run_control(monkeypatch, capsys, sid, "pause", "paused", {"kind": "conversation", "pausedAt": 1})
        state = load_session_state(sid)
        assert (state["pause_custody"], state["pending_delegation"]) == ("owned", True)
        return state

    @pytest.mark.parametrize(("tool", "tool_input"), DEMAND_CALLS)
    def test_owned_exact_pause_suspends_the_demand_and_keeps_the_delegation(
        self, patch_workspace, monkeypatch, capsys, tool, tool_input
    ):
        sid = f"t33-paused-{tool}-{len(tool_input)}"
        before = json.dumps(load_session_state(sid), sort_keys=True) if self._paused(monkeypatch, capsys, sid) else None
        code, out = run_delegation_enforce(monkeypatch, capsys, session_id=sid, tool_name=tool, tool_input=tool_input)
        assert (code, out) == (0, {})
        assert json.dumps(load_session_state(sid), sort_keys=True) == before

    @pytest.mark.parametrize(
        "override",
        [
            {"pause_custody": "retained"},
            {"pause_custody": "unconfirmed"},
            {"run_identity": {**FOREIGN, "chain_id": "chain-other#1"}},
            {"run_identity": None},
        ],
        ids=["retained", "unconfirmed", "foreign-run", "no-identity"],
    )
    def test_a_pause_this_conversation_does_not_own_keeps_the_demand(
        self, patch_workspace, monkeypatch, capsys, override
    ):
        sid = f"t33-not-owned-{sorted(override)[0]}-{override.get('pause_custody')}"
        save_session_state(sid, {**self._paused(monkeypatch, capsys, sid), **override})
        for tool in ("Bash", "Agent"):
            _, out = run_delegation_enforce(monkeypatch, capsys, session_id=sid, tool_name=tool)
            assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert load_session_state(sid)["pending_delegation"] is True

    def test_resume_restores_the_demand(self, patch_workspace, monkeypatch, capsys):
        sid = "t33-resumed"
        self._paused(monkeypatch, capsys, sid)
        run_control(monkeypatch, capsys, sid, "resume", "resumed")
        assert "conversation_pause" not in load_session_state(sid)
        _, out = run_delegation_enforce(monkeypatch, capsys, session_id=sid, tool_name="Bash")
        assert out["hookSpecificOutput"]["permissionDecisionReason"].startswith("Delegation pending")
        _, out = run_delegation_enforce(monkeypatch, capsys, session_id=sid, tool_name="Agent")
        assert "must run in the foreground" in out["hookSpecificOutput"]["permissionDecisionReason"]

    def test_the_subagent_boundary_still_holds_under_pause(self, patch_workspace, monkeypatch, capsys):
        sid = "t33-subagent"
        before = json.dumps(load_session_state(sid), sort_keys=True) if self._paused(monkeypatch, capsys, sid) else None
        payload = real_payload(sid, "Agent", {"run_in_background": False}, agent_id="acce70004ef9a4142")
        assert TestSubagentPayloadIsNotTheDelegator()._run(monkeypatch, capsys, payload) == (0, {})
        assert json.dumps(load_session_state(sid), sort_keys=True) == before
