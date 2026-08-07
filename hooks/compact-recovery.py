#!/usr/bin/env python3
"""
SessionStart("compact") hook: Re-inject active chain state after compaction.

Triggers after: Context compaction (manual /compact or auto-compaction).

Reads chain state from server's SQLite state.db (SSOT) and outputs a
continuation directive to stdout. Claude Code adds stdout to the
post-compaction context, bridging the gap between compaction and the
next UserPromptSubmit (where prompt-suggest.py would also catch it).

This replaces pre-compact.py which used PreCompact — a side-effects-only
event that cannot inject context into the conversation.
"""

import json
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from db_reader import load_active_chain_state
from session_state import ChainState, format_chain_reminder, load_session_state


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        return {}


def main():
    hook_input = parse_hook_input()
    session_id = hook_input.get("session_id", "")

    # SSOT: read from server's state.db (works without PostToolUse hook)
    state: ChainState | None = load_active_chain_state()  # type: ignore[assignment]

    # Fallback: hooks-state.db (if PostToolUse populated it)
    if not state and session_id:
        state = load_session_state(session_id)

    if not state:
        sys.exit(0)

    # Only inject if there's active chain/gate/verify state
    chain_id = state.get("chain_id", "")
    step = state.get("current_step", 0)
    total = state.get("total_steps", 0)
    pending_gate = state.get("pending_gate")
    pending_verify = state.get("pending_shell_verify")

    has_chain = step > 0
    has_gate = pending_gate is not None
    has_verify = pending_verify is not None

    if not has_chain and not has_gate and not has_verify:
        sys.exit(0)

    # Build continuation directive matching prompt-suggest.py patterns
    reminder = format_chain_reminder(state, mode="full")

    if pending_gate:
        directive = f'<GATE-REVIEW>chain_id="{chain_id}" gates="{pending_gate}" → Submit gate_verdict</GATE-REVIEW>'
    elif pending_verify:
        directive = (
            f"<CALL-TOOL>\n"
            f'prompt_engine | chain_id:"{chain_id}"\n'
            f"REQUIRED: Shell verification pending. Run implementation, "
            f"then prompt_engine validates.\n"
            f"</CALL-TOOL>"
        )
    elif step > 0 and step <= total:
        directive = (
            f"<CALL-TOOL>\n"
            f'prompt_engine | chain_id:"{chain_id}"\n'
            f"REQUIRED: Continue active chain (step {step}/{total}). "
            f"Do not respond without advancing.\n"
            f"</CALL-TOOL>"
        )
    else:
        directive = ""

    # Output to stdout — Claude Code injects this into post-compaction context
    output_lines = [
        "## Active Chain State (recovered after compaction)",
        "",
        reminder,
    ]
    if directive:
        output_lines.append("")
        output_lines.append(directive)

    print("\n".join(output_lines))
    sys.exit(0)


if __name__ == "__main__":
    main()
