"""
Tests for R2: delegation-enforce.py denies a Task/Agent spawn call that is
not pinned to the foreground, and for the shared `spawn_call_is_pinned`
predicate in `hooks/lib/spawn_pin.py`.

Claude Code spawns subagents in the BACKGROUND by default
(`run_in_background` absent means background). The server floor renders
`run_in_background: false` in the handoff instructions and refuses a resume
whose reply lacks the worker's `HANDOFF RESULT` trailer — a backgrounded
worker cannot supply that trailer before the delegating agent continues.
This hook tightens on top of that floor for Claude Code: while a delegation
is pending, a Task/Agent call only clears state and allows when the call is
actually pinned to the foreground; otherwise it denies and leaves the
pending state untouched.
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

# Import hyphenated-filename hook module directly (same pattern as
# test_delegation_deadlock_fixes.py).
_deleg_spec = importlib.util.spec_from_file_location("delegation_enforce", HOOKS_DIR / "delegation-enforce.py")
delegation_enforce = importlib.util.module_from_spec(_deleg_spec)
_deleg_spec.loader.exec_module(delegation_enforce)

from session_state import load_session_state, save_session_state
from spawn_pin import spawn_call_is_pinned


def _arm(session_id: str) -> None:
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


def run_delegation_enforce(monkeypatch, capsys, *, session_id, tool_name, tool_input=None):
    """Simulate a delegation-enforce.py PreToolUse invocation."""
    payload = {"session_id": session_id, "tool_name": tool_name, "tool_input": tool_input or {}}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        delegation_enforce.main()
    out = capsys.readouterr().out
    return excinfo.value.code, (json.loads(out) if out.strip() else {})


# ── Hook-level behavior ─────────────────────────────────────────────────────


class TestSpawnPinEnforcement:
    def test_task_with_run_in_background_false_allows_and_clears(self, patch_workspace, monkeypatch, capsys):
        session_id = "spawnpin-task-false"
        _arm(session_id)

        code, out = run_delegation_enforce(
            monkeypatch,
            capsys,
            session_id=session_id,
            tool_name="Task",
            tool_input={"run_in_background": False},
        )
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is False

    def test_task_with_run_in_background_true_denies_and_leaves_state_pending(
        self, patch_workspace, monkeypatch, capsys
    ):
        session_id = "spawnpin-task-true"
        _arm(session_id)

        code, out = run_delegation_enforce(
            monkeypatch,
            capsys,
            session_id=session_id,
            tool_name="Task",
            tool_input={"run_in_background": True},
        )
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        reason = out["hookSpecificOutput"]["permissionDecisionReason"]
        assert "run_in_background" in reason

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is True

    def test_task_with_run_in_background_absent_denies(self, patch_workspace, monkeypatch, capsys):
        session_id = "spawnpin-task-absent"
        _arm(session_id)

        code, out = run_delegation_enforce(
            monkeypatch,
            capsys,
            session_id=session_id,
            tool_name="Task",
            tool_input={},
        )
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert "run_in_background" in out["hookSpecificOutput"]["permissionDecisionReason"]

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is True

    def test_agent_with_run_in_background_false_allows(self, patch_workspace, monkeypatch, capsys):
        session_id = "spawnpin-agent-false"
        _arm(session_id)

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

    def test_no_pending_delegation_is_a_noop_regardless_of_run_in_background(
        self, patch_workspace, monkeypatch, capsys
    ):
        session_id = "spawnpin-no-pending"
        # No _arm() call — no state saved at all.

        code, out = run_delegation_enforce(
            monkeypatch,
            capsys,
            session_id=session_id,
            tool_name="Task",
            tool_input={"run_in_background": True},
        )
        assert code == 0
        assert out == {}


# ── Unit coverage of the shared predicate ───────────────────────────────────


class TestSpawnCallIsPinned:
    def test_unknown_client_is_pinned_with_no_reason(self):
        pinned, reason = spawn_call_is_pinned("codex", {})
        assert pinned is True
        assert reason == ""

    def test_claude_code_false_is_pinned(self):
        pinned, reason = spawn_call_is_pinned("claude-code", {"run_in_background": False})
        assert pinned is True
        assert reason == ""

    @pytest.mark.parametrize("value", [0, None, "false", True])
    def test_claude_code_non_false_values_are_not_pinned(self, value):
        pinned, reason = spawn_call_is_pinned("claude-code", {"run_in_background": value})
        assert pinned is False
        assert "run_in_background" in reason

    def test_claude_code_absent_parameter_is_not_pinned(self):
        pinned, reason = spawn_call_is_pinned("claude-code", {})
        assert pinned is False
        assert "run_in_background" in reason
