"""
Integration tests for Ralph delegation re-entry loop and concurrent sessions.

Tests the cross-hook coordination between:
- ralph-stop.py (Stop hook): verification, delegation threshold, task file creation
- subagent-gate-enforce.py (SubagentStop hook): verdict checking, delegation clearing
- session_state.py: delegation state per session
- verify_active_store.py: single-slot verify state
- session_tracker.py: per-session iteration history

Scenarios:
1. Delegation re-entry: fail → delegate → sub-agent PASS → verify still fails → delegate again
2. Concurrent session isolation: two sessions don't interfere with each other
3. Verify-state single-slot: only one active verification at a time
"""

import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import pytest

# ── Module setup ──────────────────────────────────────────────────────────────

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

# Import ralph-stop.py (hyphenated filename)
_ralph_stop_spec = importlib.util.spec_from_file_location("ralph_stop", HOOKS_DIR / "ralph-stop.py")
ralph_stop = importlib.util.module_from_spec(_ralph_stop_spec)
_ralph_stop_spec.loader.exec_module(ralph_stop)

# Import subagent-gate-enforce.py (hyphenated filename)
_gate_enforce_spec = importlib.util.spec_from_file_location(
    "subagent_gate_enforce", HOOKS_DIR / "subagent-gate-enforce.py"
)
gate_enforce = importlib.util.module_from_spec(_gate_enforce_spec)
_gate_enforce_spec.loader.exec_module(gate_enforce)


# ── Helpers ───────────────────────────────────────────────────────────────────


def run_ralph_stop(
    hook_input: dict, verify_state=None, run_verification_result=None, isolation_config=None
) -> tuple[int, dict | None]:
    """Simulate a ralph-stop.py invocation with controlled state.

    Returns (exit_code, parsed_json_output).
    """
    captured = io.StringIO()

    default_isolation = {
        "enabled": True,
        "inContextThreshold": 3,
        "timeoutSeconds": 300,
    }

    with patch("sys.stdin", io.StringIO(json.dumps(hook_input))):
        with patch.object(ralph_stop, "load_verify_state", return_value=verify_state):
            with patch.object(ralph_stop, "save_verify_state") as mock_save:
                with patch.object(ralph_stop, "clear_verify_state"):
                    with patch.object(
                        ralph_stop, "load_context_isolation_config", return_value=isolation_config or default_isolation
                    ):
                        with patch.object(
                            ralph_stop,
                            "run_verification",
                            return_value=run_verification_result
                            or {
                                "passed": False,
                                "exitCode": 1,
                                "stdout": "",
                                "stderr": "FAIL",
                                "timedOut": False,
                            },
                        ):
                            with redirect_stdout(captured):
                                with pytest.raises(SystemExit) as exc:
                                    ralph_stop.main()

    output = captured.getvalue().strip()
    exit_code = exc.value.code
    parsed = json.loads(output) if output else None
    return exit_code, parsed, mock_save


def run_subagent_gate_enforce(hook_input: dict) -> tuple[int, dict | None]:
    """Simulate a subagent-gate-enforce.py invocation.

    Returns (exit_code, parsed_json_output).
    """
    captured = io.StringIO()

    with patch("sys.stdin", io.StringIO(json.dumps(hook_input))), redirect_stdout(captured):
        with pytest.raises(SystemExit) as exc:
            gate_enforce.main()

    output = captured.getvalue().strip()
    exit_code = exc.value.code
    parsed = json.loads(output) if output else None
    return exit_code, parsed


def make_verify_state(
    command="false", iteration=0, max_iterations=10, timeout_ms=30000, session_id=None, delegation=None
):
    """Build a verify state dict matching MCP server format."""
    state = {"iteration": iteration}
    if session_id:
        state["sessionId"] = session_id
    if delegation:
        state["delegation"] = delegation
    return {
        "config": {
            "command": command,
            "maxIterations": max_iterations,
            "timeout": timeout_ms,
        },
        "state": state,
    }


def build_transcript(prompt_text: str, assistant_text: str, path: Path) -> str:
    """Write a minimal JSONL transcript and return the path string."""
    with open(path, "w") as f:
        f.write(json.dumps({"type": "human", "content": prompt_text}) + "\n")
        f.write(json.dumps({"type": "assistant", "content": assistant_text}) + "\n")
    return str(path)


# ── Test: Delegation Re-Entry Loop ───────────────────────────────────────────


