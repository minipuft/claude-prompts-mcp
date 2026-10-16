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

    def test_a_host_row_reason_is_pinned_byte_for_byte(self):
        result = {"exitCode": 1, "stderr": "boom", "stdout": "", "timedOut": False}
        verify_state = {"config": {"command": "false", "maxIterations": 3}, "state": {"iteration": 1}}

        assert format_error_feedback(result, verify_state) == (
            "## Shell Verification FAILED (Iteration 2/3)\n\n"
            "**Command:** `false`\n"
            "**Exit Code:** 1\n\n"
            "### Error Output\n```\nboom\n```\n\n"
            "Please fix the issues and continue working. Verification will run again when you finish."
        )

    def test_a_workflow_row_reason_names_the_run_and_prints_the_stored_count(self):
        result = {"exitCode": 1, "stderr": "boom", "stdout": "", "timedOut": False}
        verify_state = {"config": {"command": "false", "maxIterations": 3}, "state": {"iteration": 1}}
        run = {"chain_id": "chain-x#1", "current_step": 2, "total_steps": 3}

        feedback = format_error_feedback(result, verify_state, run)

        assert "Iteration 1/3" in feedback
        assert "Workflow `chain-x#1`, step 2/3." in feedback
        assert 'prompt_engine(chain_id="chain-x#1")' in feedback


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

    def test_no_verify_state_allows(self, patch_workspace):
        exit_code, output = self._run_hook({}, verify_state=None)
        assert exit_code == 0
        assert output is None

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
        assert 'gate_verdict={"overall":"PASS","rationale":"<reason>"}' in output["reason"]
        assert "Use FAIL" in output["reason"]
        assert "returned server template for per_gate, reminders and semantic evaluation" in output["reason"]
        assert "GATE_REVIEW" not in output["reason"]


