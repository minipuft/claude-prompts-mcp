"""
A worker subagent's own prompt_engine calls are not its parent's.

A subagent's tool hooks arrive under the PARENT's `session_id` (see
`session_state.is_subagent_payload`), and every hook here keys chain state by
that id. So without a subagent exit a worker running its own chain overwrote the
parent's chain row, armed delegation on it, or cleared it outright (P6.42), and
the parent's pending gate denied the worker's own resume (P6.43).

Each twin differs from its control in `agent_id` alone (`hook_payloads.real_payload`).
"""

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR / "lib"))

from hook_payloads import real_payload
from session_state import load_session_state, save_session_state

_post_spec = importlib.util.spec_from_file_location("post_prompt_engine", HOOKS_DIR / "post-prompt-engine.py")
post_prompt_engine = importlib.util.module_from_spec(_post_spec)
_post_spec.loader.exec_module(post_prompt_engine)

_gate_spec = importlib.util.spec_from_file_location("gate_enforce", HOOKS_DIR / "gate-enforce.py")
gate_enforce = importlib.util.module_from_spec(_gate_spec)
_gate_spec.loader.exec_module(gate_enforce)

TOOL = "mcp__claude-prompts__prompt_engine"
WORKER_AGENT_ID = "acce70004ef9a4142"

PARENT_RENDER = "Step 1 of 3 chain-parent#1\n\nContinue the chain."
WORKER_DELEGATING_RENDER = (
    'Step 1 of 3 chain-worker#1\n\n→ Tool: Task\n→ Parameters:\n  • subagent_type: "Explore"\nHandoff via Task tool\n'
)


def _run(module, monkeypatch, capsys, payload):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        module.main()
    return excinfo.value.code, capsys.readouterr().out


def _post(session_id, content, tool_input, *, agent_id):
    return real_payload(
        session_id,
        TOOL,
        tool_input,
        agent_id=agent_id,
        event="PostToolUse",
        tool_response={"content": [{"type": "text", "text": content}]},
    )


def _arm_parent(monkeypatch, capsys, session_id):
    """The parent's own call records its chain row, exactly as today."""
    code, _ = _run(
        post_prompt_engine,
        monkeypatch,
        capsys,
        _post(session_id, PARENT_RENDER, {"command": ">>parent_chain"}, agent_id=None),
    )
    assert code == 0
    row = load_session_state(session_id)
    assert row is not None and row["chain_id"] == "chain-parent#1"
    return row


class TestPostPromptEngineSubagentWritesNothing:
    def test_subagent_render_leaves_the_parent_row_unchanged(self, patch_workspace, monkeypatch, capsys):
        sid = "p642-sub-render"
        before = _arm_parent(monkeypatch, capsys, sid)

        code, out = _run(
            post_prompt_engine,
            monkeypatch,
            capsys,
            _post(sid, WORKER_DELEGATING_RENDER, {"command": ">>worker_chain"}, agent_id=WORKER_AGENT_ID),
        )

        assert (code, out) == (0, "")
        after = load_session_state(sid)
        assert after == before
        assert not after.get("pending_delegation")

    def test_control_the_parent_identical_call_writes_as_today(self, patch_workspace, monkeypatch, capsys):
        sid = "p642-parent-render"
        _arm_parent(monkeypatch, capsys, sid)

        code, out = _run(
            post_prompt_engine,
            monkeypatch,
            capsys,
            _post(sid, WORKER_DELEGATING_RENDER, {"command": ">>worker_chain"}, agent_id=None),
        )

        assert code == 0
        assert "CALL-TOOL" in out
        after = load_session_state(sid)
        assert after["chain_id"] == "chain-worker#1"
        assert after.get("pending_delegation") is True

    @pytest.mark.parametrize(
        ("content", "tool_input"),
        [
            ("Chain complete (3/3) chain-worker#1", {"chain_id": "chain-worker#1"}),
            ("Run cancelled.", {"chain_id": "chain-worker#1", "cancel": True}),
        ],
        ids=["completion-marker", "cancel"],
    )
    def test_subagent_clearing_reply_leaves_the_parent_row(
        self, patch_workspace, monkeypatch, capsys, content, tool_input
    ):
        sid = "p642-sub-clear"
        before = _arm_parent(monkeypatch, capsys, sid)

        code, out = _run(
            post_prompt_engine, monkeypatch, capsys, _post(sid, content, tool_input, agent_id=WORKER_AGENT_ID)
        )

        assert (code, out) == (0, "")
        assert load_session_state(sid) == before

    def test_control_the_parent_clearing_reply_clears(self, patch_workspace, monkeypatch, capsys):
        """Positive control for the absence above: the same reply on the parent's call clears."""
        sid = "p642-parent-clear"
        _arm_parent(monkeypatch, capsys, sid)
        _run(
            post_prompt_engine,
            monkeypatch,
            capsys,
            _post(sid, "Chain complete (3/3) chain-parent#1", {"chain_id": "chain-parent#1"}, agent_id=None),
        )
        assert load_session_state(sid) is None


