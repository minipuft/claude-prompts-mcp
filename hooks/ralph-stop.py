#!/usr/bin/env python3
"""
Stop hook: Shell verification for Ralph Wiggum-style autonomous loops.

When Claude tries to stop, this hook:
1. Reads runtime-state/verify-active.json (written by MCP server)
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

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))


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


def get_verify_state_path() -> Path:
    """Get path to verify-active.json from MCP server's runtime-state."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", str(Path(__file__).parent.parent))
    # MCP server writes to {plugin_root}/runtime-state/ (process.cwd() is plugin root)
    return Path(plugin_root) / "runtime-state" / "verify-active.json"


def get_config_path() -> Path:
    """Get path to config.json."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", str(Path(__file__).parent.parent))
    return Path(plugin_root) / "server" / "config.json"


def load_context_isolation_config() -> dict:
    """
    Load Ralph context isolation config from server config.json.

    Config paths:
    - verification.inContextAttempts: Number of in-context attempts before spawning
    - verification.isolation.enabled: Whether isolation is enabled
    - verification.isolation.maxBudget: Max budget per spawn in USD
    - verification.isolation.timeout: Spawn timeout in seconds
    - verification.isolation.permissionMode: Permission mode (delegate/ask/deny)
    """
    config_path = get_config_path()
    defaults = {
        "enabled": True,
        "inContextThreshold": 3,
        "maxBudgetPerSpawn": 1.00,
        "spawnTimeout": 300,
        "permissionMode": "delegate"
    }

    if not config_path.exists():
        return defaults

    try:
        config = json.loads(config_path.read_text())
        verification = config.get("verification", {})
        isolation = verification.get("isolation", {})

        return {
            "enabled": isolation.get("enabled", defaults["enabled"]),
            "inContextThreshold": verification.get("inContextAttempts", defaults["inContextThreshold"]),
            "maxBudgetPerSpawn": isolation.get("maxBudget", defaults["maxBudgetPerSpawn"]),
            "spawnTimeout": isolation.get("timeout", defaults["spawnTimeout"]),
            "permissionMode": isolation.get("permissionMode", defaults["permissionMode"]),
        }
    except (json.JSONDecodeError, IOError):
        return defaults


def load_verify_state() -> dict | None:
    """Load verification state from MCP server's runtime-state."""
    state_file = get_verify_state_path()

    if not state_file.exists():
        return None

    try:
        return json.loads(state_file.read_text())
    except (json.JSONDecodeError, IOError):
        return None


def save_verify_state(state: dict) -> None:
    """Save updated verification state."""
    state_file = get_verify_state_path()
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, indent=2))


def clear_verify_state() -> None:
    """Clear verification state file."""
    state_file = get_verify_state_path()
    try:
        state_file.unlink()
    except FileNotFoundError:
        pass


def run_verification(command: str, timeout: int, working_dir: str = None) -> dict:
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
                **{k: v for k, v in os.environ.items()
                   if k in ("PATH", "HOME", "USER", "SHELL", "NODE_ENV", "CI")},
            }
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


def format_error_feedback(result: dict, verify_state: dict) -> str:
    """Format error feedback message for Claude (in-context mode)."""
    config = verify_state["config"]
    state = verify_state["state"]
    iteration = state["iteration"] + 1
    max_iterations = config["maxIterations"]

    error_output = result["stderr"] or result["stdout"] or "No output captured"

    lines = [
        f"## Shell Verification FAILED (Iteration {iteration}/{max_iterations})",
        "",
        f"**Command:** `{config['command']}`",
        f"**Exit Code:** {result['exitCode']}",
    ]

    if result["timedOut"]:
        lines.append("**Status:** Timed out")

    lines.extend([
        "",
        "### Error Output",
        "```",
        error_output[:2000],
        "```",
        "",
        "Please fix the issues and continue working. Verification will run again when you finish.",
    ])

    return "\n".join(lines)


def log_debug(message: str, data: dict | str | None = None) -> None:
    """Write debug info to ralph-debug.log for troubleshooting."""
    from datetime import datetime
    log_path = get_verify_state_path().parent / "ralph-debug.log"
    timestamp = datetime.now().isoformat()
    with open(log_path, "a") as f:
        f.write(f"\n[{timestamp}] {message}\n")
        if data:
            if isinstance(data, dict):
                f.write(json.dumps(data, indent=2, default=str) + "\n")
            else:
                f.write(str(data) + "\n")


