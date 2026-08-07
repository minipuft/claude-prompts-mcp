"""
Tests for the Codex client seams in hooks/lib.

Covers:
- workspace.get_workspace_root PLUGIN_ROOT resolution (order + fall-through)
- cli_spawner._build_command dispatch (claude vs codex command shape)
- cli_spawner._cli_not_found_message per-client error text
- model_strategies.CodexModelStrategy resolution + registry registration
"""

import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR / "lib"))

import cli_spawner
import model_strategies
import workspace

WORKSPACE_ENV_VARS = (
    "MCP_WORKSPACE",
    "CLAUDE_PLUGIN_ROOT",
    "PLUGIN_ROOT",
    "GEMINI_EXTENSION_PATH",
    "extensionPath",
)


def _clear_workspace_env(monkeypatch):
    for var in WORKSPACE_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


class TestWorkspacePluginRoot:
    def test_plugin_root_resolves_when_alone(self, tmp_path, monkeypatch):
        _clear_workspace_env(monkeypatch)
        monkeypatch.setenv("PLUGIN_ROOT", str(tmp_path))
        assert workspace.get_workspace_root() == tmp_path

    def test_claude_plugin_root_wins_over_plugin_root(self, tmp_path, monkeypatch):
        _clear_workspace_env(monkeypatch)
        claude_root = tmp_path / "claude"
        codex_root = tmp_path / "codex"
        claude_root.mkdir()
        codex_root.mkdir()
        monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(claude_root))
        monkeypatch.setenv("PLUGIN_ROOT", str(codex_root))
        assert workspace.get_workspace_root() == claude_root

    def test_plugin_root_wins_over_gemini_root(self, tmp_path, monkeypatch):
        _clear_workspace_env(monkeypatch)
        codex_root = tmp_path / "codex"
        gemini_root = tmp_path / "gemini"
        codex_root.mkdir()
        gemini_root.mkdir()
        monkeypatch.setenv("PLUGIN_ROOT", str(codex_root))
        monkeypatch.setenv("GEMINI_EXTENSION_PATH", str(gemini_root))
        assert workspace.get_workspace_root() == codex_root

    def test_nonexistent_plugin_root_falls_through(self, tmp_path, monkeypatch):
        _clear_workspace_env(monkeypatch)
        monkeypatch.setenv("PLUGIN_ROOT", str(tmp_path / "does-not-exist"))
        resolved = workspace.get_workspace_root()
        # Falls through to self-resolution (the repo root, which has server/)
        assert resolved != tmp_path / "does-not-exist"
        assert resolved is not None
        assert (resolved / "server").exists()


class TestBuildCommandDispatch:
    def test_claude_default_shape_unchanged(self):
        cmd = cli_spawner._build_command(cli_spawner.SpawnConfig())
        assert cmd[0] == "claude"
        assert "--print" in cmd
        assert "--dangerously-skip-permissions" in cmd

    def test_codex_command_shape(self):
        config = cli_spawner.SpawnConfig(client="codex")
        cmd = cli_spawner._build_command(config)
        assert cmd[:2] == ["codex", "exec"]
        assert "--skip-git-repo-check" in cmd
        assert "--dangerously-bypass-approvals-and-sandbox" in cmd
        # claude-only flags must not leak into the codex command
        assert not any(flag.startswith("--max-budget-usd") for flag in cmd)
        assert not any(flag.startswith("--output-format") for flag in cmd)

    def test_codex_working_directory_uses_cd(self, tmp_path):
        config = cli_spawner.SpawnConfig(client="codex", working_directory=str(tmp_path))
        cmd = cli_spawner._build_command(config)
        cd_index = cmd.index("--cd")
        assert cmd[cd_index + 1] == str(tmp_path)

    def test_claude_working_directory_uses_add_dir(self, tmp_path):
        config = cli_spawner.SpawnConfig(working_directory=str(tmp_path))
        cmd = cli_spawner._build_command(config)
        assert f"--add-dir={tmp_path}" in cmd

    def test_client_defaults_from_env(self, monkeypatch):
        monkeypatch.setenv("RALPH_SPAWN_CLIENT", "codex")
        assert cli_spawner.SpawnConfig().client == "codex"
        monkeypatch.delenv("RALPH_SPAWN_CLIENT")
        assert cli_spawner.SpawnConfig().client == "claude"
        monkeypatch.setenv("RALPH_SPAWN_CLIENT", "bogus")
        assert cli_spawner.SpawnConfig().client == "claude"

    def test_not_found_message_per_client(self):
        claude_msg = cli_spawner._cli_not_found_message(cli_spawner.SpawnConfig())
        codex_msg = cli_spawner._cli_not_found_message(cli_spawner.SpawnConfig(client="codex"))
        assert "Claude CLI" in claude_msg
        assert "Codex CLI" in codex_msg


class TestCodexModelStrategy:
    def _context(self, hint=None, gates=0):
        return model_strategies.DelegationContext(
            agent_type="chain-executor",
            capability_hint=hint,
            gate_count=gates,
            step_number=1,
            total_steps=3,
        )

    def test_high_capability_resolves_to_verified_slug(self):
        hint = model_strategies.get_model_hint(self._context(hint="high-capability"), client="codex")
        assert hint == "gpt-5.6-sol"

    def test_standard_returns_none_for_client_default(self):
        assert model_strategies.get_model_hint(self._context(hint="standard"), client="codex") is None

    def test_gate_heavy_step_escalates(self):
        hint = model_strategies.get_model_hint(self._context(gates=3), client="codex")
        assert hint == "gpt-5.6-sol"

    def test_registry_has_codex(self):
        assert model_strategies.get_registry().has("codex")

    def test_claude_default_behavior_unchanged(self):
        assert model_strategies.get_model_hint(self._context()) == "sonnet"
