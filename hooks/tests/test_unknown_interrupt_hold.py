"""
Hook awareness of the blocking-unknown interrupt.

A hard-paused run holds on the reserved synthetic review `__unknown_interrupt__` instead of on a
gate anyone authored. Three things follow, and each is asserted here rather than assumed:

1. ALLOW — the server's `gate_action: resume | accept_alternative | abort` verbs must pass
   `gate-enforce.py` Check 2. The generated resolution set supplies that parameter; the mutation
   probe below proves the matrix detects its removal.
2. DENY — a bare `chain_id` resume while the interrupt is pending must be denied, with a message
   naming the verbs that DO clear it. No `gate_verdict` clears this hold, so the ordinary
   gate-review prose would be wrong.
3. LABEL — every human-facing surface renders the synthetic id as words. `__unknown_interrupt__`
   in a denial reads like a server defect to the caller it is addressed to.
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

from session_state import (
    UNKNOWN_INTERRUPT_GATE_ID,
    UNKNOWN_INTERRUPT_LABEL,
    _fallback_interrupt_exits,
    format_chain_reminder,
    format_gate_directive,
    interrupt_exits,
    label_gate_ids,
    load_session_state,
    parse_prompt_engine_response,
)
from test_delegation_deadlock_fixes import run_post_prompt_engine

spec = importlib.util.spec_from_file_location("gate_enforce", HOOKS_DIR / "gate-enforce.py")
hook_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook_mod)

# The response a hard-paused run actually returns, copied from the server's own inline snapshot
# (`server/tests/integration/chain/unknown-interrupt-flow.integration.test.ts`, the PAUSED
# variant). Hand-written prose here would test this file against itself.
PAUSED_RESPONSE = """Step output


---

**Chain Paused — Blocking Unknown**

TTL for the new cache layer is undecided

Affected steps (declared): final-review

Remaining plan:
- `inv-cache-ttl` — Investigate: TTL (investigate_unknown)
- `final-review` — Review (review)

Resolve with `chain_id="chain-demo#1"` plus one of:

- gate_action:resume
- gate_action:accept_alternative (with remainder)
- gate_action:abort

