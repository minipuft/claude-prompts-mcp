#!/usr/bin/env python3
"""
Gemini CLI Hook: BeforeAgent → Prompt Suggest
Detects >>prompt syntax and injects additionalContext with suggested MCP calls.
"""

import sys
import json
from pathlib import Path

import importlib.util

# Delegate to core Gemini script to avoid drift
EXT_ROOT = Path(__file__).resolve().parents[2]
CORE_SCRIPT = EXT_ROOT / "hooks" / "gemini" / "before-agent.py"

def _delegate_main():
    spec = importlib.util.spec_from_file_location("before_agent", CORE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["before_agent"] = module
    spec.loader.exec_module(module)  # type: ignore
    if hasattr(module, "main"):
        module.main()
    else:
        sys.exit(0)


def parse_hook_input() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
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
    quoted_pattern = r"::\s*['\"]([^'\"]+)['\"]"
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
    # Delegate to core implementation
    _delegate_main()


if __name__ == "__main__":
    main()
