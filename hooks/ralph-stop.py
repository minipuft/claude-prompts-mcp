#!/usr/bin/env python3
"""
Stop hook: Shell verification for Ralph Wiggum-style autonomous loops.

When Claude tries to stop, this hook:
1. Reads runtime-state/verify-state.db (written by MCP server via SQLite)
2. Runs the verification command
3. If PASS (exit 0): Allows Claude to stop
4. If FAIL (exit != 0): Blocks stop, feeds error back to Claude

Context Isolation (iteration 4+):
- After in-context threshold, spawns fresh `claude --print` process
- Provides rich session story and diff summary to spawned instance
- Prevents context rot in long-running verification loops

This integrates with the :: verify:"command" loop:true syntax in prompt_engine.
"""

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, NoReturn, cast

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from config_loader import load_config
from db_reader import load_recoverable_chain_state
from session_state import (
    GATE_VERDICT_GUIDANCE,
    ChainState,
    RunIdentity,
    exact_run_identity,
    format_pause_directive,
    holds_pause_exemption,
)
from verify_active_store import (
    delete_verify_row,
    has_verify_rows,
    load_verify_rows,
    save_verify_active_state,
    workflow_verify_state_key,
)
from workspace import get_runtime_state_dir


def ensure_ralph_session_id(verify_state: dict) -> str:
    """
    Ensure RALPH_SESSION_ID is set for context tracking hooks.

    Creates a session ID if one doesn't exist in verify state,
    and exports it to the environment for other hooks to use.
    """
    state = verify_state.get("state", {})
    session_id = state.get("sessionId") or verify_state.get("sessionId")

    if not session_id:
        # Generate a new session ID
        session_id = f"ralph-{uuid.uuid4().hex[:8]}"

    # Export for context tracking hooks
    os.environ["RALPH_SESSION_ID"] = session_id
    return session_id


def get_debug_log_path() -> Path:
    """Get path for ralph debug log in runtime-state."""
    dev_fallback = Path(__file__).parent.parent / "server" / "runtime-state"
    return get_runtime_state_dir(dev_fallback) / "ralph-debug.log"


def load_context_isolation_config() -> dict:
    """
    Load Ralph context isolation config from the user's config file.

    `config_loader.load_config()` owns the lookup (`get_config_path()`: the server's own
    order, project `.claude-prompts/` config included) and the parse
    (comment/trailing-comma stripping for `.jsonc`, strict for `.json`), falling back to
    `DEFAULT_CONFIG` -- which carries no `verification` section, so the `.get(..., {})`
    defaults below apply -- on any read or parse failure. This hook never refuses to run
    because the operator's config is missing or malformed.

    Config paths:
    - verification.inContextAttempts: Number of in-context attempts before spawning
    - verification.isolation.enabled: Whether isolation is enabled
    - verification.isolation.maxBudget: Max budget per spawn in USD
    - verification.isolation.timeout: Spawn timeout in seconds
    - verification.isolation.permissionMode: Permission mode (delegate/ask/deny)
    """
    defaults = {
        "enabled": True,
        "inContextThreshold": 3,
        "maxBudgetPerSpawn": 1.00,
        "spawnTimeout": 300,
        "permissionMode": "delegate",
    }

    # `Config` only models the `hooks` section it owns; `verification` is a sibling
    # top-level section config_loader does not type. Widen to Any here rather than
    # teach config_loader a shape that belongs to ralph-stop's own config contract.
    config = cast("dict[str, Any]", load_config())
    verification = config.get("verification", {})
    isolation = verification.get("isolation", {})

    return {
        "enabled": isolation.get("enabled", defaults["enabled"]),
        "inContextThreshold": verification.get("inContextAttempts", defaults["inContextThreshold"]),
        "maxBudgetPerSpawn": isolation.get("maxBudget", defaults["maxBudgetPerSpawn"]),
        "spawnTimeout": isolation.get("timeout", defaults["spawnTimeout"]),
        "permissionMode": isolation.get("permissionMode", defaults["permissionMode"]),
    }


def _parse_row(raw: str | None) -> object:
    """A row's JSON, or None when it is absent or unreadable."""
    if not raw or not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def load_verify_state(session_id: str) -> dict | None:
    """The host's own row: the one stored under this client session id. No id reads no row."""
    row = _parse_row(load_verify_rows([session_id]).get(session_id))
    return row if isinstance(row, dict) else None