PARENT_GATE_PENDING = {
    "chain_id": "chain-parent#1",
    "current_step": 2,
    "total_steps": 3,
    "pending_gate": "code-quality",
}


def _pre(session_id, tool_input, *, agent_id):
    return real_payload(session_id, TOOL, tool_input, agent_id=agent_id)


class TestGateEnforceSubagentIsNotHeldByTheParentGate:
    """Check 2 reads the PARENT's pending_gate by session_id; a worker's resume of its own run
    is the server's to gate, not the parent's review."""

    def test_subagent_bare_resume_with_the_parent_gate_pending_is_allowed(self, patch_workspace, monkeypatch, capsys):
        sid = "p643-sub-resume"
        save_session_state(sid, dict(PARENT_GATE_PENDING))

        code, out = _run(
            gate_enforce, monkeypatch, capsys, _pre(sid, {"chain_id": "chain-worker#1"}, agent_id=WORKER_AGENT_ID)
        )

        assert (code, out) == (0, "")
        assert load_session_state(sid)["pending_gate"] == "code-quality"

    def test_control_the_parent_bare_resume_is_denied(self, patch_workspace, monkeypatch, capsys):
        sid = "p643-parent-resume"
        save_session_state(sid, dict(PARENT_GATE_PENDING))

        code, out = _run(gate_enforce, monkeypatch, capsys, _pre(sid, {"chain_id": "chain-parent#1"}, agent_id=None))

        assert code == 0
        decision = json.loads(out)["hookSpecificOutput"]
        assert decision["permissionDecision"] == "deny"
        assert decision["permissionDecisionReason"].startswith("Gate review required: code-quality.")

    def test_control_the_parent_resume_with_a_verdict_is_allowed(self, patch_workspace, monkeypatch, capsys):
        sid = "p643-parent-verdict"
        save_session_state(sid, dict(PARENT_GATE_PENDING))
        tool_input = {"chain_id": "chain-parent#1", "gate_verdict": "GATE_REVIEW: PASS - criteria met"}

        code, out = _run(gate_enforce, monkeypatch, capsys, _pre(sid, tool_input, agent_id=None))

        assert (code, out) == (0, "")

    def test_subagent_fail_verdict_still_gets_the_retry_guidance(self, patch_workspace, monkeypatch, capsys):
        """Check 1 reads the caller's OWN verdict, not the parent's state, so it applies to a
        worker exactly as to its parent."""
        sid = "p643-sub-fail"
        tool_input = {"chain_id": "chain-worker#1", "gate_verdict": "GATE_REVIEW: FAIL - criteria unmet"}

        code, out = _run(gate_enforce, monkeypatch, capsys, _pre(sid, tool_input, agent_id=WORKER_AGENT_ID))

        assert code == 0
        decision = json.loads(out)["hookSpecificOutput"]
        assert decision["permissionDecision"] == "deny"
        assert decision["permissionDecisionReason"].startswith("Gate FAIL: criteria unmet.")
