"""
Hook awareness of the blocking-unknown interrupt (plan row 3.1,
plans/features/mid-chain-unknown-surfacing-2026-08-20.md).

A hard-paused run holds on the reserved synthetic review `__unknown_interrupt__` instead of on a
gate anyone authored. Three things follow, and each is asserted here rather than assumed:

1. ALLOW — every verb the server accepts for that hold (`gate_action: resume |
   accept_alternative | abort`, `cancel: true`) must pass `gate-enforce.py` Check 2. Tier 0
   renamed the artifact to `PENDING_RUN_RESOLUTION_PARAMS`, which plausibly makes this work for
   free — `gate_action` is one parameter whatever its value. "Plausibly" is why the matrix is a
   test: the mutation probe below is red against a hook that lost the parameter, so a green row
   here reports the hook's behaviour and not the test's optimism.
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
    format_chain_reminder,
    interrupt_exits,
    label_gate_ids,
    parse_prompt_engine_response,
)

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
- cancel

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
            "cancel",
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

    def test_cancel_true_is_allowed(self, monkeypatch, capsys):
        code, out = self.run_paused(monkeypatch, capsys, {"chain_id": "chain-demo#1", "cancel": True})
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
        """The db_reader path: a hold reconstructed from `pendingGateReview` has no response text.

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
        assert "cancel" in reason

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
                "pendingGateReview": {"gateIds": [UNKNOWN_INTERRUPT_GATE_ID], "attemptCount": 0},
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
            "cancel",
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
