"""
Shared pytest fixtures for hook tests.

Provides:
- Temporary workspace/runtime-state isolation
- Mock transcript builders
- Workspace environment patching
- Mock target validation (stale mock detection)
"""

import json
import sys
import unittest.mock
import warnings
from pathlib import Path

import pytest

# Save reference before we wrap it
_original_patch_object = unittest.mock.patch.object

# Ensure hooks/lib is importable
HOOKS_LIB = Path(__file__).parent.parent / "lib"
if str(HOOKS_LIB) not in sys.path:
    sys.path.insert(0, str(HOOKS_LIB))


@pytest.fixture
def tmp_workspace(tmp_path):
    """Create an isolated workspace with runtime-state directory structure."""
    workspace = tmp_path / "workspace"
    server_dir = workspace / "server"
    runtime_dir = workspace / "runtime-state"
    ralph_sessions = runtime_dir / "ralph-sessions"

    server_dir.mkdir(parents=True)
    runtime_dir.mkdir(parents=True)
    ralph_sessions.mkdir(parents=True)

    return {
        "root": workspace,
        "server": server_dir,
        "runtime_state": runtime_dir,
        "ralph_sessions": ralph_sessions,
    }


@pytest.fixture
def patch_workspace(tmp_workspace, monkeypatch):
    """Patch workspace resolution to use tmp_workspace."""
    monkeypatch.setenv("MCP_WORKSPACE", str(tmp_workspace["root"]))
    return tmp_workspace


@pytest.fixture
def transcript_builder(tmp_path):
    """Build JSONL transcript files for testing subagent-gate-enforce."""

    class TranscriptBuilder:
        def __init__(self):
            self.messages = []
            self.path = tmp_path / "transcript.jsonl"

        def add_human(self, content):
            self.messages.append({"type": "human", "content": content})
            return self

        def add_human_blocks(self, blocks):
            """Add human message with content as list of blocks."""
            self.messages.append({"type": "human", "content": blocks})
            return self

        def add_assistant(self, content):
            self.messages.append({"type": "assistant", "content": content})
            return self

        def add_assistant_blocks(self, blocks):
            """Add assistant message with content as list of blocks."""
            self.messages.append({"type": "assistant", "content": blocks})
            return self

        def write(self, path=None):
            target = path or self.path
            with open(target, "w") as f:
                for msg in self.messages:
                    f.write(json.dumps(msg) + "\n")
            return str(target)

        def write_corrupt(self, path=None):
            """Write a corrupt (non-JSON) transcript."""
            target = path or self.path
            with open(target, "w") as f:
                f.write("not json at all\n")
                f.write("{broken\n")
            return str(target)

    return TranscriptBuilder()


# ── Mock Target Validation ────────────────────────────────────────────────────
# Wraps unittest.mock.patch.object to detect stale mock targets at runtime.
# If a test patches an attribute that no longer exists on the target module,
# this raises AttributeError immediately instead of silently creating a phantom.
#
# This prevents mock drift: when refactoring removes/renames a function,
# any test that mocks the old name fails at patch time, not silently passes.


def _strict_patch_object(target, attribute, *args, **kwargs):
    """Wrapper for patch.object that validates the target attribute exists.

    Intercepts patch.object(target, attribute, ...) calls and checks that
    `attribute` is a real attribute of `target` before delegating to the
    original patch.object. If the attribute doesn't exist, raises
    AttributeError with a clear message pointing to the stale mock.

    This catches the exact failure mode that caused 18 tests to drift:
    mocking a function that was renamed/removed during refactoring.
    """
    if not hasattr(target, attribute):
        target_name = getattr(target, "__name__", repr(target))
        raise AttributeError(
            f"Mock target validation failed: "
            f"'{target_name}' has no attribute '{attribute}'. "
            f"The function may have been renamed or removed during refactoring. "
            f"Update the mock target to match the current API."
        )
    # Recommend autospec if not provided — warn, don't block
    if "autospec" not in kwargs and not kwargs.get("new_callable") and "create" not in kwargs:
        target_name = getattr(target, "__name__", repr(target))
        warnings.warn(
            f"patch.object({target_name}, '{attribute}') called without autospec=True. "
            f"Consider adding autospec=True to validate call signatures.",
            UserWarning,
            stacklevel=2,
        )
    return _original_patch_object(target, attribute, *args, **kwargs)


# Install globally — all tests in this directory get strict validation
unittest.mock.patch.object = _strict_patch_object  # type: ignore[assignment]
