"""
Tests for hooks/ralph-stop.py core functions.

Covers:
- run_verification (pass/fail/timeout)
- format_error_feedback
- load_context_isolation_config (defaults/custom)
- ensure_ralph_session_id
- stop_hook_active guard
- Max iterations reached
- Delegation threshold
"""

import importlib.util
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

spec = importlib.util.spec_from_file_location(
    "ralph_stop",
    HOOKS_DIR / "ralph-stop.py",
)
hook_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook_mod)

run_verification = hook_mod.run_verification
format_error_feedback = hook_mod.format_error_feedback
ensure_ralph_session_id = hook_mod.ensure_ralph_session_id
load_context_isolation_config = hook_mod.load_context_isolation_config


class TestRunVerification:
    def test_passing_command(self):
        result = run_verification("true", timeout=10)
        assert result["passed"] is True
        assert result["exitCode"] == 0
        assert result["timedOut"] is False

    def test_failing_command(self):
        result = run_verification("false", timeout=10)
        assert result["passed"] is False
        assert result["exitCode"] != 0
        assert result["timedOut"] is False

    def test_command_with_output(self):
        result = run_verification("echo 'hello world'", timeout=10)
        assert result["passed"] is True
        assert "hello world" in result["stdout"]

    def test_command_with_stderr(self):
        result = run_verification("echo 'error' >&2 && false", timeout=10)
        assert result["passed"] is False
        assert "error" in result["stderr"]

    def test_timeout(self):
        result = run_verification("sleep 10", timeout=1)
        assert result["passed"] is False
        assert result["timedOut"] is True
        assert "timed out" in result["stderr"].lower()

    def test_truncates_long_output(self):
        # Generate >5000 chars of output
        result = run_verification("python3 -c \"print('x' * 6000)\"", timeout=10)
        assert result["passed"] is True
        assert len(result["stdout"]) <= 5000

    def test_working_directory(self, tmp_path):
        result = run_verification("pwd", timeout=10, working_dir=str(tmp_path))
        assert result["passed"] is True
        assert str(tmp_path) in result["stdout"]

    def test_invalid_command(self):
        result = run_verification("nonexistent_command_12345", timeout=10)
        assert result["passed"] is False


class TestFormatErrorFeedback:
    def test_basic_formatting(self):
        result = {
            "exitCode": 1,
            "stderr": "Error: test failed",
            "stdout": "",
            "timedOut": False,
        }
        verify_state = {
            "config": {"command": "npm test", "maxIterations": 5},
            "state": {"iteration": 2},
        }
        feedback = format_error_feedback(result, verify_state)
        assert "Shell Verification FAILED" in feedback
        assert "Iteration 3/5" in feedback
        assert "npm test" in feedback
        assert "Error: test failed" in feedback

    def test_timeout_feedback(self):
        result = {
            "exitCode": -1,
            "stderr": "Timed out after 30s",
            "stdout": "",
            "timedOut": True,
        }
        verify_state = {
            "config": {"command": "npm test", "maxIterations": 10},
            "state": {"iteration": 1},
        }
        feedback = format_error_feedback(result, verify_state)
        assert "Timed out" in feedback

    def test_uses_stdout_when_no_stderr(self):
        result = {
            "exitCode": 1,
            "stderr": "",
            "stdout": "FAIL: assertion error",
            "timedOut": False,
        }
        verify_state = {
            "config": {"command": "npm test", "maxIterations": 5},
            "state": {"iteration": 0},
        }
        feedback = format_error_feedback(result, verify_state)
        assert "assertion error" in feedback