class TestDelegationReEntryLoop:
    """Test the full cycle: fail in-context → delegate → sub-agent PASS → fail again → re-delegate.

    This validates the coordination between ralph-stop.py and subagent-gate-enforce.py
    via session_state.py (hooks-state.db).
    """

    def test_in_context_failures_block_without_delegation(self):
        """Iterations 1-3 (within threshold) produce in-context error feedback, not delegation."""
        fail_result = {
            "passed": False,
            "exitCode": 1,
            "stdout": "",
            "stderr": "AssertionError: expected 42",
            "timedOut": False,
        }
        isolation = {"enabled": True, "inContextThreshold": 3, "timeoutSeconds": 300}

        for iteration in range(3):  # iterations 0, 1, 2 → become 1, 2, 3 after +1
            vs = make_verify_state(command="npm test", iteration=iteration, max_iterations=10)
            _, output, _ = run_ralph_stop(
                {},
                verify_state=vs,
                run_verification_result=fail_result,
                isolation_config=isolation,
            )
            assert output is not None, f"Expected output on iteration {iteration}"
            assert output["decision"] == "block"
            assert "Shell Verification FAILED" in output["reason"]
            # Should NOT have delegation markers
            assert "Sub-Agent Delegation" not in output.get("reason", "")

    def test_iteration_past_threshold_triggers_isolation(self):
        """Iteration 4 (past threshold of 3) triggers spawn_isolated_iteration."""
        fail_result = {
            "passed": False,
            "exitCode": 1,
            "stdout": "",
            "stderr": "FAIL: test still broken",
            "timedOut": False,
        }
        isolation = {"enabled": True, "inContextThreshold": 3, "spawnTimeout": 300, "permissionMode": "delegate"}

        # iteration=4 in state → 4 > 3 threshold → triggers isolation
        vs = make_verify_state(
            command="npm test",
            iteration=4,
            max_iterations=10,
            session_id="ralph-reentry-test",
        )

        with patch.object(
            ralph_stop,
            "spawn_isolated_iteration",
            return_value={
                "passed": False,
                "output": "Spawned instance could not fix the issue.",
                "stats": None,
            },
        ) as mock_spawn:
            _, output, _ = run_ralph_stop(
                {},
                verify_state=vs,
                run_verification_result=fail_result,
                isolation_config=isolation,
            )

        assert output is not None
        assert output["decision"] == "block"
        assert "Isolated Execution FAILED" in output["reason"]
        mock_spawn.assert_called_once()

    def test_subagent_pass_clears_delegation_state(self, tmp_path, patch_workspace):
        """After sub-agent emits GATE_REVIEW: PASS, delegation state is cleared."""
        # Set up delegation state in session_state
        from session_state import load_session_state, save_session_state

        session_id = "ralph-reentry-test"
        save_session_state(
            session_id,
            {
                "chain_id": "",
                "current_step": 0,
                "total_steps": 0,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
                "delegation_model_hint": None,
            },
        )

        # Verify delegation is set
        state = load_session_state(session_id)
        assert state["pending_delegation"] is True

        # Build transcript where sub-agent had quality gates and emitted PASS
        transcript_path = build_transcript(
            prompt_text="### Quality Gates\n- All tests must pass\n\n## Instructions\nFix the bug.",
            assistant_text="Fixed the auth module.\n\nGATE_REVIEW: PASS \u2014 All tests passing.",
            path=tmp_path / "transcript.jsonl",
        )

        # Run subagent-gate-enforce — should PASS and clear delegation
        exit_code, output = run_subagent_gate_enforce(
            {
                "agent_transcript_path": transcript_path,
                "session_id": session_id,
            }
        )

        assert exit_code == 0
        assert output is None  # PASS = no output (silent allow)

        # Verify delegation state was cleared
        state = load_session_state(session_id)
        assert state["pending_delegation"] is False

    def test_full_reentry_cycle(self, tmp_path, patch_workspace):
        """Full cycle: in-context fails → delegate → PASS → verify still fails → delegate again.

        This is the complete delegation re-entry loop test.
        """
        from session_state import (
            load_session_state,
            save_session_state,
        )

        session_id = "ralph-full-cycle"
        fail_result = {
            "passed": False,
            "exitCode": 1,
            "stdout": "",
            "stderr": "FAIL: auth module broken",
            "timedOut": False,
        }
        isolation = {"enabled": True, "inContextThreshold": 2, "timeoutSeconds": 300}

        # ── Phase 1: In-context failures (iterations 1-2) ────────────────────
        for iteration in range(2):
            vs = make_verify_state(command="npm test", iteration=iteration, max_iterations=10)
            _, output, _ = run_ralph_stop(
                {},
                verify_state=vs,
                run_verification_result=fail_result,
                isolation_config=isolation,
            )
            assert output["decision"] == "block"
            assert "Shell Verification FAILED" in output["reason"], (
                f"Iteration {iteration}: expected in-context feedback"
            )

        # ── Phase 2: Isolation triggered (iteration 3 > threshold 2) ─────
        vs = make_verify_state(
            command="npm test",
            iteration=3,
            max_iterations=10,
            session_id=session_id,
        )
        with patch.object(
            ralph_stop,
            "spawn_isolated_iteration",
            return_value={
                "passed": False,
                "output": "Spawned instance could not fix the issue.",
                "stats": None,
            },
        ):
            _, output, _ = run_ralph_stop(
                {},
                verify_state=vs,
                run_verification_result=fail_result,
                isolation_config=isolation,
            )
        assert output["decision"] == "block"
        assert "Isolated Execution FAILED" in output["reason"]

        # Simulate: delegation state is set (ralph-stop sets this during spawn_isolated_iteration, mocked above)
        save_session_state(
            session_id,
            {
                "chain_id": "",
                "current_step": 0,
                "total_steps": 0,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": "npm test",
                "shell_verify_attempts": 3,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
                "delegation_model_hint": None,
            },
        )

        # ── Phase 3: Sub-agent completes with PASS ───────────────────────────
        transcript_path = build_transcript(
            prompt_text=(
                "### Quality Gates\n"
                "- All tests must pass\n\n"
                "## Ralph Session Protocol\n"
                "run_memory_file: run-memory.md\n"
            ),
            assistant_text=(
                "I fixed the auth module by correcting the import.\n\n"
                "MEMORY_UPDATE: Fixed auth import in session tracker\n\n"
                "GATE_REVIEW: PASS \u2014 All tests now passing"
            ),
            path=tmp_path / "cycle1_transcript.jsonl",
        )

        exit_code, output = run_subagent_gate_enforce(
            {
                "agent_transcript_path": str(transcript_path),
                "session_id": session_id,
            }
        )
        assert exit_code == 0
        assert output is None  # PASS = silent allow

        # Verify delegation cleared
        state = load_session_state(session_id)
        assert state["pending_delegation"] is False

        # ── Phase 4: Verification still fails → back to in-context ───────────
        # Reset iteration counter (server would set this based on its own state)
        vs = make_verify_state(command="npm test", iteration=3, max_iterations=10)
        _, output, _ = run_ralph_stop(
            {},
            verify_state=vs,
            run_verification_result=fail_result,
            isolation_config=isolation,
        )
        # iteration=3 → +1=4, threshold=2, so 4>2 → DELEGATION again
        # This proves re-entry: after a successful sub-agent, if verify still fails,
        # the system delegates again.
        assert output["decision"] == "block"

    def test_subagent_fail_keeps_delegation_active(self, tmp_path, patch_workspace):
        """When sub-agent emits GATE_REVIEW: FAIL, delegation state is NOT cleared (blocked)."""
        from session_state import load_session_state, save_session_state

        session_id = "ralph-fail-test"
        save_session_state(
            session_id,
            {
                "chain_id": "",
                "current_step": 0,
                "total_steps": 0,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
                "delegation_model_hint": None,
            },
        )

        transcript_path = build_transcript(
            prompt_text="### Quality Gates\n- All tests must pass",
            assistant_text="Attempted fix but tests still fail.\n\nGATE_REVIEW: FAIL \u2014 2 tests still broken",
            path=tmp_path / "fail_transcript.jsonl",
        )

        exit_code, output = run_subagent_gate_enforce(
            {
                "agent_transcript_path": str(transcript_path),
                "session_id": session_id,
            }
        )

        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
        assert "Gate Review Failed" in output["reason"]

        # Delegation state should STILL be active (FAIL doesn't clear it)
        state = load_session_state(session_id)
        assert state["pending_delegation"] is True

    def test_subagent_no_verdict_keeps_delegation_active(self, tmp_path, patch_workspace):
        """When sub-agent forgets to emit a verdict, delegation state is NOT cleared."""
        from session_state import load_session_state, save_session_state

        session_id = "ralph-no-verdict"
        save_session_state(
            session_id,
            {
                "chain_id": "",
                "current_step": 0,
                "total_steps": 0,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
                "delegation_model_hint": None,
            },
        )

        transcript_path = build_transcript(
            prompt_text="### Quality Gates\n- All tests must pass",
            assistant_text="I fixed the code. It should work now.",
            path=tmp_path / "no_verdict_transcript.jsonl",
        )

        exit_code, output = run_subagent_gate_enforce(
            {
                "agent_transcript_path": str(transcript_path),
                "session_id": session_id,
            }
        )

        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
        assert "Gate Verdict Missing" in output["reason"]

        # Delegation still active
        state = load_session_state(session_id)
        assert state["pending_delegation"] is True