def spawn_isolated_iteration(
    verify_state: dict,
    last_result: dict,
    isolation_config: dict,
    session_id: str
) -> dict:
    """
    Spawn a context-isolated CLI instance for this iteration.

    Args:
        verify_state: Current verification state from MCP server
        last_result: Result from the last verification attempt
        isolation_config: Ralph isolation configuration
        session_id: Session ID for tracking (from ensure_ralph_session_id)

    Returns the result from the spawned instance.
    """
    log_debug("=== SPAWN ISOLATED ITERATION START ===", {
        "session_id": session_id,
        "isolation_config": isolation_config
    })

    # Import here to avoid import errors when not in isolation mode
    from session_tracker import get_session_tracker
    from task_protocol import create_task_file
    from cli_spawner import spawn_claude_print, SpawnConfig

    config = verify_state["config"]
    state = verify_state.get("state", {})

    # Get or create session tracker
    tracker = get_session_tracker(session_id)

    # Set goal if not already set
    if not tracker.state.get("original_goal"):
        tracker.set_goal(
            goal=config.get("originalGoal", "Fix verification failures"),
            verification_command=config["command"],
            working_directory=config.get("workingDir", os.getcwd())
        )

    # Record the last iteration
    error_output = last_result.get("stderr") or last_result.get("stdout") or ""
    tracker.record_iteration(
        approach="Previous attempt (in-context)",
        result=f"FAIL - exit code {last_result.get('exitCode', -1)}",
        lesson="Escalating to isolated execution"
    )

    # Create task file with rich context
    task_path, task_file = create_task_file(
        tracker=tracker,
        verification_command=config["command"],
        last_failure_output=error_output,
        max_iterations=config.get("maxIterations", 10) - state.get("iteration", 0),
        timeout_seconds=isolation_config["spawnTimeout"],
        working_directory=config.get("workingDir", os.getcwd()),
        max_budget_usd=isolation_config["maxBudgetPerSpawn"]
    )

    # Log task file for debugging
    task_content = task_path.read_text()
    log_debug("TASK FILE CREATED", {
        "path": str(task_path),
        "content_length": len(task_content)
    })
    log_debug("TASK FILE CONTENT", task_content[:3000])

    # Determine working directory - try to extract from verification command if not set
    import re
    working_dir = config.get("workingDir")
    if not working_dir:
        # Extract directory from file paths in the command
        paths = re.findall(r'(/[^\s]+)', config["command"])
        if paths:
            test_path = Path(paths[0])
            if test_path.parent.exists():
                working_dir = str(test_path.parent)

    # Spawn CLI - output_format is forced to JSON by spawn_claude_print for stats
    spawn_config = SpawnConfig(
        max_budget_usd=isolation_config["maxBudgetPerSpawn"],
        timeout_seconds=isolation_config["spawnTimeout"],
        permission_mode=isolation_config["permissionMode"],
        working_directory=working_dir
    )

    log_debug("SPAWNING CLI", {
        "budget": spawn_config.max_budget_usd,
        "timeout": spawn_config.timeout_seconds,
        "permission_mode": spawn_config.permission_mode,
        "working_dir": spawn_config.working_directory
    })

    result = spawn_claude_print(
        prompt=task_content,
        config=spawn_config,
        task_id=task_file.metadata.id
    )

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

    log_debug("SPAWN RESULT", {
        "success": result.success,
        "exit_code": result.exit_code,
        "timed_out": result.timed_out,
        "retries_used": result.retries_used,
        "output_length": len(result.output) if result.output else 0,
        "error": result.error[:500] if result.error else None,
        "stats": stats_dict
    })
    log_debug("SPAWN OUTPUT", result.output[:2000] if result.output else "(empty)")

    # After spawned execution, RE-RUN verification to confirm fix worked
    # Don't trust the spawned instance's text output - verify with ground truth
    verify_result = run_verification(
        config["command"],
        config.get("timeout", 300000) // 1000,
        config.get("workingDir")
    )

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
            "output": f"Spawned instance attempted fix but verification still fails.\n\nSpawned output:\n{result.output[:500]}\n\nVerification error:\n{error_output}",
            "stats": stats_dict,
            "spawn_output": result.output[:1000] if result.output else None,
        }


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

    # Load verification state from MCP server's runtime-state
    verify_state = load_verify_state()

    if not verify_state:
        # No active verification - allow stop
        sys.exit(0)

    config = verify_state.get("config", {})
    state = verify_state.get("state", {})

    # Ensure RALPH_SESSION_ID is set for context tracking hooks
    session_id = ensure_ralph_session_id(verify_state)

    # Get iteration count
    iteration = state.get("iteration", 0) + 1
    max_iterations = config.get("maxIterations", 10)

    # Check iteration limit
    if iteration > max_iterations:
        # Max iterations reached - clear state and allow stop
        clear_verify_state()
        print(json.dumps({
            "decision": None,  # Allow stop
            "systemMessage": f"[Verify] Max iterations ({max_iterations}) reached. Stopping."
        }))
        sys.stdout.flush()
        sys.exit(0)

    # Load context isolation config
    isolation_config = load_context_isolation_config()
    in_context_threshold = isolation_config.get("inContextThreshold", 3)

    # Run verification
    command = config.get("command", "")
    timeout = config.get("timeout", 300000) // 1000  # Convert ms to seconds
    working_dir = config.get("workingDir")

    result = run_verification(command, timeout, working_dir)

    # Update iteration count in state
    state["iteration"] = iteration
    state["lastResult"] = result
    verify_state["state"] = state
    save_verify_state(verify_state)

    if result["passed"]:
        # Verification passed - clear state and allow stop
        clear_verify_state()
        print(json.dumps({
            "decision": None,  # Allow stop
            "systemMessage": f"[Verify] PASSED on iteration {iteration}!"
        }))
        sys.stdout.flush()
        sys.exit(0)

    # Verification failed - check if we should spawn isolated instance
    if isolation_config.get("enabled", True) and iteration > in_context_threshold:
        # Check if we're already in a spawned instance (avoid infinite recursion)
        if os.environ.get("RALPH_SPAWNED"):
            # Already spawned - continue in-context
            reason = format_error_feedback(result, verify_state)
            print(json.dumps({
                "decision": "block",
                "reason": reason
            }))
            sys.stdout.flush()
            sys.exit(0)

        # Spawn isolated instance
        try:
            spawn_result = spawn_isolated_iteration(verify_state, result, isolation_config, session_id)

            if spawn_result["passed"]:
                # Spawned instance succeeded
                clear_verify_state()

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
**Command:** `{config.get('command', 'unknown')}`
{stats_summary}