def save_verify_state(state: dict, session_id: str) -> None:
    """Save a row back under the key it was read from; an empty key is refused."""
    if not session_id:
        raise ValueError("A verify row is saved under its own key; an empty key names no row")
    save_verify_active_state(state, session_id)


def clear_verify_state(session_id: str) -> None:
    """Clear exactly the row under this key (never every row)."""
    delete_verify_row(session_id)


SCOPE_KEYS = (
    ("continuityScopeId", "continuity_scope_id"),
    ("workspaceId", "workspace_id"),
    ("organizationId", "organization_id"),
)


def _scope_value(value: object) -> object:
    """The server's `buildIdentityScope` drops empty and `'default'` values; compare on the rest."""
    return None if value in (None, "", "default") else value


def workflow_row_mismatch(row: object, identity: RunIdentity) -> str | None:
    """Why a workflow row is not exactly this run's (UUID and scope), or None when it is."""
    if not isinstance(row, dict) or not isinstance(row.get("config"), dict):
        return "it is unreadable"
    if row.get("runSessionId") != identity["run_id"]:
        return "it names another run"
    scope = row.get("scope")
    if not isinstance(scope, dict):
        return "it records no scope"
    if any(_scope_value(scope.get(field)) != _scope_value(identity[key]) for field, key in SCOPE_KEYS):
        return "its scope is not the run's scope"
    return None


def load_workflow_rows(identity: RunIdentity) -> tuple[list[tuple[str, dict]], list[str]]:
    """This run's loop rows: the one under its derived key, and a row an earlier build filed under the
    public chain id when its JSON names this run. A chain-id row naming another run (another scope can
    hold the same chain id) is not this conversation's and is not read further.

    Returns (exact rows, a diagnostic per row that names this run but cannot be confirmed as it).
    """
    key = workflow_verify_state_key(identity["run_id"])
    exact: list[tuple[str, dict]] = []
    unresolved: list[str] = []
    for row_key, raw in load_verify_rows([key, identity["chain_id"]]).items():
        row = _parse_row(raw)
        if row_key != key and not (isinstance(row, dict) and row.get("runSessionId") == identity["run_id"]):
            continue
        why = workflow_row_mismatch(row, identity)
        if why is None and isinstance(row, dict):
            exact.append((row_key, row))
        else:
            unresolved.append(f"`{row_key}`: {why}")
    return exact, unresolved


def run_attribution(chain_state: ChainState | None) -> tuple[str, str]:
    """A tracked run named by chain id and step, and the call that resumes or aborts it: the two
    phrases that let a model tell which run a Stop reason is about."""
    if chain_state and (chain_id := chain_state.get("chain_id")):
        step, total = chain_state.get("current_step", 0), chain_state.get("total_steps", 0)
        return (
            f"Workflow `{chain_id}`, step {step}/{total}.\n\n",
            f'workflow `{chain_id}` through prompt_engine(chain_id="{chain_id}")',
        )
    return "", "the workflow through prompt_engine"


def unresolved_reason(problems: list[str], chain_state: ChainState | None = None) -> str:
    """The fail-closed diagnostic: no command ran for these rows and no pause exemption applies.
    A tracked run is named by chain id and step, so the model can resume or abort that run."""
    lines = "\n".join(f"- {problem}" for problem in problems)
    run, target = run_attribution(chain_state)
    return (
        "## Shell verification could not be attributed\n\n"
        f"{run}{lines}\n\n"
        "No verification command ran for these rows and no pause exemption applies to them. "
        f"Resume or abort {target} so the server re-files or releases its loop."
    )


