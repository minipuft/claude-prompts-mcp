"""Session-row clearing from prompt_engine terminal responses in an isolated workspace."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).parent.parent / "post-prompt-engine.py"
HOOKS_LIB = Path(__file__).parent.parent / "lib"

GATE_REVIEW_RESPONSE = "**Review Required**\n\n**Gates**: code-quality\n\nSubmit gate_verdict via prompt_engine."


def _run_hook(payload: dict, workspace: Path) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["MCP_WORKSPACE"] = str(workspace)
    for leaked in ("CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath", "MCP_RUNTIME_ROOT"):
        env.pop(leaked, None)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def _load_row(workspace: Path, session_id: str) -> dict | None:
    """Read the session row the way the recovery hooks do."""
    env_backup = {k: os.environ.get(k) for k in ("MCP_WORKSPACE",)}
    os.environ["MCP_WORKSPACE"] = str(workspace)
    sys.path.insert(0, str(HOOKS_LIB))
    try:
        from session_state import load_session_state

        return load_session_state(session_id)
    finally:
        sys.path.remove(str(HOOKS_LIB))
        for k, v in env_backup.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@pytest.fixture
def workspace(tmp_path):
    ws = tmp_path / "ws"
    (ws / "server" / "runtime-state").mkdir(parents=True)
    return ws


def _payload(
    content: str,
    tool_input: dict | None = None,
    session_id: str = "sess-clear",
    *,
    is_error: bool | None = False,
) -> dict:
    return {
        "tool_name": "mcp__claude-prompts__prompt_engine",
        "session_id": session_id,
        "tool_input": tool_input or {},
        "tool_response": {"content": content, **({"isError": is_error} if is_error is not None else {})},
    }


class TestSessionRowClearing:
    def test_a_resolved_verdict_clears_the_row(self, workspace):
        """Gate armed → PASS verdict → 'Execution complete.' (no markers).
        Previously the pending_gate row survived until the 24h sweep."""
        arm = _run_hook(_payload(GATE_REVIEW_RESPONSE, {"command": ">>demo"}), workspace)
        assert arm.returncode == 0
        assert _load_row(workspace, "sess-clear") is not None

        resolve = _run_hook(
            _payload(
                "Execution complete.",
                {"chain_id": "chain-demo#1", "gate_verdict": {"overall": "PASS", "rationale": "ok"}},
            ),
            workspace,
        )
        assert resolve.returncode == 0
        assert _load_row(workspace, "sess-clear") is None

    def test_authoritative_abort_clears_the_matching_tracked_run(self, workspace):
        _run_hook(_payload("Step 1 of 3 chain-demo#1", {"command": ">>demo"}), workspace)
        assert _load_row(workspace, "sess-clear")["chain_id"] == "chain-demo#1"

        response = "🛑 **Chain Cancelled**: `chain-demo#1`\n\nFurther progression is blocked."
        abort = _run_hook(_payload(response, {"chain_id": "chain-demo#1", "gate_action": "abort"}), workspace)
        assert abort.returncode == 0
        assert _load_row(workspace, "sess-clear") is None

    @pytest.mark.parametrize(
        ("content", "tool_input", "is_error"),
        [
            ("⚠️ **Abort Not Applied**: `chain-demo#1`", {"chain_id": "chain-demo#1", "gate_action": "abort"}, True),
            ("🛑 **Chain Cancelled**: `chain-demo#1`", {"chain_id": "chain-demo#1", "gate_action": "abort"}, True),
            ("Nothing was recorded.", {"chain_id": "chain-demo#1", "gate_action": "abort"}, False),
            ("🛑 **Chain Cancelled**: `chain-demo#1`", {"chain_id": "chain-demo#1"}, False),
            ("🛑 **Chain Cancelled**: `other#1`", {"chain_id": "chain-demo#1", "gate_action": "abort"}, False),
            ("🛑 **Chain Cancelled**: `other#1`", {"chain_id": "other#1", "gate_action": "abort"}, False),
            ("🛑 **Chain Cancelled**: `chain-demo#1`", {"chain_id": "chain-demo#1", "gate_action": "abort"}, None),
            (
                "Nothing was recorded.",
                {"chain_id": "chain-demo#1", "gate_verdict": {"overall": "PASS", "rationale": "ok"}},
                False,
            ),
            (
                "Execution complete.",
                {"chain_id": "chain-demo#1", "gate_verdict": {"overall": "PASS", "rationale": "ok"}},
                True,
            ),
            (
                "Execution complete.",
                {"chain_id": "chain-demo#1", "gate_verdict": {"overall": "PASS", "rationale": "ok"}},
                None,
            ),
            (
                "Execution complete.",
                {"chain_id": "other#1", "gate_verdict": {"overall": "PASS", "rationale": "ok"}},
                False,
            ),
        ],
        ids=[
            "abort-refused",
            "abort-error-with-success-words",
            "abort-markerless",
            "abort-without-request-action",
            "abort-response-id-mismatch",
            "abort-request-id-mismatch",
            "abort-status-unreported",
            "verdict-markerless",
            "completion-error",
            "completion-status-unreported",
            "completion-request-id-mismatch",
        ],
    )
    def test_unproven_terminal_response_preserves_tracker(self, workspace, content, tool_input, is_error):
        _run_hook(_payload("Step 1 of 3 chain-demo#1", {"command": ">>demo"}), workspace)
        before = _load_row(workspace, "sess-clear")
        response = _run_hook(_payload(content, tool_input, is_error=is_error), workspace)
        assert response.returncode == 0
        assert _load_row(workspace, "sess-clear") == before

    def test_chain_completion_clears_the_row(self, workspace):
        _run_hook(_payload("Step 2 of 2 chain-demo#1", {"command": ">>demo"}), workspace)
        assert _load_row(workspace, "sess-clear") is not None

        _run_hook(_payload("Chain complete (2/2) chain-demo#1", {"chain_id": "chain-demo#1"}), workspace)
        assert _load_row(workspace, "sess-clear") is None

    def test_completion_for_another_run_preserves_tracker(self, workspace):
        _run_hook(_payload("Step 1 of 3 chain-demo#1", {"command": ">>demo"}), workspace)
        before = _load_row(workspace, "sess-clear")
        _run_hook(_payload("✓ Chain complete (3/3) chain-other#1", {"chain_id": "chain-demo#1"}), workspace)
        assert _load_row(workspace, "sess-clear") == before

    def test_abort_does_not_clear_a_gate_only_tracker_without_run_identity(self, workspace):
        _run_hook(_payload(GATE_REVIEW_RESPONSE, {"command": ">>demo"}), workspace)
        before = _load_row(workspace, "sess-clear")
        assert before["chain_id"] == ""
        _run_hook(
            _payload("🛑 **Chain Cancelled**: `chain-demo#1`", {"chain_id": "chain-demo#1", "gate_action": "abort"}),
            workspace,
        )
        assert _load_row(workspace, "sess-clear") == before

    def test_a_delivered_final_step_is_kept(self, workspace):
        """'Step 2 of 2' is the final step IN FLIGHT, not completion — the row
        must survive so recovery can still remind after a compaction."""
        _run_hook(_payload("Step 2 of 2 chain-demo#1", {"command": ">>demo"}), workspace)

        row = _load_row(workspace, "sess-clear")
        assert row is not None
        assert row["current_step"] == 2

    def test_a_fail_verdict_reissuing_the_gate_keeps_the_row(self, workspace):
        """FAIL → the engine re-issues the gate review; the row stays pending."""
        _run_hook(_payload(GATE_REVIEW_RESPONSE, {"command": ">>demo"}), workspace)

        _run_hook(
            _payload(
                GATE_REVIEW_RESPONSE,
                {"chain_id": "chain-demo#1", "gate_verdict": {"overall": "FAIL", "rationale": "nope"}},
            ),
            workspace,
        )

        row = _load_row(workspace, "sess-clear")
        assert row is not None
        assert row.get("pending_gate")

    def test_completion_with_a_pending_gate_is_kept(self, workspace):
        """A final-step gate review says 'complete' AND arms a gate — pending
        wins over the completion marker."""
        _run_hook(
            _payload(f"Chain complete (2/2) chain-demo#1\n\n{GATE_REVIEW_RESPONSE}", {"chain_id": "chain-demo#1"}),
            workspace,
        )

        row = _load_row(workspace, "sess-clear")
        assert row is not None
        assert row.get("pending_gate")


class TestQualifiedTerminalBinding:
    @pytest.mark.parametrize(
        ("tracked", "response_id", "request_id", "action", "is_error", "cleared"),
        [
            ("chain-plan/table#1", "chain-plan/table#1", "chain-plan/table#1", "abort", False, True),
            (
                "chain-plan/table/detail#01",
                "chain-plan/table/detail#01",
                "chain-plan/table/detail#01",
                "complete",
                False,
                True,
            ),
            ("chain-plan/table#1", "chain-plan#1", "chain-plan/table#1", "abort", False, False),
            ("chain-plan/table#1", "chain-plan/table#1", "chain-plan#1", "abort", False, False),
            (
                "chain-plan/table/detail#01",
                "chain-plan/table/detail#1",
                "chain-plan/table/detail#01",
                "complete",
                False,
                False,
            ),
            ("chain-plan/table#1", "chain-plan/table#1", "chain-plan/table#1", "abort", True, False),
            ("chain-plan/table#1", "chain-plan#1", "chain-plan/table#1", "complete", False, False),
        ],
        ids=[
            "qualified-abort",
            "deep-raw-completion",
            "short-abort-response",
            "short-abort-request",
            "normalized-completion-response",
            "abort-error",
            "short-completion-response",
        ],
    )
    def test_terminal_response_binds_the_exact_tracked_token(
        self, workspace, tracked, response_id, request_id, action, is_error, cleared
    ):
        arm = _run_hook(_payload(f"Step 1 of 3 `{tracked}`", {"command": ">>plan/table"}), workspace)
        assert arm.returncode == 0
        before = _load_row(workspace, "sess-clear")
        assert before["chain_id"] == tracked
        tool_input = {"chain_id": request_id}
        if action == "abort":
            tool_input["gate_action"] = "abort"
            content = f"🛑 **Chain Cancelled**: `{response_id}`"
        else:
            content = f"✓ Chain complete (3/3) `{response_id}`"
        response = _run_hook(_payload(content, tool_input, is_error=is_error), workspace)
        assert response.returncode == 0
        after = _load_row(workspace, "sess-clear")
        if cleared:
            assert after is None
        else:
            assert after == before
