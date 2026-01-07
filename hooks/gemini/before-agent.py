#!/usr/bin/env python3
"""
Gemini Adapter: BeforeAgent Hook
Wraps the core prompt-suggestion logic for Gemini CLI.
"""

import sys
import os
import json
from datetime import datetime
from pathlib import Path

# Add shared lib to path
SHARED_LIB = Path(__file__).parent.parent / "lib"
sys.path.insert(0, str(SHARED_LIB))

from cache_manager import (
    load_prompts_cache,
    get_prompt_by_id,
    match_prompts_to_intent,
    get_chains_only,
)
from session_state import load_session_state, format_chain_reminder

# Duplicate logic from prompt-suggest.py but adapted for Gemini I/O
# This ensures we don't break Claude if we change one or the other.

def _project_root() -> Path:
    # hooks/gemini/before-agent.py -> gemini -> hooks -> project_root
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
            f.write(f"[{ts}] BeforeAgent: {message}\n")
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

def detect_prompt_invocation(message: str) -> str | None:
    import re
    match = re.match(r'^>>\s*([a-zA-Z0-9_-]+)', message.strip())
    if match:
        return match.group(1)
    return None

def detect_chain_syntax(message: str) -> list[str]:
    import re
    chain_pattern = r'>>\s*([a-zA-Z0-9_-]+)\s*(?:-->|→)'
    matches = re.findall(chain_pattern, message)
    final_match = re.search(r'(?:-->|→)\s*>>\s*([a-zA-Z0-9_-]+)\s*$', message)
    if final_match:
        matches.append(final_match.group(1))
    return matches

def detect_inline_gates(message: str) -> list[str]:
    import re
    quoted_pattern = r'::\s*[\'"]([^\'"]+)[\'"]'
    id_pattern = r'::\s*([a-zA-Z][a-zA-Z0-9_-]*)\b'
    quoted = re.findall(quoted_pattern, message)
    ids = re.findall(id_pattern, message)
    return quoted + ids

def format_tool_call(prompt_id: str, info: dict) -> str:
    args = info.get("arguments", [])
    if not args:
        return f'prompt_engine(command:">>{prompt_id}")'
    
    options_parts = []
    for arg in args:
        name = arg.get("name", "")
        default = arg.get("default")
        placeholder = f'"{default}"' if default else f'"<{name}>"'
        options_parts.append(f'"{name}": {placeholder}')
    
    options_str = ", ".join(options_parts)
    return f'prompt_engine(command:">>{prompt_id}", options:{{{options_str}}})'

def main():
    hook_input = parse_hook_input()
    
    # Gemini BeforeAgent Input: { "prompt": "..." }
    user_message = (
        hook_input.get("prompt", "") or 
        hook_input.get("message", "") or
        hook_input.get("userMessage", "") or
        hook_input.get("input", "")
    )
    session_id = hook_input.get("session_id", "") or hook_input.get("sessionId", "")

    if not user_message:
        sys.exit(0)

    cache = load_prompts_cache()
    if not cache:
        sys.exit(0)

    output_lines = []

    # 1. Chain State (if any)
    if session_id:
        session_state = load_session_state(session_id)
        if session_state:
            reminder = format_chain_reminder(session_state)
            if reminder:
                output_lines.append(reminder)
                output_lines.append("")

    # 2. Prompt Invocation
    invoked_prompt = detect_prompt_invocation(user_message)
    if invoked_prompt:
        prompt_info = get_prompt_by_id(invoked_prompt, cache)
        if prompt_info:
            chain_tag = f" [Chain: {prompt_info.get('chain_steps', 0)} steps]" if prompt_info.get("is_chain") else ""
            output_lines.append(f"[MCP] >>{invoked_prompt} ({prompt_info.get('category', 'unknown')}){chain_tag}")
            output_lines.append(f"  {format_tool_call(invoked_prompt, prompt_info)}")
        else:
            output_lines.append(f"[MCP Prompt Not Found] >>{invoked_prompt}")
            # Suggestions logic could go here

    # 3. Chain Syntax
    chain_prompts = detect_chain_syntax(user_message)
    if chain_prompts and len(chain_prompts) > 1:
        full_chain = ' --> '.join([f'>>{p}' for p in chain_prompts])
        output_lines.append(f"[MCP Chain] {len(chain_prompts)} steps")
        output_lines.append(f'  prompt_engine(command:"{full_chain}")')

    # 4. Inline Gates
    inline_gates = detect_inline_gates(user_message)
    if inline_gates:
        gates_str = " | ".join(g[:40] for g in inline_gates[:3])
        output_lines.append(f"[Gates] {gates_str}")
        output_lines.append("  Respond: GATE_REVIEW: PASS|FAIL - <reason>")

    # OUTPUT
    if output_lines:
        final_output = "\n".join(output_lines)
        # Gemini Specific Output Format for BeforeAgent
        # systemMessage is NOT supported in BeforeAgent, use additionalContext
        out = {
            "hookSpecificOutput": {
                "hookEventName": "BeforeAgent",
                "additionalContext": final_output
            }
        }
        _log_debug(f"emitting additionalContext length={len(final_output)}")
        print(json.dumps(out))
        sys.exit(0)
    
    sys.exit(0)

if __name__ == "__main__":
    main()