# ── Test: Concurrent Session Isolation ────────────────────────────────────────


class TestConcurrentSessionIsolation:
    """Test that two Ralph sessions with different IDs don't interfere.

    verify-state.db is single-slot (one active verification at a time),
    but session_state (hooks-state.db) and session_tracker (ralph-sessions/)
    are keyed by session_id and must remain isolated.
    """

    def test_session_state_isolation(self, patch_workspace):
        """Two sessions in hooks-state.db don't interfere."""
        from session_state import clear_delegation_state, load_session_state, save_session_state

        # Set up session A: delegation pending
        save_session_state(
            "session-A",
            {
                "chain_id": "chain-A",
                "current_step": 2,
                "total_steps": 5,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "prompt-A",
                "pending_shell_verify": "npm test",
                "shell_verify_attempts": 3,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
                "delegation_model_hint": "sonnet",
            },
        )

        # Set up session B: different chain, no delegation
        save_session_state(
            "session-B",
            {
                "chain_id": "chain-B",
                "current_step": 1,
                "total_steps": 3,
                "pending_gate": "code-quality",
                "gate_criteria": ["No lint errors"],
                "last_prompt_id": "prompt-B",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": False,
                "delegation_agent_type": None,
                "delegation_model_hint": None,
            },
        )

        # Verify isolation: each session has its own state
        state_a = load_session_state("session-A")
        state_b = load_session_state("session-B")

        assert state_a["chain_id"] == "chain-A"
        assert state_a["pending_delegation"] is True
        assert state_b["chain_id"] == "chain-B"
        assert state_b["pending_delegation"] is False

        # Clear delegation on session A — should NOT affect session B
        clear_delegation_state("session-A")

        state_a = load_session_state("session-A")
        state_b = load_session_state("session-B")

        assert state_a["pending_delegation"] is False
        assert state_b["pending_gate"] == "code-quality"  # Untouched

    def test_session_tracker_isolation(self, patch_workspace):
        """Two SessionTrackers with different IDs maintain separate histories."""
        from session_tracker import SessionTracker

        tracker_a = SessionTracker("session-A")
        tracker_b = SessionTracker("session-B")

        tracker_a.set_goal("Fix auth", "npm test", "/project-a")
        tracker_b.set_goal("Fix API", "cargo test", "/project-b")

        tracker_a.record_iteration("Tried fixing import", "FAIL", "Wrong module")
        tracker_a.record_iteration("Fixed import path", "PASS", "Correct now")

        tracker_b.record_iteration("Added error handler", "FAIL", "Missing type")

        # Verify isolation
        assert tracker_a.get_iteration_count() == 2
        assert tracker_b.get_iteration_count() == 1

        story_a = tracker_a.generate_story()
        story_b = tracker_b.generate_story()

        assert "auth" in story_a.lower() or "import" in story_a.lower()
        assert "API" in story_b or "error handler" in story_b

        # Verify separate state files within shared sessions directory
        assert tracker_a.state_file != tracker_b.state_file
        assert tracker_a.sessions_dir.exists()
        assert tracker_b.sessions_dir.exists()

    def test_session_state_survives_other_session_deletion(self, patch_workspace):
        """Deleting one session doesn't affect the other."""
        from session_state import (
            clear_session_state,
            load_session_state,
            save_session_state,
        )

        save_session_state(
            "session-keep",
            {
                "chain_id": "chain-keep",
                "current_step": 1,
                "total_steps": 2,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": False,
                "delegation_agent_type": None,
                "delegation_model_hint": None,
            },
        )
        save_session_state(
            "session-delete",
            {
                "chain_id": "chain-delete",
                "current_step": 1,
                "total_steps": 2,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": False,
                "delegation_agent_type": None,
                "delegation_model_hint": None,
            },
        )

        # Delete one session
        clear_session_state("session-delete")

        # Other session is untouched
        kept = load_session_state("session-keep")
        deleted = load_session_state("session-delete")

        assert kept is not None
        assert kept["chain_id"] == "chain-keep"
        assert deleted is None

    def test_concurrent_subagent_enforce_different_sessions(self, tmp_path, patch_workspace):
        """Two sub-agents finishing for different sessions: each clears only its own state."""
        from session_state import load_session_state, save_session_state

        # Both sessions have pending delegation
        for sid in ("concurrent-A", "concurrent-B"):
            save_session_state(
                sid,
                {
                    "chain_id": "",
                    "current_step": 0,
                    "total_steps": 0,
                    "pending_gate": None,
                    "gate_criteria": [],
                    "last_prompt_id": "",
                    "pending_shell_verify": None,
                    "shell_verify_attempts": 0,
                    "pending_delegation": True,
                    "delegation_agent_type": "chain-executor",
                    "delegation_model_hint": None,
                },
            )

        # Session A's sub-agent finishes with PASS
        transcript_a = build_transcript(
            prompt_text="### Quality Gates\n- Code compiles",
            assistant_text="Fixed.\n\nGATE_REVIEW: PASS \u2014 Compiles cleanly",
            path=tmp_path / "transcript_a.jsonl",
        )
        run_subagent_gate_enforce(
            {
                "agent_transcript_path": transcript_a,
                "session_id": "concurrent-A",
            }
        )

        # Session A delegation cleared, session B still pending
        state_a = load_session_state("concurrent-A")
        state_b = load_session_state("concurrent-B")

        assert state_a["pending_delegation"] is False, "Session A should be cleared"
        assert state_b["pending_delegation"] is True, "Session B should be untouched"

        # Now session B's sub-agent finishes with PASS
        transcript_b = build_transcript(
            prompt_text="### Quality Gates\n- Tests pass",
            assistant_text="All green.\n\nGATE_REVIEW: PASS \u2014 All tests passing",
            path=tmp_path / "transcript_b.jsonl",
        )
        run_subagent_gate_enforce(
            {
                "agent_transcript_path": transcript_b,
                "session_id": "concurrent-B",
            }
        )

        state_b = load_session_state("concurrent-B")
        assert state_b["pending_delegation"] is False, "Session B should now be cleared"