def run_verification(command: str, timeout: int, working_dir: str | None = None) -> dict:
    """Execute verification command and return result."""
    cwd = working_dir or os.getcwd()

    try:
        result = subprocess.run(
            ["sh", "-c", command],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={
                **{k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USER", "SHELL", "NODE_ENV", "CI")},
            },
        )

        return {
            "passed": result.returncode == 0,
            "exitCode": result.returncode,
            "stdout": result.stdout[-5000:] if len(result.stdout) > 5000 else result.stdout,
            "stderr": result.stderr[-5000:] if len(result.stderr) > 5000 else result.stderr,
            "timedOut": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "passed": False,
            "exitCode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout}s",
            "timedOut": True,
        }
    except Exception as e:
        return {
            "passed": False,
            "exitCode": -1,
            "stdout": "",
            "stderr": str(e),
            "timedOut": False,
        }


def format_error_feedback(result: dict, verify_state: dict, run: ChainState | None = None) -> str:
    """Format error feedback message for Claude (in-context mode).

    A host row prints the next attempt (stored + 1). A workflow row passes its `run`: the server
    owns its count, so the stored iteration prints as is, and the run is named so it can be resumed.
    """
    config = verify_state["config"]
    state = verify_state["state"]
    iteration = state["iteration"] + (0 if run else 1)
    max_iterations = config["maxIterations"]
    named, target = run_attribution(run) if run else ("", "")

    error_output = result["stderr"] or result["stdout"] or "No output captured"

    lines = [
        f"## Shell Verification FAILED (Iteration {iteration}/{max_iterations})",
        "",
        *([named.rstrip(), ""] if named else []),
        f"**Command:** `{config['command']}`",
        f"**Exit Code:** {result['exitCode']}",
    ]

    if result["timedOut"]:
        lines.append("**Status:** Timed out")

    lines.extend(
        [
            "",
            "### Error Output",
            "```",
            error_output[:2000],
            "```",
            "",
            "Please fix the issues and continue working. Verification will run again when you finish.",
        ]
    )
    if run:
        lines.extend(["", f"Resume or abort {target} if the run should not continue."])

    return "\n".join(lines)


def log_debug(message: str, data: dict | str | None = None) -> None:
    """Write debug info to ralph-debug.log for troubleshooting."""
    from datetime import datetime

    log_path = get_debug_log_path()
    timestamp = datetime.now().isoformat()
    with open(log_path, "a") as f:
        f.write(f"\n[{timestamp}] {message}\n")
        if data:
            if isinstance(data, dict):
                f.write(json.dumps(data, indent=2, default=str) + "\n")
            else:
                f.write(str(data) + "\n")


def spawn_isolated_iteration(verify_state: dict, last_result: dict, isolation_config: dict, session_id: str) -> dict:
    """
    Spawn a context-isolated CLI instance for this iteration.

    Args:
        verify_state: Current verification state from MCP server
        last_result: Result from the last verification attempt
        isolation_config: Ralph isolation configuration
        session_id: Session ID for tracking (from ensure_ralph_session_id)

    Returns the result from the spawned instance.
    """
    log_debug(
        "=== SPAWN ISOLATED ITERATION START ===", {"session_id": session_id, "isolation_config": isolation_config}
    )

    # Import here to avoid import errors when not in isolation mode
    from cli_spawner import SpawnConfig, spawn_claude_print
    from session_tracker import get_session_tracker
    from task_protocol import create_task_file

    config = verify_state["config"]
    state = verify_state.get("state", {})

    # Get or create session tracker
    tracker = get_session_tracker(session_id)

    # Set goal if not already set
    if not tracker.state.get("original_goal"):
        tracker.set_goal(
            goal=config.get("originalGoal", "Fix verification failures"),
            verification_command=config["command"],
            working_directory=config.get("workingDir", os.getcwd()),
        )

    # Record the last iteration
    error_output = last_result.get("stderr") or last_result.get("stdout") or ""
    tracker.record_iteration(
        approach="Previous attempt (in-context)",
        result=f"FAIL - exit code {last_result.get('exitCode', -1)}",
        lesson="Escalating to isolated execution",
    )

    # Create task file with rich context
    task_path, task_file = create_task_file(
        tracker=tracker,
        verification_command=config["command"],
        last_failure_output=error_output,
        max_iterations=config.get("maxIterations", 10) - state.get("iteration", 0),
        timeout_seconds=isolation_config["spawnTimeout"],
        working_directory=config.get("workingDir", os.getcwd()),
        max_budget_usd=isolation_config["maxBudgetPerSpawn"],
    )

    # Log task file for debugging
    task_content = task_path.read_text()
    log_debug("TASK FILE CREATED", {"path": str(task_path), "content_length": len(task_content)})
    log_debug("TASK FILE CONTENT", task_content[:3000])

    # Determine working directory - try to extract from verification command if not set
    import re

    working_dir = config.get("workingDir")
    if not working_dir:
        # Extract directory from file paths in the command
        paths = re.findall(r"(/[^\s]+)", config["command"])
        if paths:
            test_path = Path(paths[0])
            if test_path.parent.exists():
                working_dir = str(test_path.parent)

    # Spawn CLI - output_format is forced to JSON by spawn_claude_print for stats
    spawn_config = SpawnConfig(
        max_budget_usd=isolation_config["maxBudgetPerSpawn"],
        timeout_seconds=isolation_config["spawnTimeout"],
        permission_mode=isolation_config["permissionMode"],
        working_directory=working_dir,
    )

    log_debug(
        "SPAWNING CLI",
        {
            "budget": spawn_config.max_budget_usd,
            "timeout": spawn_config.timeout_seconds,
            "permission_mode": spawn_config.permission_mode,
            "working_dir": spawn_config.working_directory,
        },
    )

    result = spawn_claude_print(prompt=task_content, config=spawn_config, task_id=task_file.metadata.id)

    # Extract stats for reporting
    stats_dict = None
    if result.stats:
        stats_dict = {
            "input_tokens": result.stats.input_tokens,
            "output_tokens": result.stats.output_tokens,
            "cache_read_tokens": result.stats.cache_read_tokens,
            "cache_creation_tokens": result.stats.cache_creation_tokens,
            "total_cost_usd": result.stats.total_cost_usd,
            "duration_ms": result.stats.duration_ms,
            "num_turns": result.stats.num_turns,
        }

    log_debug(
        "SPAWN RESULT",
        {
            "success": result.success,
            "exit_code": result.exit_code,
            "timed_out": result.timed_out,
            "retries_used": result.retries_used,
            "output_length": len(result.output) if result.output else 0,
            "error": result.error[:500] if result.error else None,
            "stats": stats_dict,
        },
    )
    log_debug("SPAWN OUTPUT", result.output[:2000] if result.output else "(empty)")

    # After spawned execution, RE-RUN verification to confirm fix worked
    # Don't trust the spawned instance's text output - verify with ground truth
    verify_result = run_verification(config["command"], config.get("timeout", 300000) // 1000, config.get("workingDir"))

    if verify_result["passed"]:
        return {
            "passed": True,
            "output": f"Spawned instance fixed the issue.\n\nVerification output:\n{verify_result['stdout']}",
            "stats": stats_dict,
            "spawn_output": result.output[:1000] if result.output else None,
        }
    else:
        # Spawned instance didn't fix it - return both outputs for context
        error_output = verify_result["stderr"] or verify_result["stdout"] or "No output"
        return {
            "passed": False,
            "output": (
                "Spawned instance attempted fix but verification still fails.\n\n"
                f"Spawned output:\n{result.output[:500]}\n\n"
                f"Verification error:\n{error_output}"
            ),
            "stats": stats_dict,
            "spawn_output": result.output[:1000] if result.output else None,
        }


def chain_block_reason(chain_state: ChainState) -> str:
    """The Stop reason for a visible run, picked from the hold the state carries."""
    chain_id = chain_state.get("chain_id", "")
    step = chain_state.get("current_step", 0)
    total = chain_state.get("total_steps", 0)
    resume = f'  prompt_engine(chain_id="{chain_id}")'
    if chain_state.get("pending_gate"):
        return (
            f"Chain {chain_id} has a pending gate review (step {step}/{total}).\n\n"
            f"Submit gate_verdict via prompt_engine:\n"
            f'  chain_id="{chain_id}"\n'
            f"  {GATE_VERDICT_GUIDANCE}"
        )
    if chain_state.get("pending_shell_verify"):
        return (
            f"Chain {chain_id} is waiting on a shell verification "
            f"(`{chain_state['pending_shell_verify']}`).\n\n"
            f'Submit the fix as user_response, or gate_action="retry|skip|abort", with '
            f'chain_id="{chain_id}".'
        )
    if step <= total:
        return f"Chain {chain_id} is active (step {step}/{total}): steps remain.\n\nContinue the chain:\n{resume}"
    return (
        f"Chain {chain_id} is held (an owed detached report or an open review on a finished "
        f"step).\n\nResume it:\n{resume}"
    )


def emit(payload: dict | None) -> NoReturn:
    """Print the hook's decision (nothing allows Stop silently) and exit."""
    if payload:
        print(json.dumps(payload))
        sys.stdout.flush()
    sys.exit(0)


def main():
    # Read hook input from stdin (Claude Code passes context here)
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        hook_input = {}

    # Prevent infinite loop - if we already blocked and Claude is retrying,
    # stop_hook_active will be True
    if hook_input.get("stop_hook_active"):
        sys.exit(0)

    # Session scoping: the host's own rows are keyed by its session id; a workflow's rows by the run
    # this session is bound to. Neither falls back to another conversation's row.
    hook_session_id = hook_input.get("session_id", "") or ""
    chain_state = cast("ChainState | None", load_recoverable_chain_state(hook_session_id or None))
    identity = exact_run_identity(chain_state.get("run_identity")) if chain_state else None
    # An owned, exact conversation pause parks its run: decided before any command, counter or
    # stale cleanup, so its rows stay byte-identical. Nothing else is exempted by it.
    parked = holds_pause_exemption(chain_state, identity)

    obligations: list[tuple[str, dict, bool]] = []
    host_state = load_verify_state(hook_session_id)
    if host_state:
        obligations.append((hook_session_id, host_state, False))
    unresolved: list[str] = []
    if identity is not None:
        workflow_rows, unresolved = load_workflow_rows(identity)
        if not parked:
            obligations.extend((key, row, True) for key, row in workflow_rows)
    elif not hook_session_id and not obligations and has_verify_rows():
        unresolved.append("this Stop event carries no session id, so no verify row can be attributed to it")

    allowed: list[dict] = []
    for key, verify_state, workflow in obligations:
        outcome = enforce_obligation(key, verify_state, workflow, chain_state)
        if outcome.get("decision") == "block":
            if unresolved:
                outcome["reason"] += "\n\n" + unresolved_reason(unresolved, chain_state)
            emit(outcome)
        if outcome:
            allowed.append(outcome)

    if unresolved:
        emit({"decision": "block", "reason": unresolved_reason(unresolved, chain_state)})

    # R30: the loader returns only runs the server still projects, i.e. runs that are not
    # complete, so a state coming back IS the block — unless that run is the parked one.
    if not obligations and chain_state and not parked:
        reason = format_pause_directive(chain_state) or chain_block_reason(chain_state)
        emit({"decision": "block", "reason": reason})

    if len(allowed) > 1:
        emit({"decision": None, "systemMessage": "\n\n".join(o.get("systemMessage", "") for o in allowed)})
    emit(allowed[0] if allowed else None)


def enforce_obligation(key: str, verify_state: dict, workflow: bool, chain_state: ChainState | None = None) -> dict:
    """Run one verify row's loop. Every write and clear names `key`, the row it was read from.

    Returns the block, an allow with a message, or `{}` for a silent allow. A workflow row lives as
    long as its run (the server releases it); only a host row expires after an hour.
    """
    config = verify_state.get("config", {})
    state = verify_state.get("state", {})

    # Staleness check: a host row older than 1 hour is discarded and Stop allowed
    from datetime import datetime, timedelta, timezone

    started_at = state.get("startedAt", "")
    if started_at and not workflow:
        try:
            start_time = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - start_time > timedelta(hours=1):
                clear_verify_state(key)
                return {}
        except (ValueError, TypeError):
            pass  # Malformed timestamp — proceed normally

    # Ensure RALPH_SESSION_ID is set for context tracking hooks
    session_id = ensure_ralph_session_id(verify_state)

    # Get iteration count — MCP server already increments before writing state,
    # so use the value directly (no +1 to avoid double-counting)
    iteration = state.get("iteration", 0) or 1
    max_iterations = config.get("maxIterations", 10)

    # Check iteration limit (>= because iteration is already incremented by MCP server)
    if iteration >= max_iterations:
        # Max iterations reached - clear state and allow stop
        clear_verify_state(key)
        return {
            "decision": None,  # Allow stop
            "systemMessage": f"[Verify] Max iterations ({max_iterations}) reached. Stopping.",
        }

    # Load context isolation config
    isolation_config = load_context_isolation_config()
    in_context_threshold = isolation_config.get("inContextThreshold", 3)

    # Run verification
    command = config.get("command", "")
    timeout = config.get("timeout", 300000) // 1000  # Convert ms to seconds
    working_dir = config.get("workingDir")

    result = run_verification(command, timeout, working_dir)
    run = chain_state if workflow else None  # only a workflow row's failure names its run

    # Update iteration count in state
    state["iteration"] = iteration
    state["lastResult"] = result
    verify_state["state"] = state
    save_verify_state(verify_state, key)

    if result["passed"]:
        # Verification passed - clear state and allow stop
        clear_verify_state(key)

        # Opportunistic cleanup of stale state across all stores
        try:
            from hook_state_store import cleanup_stale_rows
            from session_state import cleanup_old_sessions
            from session_tracker import cleanup_old_ralph_sessions

            cleanup_stale_rows(max_age_hours=24)
            cleanup_old_sessions(max_age_hours=24)
            cleanup_old_ralph_sessions(max_age_hours=24)
        except Exception:
            pass  # Non-critical — don't fail verification success

        return {
            "decision": None,  # Allow stop
            "systemMessage": f"[Verify] PASSED on iteration {iteration}!",
        }

    # Verification failed - check if we should spawn isolated instance
    if isolation_config.get("enabled", True) and iteration > in_context_threshold:
        # Check if we're already in a spawned instance (avoid infinite recursion)
        if os.environ.get("RALPH_SPAWNED"):
            # Already spawned - continue in-context
            return {"decision": "block", "reason": format_error_feedback(result, verify_state, run)}

        # Spawn isolated instance
        try:
            spawn_result = spawn_isolated_iteration(verify_state, result, isolation_config, session_id)

            if spawn_result["passed"]:
                # Spawned instance succeeded
                clear_verify_state(key)

                # Format stats for display
                stats = spawn_result.get("stats", {})
                stats_summary = ""
                if stats:
                    cost = stats.get("total_cost_usd", 0)
                    duration_s = stats.get("duration_ms", 0) / 1000
                    input_tok = stats.get("input_tokens", 0)
                    output_tok = stats.get("output_tokens", 0)
                    cache_read = stats.get("cache_read_tokens", 0)
                    turns = stats.get("num_turns", 0)
                    stats_summary = f"""
**Spawn Stats:**
- Cost: ${cost:.4f}
- Duration: {duration_s:.1f}s
- Tokens: {input_tok:,} in / {output_tok:,} out (cache: {cache_read:,})
- Turns: {turns}"""

                message = f"""## ✅ Verification PASSED (Iteration {iteration})

**Method:** Isolated execution (fresh context)
**Command:** `{config.get("command", "unknown")}`
{stats_summary}

### Result
{spawn_result["output"][:800]}"""

                return {
                    "decision": None,
                    "systemMessage": message,
                    "metadata": {
                        "type": "ralph_verification",
                        "passed": True,
                        "iteration": iteration,
                        "method": "isolated",
                        "stats": stats,
                    },
                }
            else:
                # Spawned instance failed - update state and bounce back
                state["iteration"] = iteration + 1  # Count the spawn as an iteration
                verify_state["state"] = state
                save_verify_state(verify_state, key)

                # Format stats even on failure
                stats = spawn_result.get("stats", {})
                stats_line = ""
                if stats:
                    cost = stats.get("total_cost_usd", 0)
                    stats_line = f"\n**Spawn cost:** ${cost:.4f}"

                reason = f"""## ❌ Isolated Execution FAILED (Iteration {iteration}/{max_iterations})

The context-isolated Claude instance could not fix the issue.{stats_line}

**Output from isolated instance:**
```
{spawn_result["output"][:2000]}
```

Please review the isolated attempt and try a different approach."""

                return {
                    "decision": "block",
                    "reason": reason,
                    "metadata": {
                        "type": "ralph_verification",
                        "passed": False,
                        "iteration": iteration,
                        "max_iterations": max_iterations,
                        "method": "isolated",
                        "stats": stats,
                    },
                }

        except ImportError as e:
            # Libraries not available - fall back to in-context
            print(f"[Verify] Isolation libraries unavailable: {e}", file=sys.stderr)
            return {"decision": "block", "reason": format_error_feedback(result, verify_state, run)}

        except Exception as e:
            # Spawn failed - fall back to in-context
            print(f"[Verify] Isolation spawn failed: {e}", file=sys.stderr)
            return {"decision": "block", "reason": format_error_feedback(result, verify_state, run)}

    # In-context mode - block stop and feed error back
    return {"decision": "block", "reason": format_error_feedback(result, verify_state, run)}


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # On error, allow stop (don't break Claude)
        print(f"[Verify] Hook error: {e}", file=sys.stderr)
        sys.exit(0)
