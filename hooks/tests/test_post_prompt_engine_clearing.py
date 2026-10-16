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


def _run_hook(payload: dict, workspace: Path, hook: Path = HOOK) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["MCP_WORKSPACE"] = str(workspace)
    for leaked in ("CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath", "MCP_RUNTIME_ROOT"):
        env.pop(leaked, None)
    return subprocess.run(
        [sys.executable, str(hook)],
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
    structured: dict | None = None,
) -> dict:
    response = {"content": content, **({"isError": is_error} if is_error is not None else {})}
    return {
        "tool_name": "mcp__claude-prompts__prompt_engine",
        "session_id": session_id,
        "tool_input": tool_input or {},
        "tool_response": {**response, **({"structuredContent": structured} if structured else {})},
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


TOKEN = "tok-SECRET-1"
INTERRUPT = "Step 2 of 3 chain-demo#1\n\n**Chain Paused** Resolve with `chain_id=chain-demo#1` plus one of:\n\n- gate_action:resume\n"
PAUSE = {"kind": "conversation", "nodeId": "n2", "pausedAt": 1}


def _control(outcome: str, *, pause: dict | None = None, workspace: str = "w", chain: str = "chain-demo#1") -> dict:
    run = {"runId": "r", "chainId": chain, "step": {"current": 2, "total": 3}, "pause": pause}
    run["scope"] = {"organizationId": None, "workspaceId": workspace, "continuityScopeId": "w"}
    run["obligations"] = [{"kind": "blocking-unknown", "nodeId": "n2", "step": 2}]
    packet = {"kind": "conversation_control", "outcome": outcome, "run": run}
    return {"conversation_control": packet, "message": f"Recovery token: `{TOKEN}`"}


def _call(action: str, structured: dict | None, *, is_error: bool | None = False) -> dict:
    tool_input = {"chain_id": "chain-demo#1", "gate_action": action}
    return _payload(f"⏸️ step 2 of 3. Recovery token: `{TOKEN}`", tool_input, is_error=is_error, structured=structured)


def _pause(workspace: Path) -> dict:
    _run_hook(_payload(INTERRUPT, {"command": ">>demo"}), workspace)
    _run_hook(_call("pause", _control("paused", pause=PAUSE)), workspace)
    return _load_row(workspace, "sess-clear")


def _gate_reason(workspace: Path) -> str:
    call = _payload("", {"chain_id": "chain-demo#1", "user_response": "x"})
    gate = _run_hook(call, workspace, HOOK.parent / "gate-enforce.py")
    return json.loads(gate.stdout)["hookSpecificOutput"]["permissionDecisionReason"]


class TestConversationControlPacket:
    def test_pause_records_identity_pause_and_custody_never_the_token(self, workspace):
        row = _pause(workspace)
        identity = {"run_id": "r", "chain_id": "chain-demo#1", "organization_id": None, "workspace_id": "w"}
        assert row["run_identity"] == {**identity, "continuity_scope_id": "w"}
        assert row["conversation_pause"] == {"kind": "conversation", "node_id": "n2", "paused_at": 1}
        assert row["owed"] == [{"kind": "blocking-unknown", "node_id": "n2", "step": 2}]
        assert row["pause_custody"] == "owned" and "message" not in row
        stored = [path.read_bytes() for path in workspace.rglob("hooks-state.db*")]
        assert stored and not any(TOKEN.encode() in data for data in stored)
        assert _gate_reason(workspace).startswith("Workflow paused for conversation at step 2 of 3")

    def test_resume_clears_only_the_pause_and_the_held_unknown_is_required_again(self, workspace):
        before = _pause(workspace)
        assert before["run_identity"]["run_id"] == "r" and before["pause_custody"] == "owned"
        _run_hook(_call("resume", _control("resumed")), workspace)
        paused_keys = ("conversation_pause", "owed", "pause_custody")
        assert _load_row(workspace, "sess-clear") == {key: v for key, v in before.items() if key not in paused_keys}
        assert _gate_reason(workspace).startswith("Chain paused: blocking unknown interrupt")

    def test_a_claimed_pause_restores_its_owed_hold_after_resume(self, workspace):
        _run_hook(_payload(f"`{TOKEN}`", {"claim_token": "t"}, structured=_control("claimed", pause=PAUSE)), workspace)
        assert _load_row(workspace, "sess-clear")["pause_custody"] == "owned"
        _run_hook(_call("resume", _control("resumed")), workspace)
        row = _load_row(workspace, "sess-clear")
        assert (row["pending_gate"], "conversation_pause" in row) == ("blocking unknown interrupt", False)

    @pytest.mark.parametrize(
        ("structured", "is_error"),
        [
            (_control("resumed"), True),
            (_control("resumed"), None),
            ({"conversation_control": {**_control("resumed")["conversation_control"], "outcome": "refused"}}, False),
            (None, False),
            ({"conversation_control": {"kind": "conversation_control", "outcome": "resumed"}}, False),
            (_control("resumed", workspace="other"), False),
            (_control("resumed", chain="chain-other#1"), False),
        ],
        ids=["is-error", "status-unreported", "refused", "missing-packet", "no-run", "wrong-scope", "foreign-chain"],
    )
    def test_unproven_control_reply_leaves_the_pause_tracked(self, workspace, structured, is_error):
        before = _pause(workspace)
        _run_hook(_call("resume", structured, is_error=is_error), workspace)
        assert _load_row(workspace, "sess-clear") == before

    def test_applied_abort_clears_a_paused_run_and_a_subagent_packet_writes_nothing(self, workspace):
        before = _pause(workspace)
        _run_hook({**_call("resume", _control("resumed")), "agent_id": "w1"}, workspace)
        assert _load_row(workspace, "sess-clear") == before
        abort = {"chain_id": "chain-demo#1", "gate_action": "abort"}
        _run_hook(_payload("🛑 **Chain Cancelled**: `chain-demo#1`", abort), workspace)
        assert _load_row(workspace, "sess-clear") is None