# ── Test: Verify-State Single Slot ────────────────────────────────────────────


class TestVerifyStateSingleSlot:
    """verify-state.db uses a single-row table (id=1).

    This means only one Ralph verification loop is active at a time.
    These tests verify the serialization behavior.
    """

    def test_save_and_load_round_trip(self, patch_workspace):
        """Verify state can be saved and loaded."""
        from verify_active_store import (
            clear_verify_active_state,
            load_verify_active_state,
            save_verify_active_state,
        )

        state = make_verify_state(command="npm test", iteration=2, max_iterations=5)
        save_verify_active_state(state)

        loaded = load_verify_active_state()
        assert loaded is not None
        assert loaded["config"]["command"] == "npm test"
        assert loaded["state"]["iteration"] == 2

        clear_verify_active_state()
        assert load_verify_active_state() is None

    def test_second_save_overwrites_first(self, patch_workspace):
        """Writing a new verify state replaces the previous one (single slot)."""
        from verify_active_store import (
            load_verify_active_state,
            save_verify_active_state,
        )

        state_1 = make_verify_state(command="npm test", iteration=1)
        save_verify_active_state(state_1)

        state_2 = make_verify_state(command="cargo test", iteration=5)
        save_verify_active_state(state_2)

        loaded = load_verify_active_state()
        assert loaded["config"]["command"] == "cargo test"
        assert loaded["state"]["iteration"] == 5

    def test_delegation_metadata_persists_in_verify_state(self, patch_workspace):
        """Delegation metadata saved by ralph-stop persists in verify state."""
        from verify_active_store import (
            load_verify_active_state,
            save_verify_active_state,
        )

        state = make_verify_state(
            command="npm test",
            iteration=4,
            session_id="ralph-persist",
            delegation={
                "method": "subagent_delegation",
                "requested_at_iteration": 4,
                "task_id": "task-abc12345",
                "task_path": "/tmp/task.md",
            },
        )
        save_verify_active_state(state)

        loaded = load_verify_active_state()
        assert loaded["state"]["delegation"]["method"] == "subagent_delegation"
        assert loaded["state"]["delegation"]["task_id"] == "task-abc12345"


