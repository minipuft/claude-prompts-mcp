#!/usr/bin/env python3
"""
Gemini CLI Hook: AfterTool → Post prompt_engine processing
Tracks chain/gate state and injects continuation reminders.
"""

import sys
import json
from pathlib import Path

import importlib.util

# Delegate to core Gemini script to avoid drift
EXT_ROOT = Path(__file__).resolve().parents[2]
CORE_SCRIPT = EXT_ROOT / "hooks" / "gemini" / "after-tool.py"

def _delegate_main():
    spec = importlib.util.spec_from_file_location("after_tool", CORE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["after_tool"] = module
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


def main():
    # Delegate to core implementation
    _delegate_main()


if __name__ == "__main__":
    main()
