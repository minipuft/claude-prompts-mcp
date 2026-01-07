#!/usr/bin/env python3
"""
Gemini Adapter: PreCompact Hook
Wraps context preservation logic.
"""
import sys
from pathlib import Path

# Add shared lib/hooks root
CORE_HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(CORE_HOOKS_DIR))

import importlib.util
spec = importlib.util.spec_from_file_location("pre_compact", CORE_HOOKS_DIR / "pre-compact.py")
pre_compact = importlib.util.module_from_spec(spec)
sys.modules["pre_compact"] = pre_compact
spec.loader.exec_module(pre_compact)

if __name__ == "__main__":
    pre_compact.main()
