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
