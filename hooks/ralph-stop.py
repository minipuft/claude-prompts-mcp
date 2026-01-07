#!/usr/bin/env python3
"""
Stop hook: Shell verification for Ralph Wiggum-style autonomous loops.

When Claude tries to stop, this hook:
1. Reads runtime-state/verify-active.json (written by MCP server)
2. Runs the verification command
3. If PASS (exit 0): Allows Claude to stop
4. If FAIL (exit != 0): Blocks stop, feeds error back to Claude

This integrates with the :: verify:"command" loop:true syntax in prompt_engine.
"""

import json
import os
import subprocess
import sys
from pathlib import Path


def get_verify_state_path() -> Path:
    """Get path to verify-active.json from MCP server's runtime-state."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", str(Path(__file__).parent.parent))
    return Path(plugin_root) / "server" / "runtime-state" / "verify-active.json"


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
    """Format error feedback message for Claude."""
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


def main():
    # Load verification state from MCP server's runtime-state
    verify_state = load_verify_state()

    if not verify_state:
        # No active verification - allow stop
        sys.exit(0)

    config = verify_state.get("config", {})
    state = verify_state.get("state", {})

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
        sys.exit(0)

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
        sys.exit(0)

    # Verification failed - block stop and feed error back
    reason = format_error_feedback(result, verify_state)

    print(json.dumps({
        "decision": "block",
        "reason": reason
    }))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # On error, allow stop (don't break Claude)
        print(f"[Verify] Hook error: {e}", file=sys.stderr)
        sys.exit(0)
