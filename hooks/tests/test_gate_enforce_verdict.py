"""
Tests for hooks/gate-enforce.py verdict-shape handling.

gate_verdict reaches the hook in two schema shapes: the structured object
{overall, rationale, per_gate[]} (preferred) and the legacy
"GATE_REVIEW: FAIL - reason" string. The structured shape crashed the hook
with TypeError until 2026-08-03 (surfaced by the codex-prompts E2E port);
because hook failures are fail-open, that meant object verdicts were never
gate-enforced.
"""

import importlib.util
import io
import json
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


class TestStructuredVerdict:
    def test_fail_object_denies(self, monkeypatch, capsys):
        code, out = run_hook(
            monkeypatch,
            capsys,
            {
                "chain_id": "chain-demo#1",
                "gate_verdict": {
                    "overall": "FAIL",
                    "rationale": "criteria unmet",
                    "per_gate": [{"index": 1, "passed": False, "rationale": "g: no"}],
                },
            },
        )
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert "criteria unmet" in out["hookSpecificOutput"]["permissionDecisionReason"]

    def test_pass_object_allows(self, monkeypatch, capsys):
        code, out = run_hook(
            monkeypatch,
            capsys,
            {
                "chain_id": "chain-demo#1",
                "gate_verdict": {"overall": "PASS", "rationale": "all met"},
            },
        )
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"


class TestPendingGateResolution:
    """A pending gate must accept every contract-flagged resolution verb.

    The hook's previous hardcoded model (chain_id without gate_verdict -> deny) blocked
    `cancel: true` and `gate_action: "abort"` — both server-supported exits — so a pending
    gate trapped its own abort (2026-08-20). The verb set now comes from
    lib/_generated/resolution_verbs.py, emitted by server/scripts/generate-contracts.ts.
    """

    PENDING: ClassVar[dict] = {"pending_gate": "code-review"}

    def run_pending(self, monkeypatch, capsys, tool_input):
        monkeypatch.setattr(hook_mod, "load_session_state", lambda _sid: dict(self.PENDING))
        return run_hook(monkeypatch, capsys, tool_input)

    def test_cancel_true_allows(self, monkeypatch, capsys):
        code, out = self.run_pending(monkeypatch, capsys, {"chain_id": "chain-demo#1", "cancel": True})
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    @pytest.mark.parametrize("action", ["retry", "skip", "abort"])
    def test_gate_action_allows(self, monkeypatch, capsys, action):
        code, out = self.run_pending(monkeypatch, capsys, {"chain_id": "chain-demo#1", "gate_action": action})
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

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
        assert "cancel" in reason
        assert "gate_action" in reason

    def test_cancel_false_still_denies(self, monkeypatch, capsys):
        code, out = self.run_pending(monkeypatch, capsys, {"chain_id": "chain-demo#1", "cancel": False})
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


class TestLegacyStringVerdict:
    def test_fail_string_denies(self, monkeypatch, capsys):
        code, out = run_hook(
            monkeypatch,
            capsys,
            {
                "chain_id": "chain-demo#1",
                "gate_verdict": "GATE_REVIEW: FAIL - not good enough",
            },
        )
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_pass_string_allows(self, monkeypatch, capsys):
        code, out = run_hook(
            monkeypatch,
            capsys,
            {
                "chain_id": "chain-demo#1",
                "gate_verdict": "GATE_REVIEW: PASS - solid",
            },
        )
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"
