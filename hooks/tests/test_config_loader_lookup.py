"""
Tests for hooks/lib/config_loader.py's config.jsonc/config.json lookup.

Covers:
- Directory lookup order: MCP_WORKSPACE, then CLAUDE_PLUGIN_DATA, then the packaged
  server/ directory
- config.jsonc beats config.json within one directory
- The comment/trailing-comma stripper: real strips, string-content preservation
  (byte-for-byte), and the strict .json positive control
- Unreadable / malformed candidates fall back to DEFAULT_CONFIG
- ralph-stop.py reads its settings through the same loader
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
HOOKS_LIB = HOOKS_DIR / "lib"
if str(HOOKS_LIB) not in sys.path:
    sys.path.insert(0, str(HOOKS_LIB))

import config_loader

# ralph-stop.py loaded the same way test_ralph_stop.py loads it -- it is a script,
# not a package member, so `import ralph_stop` will not resolve.
_spec = importlib.util.spec_from_file_location("ralph_stop_lookup", HOOKS_DIR / "ralph-stop.py")
ralph_stop = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ralph_stop)


@pytest.fixture
def lookup_dirs(tmp_path, monkeypatch):
    """Three distinct, existing, empty directories wired to the three lookup roots.

    `workspace` doubles as both the MCP_WORKSPACE-direct candidate AND the parent of
    the packaged candidate: once MCP_WORKSPACE resolves via workspace.get_workspace_root(),
    workspace.get_server_dir() answers `<workspace>/server` -- the same derivation
    config_loader.get_config_path() reuses for its third candidate. `workspace/server`
    must exist for that resolution to hold (get_workspace_root only honors a path that
    exists), and empty means neither test data nor tree-state leakage.
    """
    workspace = tmp_path / "workspace"
    (workspace / "server").mkdir(parents=True)
    plugin_data = tmp_path / "plugin-data"
    plugin_data.mkdir()

    monkeypatch.setenv("MCP_WORKSPACE", str(workspace))
    monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(plugin_data))

    return {"workspace": workspace, "plugin_data": plugin_data, "packaged": workspace / "server"}


class TestLookupOrder:
    def test_workspace_beats_plugin_data_and_packaged(self, lookup_dirs):
        (lookup_dirs["workspace"] / "config.json").write_text(json.dumps({"source": "workspace"}))
        (lookup_dirs["plugin_data"] / "config.json").write_text(json.dumps({"source": "plugin_data"}))
        (lookup_dirs["packaged"] / "config.json").write_text(json.dumps({"source": "packaged"}))

        resolved = config_loader.get_config_path()
        assert resolved == lookup_dirs["workspace"] / "config.json"
        assert config_loader.load_config()["source"] == "workspace"

    def test_plugin_data_beats_packaged_when_workspace_has_none(self, lookup_dirs):
        (lookup_dirs["plugin_data"] / "config.json").write_text(json.dumps({"source": "plugin_data"}))
        (lookup_dirs["packaged"] / "config.json").write_text(json.dumps({"source": "packaged"}))

        resolved = config_loader.get_config_path()
        assert resolved == lookup_dirs["plugin_data"] / "config.json"
        assert config_loader.load_config()["source"] == "plugin_data"

    def test_packaged_is_last_resort(self, lookup_dirs):
        (lookup_dirs["packaged"] / "config.json").write_text(json.dumps({"source": "packaged"}))

        resolved = config_loader.get_config_path()
        assert resolved == lookup_dirs["packaged"] / "config.json"
        assert config_loader.load_config()["source"] == "packaged"

    def test_no_candidate_anywhere_returns_none(self, lookup_dirs):
        assert config_loader.get_config_path() is None
        assert config_loader.load_config() == config_loader.DEFAULT_CONFIG

    def test_jsonc_beats_json_in_same_directory(self, lookup_dirs):
        (lookup_dirs["workspace"] / "config.json").write_text(json.dumps({"source": "json"}))
        (lookup_dirs["workspace"] / "config.jsonc").write_text(json.dumps({"source": "jsonc"}))

        resolved = config_loader.get_config_path()
        assert resolved == lookup_dirs["workspace"] / "config.jsonc"
        assert config_loader.load_config()["source"] == "jsonc"


class TestStripJsoncComments:
    """`strip_jsonc_comments` is a pure function -- test it directly, no I/O."""

    def test_line_and_block_comments_and_trailing_commas_load(self):
        text = """
        {
          // hooks section
          "hooks": {
            "expandedOutput": true, // a line a user uncomments on its own, trailing comma and all
          },
          /* verification
             block */
          "verification": {
            "inContextAttempts": 5,
          },
        }
        """
        parsed = json.loads(config_loader.strip_jsonc_comments(text))
        assert parsed == {
            "hooks": {"expandedOutput": True},
            "verification": {"inContextAttempts": 5},
        }

    def test_string_containing_slash_slash_and_block_marker_and_escaped_quote_survive_byte_for_byte(self):
        # No real comments or trailing commas here -- stripping must be a no-op.
        text = (
            '{"$schema": "https://cdn.example/x//y.json", '
            '"note": "a /* fake */ comment and a \\"quoted\\" word stay put"}'
        )
        assert config_loader.strip_jsonc_comments(text) == text

        parsed = json.loads(text)
        assert parsed["$schema"] == "https://cdn.example/x//y.json"
        assert parsed["note"] == 'a /* fake */ comment and a "quoted" word stay put'

    def test_real_comments_stripped_around_a_string_carrying_comment_markers(self):
        text = """
        {
          // real line comment
          "$schema": "https://cdn.example/x//y.json", // trailing real comment
          /* real
             block comment */
          "note": "a /* fake */ comment and a \\"quoted\\" word stay put"
        }
        """
        stripped = config_loader.strip_jsonc_comments(text)
        assert "// real line comment" not in stripped
        assert "// trailing real comment" not in stripped
        assert "real\n             block comment" not in stripped

        parsed = json.loads(stripped)
        assert parsed["$schema"] == "https://cdn.example/x//y.json"
        assert parsed["note"] == 'a /* fake */ comment and a "quoted" word stay put'


class TestStrictJsonPositiveControl:
    def test_commented_text_as_config_json_does_not_load(self, lookup_dirs):
        # POSITIVE CONTROL: the exact text that loads cleanly as config.jsonc is
        # refused as config.json -- proving the strict path is actually strict, not
        # merely untested.
        commented_text = """
        {
          // hooks section
          "hooks": {
            "expandedOutput": true,
          },
        }
        """
        (lookup_dirs["workspace"] / "config.json").write_text(commented_text)

        assert config_loader.load_config() == config_loader.DEFAULT_CONFIG

    def test_same_text_as_config_jsonc_does_load(self, lookup_dirs):
        commented_text = """
        {
          // hooks section
          "hooks": {
            "expandedOutput": false,
          },
        }
        """
        (lookup_dirs["workspace"] / "config.jsonc").write_text(commented_text)

        assert config_loader.load_config() == {"hooks": {"expandedOutput": False}}


class TestFallbackOnFailure:
    def test_malformed_jsonc_falls_back_to_defaults(self, lookup_dirs):
        (lookup_dirs["workspace"] / "config.jsonc").write_text("{ not valid json even after stripping")

        assert config_loader.load_config() == config_loader.DEFAULT_CONFIG

    def test_unreadable_candidate_falls_back_to_defaults(self, lookup_dirs):
        # A directory named config.jsonc "exists" (Path.exists() is True) but raises
        # IsADirectoryError (an OSError) on read_text -- deterministic without relying
        # on permission bits, which a sandboxed/root runner can ignore.
        (lookup_dirs["workspace"] / "config.jsonc").mkdir()

        assert config_loader.load_config() == config_loader.DEFAULT_CONFIG


class TestRalphStopReadsWorkspaceConfig:
    def test_reads_verification_settings_from_workspace_config_jsonc(self, lookup_dirs):
        (lookup_dirs["workspace"] / "config.jsonc").write_text(
            """
            {
              // Ralph context isolation
              "verification": {
                "inContextAttempts": 7,
                "isolation": {
                  "enabled": false,
                  "timeout": 120,
                },
              },
            }
            """
        )

        config = ralph_stop.load_context_isolation_config()
        assert config["inContextThreshold"] == 7
        assert config["enabled"] is False
        assert config["spawnTimeout"] == 120
