"""
Verdict parameter admission through real hook subprocesses; pending-run policy probes are local.
"""

import importlib.util
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import ClassVar

import pytest

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

spec = importlib.util.spec_from_file_location(
    "gate_enforce",
    HOOKS_DIR / "gate-enforce.py",
)
hook_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook_mod)


def run_hook(monkeypatch, capsys, tool_input):
    payload = {
        "session_id": "gate-verdict-test",
        "hook_event_name": "PreToolUse",
        "tool_name": "mcp__claude_prompts_mcp__prompt_engine",
        "tool_input": tool_input,
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        hook_mod.main()
    out = capsys.readouterr().out
    return excinfo.value.code, json.loads(out) if out.strip() else {}


def run_verdict_subprocess(tool_input, workspace):
    payload = {"tool_name": "prompt_engine", "tool_input": tool_input, "session_id": "verdict-shape"}
    result = subprocess.run(
        [sys.executable, str(HOOKS_DIR / "gate-enforce.py")],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=30,
        env={**os.environ, "MCP_WORKSPACE": str(workspace)},
    )
    print(
        json.dumps(
            {"tool_input": tool_input, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
        )
    )
    assert result.stderr == ""
    return result.returncode, json.loads(result.stdout) if result.stdout.strip() else {}


class TestStructuredVerdict:
    def test_fail_object_allows(self, tmp_path):
        code, out = run_verdict_subprocess(
            {
                "chain_id": "chain-demo#1",
                "gate_verdict": {
                    "overall": "FAIL",
                    "rationale": "criteria unmet",
                    "per_gate": [{"index": 1, "passed": False, "rationale": "g: no"}],
                },
            },
            tmp_path,
        )
        assert code == 0
        assert out == {}

    def test_pass_object_allows(self, tmp_path):
        code, out = run_verdict_subprocess(
            {
                "chain_id": "chain-demo#1",
                "gate_verdict": {"overall": "PASS", "rationale": "all met"},
            },
            tmp_path,
        )
        assert code == 0
        assert out == {}


class TestPendingGateResolution:
    """A pending gate must accept every contract-flagged resolution verb.

    A hardcoded model of pending-run exits can block `gate_action: "abort"` and trap a pending
    gate. The verb set comes from
    lib/_generated/resolution_verbs.py, emitted by server/scripts/generate-contracts.ts.
    """

    PENDING: ClassVar[dict] = {"pending_gate": "code-review"}

    def run_pending(self, monkeypatch, capsys, tool_input):
        monkeypatch.setattr(hook_mod, "load_session_state", lambda _sid: dict(self.PENDING))
        return run_hook(monkeypatch, capsys, tool_input)

    @pytest.mark.parametrize("action", ["retry", "skip", "abort"])
    def test_gate_action_allows(self, monkeypatch, capsys, action):
        code, out = self.run_pending(monkeypatch, capsys, {"chain_id": "chain-demo#1", "gate_action": action})
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    @pytest.mark.parametrize("gate", ["code-review", "detached review"])
    def test_abort_is_admitted_across_review_holds(self, monkeypatch, capsys, gate):
        monkeypatch.setattr(hook_mod, "load_session_state", lambda _sid: {"pending_gate": gate})
        bare_code, bare_out = run_hook(monkeypatch, capsys, {"chain_id": "chain-demo#1"})
        abort_code, abort_out = run_hook(monkeypatch, capsys, {"chain_id": "chain-demo#1", "gate_action": "abort"})
        assert bare_code == abort_code == 0
        assert bare_out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert abort_out == {}

    def test_bare_resume_denies_and_names_exits(self, monkeypatch, capsys):
        code, out = self.run_pending(
            monkeypatch,
            capsys,
            {"chain_id": "chain-demo#1", "user_response": "step output"},
        )
        assert code == 0
        reason = out["hookSpecificOutput"]["permissionDecisionReason"]
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        # Verdict-first message, exits named as the fallback line.
        assert "gate_verdict" in reason
        assert "cancel" not in reason
        assert "gate_action" in reason

    @pytest.mark.parametrize("retired_value", [True, False])
    def test_retired_parameter_does_not_resolve_a_pending_gate(self, monkeypatch, capsys, retired_value):
        code, out = self.run_pending(monkeypatch, capsys, {"chain_id": "chain-demo#1", "cancel": retired_value})
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_missing_artifact_fails_open(self, monkeypatch, capsys):
        monkeypatch.setattr(hook_mod, "load_resolution_params", lambda: None)
        code, out = self.run_pending(
            monkeypatch,
            capsys,
            {"chain_id": "chain-demo#1", "user_response": "step output"},
        )
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    def test_generated_artifact_matches_contract_flags(self):
        """Parity: the shipped artifact carries exactly the contract's flagged parameters."""
        contract_path = HOOKS_DIR.parent / "server" / "tooling" / "contracts" / "prompt-engine.json"
        contract = json.loads(contract_path.read_text())
        flagged = {p["name"] for p in contract["parameters"] if p.get("resolvesPendingRun") is True}
        assert flagged, "contract flags no resolution parameters"
        assert hook_mod.load_resolution_params() == flagged


class TestRetiredStringVerdict:
    @pytest.mark.parametrize(
        "verdict",
        ["GATE_REVIEW: PASS - solid", "GATE_REVIEW: FAIL - not good enough"],
        ids=["retired-pass", "retired-fail"],
    )
    def test_legacy_string_parameter_is_refused(self, tmp_path, verdict):
        code, out = run_verdict_subprocess({"chain_id": "chain-demo#1", "gate_verdict": verdict}, tmp_path)
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"
        assert out["hookSpecificOutput"]["permissionDecisionReason"].startswith("gate_verdict requires an object")


class TestMalformedVerdict:
    @pytest.mark.parametrize(
        "verdict",
        [
            {},
            {"overall": None, "rationale": "reason"},
            {"overall": [], "rationale": "reason"},
            {"overall": "pass", "rationale": "reason"},
            {"overall": "FAIL", "rationale": False},
            {"overall": "PASS", "rationale": " "},
            None,
            True,
            [],
        ],
    )
    def test_malformed_verdict_is_refused_without_crashing(self, tmp_path, verdict):
        code, out = run_verdict_subprocess({"chain_id": "chain-demo#1", "gate_verdict": verdict}, tmp_path)
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert out["hookSpecificOutput"]["permissionDecisionReason"].startswith("gate_verdict requires an object")
