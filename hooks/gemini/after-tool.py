#!/usr/bin/env python3
"""
Gemini Adapter: AfterTool Hook
Wraps the chain-tracking logic for Gemini CLI.
"""

import sys
import os
import json
from datetime import datetime
from pathlib import Path

# Add shared lib to path
SHARED_LIB = Path(__file__).parent.parent / "lib"
sys.path.insert(0, str(SHARED_LIB))

from session_state import (
    load_session_state,
    save_session_state,
    parse_prompt_engine_response,
)

def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _log_debug(message: str) -> None:
    if os.getenv('GEMINI_HOOK_DEBUG', '').lower() not in {'1', 'true', 'yes'}:
        return
    root = _project_root()
    log_dir = root / '.gemini'
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / 'hook-debug.log'
    ts = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    try:
        with open(log_file, 'a') as f:
            f.write(f"[{ts}] AfterTool: {message}\n")
    except Exception:
        pass


def parse_hook_input() -> dict:
    try:
        raw = sys.stdin.read()
        preview = (raw or '')[:200].replace('\n', ' ')
        _log_debug(f"received input: {preview}...")
        return json.loads(raw or '{}')
    except json.JSONDecodeError:
        _log_debug("invalid JSON input")
        return {}

def main():
    hook_input = parse_hook_input()

    # Gemini Input Mapping
    tool_name = (
        hook_input.get("tool_name", "") or 
        hook_input.get("toolName", "") or
        hook_input.get("name", "")
    )
    session_id = (
        hook_input.get("session_id", "") or
        hook_input.get("sessionId", "")
    )

    if "prompt_engine" not in tool_name:
        sys.exit(0)

    tool_response = (
        hook_input.get("tool_response", {}) or
        hook_input.get("toolResponse", {}) or
        hook_input.get("result", {})
    )

    # Extract tool_input for chain_id (matches Claude's post-prompt-engine.py)
    tool_input = (
        hook_input.get("tool_input", {}) or
        hook_input.get("toolInput", {}) or
        {}
    )

    # Parse content
    if isinstance(tool_response, dict):
        content = tool_response.get("content", "")
        if isinstance(content, list):
            content = " ".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in content
            )
    else:
        content = str(tool_response)

    state = parse_prompt_engine_response(content)

    if not state:
        sys.exit(0)

    # Extract chain_id from tool_input (higher priority than regex parsing)
    if isinstance(tool_input, dict):
        input_chain_id = tool_input.get("chain_id", "")
        if input_chain_id:
            state["chain_id"] = input_chain_id

    save_session_state(session_id, state)

    output_lines = []
    if state.get("pending_gate"):
        criteria = state.get("gate_criteria", [])
        criteria_str = " | ".join(c[:40] for c in criteria[:3]) if criteria else ""
        output_lines.append(f"[Gate] {state['pending_gate']}")
        output_lines.append("  Respond: GATE_REVIEW: PASS|FAIL - <reason>")
        if criteria_str:
            output_lines.append(f"  Check: {criteria_str}")

    if state.get("current_step", 0) > 0:
        step = state["current_step"]
        total = state["total_steps"]
        if step < total:
            output_lines.append(f"[Chain] Step {step}/{total} - call prompt_engine to continue")

    if output_lines:
        final_output = "\n".join(output_lines)
        out = {
            "hookSpecificOutput": {
                "hookEventName": "AfterTool",
                "additionalContext": final_output
            }
        }
        _log_debug(f"emitting additionalContext length={len(final_output)}")
        print(json.dumps(out))
        sys.exit(0)
    
    sys.exit(0)

if __name__ == "__main__":
    main()