### Result
{spawn_result['output'][:800]}"""

                print(json.dumps({
                    "decision": None,
                    "systemMessage": message,
                    "metadata": {
                        "type": "ralph_verification",
                        "passed": True,
                        "iteration": iteration,
                        "method": "isolated",
                        "stats": stats,
                    }
                }))
                sys.stdout.flush()
                sys.exit(0)
            else:
                # Spawned instance failed - update state and bounce back
                state["iteration"] = iteration + 1  # Count the spawn as an iteration
                verify_state["state"] = state
                save_verify_state(verify_state)

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
{spawn_result['output'][:2000]}
```

Please review the isolated attempt and try a different approach."""

                print(json.dumps({
                    "decision": "block",
                    "reason": reason,
                    "metadata": {
                        "type": "ralph_verification",
                        "passed": False,
                        "iteration": iteration,
                        "max_iterations": max_iterations,
                        "method": "isolated",
                        "stats": stats,
                    }
                }))
                sys.stdout.flush()
                sys.exit(0)

        except ImportError as e:
            # Libraries not available - fall back to in-context
            print(f"[Verify] Isolation libraries unavailable: {e}", file=sys.stderr)
            reason = format_error_feedback(result, verify_state)
            print(json.dumps({
                "decision": "block",
                "reason": reason
            }))
            sys.stdout.flush()
            sys.exit(0)

        except Exception as e:
            # Spawn failed - fall back to in-context
            print(f"[Verify] Isolation spawn failed: {e}", file=sys.stderr)
            reason = format_error_feedback(result, verify_state)
            print(json.dumps({
                "decision": "block",
                "reason": reason
            }))
            sys.stdout.flush()
            sys.exit(0)

    # In-context mode - block stop and feed error back
    reason = format_error_feedback(result, verify_state)

    print(json.dumps({
        "decision": "block",
        "reason": reason
    }))
    sys.stdout.flush()
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # On error, allow stop (don't break Claude)
        print(f"[Verify] Hook error: {e}", file=sys.stderr)
        sys.exit(0)
