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


def _aborted(outcome: str = "cancelled", chain: str = "chain-demo#1", run_id: str | None = None) -> dict:
    """An abort reply's structuredContent (prompt-executor.ts handleAbort)."""
    return {
        "run_control": {
            "action": "abort",
            "outcome": outcome,
            "chainId": chain,
            **({"runId": run_id} if run_id else {}),
        }
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
        abort_input = {"chain_id": "chain-demo#1", "gate_action": "abort"}
        abort = _run_hook(_payload(response, abort_input, structured=_aborted()), workspace)
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
            ("🛑 **Chain Cancelled**: `chain-demo#1`", {"chain_id": "chain-demo#1", "gate_action": "abort"}, False),
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
            "abort-text-without-run-control",
            "verdict-markerless",
            "completion-error",
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
        abort = {"chain_id": "chain-demo#1", "gate_action": "abort"}
        _run_hook(_payload("🛑 **Chain Cancelled**: `chain-demo#1`", abort, structured=_aborted()), workspace)
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
        tool_input, structured = {"chain_id": request_id}, None
        if action == "abort":
            tool_input["gate_action"] = "abort"
            content, structured = f"🛑 **Chain Cancelled**: `{response_id}`", _aborted(chain=response_id)
        else:
            content = f"✓ Chain complete (3/3) `{response_id}`"
        response = _run_hook(_payload(content, tool_input, is_error=is_error, structured=structured), workspace)
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
            ({"conversation_control": {**_control("resumed")["conversation_control"], "outcome": "refused"}}, False),
            (None, False),
            ({"conversation_control": {"kind": "conversation_control", "outcome": "resumed"}}, False),
            (_control("resumed", workspace="other"), False),
            (_control("resumed", chain="chain-other#1"), False),
        ],
        ids=["is-error", "refused", "missing-packet", "no-run", "wrong-scope", "foreign-chain"],
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
        _run_hook(_payload("🛑 **Chain Cancelled**: `chain-demo#1`", abort, structured=_aborted(run_id="r")), workspace)
        assert _load_row(workspace, "sess-clear") is None


# Native Claude Code 2.1.299 PostToolUse shapes, captured verbatim by the T3.2p probe (token redacted):
# a step without structuredContent arrives as a list of blocks; a control reply as the JSON string of
# its structuredContent, with no `content` and no `isError`.
NATIVE_STEP = [
    {
        "type": "text",
        "text": "**Gate Review Required** (attempt 1/2)\n\n\n\nReview your output above against the gates, "
        'then submit:\n\nChain: chain-quick_decision#1\n→ Progress 1/3\nNext: chain_id="chain-quick_decision#1", '
        'user_response="<your step output>", gate_verdict={"overall": "PASS|FAIL", "rationale": "<why>"}',
    }
]
NATIVE_RUN = (
    '{"runId":"7d3d8de2-e3d1-4566-ad74-145c59691b67","chainId":"chain-quick_decision#1","scope":{"organizationId":'
    'null,"workspaceId":"cwd","continuityScopeId":"cwd"},"currentNodeId":"options-1-3","step":{"current":1,'
    '"total":3},"pause":%s,"obligations":[{"kind":"review","nodeId":"options-1-3","step":1,"review":{"kind":'
    '"gate","phase":"awaiting-verdict"}}]}'
)
NATIVE_PAUSE = '{"kind":"conversation","nodeId":"options-1-3","pausedAt":1792111389179}'
NATIVE_PAUSED = (
    '{"conversation_control":{"kind":"conversation_control","outcome":"paused","run":%s},"message":"⏸️ '
    "**Workflow Paused**: `chain-quick_decision#1` at step 1 of 3.\\n\\nRecovery token: `hnd_redacted` — "
    'claim the paused run from another client with `prompt_engine(claim_token:\\"…\\")`."}'
) % (NATIVE_RUN % NATIVE_PAUSE)
NATIVE_RESUMED = (
    '{"conversation_control":{"kind":"conversation_control","outcome":"resumed","run":%s},"message":"▶️ '
    '**Workflow Resumed**: `chain-quick_decision#1` at step 1 of 3. Nothing was captured, graded or advanced."}'
) % (NATIVE_RUN % "null")
NATIVE_PAUSED_REFUSAL = (
    '{"conversation_control":{"kind":"conversation_control","outcome":"refused","refusal":{"reason":'
    '"conversation-paused","retryable":false},"run":%s},"message":"⏸️ **Workflow Paused**: refused."}'
) % (NATIVE_RUN % NATIVE_PAUSE)
NATIVE_BUSY = (
    '{"conversation_control":{"kind":"conversation_control","outcome":"refused","refusal":{"reason":"busy",'
    '"retryable":true}},"message":"⏳ **Control Busy**: `chain-quick_decision#1`"}'
)
NATIVE_CHAIN = "chain-quick_decision#1"


