"""
Tests for hooks/lib/config_loader.py defaults (plan row 4.6).

`is_expanded_output()` reads `hooks.expandedOutput` off `server/config.json` and falls back to
`True` when the section (or the file) says nothing -- matching the shipped `config.json`, which
sets `hooks.expandedOutput: true`. These pin that default directly against a loaded config rather
than against `DEFAULT_CONFIG` in-process, so a regression in the fallback itself (not just the
constant) is caught.
"""

import json
import sys
from pathlib import Path

HOOKS_LIB = Path(__file__).parent.parent / "lib"
sys.path.insert(0, str(HOOKS_LIB))


def _write_config(patch_workspace, content: dict) -> None:
    config_path = patch_workspace["server"] / "config.json"
    config_path.write_text(json.dumps(content), encoding="utf-8")


class TestIsExpandedOutputDefault:
    def test_defaults_to_true_when_config_has_no_hooks_section(self, patch_workspace):
        import config_loader

        # A real config with no `hooks` key at all -- the section every reader falls back on.
        _write_config(patch_workspace, {"server": {"name": "test-server"}})

        assert config_loader.is_expanded_output() is True

    def test_positive_control_explicit_false_returns_false(self, patch_workspace):
        import config_loader

        _write_config(patch_workspace, {"hooks": {"expandedOutput": False}})

        assert config_loader.is_expanded_output() is False

    def test_explicit_true_returns_true(self, patch_workspace):
        import config_loader

        _write_config(patch_workspace, {"hooks": {"expandedOutput": True}})

        assert config_loader.is_expanded_output() is True

    def test_defaults_to_true_when_config_file_is_missing(self, patch_workspace):
        import config_loader

        # No config.json written at all -- `load_config()` falls back to `DEFAULT_CONFIG`.
        assert config_loader.is_expanded_output() is True
