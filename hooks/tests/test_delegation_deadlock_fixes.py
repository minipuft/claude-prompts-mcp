"""
Regression tests for the 2026-08 session-deadlock fixes.

Three defects combined to make delegation enforcement arm on a prose mention
of "==>", fail to record which gate ids were pending, and then never
self-clear on this client — blocking every Bash/Edit/Agent call for the rest
of the session.

Defect 1 (hooks/post-prompt-engine.py): arming must come from the response's
delegation CTA markers (subagent_type / "Handoff via Task tool"), not a
substring check on the command text.

Defect 2 (hooks/lib/session_state.py): when "**Review Required**" matches but
no gate ids can be extracted, pending_gate must not silently stay None — it
must carry a sentinel ("review") so state does not claim "no review pending"
while the server is still waiting on a verdict.

Defect 3 (hooks/delegation-enforce.py + hooks/hooks.json): this client
reports its subagent tool as "Agent", not "Task" — the clear condition and
ALLOW_LIST must recognize it, and task-tracking calls (TaskCreate, etc.)
caught by the unanchored hooks.json matcher must not be treated as action
tools.
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

# Import hyphenated-filename hook modules directly (same pattern as
# test_gate_enforce_verdict.py / test_subagent_gate_enforce.py).
_post_spec = importlib.util.spec_from_file_location("post_prompt_engine", HOOKS_DIR / "post-prompt-engine.py")
post_prompt_engine = importlib.util.module_from_spec(_post_spec)
_post_spec.loader.exec_module(post_prompt_engine)

_deleg_spec = importlib.util.spec_from_file_location("delegation_enforce", HOOKS_DIR / "delegation-enforce.py")
delegation_enforce = importlib.util.module_from_spec(_deleg_spec)
_deleg_spec.loader.exec_module(delegation_enforce)

from session_state import (
    format_chain_reminder,
    load_session_state,
    parse_prompt_engine_response,
    save_session_state,
)


def run_post_prompt_engine(monkeypatch, capsys, *, session_id, content, tool_input=None):
    """Simulate a post-prompt-engine.py PostToolUse invocation."""
    payload = {
        "session_id": session_id,
        "tool_name": "mcp__claude-prompts__prompt_engine",
        "tool_input": tool_input or {},
        "tool_response": {"content": content},
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        post_prompt_engine.main()
    out = capsys.readouterr().out
    return excinfo.value.code, (json.loads(out) if out.strip() else {})


def run_delegation_enforce(monkeypatch, capsys, *, session_id, tool_name):
    """Simulate a delegation-enforce.py PreToolUse invocation."""
    payload = {"session_id": session_id, "tool_name": tool_name}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        delegation_enforce.main()
    out = capsys.readouterr().out
    return excinfo.value.code, (json.loads(out) if out.strip() else {})


# ── Defect 1: arm from response CTA, not command prose ─────────────────────


class TestDefect1DelegationArming:
    def test_prose_mention_of_operator_does_not_arm(self, patch_workspace, monkeypatch, capsys):
        """A command whose PROSE mentions '==>' (e.g. a feature description)
        must not arm delegation enforcement — nothing was actually delegated.
        Would fail before the fix (old code armed on `"==>" in command`).
        """
        session_id = "defect1-prose"
        content = "Step 1 of 3\n\nContinuing the chain. No delegation CTA here."
        tool_input = {"command": "Add support for the ==> delegation operator in docs"}

        code, _ = run_post_prompt_engine(
            monkeypatch, capsys, session_id=session_id, content=content, tool_input=tool_input
        )
        assert code == 0

        state = load_session_state(session_id)
        assert state is not None
        assert not state.get("pending_delegation")

    def test_delegation_cta_markers_arm_and_extract_agent_type(self, patch_workspace, monkeypatch, capsys):
        """A response carrying the server's delegation CTA markers
        (subagent_type + 'Handoff via Task tool') with a remaining step must
        arm pending_delegation and extract the agent type.
        """
        session_id = "defect1-cta"
        content = (
            "Step 1 of 3\n\n"
            "→ Tool: Task\n"
            "→ Parameters:\n"
            '  • subagent_type: "claude-prompts:chain-executor"\n'
            "Handoff via Task tool\n"
        )

        code, _ = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0

        state = load_session_state(session_id)
        assert state is not None
        assert state.get("pending_delegation") is True
        assert state.get("delegation_agent_type") == "claude-prompts:chain-executor"

    def test_delegation_cta_without_subagent_type_falls_back_to_chain_executor(
        self, patch_workspace, monkeypatch, capsys
    ):
        session_id = "defect1-fallback"
        content = "Step 1 of 2\n\nHandoff via Task tool\n"

        code, _ = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is True
        assert state.get("delegation_agent_type") == "chain-executor"


# ── Defect 2: unparsed review-required sets a sentinel, not None ───────────


class TestDefect2GateSentinel:
    def test_review_required_without_gates_line_sets_sentinel(self):
        """'**Review Required**' with neither a **Gates**: line nor a parsable
        GATE_VERDICTS block must not leave pending_gate as None. Would fail
        before the fix (state['pending_gate'] stayed None).
        """
        content = "**Review Required**\n\nPlease review the output before continuing."
        state = parse_prompt_engine_response(content)
        assert state is not None
        assert state["pending_gate"] == "review"

    def test_review_required_with_gates_line_still_extracts_ids(self):
        """Sanity: the sentinel only fires when extraction genuinely fails —
        a normal **Gates**: line still wins."""
        content = "**Review Required**\n**Gates**: code-quality, test-coverage\n"
        state = parse_prompt_engine_response(content)
        assert state["pending_gate"] == "code-quality, test-coverage"

    def test_format_chain_reminder_tolerates_sentinel(self):
        """Consumer 1: format_chain_reminder must format the sentinel as
        plain text, not index into it."""
        state = {
            "chain_id": "chain-demo#1",
            "current_step": 1,
            "total_steps": 3,
            "pending_gate": "review",
            "pending_shell_verify": None,
            "shell_verify_attempts": 1,
        }
        full = format_chain_reminder(state, mode="full")
        assert "[Gate] review" in full
        inline = format_chain_reminder(state, mode="inline")
        assert "Gate: review" in inline

    def test_post_prompt_engine_directive_tolerates_sentinel(self, patch_workspace, monkeypatch, capsys):
        """Consumer 2: post-prompt-engine.py's `if pending_gate:` branch must
        still fire (sentinel is truthy) and format without crashing."""
        session_id = "defect2-consumer"
        content = "**Review Required**\n\nNo gates line present."

        code, out = run_post_prompt_engine(monkeypatch, capsys, session_id=session_id, content=content)
        assert code == 0
        directive = out["hookSpecificOutput"]["additionalContext"]
        assert 'gates="review"' in directive


# ── Defect 3: clear-and-allow recognizes this client's tool name ───────────


class TestDefect3ClearCondition:
    def _arm(self, session_id: str) -> None:
        save_session_state(
            session_id,
            {
                "chain_id": "chain-demo#1",
                "current_step": 1,
                "total_steps": 3,
                "pending_gate": None,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
            },
        )

    def test_agent_tool_clears_state_and_allows(self, patch_workspace, monkeypatch, capsys):
        """This build reports its subagent tool as 'Agent'. Would fail before
        the fix (old code only cleared on tool_name == 'Task', so the block
        could never self-clear on this client)."""
        session_id = "defect3-agent"
        self._arm(session_id)

        code, out = run_delegation_enforce(monkeypatch, capsys, session_id=session_id, tool_name="Agent")
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

        state = load_session_state(session_id)
        assert state.get("pending_delegation") is False

    def test_taskcreate_allowed_without_deny(self, patch_workspace, monkeypatch, capsys):
        """TaskCreate (a task-tracking call, not an action tool) is caught by
        the unanchored hooks.json matcher but must be allowed, not denied."""
        session_id = "defect3-taskcreate"
        self._arm(session_id)

        code, out = run_delegation_enforce(monkeypatch, capsys, session_id=session_id, tool_name="TaskCreate")
        assert code == 0
        assert out == {}
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

        # ALLOW_LIST membership does not clear delegation state — only Task/Agent do.
        state = load_session_state(session_id)
        assert state.get("pending_delegation") is True

    def test_bash_denied_while_delegation_pending(self, patch_workspace, monkeypatch, capsys):
        """Sanity: action tools are still hard-blocked while pending."""
        session_id = "defect3-bash"
        self._arm(session_id)

        code, out = run_delegation_enforce(monkeypatch, capsys, session_id=session_id, tool_name="Bash")
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