def _native(tool_response: object, tool_input: dict) -> dict:
    payload = {"tool_name": "mcp__cpprobe__prompt_engine", "session_id": "sess-native", "tool_input": tool_input}
    return {**payload, "tool_response": tool_response}


def _native_step(workspace: Path) -> dict:
    _run_hook(_native(NATIVE_STEP, {"command": '>>quick_decision topic:"pick a database"'}), workspace)
    return _load_row(workspace, "sess-native")


class TestNativeHostShapes:
    def test_read_tool_response_reads_every_shape(self):
        sys.path.insert(0, str(HOOKS_LIB))
        try:
            from session_state import read_tool_response
        finally:
            sys.path.remove(str(HOOKS_LIB))
        text, structured, flag = read_tool_response(NATIVE_PAUSED)
        assert structured["conversation_control"]["outcome"] == "paused" and flag is None
        assert text.startswith("⏸️ **Workflow Paused**")
        assert (
            read_tool_response(NATIVE_STEP)[1:] == (None, None) and "Progress 1/3" in read_tool_response(NATIVE_STEP)[0]
        )
        legacy = {"content": [{"type": "text", "text": "a"}], "isError": False, "structuredContent": {"k": 1}}
        assert read_tool_response(legacy) == ("a", {"k": 1}, False)
        assert read_tool_response("plain text") == ("plain text", None, None)

    def test_native_pause_then_resume_is_tracked_and_the_token_never_stored(self, workspace):
        step = _native_step(workspace)
        assert (step["chain_id"], step["pending_gate"]) == (NATIVE_CHAIN, "review")
        _run_hook(_native(NATIVE_PAUSED, {"chain_id": NATIVE_CHAIN, "gate_action": "pause"}), workspace)
        paused = _load_row(workspace, "sess-native")
        assert paused["run_identity"]["run_id"] == "7d3d8de2-e3d1-4566-ad74-145c59691b67"
        assert paused["conversation_pause"] == {
            "kind": "conversation",
            "node_id": "options-1-3",
            "paused_at": 1792111389179,
        }
        assert paused["pause_custody"] == "owned" and paused["pending_gate"] == "review"
        stored = [path.read_bytes() for path in workspace.rglob("hooks-state.db*")]
        assert stored and not any(b"hnd_" in data for data in stored)
        _run_hook(_native(NATIVE_RESUMED, {"chain_id": NATIVE_CHAIN, "gate_action": "resume"}), workspace)
        resumed = _load_row(workspace, "sess-native")
        assert "conversation_pause" not in resumed and "pause_custody" not in resumed
        assert resumed["pending_gate"] == "review"

    @pytest.mark.parametrize("reply", [NATIVE_PAUSED_REFUSAL, NATIVE_BUSY], ids=["paused-refusal", "busy"])
    def test_a_native_refusal_never_applies(self, workspace, reply):
        before = _native_step(workspace)
        _run_hook(_native(reply, {"chain_id": NATIVE_CHAIN, "gate_action": "pause"}), workspace)
        assert _load_row(workspace, "sess-native") == before


NATIVE_RUN_ID = "7d3d8de2-e3d1-4566-ad74-145c59691b67"
NATIVE_ABORT = {"chain_id": NATIVE_CHAIN, "gate_action": "abort"}


def _native_abort(outcome: str, run_id: str = NATIVE_RUN_ID) -> str:
    """The native abort reply: the JSON string of its structuredContent -- no text, no isError."""
    return json.dumps(_aborted(outcome, NATIVE_CHAIN, run_id))


def _native_paused(workspace: Path) -> dict:
    _native_step(workspace)
    _run_hook(_native(NATIVE_PAUSED, {"chain_id": NATIVE_CHAIN, "gate_action": "pause"}), workspace)
    return _load_row(workspace, "sess-native")


