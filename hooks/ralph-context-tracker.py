#!/usr/bin/env python3
"""
PostToolUse hook: Track file changes and tool usage for Ralph loops.

Triggers after: Edit, Write, Bash (during active Ralph sessions)

Records:
1. File modifications (Edit/Write tools)
2. Command executions (Bash tool)
3. Extracts lessons from Claude's reasoning

This data feeds the session story for context-isolated Ralph instances.
"""

import json
import os
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from session_tracker import get_session_tracker
from lesson_extractor import extract_lesson, extract_approach, summarize_error


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def get_verify_state_path() -> Path:
    """Get path to verify-active.json state file."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", str(Path(__file__).parent.parent))
    return Path(plugin_root) / "runtime-state" / "verify-active.json"


def get_active_ralph_session() -> str | None:
    """
    Get the currently active Ralph session ID.

    Checks for verify-active.json state file (source of truth for Ralph sessions).
    State files persist across process boundaries, unlike environment variables.
    """
    state_file = get_verify_state_path()

    if not state_file.exists():
        return None

    try:
        state = json.loads(state_file.read_text())
        return state.get("sessionId")
    except (json.JSONDecodeError, IOError):
        return None


def extract_file_change_details(tool_input: dict, tool_name: str) -> dict | None:
    """Extract file change details from Edit/Write tool input."""
    if "Edit" in tool_name:
        return {
            "file": tool_input.get("file_path", "unknown"),
            "type": "modify",
            "details": f"Edit: {tool_input.get('old_string', '')[:50]}... → {tool_input.get('new_string', '')[:50]}..."
        }
    elif "Write" in tool_name:
        return {
            "file": tool_input.get("file_path", "unknown"),
            "type": "add",
            "details": f"Write: {len(tool_input.get('content', ''))} chars"
        }
    return None


def extract_bash_details(tool_input: dict, tool_response: str) -> dict | None:
    """Extract command execution details from Bash tool."""
    command = tool_input.get("command", "")
    if not command:
        return None

    # Truncate long commands
    cmd_summary = command[:100] + "..." if len(command) > 100 else command

    # Check if it's a verification command (test, lint, build, etc.)
    verification_indicators = ["test", "npm run", "yarn", "pytest", "cargo test", "go test", "make"]
    is_verification = any(ind in command.lower() for ind in verification_indicators)

    return {
        "command": cmd_summary,
        "is_verification": is_verification,
        "output_summary": summarize_error(tool_response) if tool_response else None
    }


def main():
    hook_input = parse_hook_input()

    tool_name = hook_input.get("tool_name", "")
    session_id = hook_input.get("session_id", "")

    # Only track Edit, Write, and Bash tools
    tracked_tools = ["Edit", "Write", "Bash"]
    if not any(t in tool_name for t in tracked_tools):
        sys.exit(0)

    # Only track during active Ralph sessions
    ralph_session = get_active_ralph_session()
    if not ralph_session:
        # No active Ralph session, no tracking needed
        sys.exit(0)

    tool_input = hook_input.get("tool_input", {})
    tool_response = hook_input.get("tool_response", "")

    # Convert response to string if needed
    if isinstance(tool_response, dict):
        content = tool_response.get("content", "")
        if isinstance(content, list):
            tool_response = " ".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in content
            )
        else:
            tool_response = str(content)
    else:
        tool_response = str(tool_response)

    # Get session tracker
    tracker = get_session_tracker(ralph_session)

    # Track file changes
    if "Edit" in tool_name or "Write" in tool_name:
        change = extract_file_change_details(tool_input, tool_name)
        if change:
            tracker.record_file_change(
                file_path=change["file"],
                change_type=change["type"],
                details=change["details"]
            )

    # Track Bash commands (for context about what was run)
    if "Bash" in tool_name:
        bash_details = extract_bash_details(tool_input, tool_response)
        if bash_details and bash_details["is_verification"]:
            # This is a verification command - its output will be captured
            # by ralph-stop.py when the verification completes
            pass

    # No output needed - silent tracking
    sys.exit(0)


if __name__ == "__main__":
    main()
