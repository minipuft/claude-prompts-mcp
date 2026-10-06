"""
Shared pytest fixtures for hook tests.

Provides:
- Temporary workspace/runtime-state isolation
- Workspace environment patching
- Mock target validation (stale mock detection)
"""

import sys
import unittest.mock
import warnings
from pathlib import Path

import pytest
from tree_state_guard import KNOWN_LEAKS, REPO_ROOT, classify, entry_path, known_leak_reason, list_entries

# Save reference before we wrap it
_original_patch_object = unittest.mock.patch.object

# Ensure hooks/lib is importable
HOOKS_LIB = Path(__file__).parent.parent / "lib"
if str(HOOKS_LIB) not in sys.path:
    sys.path.insert(0, str(HOOKS_LIB))


@pytest.fixture(scope="session", autouse=True)
def _tree_state_guard():
    """Fails the pytest run if any hook test left something in the working tree.

    See tree_state_guard.py for why this is a gate and not a cleanup, and for the incident that
    motivated it. Failing from a session-scoped fixture's teardown exits pytest non-zero even
    when every test passed, which is the point: the leak this catches is invisible to assertions
    because the tests that cause it are green.
    """
    before = list_entries()
    yield
    result = classify(before, list_entries())

    if result["unreadable"] is not None:
        pytest.fail(
            f"The tree-state guard could not measure this run: {result['unreadable']}.\n"
            "A run that cannot be shown clean is not a clean run — see "
            "hooks/tests/tree_state_guard.py.",
            pytrace=False,
        )

    # Known leaks do not fail the run, but they are never silent.
    for line in result.get("known_leaks", []):
        reason = known_leak_reason(entry_path(line), KNOWN_LEAKS)
        sys.stderr.write(f"[tree-state-guard] KNOWN LEAK (not failing this run): {line}\n  cause: {reason}\n")

    if not result["leaked"]:
        return

    pytest.fail(
        f"{len(result['leaked'])} working-tree entr(ies) appeared during this pytest run that "
        "nothing declares.\n\n"
        "A hook test that reaches workspace.get_workspace_root()'s self-resolution fallback (no "
        "MCP_WORKSPACE / CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / GEMINI_EXTENSION_PATH set — the CI "
        "shape) resolves to this checkout. Use the `patch_workspace` fixture (or set MCP_WORKSPACE "
        "to a tmp_path yourself) before driving any code path that touches session_tracker, "
        "hook_state_store, task_protocol, cli_spawner, or verify_active_store.\n\n"
        "If a path genuinely belongs to a generator, add it to DECLARED_SUFFIXES in "
        "hooks/tests/tree_state_guard.py WITH a reason naming that generator.\n\n"
        f"Root: {REPO_ROOT}\n" + "\n".join(f"  + {line}" for line in result["leaked"]) + "\n\n"
        "These entries are still on disk. Remove them before committing.",
        pytrace=False,
    )


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
    """Patch workspace resolution to use tmp_workspace.

    The runtime-root variables are cleared too: verify-state.db and state.db are
    found through them first, so an ambient value would point a test at a real
    server's files.
    """
    monkeypatch.setenv("MCP_WORKSPACE", str(tmp_workspace["root"]))
    for ambient in ("MCP_RUNTIME_ROOT", "CLAUDE_PLUGIN_DATA"):
        monkeypatch.delenv(ambient, raising=False)
    return tmp_workspace


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
