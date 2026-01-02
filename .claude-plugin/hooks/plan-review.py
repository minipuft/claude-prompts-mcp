#!/usr/bin/env python3
"""
PreToolUse hook: Inject reflection frame before ExitPlanMode.

Triggers on: ExitPlanMode (once per session)
Output: stderr (exit code 2) - fed to Claude, not shown to user

Token-efficient pattern:
1. First call: Inject reflection criteria, block tool
2. Subsequent calls: Allow through (reflection already done)
3. Post-validation via gates checks output quality
"""

import json
import os
import sys
from pathlib import Path


def get_session_marker_path(session_id: str) -> Path:
    """Get path to session-specific marker file."""
    marker_dir = Path(os.environ.get("TMPDIR", "/tmp")) / "claude-plan-review"
    marker_dir.mkdir(exist_ok=True)
    return marker_dir / f"{session_id}.done"


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def main():
    hook_input = parse_hook_input()
    tool_name = hook_input.get("tool_name", "")
    session_id = hook_input.get("session_id", "default")

    # Only trigger on ExitPlanMode
    if tool_name != "ExitPlanMode":
        sys.exit(0)

    # Check if reflection already done for this session
    marker_path = get_session_marker_path(session_id)
    if marker_path.exists():
        # Already reflected - allow through
        sys.exit(0)

    # Mark as done for this session
    marker_path.touch()

    # Inject reflection criteria (one-time, token-efficient)
    review_prompt = """[Plan Review Gate]

Before finalizing, complete this structured reflection:

**Risk Assessment:**
- Critical Risk: (single failure point or "mitigated")
- Unvalidated Assumption: (unverified dependency or "verified")

**Completeness Check:**
- Coverage Gap: (missing scenario or "complete")
- Alternative: (considered trade-off or "optimal chosen")

**Refined Plan:**
Incorporate findings above into your plan, then call ExitPlanMode to proceed."""

    # Exit 2 + stderr = fed to Claude AND blocks tool
    print(review_prompt, file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