class TestStopReadsRowsByExactIdentity:
    """T3.5: the host's own row by its session id, a workflow's rows by the exact run it is bound to.

    Real verify-state.db under a tmp workspace; the run binding comes from the loader, the command
    from a spy. An owned exact pause parks only its run's rows: they stay byte-identical and no
    command runs for them, while every other obligation enforces as before.
    """

    CHAIN = "chain-x#1"
    HOST = "sess-1"

    @pytest.fixture(autouse=True)
    def _store(self, patch_workspace, monkeypatch):
        monkeypatch.setenv("RALPH_SESSION_ID", "unchanged")
        import verify_active_store

        self.store = verify_active_store

    def identity(self, run, scope):
        return {
            "run_id": run,
            "chain_id": self.CHAIN,
            "organization_id": None,
            "workspace_id": scope,
            "continuity_scope_id": scope,
        }

    def chain(self, run="run-a", scope="ws-a", paused=False, custody="owned"):
        state = {"chain_id": self.CHAIN, "current_step": 2, "total_steps": 3, "pending_gate": None}
        state["run_identity"] = self.identity(run, scope)
        if paused:
            state["conversation_pause"] = {"kind": "conversation", "node_id": "n2", "paused_at": 1}
            state["pause_custody"] = custody
        return state

    @staticmethod
    def loop(command, started_hours_ago=0.0, **identity):
        from datetime import datetime, timedelta, timezone

        started = datetime.now(timezone.utc) - timedelta(hours=started_hours_ago)
        return {
            **identity,
            "config": {"command": command, "timeout": 30000, "maxIterations": 10},
            "state": {"iteration": 1, "lastResult": None, "startedAt": started.isoformat()},
        }

    def workflow(self, run, scope, command, started_hours_ago=0.0, key=None):
        row = self.loop(
            command,
            started_hours_ago,
            sessionId=f"workflow-run-{run}",
            runSessionId=run,
            chainId=self.CHAIN,
            scope={"continuityScopeId": scope, "workspaceId": scope},
        )
        self.store.save_verify_active_state(row, key or f"workflow-run-{run}")

    def rows(self):
        import sqlite3

        db = self.store.get_verify_state_db_path()
        if not db.exists():
            return {}
        conn = sqlite3.connect(str(db))
        try:
            return {key: (raw, at) for key, raw, at in conn.execute("SELECT * FROM verify_active_state")}
        finally:
            conn.close()

    def stop(self, chain_state, session_id=HOST, passed=False):
        import contextlib
        import io

        commands = []

        def spy(command, timeout, working_dir=None):
            commands.append(command)
            return {"passed": passed, "exitCode": 0 if passed else 1, "stdout": "", "stderr": "FAIL", "timedOut": False}

        captured = io.StringIO()
        payload = {"session_id": session_id} if session_id else {}
        with patch("sys.stdin", io.StringIO(json.dumps(payload))):
            with patch.object(hook_mod, "load_recoverable_chain_state", autospec=True, return_value=chain_state):
                with patch.object(hook_mod, "run_verification", side_effect=spy):
                    with patch.object(hook_mod, "load_context_isolation_config", return_value={"enabled": False}):
                        with contextlib.redirect_stdout(captured):
                            with pytest.raises(SystemExit):
                                hook_mod.main()
        output = captured.getvalue().strip()
        return (json.loads(output) if output else None), commands

    def test_an_owned_exact_pause_parks_its_row_and_permits_stop(self):
        self.workflow("run-a", "ws-a", "cmd-a")
        before = self.rows()

        output, commands = self.stop(self.chain(paused=True))

        assert output is None
        assert commands == []
        assert self.rows() == before

    def test_a_failing_workflow_row_names_its_run_and_the_host_row_keeps_its_count(self):
        self.workflow("run-a", "ws-a", "cmd-a")

        output, _ = self.stop(self.chain())
        assert output is not None
        assert "Iteration 1/10" in output["reason"]
        assert f"Workflow `{self.CHAIN}`, step 2/3." in output["reason"]

        self.store.delete_verify_row("workflow-run-run-a")
        self.store.save_verify_active_state(self.loop("host-cmd"), self.HOST)
        output, _ = self.stop(self.chain())
        assert output is not None
        assert "Iteration 2/10" in output["reason"] and "Workflow `" not in output["reason"]

    def test_an_independent_host_row_still_enforces_while_the_run_is_parked(self):
        self.workflow("run-a", "ws-a", "cmd-a")
        self.store.save_verify_active_state(self.loop("host-cmd"), self.HOST)
        before = self.rows()

        output, commands = self.stop(self.chain(paused=True))

        assert commands == ["host-cmd"]
        assert output is not None and output["decision"] == "block"
        after = self.rows()
        assert after.keys() == before.keys()
        assert after["workflow-run-run-a"] == before["workflow-run-run-a"]
        assert json.loads(after[self.HOST][0])["state"]["lastResult"]["exitCode"] == 1

    def test_two_scopes_with_one_public_chain_id_run_only_the_bound_runs_check(self):
        self.workflow("run-a", "ws-a", "cmd-a")
        self.workflow("run-b", "ws-b", "cmd-b")
        self.workflow("run-b", "ws-b", "legacy-b", key=self.CHAIN)
        before = self.rows()

        output, commands = self.stop(self.chain())

        assert commands == ["cmd-a"]
        assert output is not None and output["decision"] == "block"
        after = self.rows()
        assert after.keys() == before.keys()
        assert after["workflow-run-run-b"] == before["workflow-run-run-b"]
        assert after[self.CHAIN] == before[self.CHAIN]
        assert json.loads(after["workflow-run-run-a"][0])["state"]["lastResult"]["exitCode"] == 1

    def test_a_retained_pause_grants_no_exemption(self):
        self.workflow("run-a", "ws-a", "cmd-a")

        output, commands = self.stop(self.chain(paused=True, custody="retained"))

        assert commands == ["cmd-a"]
        assert output is not None and output["decision"] == "block"

    @pytest.mark.parametrize(
        ("row_run", "row_scope", "why"),
        [("run-b", "ws-a", "names another run"), ("run-a", "ws-b", "scope is not the run's scope")],
    )
    def test_a_row_at_the_runs_key_that_is_not_exactly_it_fails_closed(self, row_run, row_scope, why):
        self.workflow(row_run, row_scope, "foreign-cmd", key="workflow-run-run-a")
        before = self.rows()

        output, commands = self.stop(self.chain(paused=True))

        assert commands == []
        assert output is not None and output["decision"] == "block"
        assert "could not be attributed" in output["reason"] and why in output["reason"]
        assert f"Workflow `{self.CHAIN}`, step 2/3" in output["reason"]
        assert self.rows() == before

    def test_an_unreadable_row_at_the_runs_key_fails_closed(self):
        import sqlite3

        self.workflow("run-a", "ws-a", "cmd-a")
        conn = sqlite3.connect(str(self.store.get_verify_state_db_path()))
        conn.execute("UPDATE verify_active_state SET state_json = '{not json'")
        conn.commit()
        conn.close()

        output, commands = self.stop(self.chain(paused=True))

        assert commands == []
        assert output is not None and "is unreadable" in output["reason"]

    def test_a_stop_with_no_session_id_runs_no_row_and_fails_closed(self):
        self.workflow("run-a", "ws-a", "cmd-a")
        before = self.rows()

        output, commands = self.stop(None, session_id="")

        assert commands == []
        assert output is not None and output["decision"] == "block"
        assert "no session id" in output["reason"]
        assert self.rows() == before

    def test_control_no_session_id_and_no_rows_allows(self):
        output, commands = self.stop(None, session_id="")

        assert (output, commands) == (None, [])

    def test_a_long_pause_then_resume_keeps_the_workflow_obligation(self):
        self.workflow("run-a", "ws-a", "cmd-a", started_hours_ago=3)
        before = self.rows()

        paused_output, paused_commands = self.stop(self.chain(paused=True))
        assert (paused_output, paused_commands) == (None, [])
        assert self.rows() == before

        output, commands = self.stop(self.chain())

        assert commands == ["cmd-a"]
        assert output is not None and output["decision"] == "block"
        assert set(self.rows()) == {"workflow-run-run-a"}

    def test_control_a_host_row_past_the_hour_still_expires(self):
        self.store.save_verify_active_state(self.loop("host-cmd", started_hours_ago=3), self.HOST)

        output, commands = self.stop(None)

        assert (output, commands) == (None, [])
        assert self.rows() == {}

    def test_after_abort_a_passing_host_row_clears_only_itself(self):
        # Abort released run-a's row (absent) and the run is gone; another scope's row stays.
        self.workflow("run-b", "ws-b", "cmd-b")
        self.store.save_verify_active_state(self.loop("host-cmd"), self.HOST)
        before = self.rows()

        output, commands = self.stop(None, passed=True)

        assert commands == ["host-cmd"]
        assert output is not None and output["decision"] is None
        assert self.rows() == {"workflow-run-run-b": before["workflow-run-run-b"]}

    def test_no_clear_or_save_accepts_an_empty_key(self):
        with pytest.raises(ValueError):
            hook_mod.clear_verify_state("")
        with pytest.raises(ValueError):
            hook_mod.save_verify_state({}, "")
        with pytest.raises(ValueError):
            self.store.delete_verify_row("")