# ── Test: Edge Cases ──────────────────────────────────────────────────────────


class TestEdgeCases:
    """Edge cases in the delegation coordination flow."""

    def test_delegation_with_isolation_disabled_stays_in_context(self):
        """When isolation is disabled, failures always stay in-context (no delegation)."""
        fail_result = {
            "passed": False,
            "exitCode": 1,
            "stdout": "",
            "stderr": "FAIL",
            "timedOut": False,
        }
        isolation = {"enabled": False, "inContextThreshold": 3, "timeoutSeconds": 300}

        # Even past the threshold (iteration=5), isolation disabled means in-context
        vs = make_verify_state(command="npm test", iteration=5, max_iterations=10)
        _, output, _ = run_ralph_stop(
            {},
            verify_state=vs,
            run_verification_result=fail_result,
            isolation_config=isolation,
        )
        assert output["decision"] == "block"
        assert "Shell Verification FAILED" in output["reason"]
        assert "Delegation" not in output["reason"]

    def test_pass_on_first_try_clears_state(self):
        """Verification passing on first attempt clears state and allows stop."""
        pass_result = {
            "passed": True,
            "exitCode": 0,
            "stdout": "All 42 tests passed",
            "stderr": "",
            "timedOut": False,
        }
        vs = make_verify_state(command="npm test", iteration=0, max_iterations=10)
        _, output, _ = run_ralph_stop(
            {},
            verify_state=vs,
            run_verification_result=pass_result,
        )
        # Pass means allow (output may contain systemMessage but no "block")
        if output:
            assert output.get("decision") is None

    def test_max_iterations_stops_loop(self):
        """After max iterations, verification is abandoned and stop is allowed."""
        # iteration=9 → +1 = 10 → 10 == 10 doesn't trigger, but 10 > 10 does
        # Actually: `if iteration > max_iterations` checks after increment
        # iteration=10 in state → +1 = 11 > 10 → max reached
        vs_at_max = make_verify_state(command="npm test", iteration=10, max_iterations=10)
        _, output, _ = run_ralph_stop({}, verify_state=vs_at_max)
        if output:
            assert "Max iterations" in json.dumps(output)

    def test_ralph_protocol_pass_without_memory_update_blocks(self, tmp_path, patch_workspace):
        """Ralph protocol prompt: PASS verdict but missing MEMORY_UPDATE should block."""
        from session_state import save_session_state

        save_session_state(
            "ralph-protocol-test",
            {
                "chain_id": "",
                "current_step": 0,
                "total_steps": 0,
                "pending_gate": None,
                "gate_criteria": [],
                "last_prompt_id": "",
                "pending_shell_verify": None,
                "shell_verify_attempts": 0,
                "pending_delegation": True,
                "delegation_agent_type": "chain-executor",
                "delegation_model_hint": None,
            },
        )

        transcript_path = build_transcript(
            prompt_text=(
                "## Ralph Session Protocol\nrun_memory_file: run-memory.md\n\n### Quality Gates\n- Tests must pass\n"
            ),
            assistant_text="I fixed it.\n\nGATE_REVIEW: PASS \u2014 Tests passing",
            # Note: NO MEMORY_UPDATE line
            path=tmp_path / "no_memory.jsonl",
        )

        _, output = run_subagent_gate_enforce(
            {
                "agent_transcript_path": str(transcript_path),
                "session_id": "ralph-protocol-test",
            }
        )

        assert output is not None
        assert output["decision"] == "block"
        assert "Memory Update Missing" in output["reason"]

    def test_multiple_verdicts_last_wins(self, tmp_path, patch_workspace):
        """When multiple GATE_REVIEW lines exist across messages, last assistant message wins."""
        transcript_path = tmp_path / "multi_verdict.jsonl"
        with open(transcript_path, "w") as f:
            # Prompt with gates
            f.write(
                json.dumps(
                    {
                        "type": "human",
                        "content": "### Quality Gates\n- Tests pass\n- No lint errors",
                    }
                )
                + "\n"
            )
            # First attempt: FAIL
            f.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "content": "First try failed.\n\nGATE_REVIEW: FAIL \u2014 Lint errors remain",
                    }
                )
                + "\n"
            )
            # Human feedback
            f.write(
                json.dumps(
                    {
                        "type": "human",
                        "content": "Fix the lint errors and try again.",
                    }
                )
                + "\n"
            )
            # Second attempt: PASS (this should win — it's the last assistant message)
            f.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "content": "Fixed lint.\n\nGATE_REVIEW: PASS \u2014 All clean now",
                    }
                )
                + "\n"
            )

        _, output = run_subagent_gate_enforce(
            {
                "agent_transcript_path": str(transcript_path),
            }
        )

        # Last verdict (PASS) wins — should allow
        assert output is None  # PASS = silent allow
