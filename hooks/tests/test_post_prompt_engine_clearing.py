"""
Tests for hooks/post-prompt-engine.py session-row lifecycle.

Rows were written on every parse and cleared by nothing but the 24h sweep, so
a resolved gate ("Execution complete.", no markers) left its pending_gate row
behind and recovery hooks re-injected long-resolved state after compaction.
These pin the clearing boundaries:

  - verdict/cancel submission + marker-less response  → row cleared
  - explicit completion marker + nothing pending      → row cleared
  - final step merely DELIVERED ("Step 2 of 2")       → row kept (in flight)
  - FAIL verdict re-issuing a gate review             → row kept (gate pending)
"""

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


def _payload(content: str, tool_input: dict | None = None, session_id: str = "sess-clear") -> dict:
    return {
        "tool_name": "mcp__claude-prompts__prompt_engine",
        "session_id": session_id,
        "tool_input": tool_input or {},
        "tool_response": {"content": content},
    }


class TestSessionRowClearing:
    def test_a_resolved_verdict_clears_the_row(self, workspace):
        """Gate armed → PASS verdict → 'Execution complete.' (no markers).
        Previously the pending_gate row survived until the 24h sweep."""
        arm = _run_hook(_payload(GATE_REVIEW_RESPONSE, {"command": ">>demo"}), workspace)
        assert arm.returncode == 0
        assert _load_row(workspace, "sess-clear") is not None

        resolve = _run_hook(
            _payload("Execution complete.", {"chain_id": "chain-demo#1", "gate_verdict": "GATE_REVIEW: PASS - ok"}),
            workspace,
        )
        assert resolve.returncode == 0
        assert _load_row(workspace, "sess-clear") is None

    def test_a_cancel_clears_the_row(self, workspace):
        _run_hook(_payload("Step 1 of 3 chain-demo#1", {"command": ">>demo"}), workspace)
        assert _load_row(workspace, "sess-clear") is not None

        _run_hook(_payload("Run cancelled.", {"chain_id": "chain-demo#1", "cancel": True}), workspace)
        assert _load_row(workspace, "sess-clear") is None

    def test_chain_completion_clears_the_row(self, workspace):
        _run_hook(_payload("Step 2 of 2 chain-demo#1", {"command": ">>demo"}), workspace)
        assert _load_row(workspace, "sess-clear") is not None

        _run_hook(_payload("Chain complete (2/2) chain-demo#1", {"chain_id": "chain-demo#1"}), workspace)
        assert _load_row(workspace, "sess-clear") is None

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
            _payload(GATE_REVIEW_RESPONSE, {"chain_id": "chain-demo#1", "gate_verdict": "GATE_REVIEW: FAIL - nope"}),
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