class TestEnsureRalphSessionId:
    def test_extracts_from_state(self):
        verify_state = {"state": {"sessionId": "ralph-abc123"}}
        sid = ensure_ralph_session_id(verify_state)
        assert sid == "ralph-abc123"

    def test_extracts_from_top_level(self):
        verify_state = {"sessionId": "ralph-top", "state": {}}
        sid = ensure_ralph_session_id(verify_state)
        assert sid == "ralph-top"

    def test_generates_new_when_missing(self):
        verify_state = {"state": {}}
        sid = ensure_ralph_session_id(verify_state)
        assert sid.startswith("ralph-")
        assert len(sid) > 8

    def test_sets_environment_variable(self):
        verify_state = {"state": {"sessionId": "ralph-env-test"}}
        ensure_ralph_session_id(verify_state)
        assert os.environ.get("RALPH_SESSION_ID") == "ralph-env-test"


class TestLoadContextIsolationConfig:
    def test_defaults_when_no_config(self, patch_workspace):
        # patch_workspace points MCP_WORKSPACE at an empty tmp_path tree and clears
        # CLAUDE_PLUGIN_DATA -- no config.jsonc/config.json exists anywhere in the
        # lookup, so load_context_isolation_config falls back to its own defaults.
        config = load_context_isolation_config()
        assert config["enabled"] is True
        assert config["inContextThreshold"] == 3
        assert config["spawnTimeout"] == 300

    def test_reads_custom_config(self, patch_workspace):
        config_file = patch_workspace["root"] / "config.json"
        config_file.write_text(
            json.dumps(
                {
                    "verification": {
                        "inContextAttempts": 5,
                        "isolation": {
                            "mode": "on",
                            "timeout": 600,
                        },
                    }
                }
            )
        )
        config = load_context_isolation_config()
        assert config["enabled"] is True
        assert config["inContextThreshold"] == 5
        assert config["spawnTimeout"] == 600

    def test_disabled_mode(self, patch_workspace):
        config_file = patch_workspace["root"] / "config.json"
        config_file.write_text(
            json.dumps(
                {
                    "verification": {
                        "isolation": {"enabled": False},
                    }
                }
            )
        )
        config = load_context_isolation_config()
        assert config["enabled"] is False

    def test_corrupt_config_returns_defaults(self, patch_workspace):
        config_file = patch_workspace["root"] / "config.json"
        config_file.write_text("not valid json")
        config = load_context_isolation_config()
        assert config["enabled"] is True
        assert config["inContextThreshold"] == 3


class TestMainDecisions:
    """Test ralph-stop main() decision logic."""

    def _run_hook(self, hook_input, verify_state=None):
        """Simulate running the hook with mocked stdin and verify state."""
        import contextlib
        import io

        captured = io.StringIO()

        with patch("sys.stdin", io.StringIO(json.dumps(hook_input))):
            with patch.object(hook_mod, "load_verify_state", return_value=verify_state):
                with patch.object(hook_mod, "save_verify_state"):
                    with patch.object(hook_mod, "clear_verify_state"):
                        with contextlib.redirect_stdout(captured):
                            with pytest.raises(SystemExit) as exc_info:
                                hook_mod.main()

        output = captured.getvalue().strip()
        exit_code = exc_info.value.code
        return exit_code, json.loads(output) if output else None

    def test_stop_hook_active_allows(self):
        exit_code, output = self._run_hook({"stop_hook_active": True})
        assert exit_code == 0

    def test_no_verify_state_allows(self):
        exit_code, output = self._run_hook({}, verify_state=None)
        assert exit_code == 0

    def test_max_iterations_reached_allows(self):
        verify_state = {
            "config": {"command": "npm test", "maxIterations": 3},
            "state": {"iteration": 3},
        }
        exit_code, output = self._run_hook({}, verify_state=verify_state)
        assert exit_code == 0
        # Should have system message about max iterations
        if output:
            assert "Max iterations" in json.dumps(output)

    def test_verification_pass_allows(self, patch_workspace):
        # The `passed` branch opportunistically runs the real (unpatched) cleanup_stale_rows /
        # cleanup_old_sessions / cleanup_old_ralph_sessions — patch_workspace keeps their
        # workspace resolution inside tmp_path instead of the self-resolved checkout root
        # (found by the tree-state guard, 2026-09-19; see tests/tree_state_guard.py).
        verify_state = {
            "config": {"command": "true", "maxIterations": 5, "timeout": 30000},
            "state": {"iteration": 0},
        }
        with patch.object(
            hook_mod,
            "run_verification",
            return_value={
                "passed": True,
                "exitCode": 0,
                "stdout": "",
                "stderr": "",
                "timedOut": False,
            },
        ):
            exit_code, output = self._run_hook({}, verify_state=verify_state)
        assert exit_code == 0

    def test_verification_fail_in_context_blocks(self):
        """Before delegation threshold, failure blocks with in-context feedback."""
        verify_state = {
            "config": {"command": "npm test", "maxIterations": 10, "timeout": 30000},
            "state": {"iteration": 0},
        }
        fail_result = {
            "passed": False,
            "exitCode": 1,
            "stdout": "",
            "stderr": "FAIL: test.js",
            "timedOut": False,
        }
        with patch.object(hook_mod, "run_verification", return_value=fail_result):
            with patch.object(
                hook_mod,
                "load_context_isolation_config",
                return_value={
                    "enabled": True,
                    "inContextThreshold": 3,
                    "timeoutSeconds": 300,
                },
            ):
                exit_code, output = self._run_hook({}, verify_state=verify_state)

        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
        assert "Shell Verification FAILED" in output["reason"]

    # test_delegation_pending_blocks removed — delegation handling
    # was removed from ralph-stop.py in the delegation refactor


