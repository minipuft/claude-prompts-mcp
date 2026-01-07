#!/usr/bin/env python3
"""
Gemini Adapter: SessionStart Hook
Wraps dev-sync logic.
"""
import sys
from pathlib import Path

# Add shared lib/hooks root
CORE_HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(CORE_HOOKS_DIR))

# dev-sync is standalone, we can just run it
import importlib.util
spec = importlib.util.spec_from_file_location("dev_sync", CORE_HOOKS_DIR / "dev-sync.py")
dev_sync = importlib.util.module_from_spec(spec)
sys.modules["dev_sync"] = dev_sync
spec.loader.exec_module(dev_sync)

if __name__ == "__main__":
    dev_sync.main()
