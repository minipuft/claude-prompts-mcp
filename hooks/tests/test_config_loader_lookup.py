"""
Tests for hooks/lib/config_loader.py's config.jsonc/config.json lookup.

Covers:
- Lookup order: MCP_CONFIG_PATH, then the project's .claude-prompts/ directory
  (CLAUDE_PROJECT_DIR, else the working directory), then MCP_WORKSPACE, then
  CLAUDE_PLUGIN_DATA, then the packaged server/ directory
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

    The project directory is pinned to an empty directory of its own and MCP_CONFIG_PATH
    is cleared: both are read from the environment, so an ambient project holding a
    `.claude-prompts/config.jsonc` (this checkout's own CLAUDE_PROJECT_DIR in a Claude
    Code session) would otherwise answer before any of the roots below.

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

    project = tmp_path / "project"
    project.mkdir()

    monkeypatch.setenv("MCP_WORKSPACE", str(workspace))
    monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(plugin_data))
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(project))
    monkeypatch.delenv("MCP_CONFIG_PATH", raising=False)

    return {
        "workspace": workspace,
        "plugin_data": plugin_data,
        "packaged": workspace / "server",
        "project": project,
    }


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


class TestProjectConfig:
    """The project's `.claude-prompts/` config outranks every workspace root, as on the server."""

    @staticmethod
    def _project_workspace(lookup_dirs) -> Path:
        project_workspace = lookup_dirs["project"] / ".claude-prompts"
        project_workspace.mkdir()
        return project_workspace

    def test_project_config_beats_workspace_plugin_data_and_packaged(self, lookup_dirs):
        (lookup_dirs["workspace"] / "config.jsonc").write_text(json.dumps({"source": "workspace"}))
        (lookup_dirs["plugin_data"] / "config.json").write_text(json.dumps({"source": "plugin_data"}))
        (lookup_dirs["packaged"] / "config.json").write_text(json.dumps({"source": "packaged"}))
        project_workspace = self._project_workspace(lookup_dirs)

        # Control: the project folder exists but holds no config, so the workspace answers.
        assert config_loader.get_config_path() == lookup_dirs["workspace"] / "config.jsonc"

        (project_workspace / "config.jsonc").write_text(
            '{\n  // the project\'s own hook settings\n  "hooks": {"expandedOutput": false},\n}\n'
        )

        assert config_loader.get_config_path() == project_workspace / "config.jsonc"
        assert config_loader.load_config() == {"hooks": {"expandedOutput": False}}
        assert config_loader.is_expanded_output() is False

    def test_project_config_json_is_read_only_without_a_config_jsonc(self, lookup_dirs):
        (lookup_dirs["workspace"] / "config.jsonc").write_text(json.dumps({"source": "workspace"}))
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.json").write_text(json.dumps({"source": "project-json"}))

        assert config_loader.get_config_path() == project_workspace / "config.json"

        (project_workspace / "config.jsonc").write_text(json.dumps({"source": "project-jsonc"}))
        assert config_loader.get_config_path() == project_workspace / "config.jsonc"

    def test_no_project_folder_reads_the_workspace_as_before(self, lookup_dirs):
        # The control: the same trees without `.claude-prompts/` resolve exactly as they did.
        (lookup_dirs["workspace"] / "config.json").write_text(json.dumps({"source": "workspace"}))

        assert config_loader.get_config_path() == lookup_dirs["workspace"] / "config.json"

    def test_project_directory_falls_back_to_the_working_directory(self, lookup_dirs, monkeypatch, tmp_path):
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.jsonc").write_text(json.dumps({"source": "project"}))
        (lookup_dirs["workspace"] / "config.jsonc").write_text(json.dumps({"source": "workspace"}))
        monkeypatch.delenv("CLAUDE_PROJECT_DIR")

        monkeypatch.chdir(lookup_dirs["project"])
        assert config_loader.get_config_path() == project_workspace / "config.jsonc"

        # Control: from a directory with no project folder, the workspace answers.
        elsewhere = tmp_path / "elsewhere"
        elsewhere.mkdir()
        monkeypatch.chdir(elsewhere)
        assert config_loader.get_config_path() == lookup_dirs["workspace"] / "config.jsonc"

    def test_blank_project_directory_variable_counts_as_unset(self, lookup_dirs, monkeypatch):
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.jsonc").write_text(json.dumps({"source": "project"}))
        (lookup_dirs["workspace"] / "config.jsonc").write_text(json.dumps({"source": "workspace"}))
        monkeypatch.setenv("CLAUDE_PROJECT_DIR", "   ")
        monkeypatch.chdir(lookup_dirs["workspace"])

        assert config_loader.get_config_path() == lookup_dirs["workspace"] / "config.jsonc"

    def test_explicit_config_path_beats_the_project_config(self, lookup_dirs, monkeypatch, tmp_path):
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.jsonc").write_text(json.dumps({"source": "project"}))
        explicit = tmp_path / "explicit.json"
        explicit.write_text(json.dumps({"source": "explicit"}))
        monkeypatch.setenv("MCP_CONFIG_PATH", str(explicit))

        assert config_loader.get_config_path() == explicit
        assert config_loader.load_config()["source"] == "explicit"

    def test_missing_explicit_config_path_is_skipped_not_fatal(self, lookup_dirs, monkeypatch, tmp_path):
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.jsonc").write_text(json.dumps({"source": "project"}))
        monkeypatch.setenv("MCP_CONFIG_PATH", str(tmp_path / "does-not-exist.json"))

        assert config_loader.get_config_path() == project_workspace / "config.jsonc"

    def test_malformed_project_config_falls_back_to_defaults_not_the_workspace(self, lookup_dirs):
        # A file found but unparsable is not retried against the next root.
        (lookup_dirs["workspace"] / "config.jsonc").write_text(json.dumps({"source": "workspace"}))
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.jsonc").write_text("{ not valid json even after stripping")

        assert config_loader.load_config() == config_loader.DEFAULT_CONFIG

    def test_ralph_stop_reads_its_settings_from_the_project_config(self, lookup_dirs):
        project_workspace = self._project_workspace(lookup_dirs)
        (project_workspace / "config.jsonc").write_text(
            '{"verification": {"inContextAttempts": 9, "isolation": {"enabled": false}}}'
        )

        config = ralph_stop.load_context_isolation_config()
        assert config["inContextThreshold"] == 9
        assert config["enabled"] is False


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