class TestStopWaitsOnEveryVisibleRun:
    """Stop is blocked exactly while the loader returns a chain state (R30, hook side).

    The loader keeps only rows the server projects, and the server projects a run exactly while
    it is not complete, so a state coming back IS "the run needs the client". Re-deriving that
    from `step < total` missed a run held past its last node (`step = total + 1`) by a shell
    verification or an owed detached report.
    """

    def _stop(self, chain_state):
        import contextlib
        import io

        captured = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps({"session_id": "sess-stop"}))):
            with patch.object(hook_mod, "load_verify_state", return_value=None):
                with patch.object(hook_mod, "load_recoverable_chain_state", autospec=True, return_value=chain_state):
                    with contextlib.redirect_stdout(captured):
                        with pytest.raises(SystemExit) as exc_info:
                            hook_mod.main()
        output = captured.getvalue().strip()
        return exc_info.value.code, json.loads(output) if output else None

    @staticmethod
    def _state(step, total, **extra):
        state = {
            "chain_id": "chain-demo#1",
            "current_step": step,
            "total_steps": total,
            "pending_gate": None,
            "pending_shell_verify": None,
        }
        state.update(extra)
        return state

    def test_a_run_held_past_its_end_by_a_shell_check_blocks_and_names_it(self):
        code, output = self._stop(self._state(4, 3, pending_shell_verify="npm test"))

        assert code == 0
        assert output is not None and output["decision"] == "block"
        assert "shell verification" in output["reason"]
        assert "npm test" in output["reason"]
        assert "gate_action" in output["reason"]

    def test_a_run_held_past_its_end_with_nothing_pending_blocks_as_held(self):
        code, output = self._stop(self._state(4, 3))

        assert code == 0
        assert output is not None and output["decision"] == "block"
        assert "is held" in output["reason"]
        assert 'chain_id="chain-demo#1"' in output["reason"]

    def test_control_a_mid_chain_run_blocks_with_steps_remaining(self):
        code, output = self._stop(self._state(1, 3))

        assert output is not None and output["decision"] == "block"
        assert "steps remain" in output["reason"]
        assert "step 1/3" in output["reason"]

    def test_no_chain_state_allows_stop(self):
        code, output = self._stop(None)

        assert code == 0
        assert output is None

    def test_control_a_pending_gate_keeps_the_gate_review_message(self):
        code, output = self._stop(self._state(3, 3, pending_gate="code-quality"))

        assert output is not None and output["decision"] == "block"
        assert output["reason"].startswith("Chain chain-demo#1 has a pending gate review (step 3/3).")
        assert "gate_verdict" in output["reason"]
