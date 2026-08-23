import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ROOT / "hooks"
RUNNER = HOOKS / "python-hook-runner.cjs"


def registered_commands() -> list[str]:
    config = json.loads((HOOKS / "hooks.json").read_text(encoding="utf-8"))
    return [
        hook["command"] for matchers in config["hooks"].values() for matcher in matchers for hook in matcher["hooks"]
    ]


def test_runner_self_test_covers_platform_order_and_failure_paths() -> None:
    result = subprocess.run(
        ["node", str(RUNNER), "--self-test"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "7/7 checks passed" in result.stdout


def test_every_registered_python_hook_uses_the_cross_platform_runner() -> None:
    commands = registered_commands()

    assert len(commands) == 7
    assert all(command.startswith('node "${CLAUDE_PLUGIN_ROOT}/hooks/python-hook-runner.cjs"') for command in commands)
    assert all('"${CLAUDE_PLUGIN_ROOT}/hooks/' in command and command.endswith('.py"') for command in commands)
    assert all(not command.startswith("python3 ") for command in commands)