class TestStopEnforcesAnUnpausedWorkflowRun:
    """V1: an ordinary chain step records its run's exact identity from the `chain_sessions`
    projection, so Stop reaches that run's verification row without any pause having happened.

    Real hooks end to end: post-prompt-engine runs as a subprocess against a state.db carrying the
    server's own DDL; ralph-stop's main reads the identity it recorded, and only the command runs
    through a spy. Two scopes holding one chain id record no identity, so neither row is borrowed.
    """

    CHAIN = "chain-x#1"
    HOST = "sess-v1"

    @pytest.fixture(autouse=True)
    def _workspace(self, patch_workspace, monkeypatch):
        import sqlite3

        import verify_active_store
        from test_db_reader import _extract_server_schema

        monkeypatch.setenv("RALPH_SESSION_ID", "unchanged")
        monkeypatch.delenv("CLAUDE_PLUGIN_ROOT", raising=False)
        self.store = verify_active_store
        self.root = patch_workspace["root"]
        self.db = sqlite3.connect(self.root / "runtime-state" / "state.db")
        self.db.executescript(_extract_server_schema()[0])
        yield
        self.db.close()

    def project(self, run, scope, pid=None, chain=CHAIN):
        doc = {"sessionId": run, "chainId": chain, "currentStep": 1, "totalSteps": 3, "runStatus": "working"}
        self.db.execute(
            "INSERT INTO chain_sessions (run_owner_pid, workspace_id, continuity_scope_id, chain_id, state) "
            "VALUES (?, ?, ?, ?, ?)",
            (str(pid or os.getpid()), scope, scope, chain, json.dumps(doc)),
        )
        self.db.commit()

    def step(self, content, tool_input):
        import subprocess

        payload = {"tool_name": "mcp__claude-prompts__prompt_engine", "session_id": self.HOST}
        payload |= {"tool_input": tool_input, "tool_response": {"content": content, "isError": False}}
        hook = HOOKS_DIR / "post-prompt-engine.py"
        done = subprocess.run(
            [sys.executable, str(hook)], input=json.dumps(payload), capture_output=True, text=True, timeout=30
        )
        assert done.returncode == 0, done.stderr
        from session_state import load_session_state

        return load_session_state(self.HOST)

    def identity(self, run, scope):
        return {"run_id": run, "chain_id": self.CHAIN, "organization_id": None} | {
            "workspace_id": scope,
            "continuity_scope_id": scope,
        }

    def seed_loops(self):
        """A pending loop row per run, filed under the key the server derives from its UUID."""
        for run, scope in (("run-a", "ws-a"), ("run-b", "ws-b")):
            row = TestStopReadsRowsByExactIdentity.loop(
                f"cmd-{run[-1]}",
                sessionId=f"workflow-run-{run}",
                runSessionId=run,
                chainId=self.CHAIN,
                scope={"continuityScopeId": scope, "workspaceId": scope},
            )
            self.store.save_verify_active_state(row, f"workflow-run-{run}")

    def stop(self):
        import contextlib
        import io

        commands = []

        def spy(command, timeout, working_dir=None):
            commands.append(command)
            return {"passed": False, "exitCode": 1, "stdout": "", "stderr": "FAIL", "timedOut": False}

        captured = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps({"session_id": self.HOST}))):
            with patch.object(hook_mod, "run_verification", autospec=True, side_effect=spy):
                with patch.object(
                    hook_mod, "load_context_isolation_config", autospec=True, return_value={"enabled": False}
                ):
                    with contextlib.redirect_stdout(captured):
                        with pytest.raises(SystemExit):
                            hook_mod.main()
        output = captured.getvalue().strip()
        return (json.loads(output) if output else None), commands

    def test_an_ordinary_step_binds_the_run_and_stop_enforces_its_pending_loop(self):
        self.project("run-a", "ws-a")
        self.seed_loops()

        first = self.step(f"Step 1 of 3 {self.CHAIN}", {"command": ">>x"})
        assert first["run_identity"] == self.identity("run-a", "ws-a") and "conversation_pause" not in first

        decision, commands = self.stop()

        assert commands == ["cmd-a"]
        assert decision["decision"] == "block" and "Shell Verification FAILED" in decision["reason"]

    def test_a_later_step_of_the_run_keeps_the_identity_and_another_chain_drops_it(self):
        self.project("run-a", "ws-a")
        self.step(f"Step 1 of 3 {self.CHAIN}", {"command": ">>x"})
        self.db.execute("DELETE FROM chain_sessions")  # kept, not re-resolved
        self.db.commit()

        second = self.step(f"Step 2 of 3 {self.CHAIN}", {"chain_id": self.CHAIN})
        assert (second["current_step"], second["run_identity"]) == (2, self.identity("run-a", "ws-a"))

        other = self.step("Step 1 of 2 chain-y#1", {"command": ">>y"})
        assert other["chain_id"] == "chain-y#1" and "run_identity" not in other
        self.project("run-y", "ws-a", chain="chain-y#1")
        again = self.step("Step 2 of 2 chain-y#1", {"chain_id": "chain-y#1"})
        assert again["run_identity"]["run_id"] == "run-y"

    @pytest.mark.parametrize(
        ("row_scope", "enforced"),
        [
            # The run's stored scope, as the server writes the row now: no organization.
            ({"continuityScopeId": "cwd", "workspaceId": "cwd"}, True),
            # The request scope an earlier writer recorded, its organization falling back to the
            # workspace: not the run's scope, so it stays refused exactly like a foreign row.
            ({"continuityScopeId": "cwd", "workspaceId": "cwd", "organizationId": "cwd"}, False),
        ],
    )
    def test_the_loop_is_enforced_only_under_the_runs_stored_scope(self, row_scope, enforced):
        self.project("run-a", "cwd")  # organization_id NULL, as the run registry stores it
        row = TestStopReadsRowsByExactIdentity.loop(
            "false", sessionId="workflow-run-run-a", runSessionId="run-a", chainId=self.CHAIN, scope=row_scope
        )
        self.store.save_verify_active_state(row, "workflow-run-run-a")
        tracked = self.step(f"Step 1 of 3 {self.CHAIN}", {"command": ">>x"})
        assert tracked is not None and tracked.get("run_identity") == self.identity("run-a", "cwd")

        decision, commands = self.stop()

        assert decision is not None and decision["decision"] == "block"
        if enforced:
            assert commands == ["false"] and "Shell Verification FAILED" in decision["reason"]
        else:
            assert commands == [] and "scope is not the run's scope" in decision["reason"]
            assert f"Workflow `{self.CHAIN}`, step 1/3" in decision["reason"]
            assert f'prompt_engine(chain_id="{self.CHAIN}")' in decision["reason"]

    def test_two_scopes_with_one_chain_id_bind_nothing_and_stop_runs_neither_loop(self):
        self.project("run-a", "ws-a")
        self.project("run-b", "ws-b")
        self.seed_loops()
        before = {key: self.store.load_verify_rows([key]) for key in ("workflow-run-run-a", "workflow-run-run-b")}

        tracked = self.step(f"Step 1 of 3 {self.CHAIN}", {"command": ">>x"})
        assert "run_identity" not in tracked

        decision, commands = self.stop()

        assert commands == []
        # Without an identity the workflow rows are not this conversation's: the run itself blocks.
        assert decision["decision"] == "block" and "Shell Verification" not in decision["reason"]
        assert {key: self.store.load_verify_rows([key]) for key in before} == before

    def test_a_dead_owners_row_binds_nothing_and_its_loop_is_not_run(self):
        from test_db_reader import _dead_pid

        self.project("run-a", "ws-a", pid=_dead_pid())
        self.seed_loops()

        tracked = self.step(f"Step 1 of 3 {self.CHAIN}", {"command": ">>x"})
        assert "run_identity" not in tracked

        assert self.stop() == (None, [])