class TestNativeTerminalClearing:
    """The three clears on the shapes Claude Code actually sends (no `isError`, no `content` key)."""

    def test_a_cancelled_abort_clears_the_paused_run(self, workspace):
        assert "conversation_pause" in _native_paused(workspace)
        _run_hook(_native(_native_abort("cancelled"), NATIVE_ABORT), workspace)
        assert _load_row(workspace, "sess-native") is None

    @pytest.mark.parametrize(
        ("outcome", "run_id"),
        [("release-incomplete", NATIVE_RUN_ID), ("not-applied", NATIVE_RUN_ID), ("cancelled", "another-run")],
        ids=["release-incomplete", "not-applied", "another-run-same-chain"],
    )
    def test_an_abort_that_did_not_cancel_this_run_keeps_it(self, workspace, outcome, run_id):
        before = _native_paused(workspace)
        _run_hook(_native(_native_abort(outcome, run_id), NATIVE_ABORT), workspace)
        assert _load_row(workspace, "sess-native") == before

    def test_a_completed_verdict_clears_the_gate_row(self, workspace):
        assert _native_step(workspace)["pending_gate"] == "review"
        verdict = {"chain_id": NATIVE_CHAIN, "gate_verdict": {"overall": "PASS", "rationale": "ok"}}
        _run_hook(_native([{"type": "text", "text": "Execution complete."}], verdict), workspace)
        assert _load_row(workspace, "sess-native") is None

    def test_chain_completion_clears_the_row(self, workspace):
        _native_step(workspace)
        done = "Final answer.\n\n---\nChain: chain-quick_decision#1\n✓ Chain complete (3/3)"
        _run_hook(_native([{"type": "text", "text": done}], {"chain_id": NATIVE_CHAIN}), workspace)
        assert _load_row(workspace, "sess-native") is None

    @pytest.mark.parametrize(
        "tool_input", [{"command": ">>other"}, {"chain_id": "chain-other#1"}], ids=["no-chain", "other-chain"]
    )
    def test_an_unrelated_prompt_run_keeps_the_tracked_pause(self, workspace, tool_input):
        before = _native_paused(workspace)
        other = [{"type": "text", "text": "**Review Required**\n\n**Gates**: code-quality\n\n→ Progress 1/2"}]
        _run_hook(_native(other, tool_input), workspace)
        assert _load_row(workspace, "sess-native") == before

    def test_the_paused_runs_own_step_still_replaces_its_row(self, workspace):
        _native_paused(workspace)  # positive control: the guard keys on the chain, not on any reply
        _run_hook(_native([{"type": "text", "text": "→ Progress 2/3"}], {"chain_id": NATIVE_CHAIN}), workspace)
        row = _load_row(workspace, "sess-native")
        assert row["current_step"] == 2 and "conversation_pause" not in row


class TestPauseIdentityAndGuidance:
    def _lib(self):
        sys.path.insert(0, str(HOOKS_LIB))
        try:
            import session_state

            return session_state
        finally:
            sys.path.remove(str(HOOKS_LIB))

    @pytest.mark.parametrize("missing", ["organization_id", "workspace_id", "run_id"])
    def test_a_partial_identity_is_none_not_a_crash(self, missing):
        full = {
            "run_id": "r",
            "chain_id": "c",
            "organization_id": None,
            "workspace_id": "w",
            "continuity_scope_id": "w",
        }
        lib = self._lib()
        assert lib.exact_run_identity(full) == full
        assert lib.exact_run_identity({k: v for k, v in full.items() if k != missing}) is None

    def test_unconfirmed_shows_the_calls_and_retained_keeps_the_claim(self):
        lib = self._lib()
        identity = {"run_id": "r", "chain_id": "chain-demo#1", "organization_id": None}
        identity |= {"workspace_id": "w", "continuity_scope_id": "w"}
        paused = {"chain_id": "chain-demo#1", "run_identity": identity, "conversation_pause": {"kind": "conversation"}}
        unconfirmed = lib.format_pause_directive({**paused, "pause_custody": "unconfirmed"})
        assert 'prompt_engine(chain_id:"chain-demo#1", gate_action:"resume")' in unconfirmed
        assert 'gate_action:"abort"' in unconfirmed and "not confirmed live" in unconfirmed
        retained = lib.format_pause_directive({**paused, "pause_custody": "retained"})
        assert retained.endswith(lib.PAUSE_RECOVERY_GUIDANCE) and 'gate_action:"resume"' not in retained