Chain: chain-demo#1
→ Progress 1/3
Next: chain_id="chain-demo#1", gate_action="resume" | gate_action="accept_alternative" (with remainder) | gate_action="abort"
"""

# The SOFT variant. It issues a step, so it is NOT a hold — the positive control that the paused
# detection is measuring the pause and not the words "Blocking Unknown".
SOFT_RESPONSE = PAUSED_RESPONSE.replace("**Chain Paused — Blocking Unknown**", "**Blocking Unknown**").replace(
    "- gate_action:resume\n- gate_action:accept_alternative (with remainder)\n", "- answer the step\n- remainder\n"
)


def run_hook(monkeypatch, capsys, tool_input):
    payload = {
        "session_id": "unknown-interrupt-test",
        "hook_event_name": "PreToolUse",
        "tool_name": "mcp__claude_prompts_mcp__prompt_engine",
        "tool_input": tool_input,
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    with pytest.raises(SystemExit) as excinfo:
        hook_mod.main()
    out = capsys.readouterr().out
    return excinfo.value.code, json.loads(out) if out.strip() else {}


class TestInterruptHoldMatrix:
    """pending `__unknown_interrupt__` crossed with every documented exit."""

    PENDING: ClassVar[dict] = {
        "chain_id": "chain-demo#1",
        "current_step": 1,
        "total_steps": 3,
        "pending_gate": UNKNOWN_INTERRUPT_LABEL,
        "interrupt_verbs": [
            "gate_action:resume",
            "gate_action:accept_alternative (with remainder)",
            "gate_action:abort",
        ],
    }

    def run_paused(self, monkeypatch, capsys, tool_input, state=None):
        monkeypatch.setattr(hook_mod, "load_session_state", lambda _sid: dict(state or self.PENDING))
        return run_hook(monkeypatch, capsys, tool_input)

    @pytest.mark.parametrize("action", ["resume", "accept_alternative", "abort"])
    def test_gate_action_verbs_are_allowed(self, monkeypatch, capsys, action):
        code, out = self.run_paused(monkeypatch, capsys, {"chain_id": "chain-demo#1", "gate_action": action})
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    def test_accept_alternative_with_remainder_is_allowed(self, monkeypatch, capsys):
        code, out = self.run_paused(
            monkeypatch,
            capsys,
            {
                "chain_id": "chain-demo#1",
                "gate_action": "accept_alternative",
                "remainder": {"mode": "replace", "nodes": [{"id": "n1", "promptId": "minimal_prompt"}]},
            },
        )
        assert code == 0
        assert out.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"

    def test_mutation_probe_a_hook_without_gate_action_denies_resume(self, monkeypatch, capsys):
        """POSITIVE CONTROL for the three rows above.

        Deliberately break the hook the way the artifact rename could have: drop `gate_action`
        from the generated resolution set. `gate_action:"resume"` must then be DENIED. Without
        this, an allow-matrix that passes proves nothing — a hook that allowed everything would
        be equally green.
        """
        broken = hook_mod.load_resolution_params() - {"gate_action"}
        monkeypatch.setattr(hook_mod, "load_resolution_params", lambda: broken)
        code, out = self.run_paused(monkeypatch, capsys, {"chain_id": "chain-demo#1", "gate_action": "resume"})
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"

    def test_bare_chain_id_resume_is_denied_and_names_the_verbs(self, monkeypatch, capsys):
        code, out = self.run_paused(
            monkeypatch,
            capsys,
            {"chain_id": "chain-demo#1", "user_response": "here is my step output"},
        )
        assert code == 0
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        reason = out["hookSpecificOutput"]["permissionDecisionReason"]
        for verb in self.PENDING["interrupt_verbs"]:
            assert verb in reason
        # The hold is not a gate review, so the message must not send the caller after a verdict.
        assert "submit gate_verdict" not in reason
        assert UNKNOWN_INTERRUPT_GATE_ID not in reason
        assert UNKNOWN_INTERRUPT_LABEL in reason

    def test_denial_falls_back_to_contract_parameters_when_no_verbs_were_captured(self, monkeypatch, capsys):
        """The db_reader path: a hold reconstructed from `currentStepReview` has no response text.

        The message still has to name exits, and the ones it names come from the same generated
        artifact rather than from a second hardcoded model.
        """
        state = {k: v for k, v in self.PENDING.items() if k != "interrupt_verbs"}
        code, out = self.run_paused(
            monkeypatch, capsys, {"chain_id": "chain-demo#1", "user_response": "x"}, state=state
        )
        reason = out["hookSpecificOutput"]["permissionDecisionReason"]
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert "gate_action" in reason
        assert "cancel" not in reason

    def test_an_ordinary_gate_review_still_gets_the_verdict_message(self, monkeypatch, capsys):
        """Discrimination control: the interrupt branch must not swallow gate reviews."""
        code, out = self.run_paused(
            monkeypatch,
            capsys,
            {"chain_id": "chain-demo#1", "user_response": "x"},
            state={"pending_gate": "code-review"},
        )
        reason = out["hookSpecificOutput"]["permissionDecisionReason"]
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert "submit gate_verdict" in reason


class TestSyntheticIdLabel:
    def test_label_gate_ids_renders_the_synthetic_id_as_words(self):
        assert label_gate_ids([UNKNOWN_INTERRUPT_GATE_ID]) == UNKNOWN_INTERRUPT_LABEL
        # Authored gate ids are untouched, and a mixed list keeps its order.
        assert label_gate_ids(["clarity"]) == "clarity"
        assert label_gate_ids([UNKNOWN_INTERRUPT_GATE_ID, "clarity"]) == f"{UNKNOWN_INTERRUPT_LABEL}, clarity"

    def test_db_reader_uses_the_same_label(self):
        """`db_reader` is the second producer of `pending_gate` — compact recovery reads it."""
        import db_reader

        result = db_reader._session_to_hook_state(
            {
                "chainId": "chain-demo#1",
                "currentStep": 1,
                "totalSteps": 3,
                "currentStepReview": {"gateIds": [UNKNOWN_INTERRUPT_GATE_ID], "attemptCount": 0},
            }
        )
        assert result is not None
        assert result["pending_gate"] == UNKNOWN_INTERRUPT_LABEL


class TestPausedResponseParsing:
    def test_paused_response_sets_the_hold_and_captures_the_servers_verbs(self):
        state = parse_prompt_engine_response(PAUSED_RESPONSE)
        assert state is not None
        assert state["pending_gate"] == UNKNOWN_INTERRUPT_LABEL
        assert state["interrupt_verbs"] == [
            "gate_action:resume",
            "gate_action:accept_alternative (with remainder)",
            "gate_action:abort",
        ]
        # Row 2.6: a paused run issues no step, so no exit that answers one may be advertised.
        assert "answer the step" not in state["interrupt_verbs"]

    def test_the_soft_variant_is_not_a_hold(self):
        """POSITIVE CONTROL: the soft interrupt issues a step and a bare resume answers it."""
        state = parse_prompt_engine_response(SOFT_RESPONSE)
        assert state is not None
        assert state["pending_gate"] is None

    def test_reminder_offers_the_interrupt_verbs_not_a_verdict(self):
        state = parse_prompt_engine_response(PAUSED_RESPONSE)
        assert state is not None
        for mode in ("full", "inline"):
            reminder = format_chain_reminder(state, mode=mode)
            assert "gate_action:resume" in reminder
            assert "GATE_REVIEW" not in reminder

    def test_interrupt_exits_prefer_the_servers_own_list(self):
        state = parse_prompt_engine_response(PAUSED_RESPONSE)
        assert state is not None
        assert interrupt_exits(state)[0] == "gate_action:resume"

    def test_stale_interrupt_verbs_and_missing_artifact_do_not_advertise_retired_exit(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "_generated.resolution_verbs", None)
        assert _fallback_interrupt_exits() == ["gate_action"]
        assert interrupt_exits({"interrupt_verbs": ["gate_action:abort", "cancel", "gate_verdict"]}) == [
            "gate_action:abort"
        ]


@pytest.mark.parametrize(
    "token",
    [
        "chain-implementation_plan/plan_table#1",
        "chain-Team-Legacy/Child_Name/9deep#01",
    ],
)
def test_paused_qualified_run_retains_exact_resume_token_and_exits(token):
    state = parse_prompt_engine_response(PAUSED_RESPONSE.replace("chain-demo#1", token))
    assert state is not None
    assert state["chain_id"] == token
    assert state["pending_gate"] == UNKNOWN_INTERRUPT_LABEL
    assert interrupt_exits(state) == [
        "gate_action:resume",
        "gate_action:accept_alternative (with remainder)",
        "gate_action:abort",
    ]
    for mode in ("full", "inline"):
        assert token in format_chain_reminder(state, mode=mode)


@pytest.mark.parametrize("token", ["chain-demo#1", "chain-Team-Legacy/Child_Name/9deep#01"])
def test_post_unknown_hold_directive_retains_server_exits(patch_workspace, monkeypatch, capsys, token):
    content = PAUSED_RESPONSE.replace("chain-demo#1", token)
    code, out = run_post_prompt_engine(
        monkeypatch, capsys, session_id="post-held", content=content, tool_input={"chain_id": token}, is_error=False
    )
    assert code == 0
    directive = out["hookSpecificOutput"]["additionalContext"]
    assert token in directive
    assert "<INTERRUPT>" in directive
    assert "gate_verdict" not in directive
    assert "PASS" not in directive and "FAIL" not in directive
    state = parse_prompt_engine_response(content)
    assert state is not None
    for verb in state["interrupt_verbs"]:
        assert verb in directive
    stored = load_session_state("post-held")
    assert stored is not None and stored["pending_gate"] == UNKNOWN_INTERRUPT_LABEL
    assert stored["chain_id"] == token


def test_post_ordinary_review_keeps_exact_directive(patch_workspace, monkeypatch, capsys):
    code, out = run_post_prompt_engine(
        monkeypatch,
        capsys,
        session_id="ordinary-review",
        content="Progress 1/3\n**Gate Review Required**\n**Gates**: review",
        tool_input={"chain_id": "chain-demo#1"},
        is_error=False,
    )
    assert code == 0
    assert out["hookSpecificOutput"]["additionalContext"] == (
        '<GATE-REVIEW>chain_id="chain-demo#1" gates="review" → Submit gate_verdict</GATE-REVIEW>'
    )


# ── Conversation pause: one shared directive across every hook that renders the run ──────────
IDENTITY = {"run_id": "r", "chain_id": "chain-demo#1", "organization_id": None, "workspace_id": "w"}
IDENTITY["continuity_scope_id"] = "w"
OWNED = {**TestInterruptHoldMatrix.PENDING, "current_step": 2, "run_identity": IDENTITY, "pause_custody": "owned"}
OWNED |= {"conversation_pause": {"kind": "conversation", "node_id": "n2", "paused_at": 1}, "owed": []}
PAUSE_KEYS = ("conversation_pause", "owed", "pause_custody")
DIRECTIVE = (
    "Workflow paused for conversation at step 2 of 3: `chain-demo#1`. Discuss with the user; resume explicitly "
    'with prompt_engine(chain_id:"chain-demo#1", gate_action:"resume") or end it with gate_action:"abort".'
)
# Instructions a paused run refuses: continue, verdict, fix/accept, shell verification.
MANDATORY_CTAS = ("<CALL-TOOL>", "REQUIRED", "gate_verdict", "<GATE-REVIEW>", "<INTERRUPT>", "accept_alternative")
compact_spec = importlib.util.spec_from_file_location("compact_recovery", HOOKS_DIR / "compact-recovery.py")
compact_mod = importlib.util.module_from_spec(compact_spec)
compact_spec.loader.exec_module(compact_mod)


def run_stdout_hook(module, monkeypatch, capsys, state, payload=None):
    monkeypatch.setattr(module, "load_recoverable_chain_state", lambda _sid: None if state is None else dict(state))
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload or {"session_id": "s", "prompt": "why?"})))
    with pytest.raises(SystemExit) as excinfo:
        module.main()
    return excinfo.value.code, capsys.readouterr().out


class TestConversationPauseDirective:
    @pytest.fixture
    def suggest(self, monkeypatch):
        from test_prompt_suggest_thread_visibility import prompt_suggest

        monkeypatch.setattr(prompt_suggest, "load_prompts_cache", lambda: True)
        monkeypatch.setenv("CLAUDE_CODE_ENTRYPOINT", "cli")
        return prompt_suggest

    @pytest.mark.parametrize(
        "phase",
        [{}, {"pending_gate": "code-quality"}, {"pending_gate": None}, {"pending_shell_verify": "npm test"}],
        ids=["unknown", "review", "free-step", "shell-verify"],
    )
    def test_every_surface_renders_the_one_directive_once(self, suggest, monkeypatch, capsys, phase):
        state = {**OWNED, **phase}
        _, out = run_stdout_hook(suggest, monkeypatch, capsys, state)
        rendered = json.loads(out)
        assert rendered["systemMessage"] == DIRECTIVE
        assert rendered["hookSpecificOutput"]["additionalContext"] == DIRECTIVE
        _, recovered = run_stdout_hook(compact_mod, monkeypatch, capsys, state)
        assert recovered == f"## Paused Workflow (recovered after compaction)\n\n{DIRECTIVE}\n"
        for cta in MANDATORY_CTAS:
            assert cta not in out and cta not in recovered

    def test_gate_enforce_paused_deny_is_the_shared_directive(self, monkeypatch, capsys):
        monkeypatch.setattr(hook_mod, "load_session_state", lambda _sid: dict(OWNED))
        _, out = run_hook(monkeypatch, capsys, {"chain_id": "chain-demo#1", "user_response": "x"})
        assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
        assert out["hookSpecificOutput"]["permissionDecisionReason"] == DIRECTIVE

    @pytest.mark.parametrize("custody", ["retained", "unconfirmed"])
    def test_unowned_custody_renders_recovery_guidance(self, suggest, monkeypatch, capsys, custody):
        from session_state import PAUSE_RECOVERY_GUIDANCE

        _, out = run_stdout_hook(suggest, monkeypatch, capsys, {**OWNED, "pause_custody": custody})
        context = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        assert context == f"Workflow paused for conversation at step 2 of 3: `chain-demo#1`. {PAUSE_RECOVERY_GUIDANCE}"
        assert 'gate_action:"resume"' not in context and "<INTERRUPT>" not in context

    def test_unknown_only_path_is_unchanged(self, suggest, monkeypatch, capsys):
        state = {key: value for key, value in OWNED.items() if key not in (*PAUSE_KEYS, "run_identity")}
        _, out = run_stdout_hook(suggest, monkeypatch, capsys, state)
        assert json.loads(out)["hookSpecificOutput"]["additionalContext"] == format_gate_directive(state)
        assert "<INTERRUPT>" in out and "Workflow paused" not in out

    def test_resume_reinstates_the_phase_directive_and_compaction_never_resumes(
        self, suggest, tmp_path, monkeypatch, capsys
    ):
        from test_post_prompt_engine_clearing import HOOK, _call, _control, _load_row, _pause, _run_hook

        monkeypatch.delenv("CLAUDE_PLUGIN_DATA", raising=False)
        workspace = tmp_path / "ws"
        (workspace / "server" / "runtime-state").mkdir(parents=True)
        paused = _pause(workspace)
        compact = {"session_id": "sess-clear", "source": "compact"}
        recovered = _run_hook(compact, workspace, HOOK.parent / "compact-recovery.py").stdout
        # No server db here, so the restored pause is unconfirmed: guidance, still paused, no CTA.
        assert "Workflow paused for conversation at step 2 of 3" in recovered and "not confirmed live" in recovered
        assert "<CALL-TOOL>" not in recovered and _load_row(workspace, "sess-clear") == paused
        # An unrelated tool result or an unrelated prompt call adds nothing and changes nothing.
        assert _run_hook({**compact, "tool_name": "Edit", "tool_response": "ok"}, workspace).stdout == ""
        other = {**compact, "tool_name": "mcp__x__prompt_engine", "tool_input": {"command": ">>other_prompt"}}
        assert _run_hook(other, workspace, HOOK.parent / "gate-enforce.py").stdout == ""
        own = {**other, "tool_input": {"chain_id": "chain-demo#1"}}  # positive control: the runner sees output
        assert _run_hook(own, workspace, HOOK.parent / "gate-enforce.py").stdout != ""
        assert _load_row(workspace, "sess-clear") == paused
        _run_hook(_call("resume", _control("resumed")), workspace)
        resumed = _load_row(workspace, "sess-clear")
        assert resumed is not None and not any(key in resumed for key in PAUSE_KEYS)
        _, out = run_stdout_hook(suggest, monkeypatch, capsys, resumed)
        assert json.loads(out)["hookSpecificOutput"]["additionalContext"] == format_gate_directive(resumed)
        assert "<INTERRUPT>" in out and "Workflow paused" not in out
