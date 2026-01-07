#!/usr/bin/env python3
"""
Gemini Adapter: Stop Hook
Wraps ralph-stop logic for autonomous loops.
"""
import sys
from pathlib import Path

# Add shared lib/hooks root
CORE_HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(CORE_HOOKS_DIR))

import importlib.util
spec = importlib.util.spec_from_file_location("ralph_stop", CORE_HOOKS_DIR / "ralph-stop.py")
ralph_stop = importlib.util.module_from_spec(spec)
sys.modules["ralph_stop"] = ralph_stop
spec.loader.exec_module(ralph_stop)

if __name__ == "__main__":
    ralph_stop.main()
