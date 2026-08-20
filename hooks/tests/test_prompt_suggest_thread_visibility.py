"""
Regression tests for the 2026-08-19 thread-visibility fix.

`prompt-suggest.py` returns two channels: `systemMessage` (human-readable) and
`hookSpecificOutput.additionalContext` (the <CALL-TOOL> directive). Clients that
do not consume hook events render only the second one -- T3 Code emits
hook.started/hook.progress/hook.completed and has no consumer for any of them.

The unknown-prompt path has always assigned the SAME string to both fields, so a
mistyped >>invocation surfaced its suggestions while a SUCCESSFUL one surfaced
nothing at all. These tests pin the fix: the resolution line now rides
`additionalContext` too, and the directive that follows it is unweakened.

The prompt cache is stubbed throughout -- these assertions are about routing,
and must not change meaning when the user's prompt library does.
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
_spec = importlib.util.spec_from_file_location("prompt_suggest", HOOKS_DIR / "prompt-suggest.py")
prompt_suggest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prompt_suggest)


CATALOG = {
    "demo_prompt": {
        "description": "A demo prompt",
        "arguments": [
            {"name": "content", "type": "string", "required": True},
            {"name": "scope", "type": "string", "required": False},
        ],
    },
    "demo_chain": {
        "description": "A demo chain",
        "is_chain": True,
        "chain_steps": 2,
        "chain_step_ids": ["step_one", "step_two"],
        "chain_step_names": ["Step One", "Step Two"],
        "arguments": [],
    },
    "step_one": {"description": "first", "arguments": []},
    "step_two": {"description": "second", "arguments": []},
}


@pytest.fixture
def stub_cache(monkeypatch):
    """Pin the prompt catalog so routing assertions do not depend on the
    user's live prompt library."""
    monkeypatch.setattr(prompt_suggest, "load_prompts_cache", lambda: True)
    monkeypatch.setattr(prompt_suggest, "get_prompt_by_id", lambda pid: CATALOG.get(pid))
    monkeypatch.setattr(prompt_suggest, "get_valid_frameworks", lambda: {"cageerf"})
    monkeypatch.setattr(prompt_suggest, "get_valid_styles", lambda: {"analytical"})
    monkeypatch.setattr(prompt_suggest, "is_expanded_output", lambda: False)
    monkeypatch.setattr(
        prompt_suggest,
        "fuzzy_match_prompt_id",
        lambda pid: ["demo_prompt"] if pid.startswith("demo") else [],
    )


def run_hook(monkeypatch, capsys, user_prompt):
    """Simulate a prompt-suggest.py UserPromptSubmit invocation."""
    payload = {"session_id": "visibility-test", "prompt": user_prompt}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        prompt_suggest.main()
    out = capsys.readouterr().out
    return excinfo.value.code, (json.loads(out) if out.strip() else {})


def context_of(out):
    return out["hookSpecificOutput"]["additionalContext"]


# ── Row 3: the hit path must reach the surviving channel ───────────────────


class TestHitPathReachesTheThread:
    def test_resolution_line_rides_additional_context(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, '>>demo_prompt content:"hello world"')
        assert code == 0
        ctx = context_of(out)
        assert "[>> prompt_engine] demo_prompt" in ctx
        assert 'content:"hello world"' in ctx

    def test_directive_survives_intact_and_stays_last(self, stub_cache, monkeypatch, capsys):
        """The prepended line must not weaken or displace the blocking
        instruction -- that directive is what makes the model call the tool."""
        code, out = run_hook(monkeypatch, capsys, '>>demo_prompt content:"x"')
        ctx = context_of(out)
        assert "<CALL-TOOL>" in ctx
        assert "REQUIRED: Execute now. Do not respond to >> prompts directly." in ctx
        assert ctx.rstrip().endswith("</CALL-TOOL>")
        assert ctx.index("[>> prompt_engine]") < ctx.index("<CALL-TOOL>")

    def test_system_message_channel_is_unchanged(self, stub_cache, monkeypatch, capsys):
        """The fix ADDS a channel; it must not remove the CLI's."""
        code, out = run_hook(monkeypatch, capsys, '>>demo_prompt content:"x"')
        assert out["systemMessage"].startswith("[>> prompt_engine] demo_prompt")

    def test_missing_required_args_are_visible(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, ">>demo_prompt")
        ctx = context_of(out)
        assert '"content"' in ctx and "missing" in ctx

    def test_operators_are_visible(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, "@CAGEERF #analytical >>demo_prompt * 3")
        ctx = context_of(out)
        # Framework/style keep the casing the user typed; only the DB lookup
        # that validates them is case-folded.
        assert "@CAGEERF" in ctx
        assert "#analytical" in ctx
        assert "*3" in ctx

    def test_chain_preview_is_visible(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, ">>demo_chain")
        ctx = context_of(out)
        assert "[Chain Workflow] 2 steps" in ctx
        assert "step_one" in ctx


# ── Row 4: the miss path gains argument signatures ─────────────────────────


class TestMissPathCarriesSignatures:
    def test_suggestion_carries_its_argument_signature(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, ">>demo_promt")
        ctx = context_of(out)
        assert "Unknown prompt 'demo_promt'" in ctx
        assert ">>demo_prompt" in ctx
        assert "content*:string" in ctx  # required marked
        assert "scope:string" in ctx  # optional unmarked

    def test_no_match_still_reports_plainly(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, ">>zzz_nothing_like_this")
        ctx = context_of(out)
        assert "No similar prompts found" in ctx

    def test_miss_path_emits_no_tool_directive(self, stub_cache, monkeypatch, capsys):
        """The early return deliberately skips a failing server round-trip."""
        code, out = run_hook(monkeypatch, capsys, ">>demo_promt")
        assert "<CALL-TOOL>" not in context_of(out)

    def test_both_channels_still_agree_on_the_miss_path(self, stub_cache, monkeypatch, capsys):
        code, out = run_hook(monkeypatch, capsys, ">>demo_promt")
        assert out["systemMessage"] == context_of(out)


class TestHelperInIsolation:
    def test_prompt_without_arguments_reads_cleanly(self, stub_cache):
        msg = prompt_suggest.format_unknown_prompt_message("step_on", ["step_one"])
        assert ">>step_one (no args)" in msg

    def test_unresolvable_suggestion_still_listed(self, stub_cache):
        """A name the user can retype beats omitting it for lack of metadata."""
        msg = prompt_suggest.format_unknown_prompt_message("ghost", ["not_in_catalog"])
        assert ">>not_in_catalog (no args)" in msg
