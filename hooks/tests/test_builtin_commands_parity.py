"""
`>>status`, `>>help`, `>>gates` and the other built-ins have no prompt record, so the
hook's catalog lookup cannot know them. Before 2026-10-20 the hook answered
"Unknown prompt 'status'. No similar prompts found." and the client guessed what to do
(it ran `git status`). The hook now routes a built-in to prompt_engine like any known
prompt, and the list it uses is pinned to the server's parser.
"""

import importlib.util
import io
import json
import re
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
REPO_ROOT = HOOKS_DIR.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

from builtin_commands import BUILTIN_COMMANDS, is_builtin_command

_spec = importlib.util.spec_from_file_location("prompt_suggest", HOOKS_DIR / "prompt-suggest.py")
prompt_suggest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prompt_suggest)

PARSER = REPO_ROOT / "server" / "src" / "engine" / "execution" / "parsers" / "command-parser.ts"


def _server_builtins() -> set[str]:
    source = PARSER.read_text(encoding="utf-8")
    match = re.search(r"const builtinCommands = \[(.*?)\];", source, re.DOTALL)
    assert match, "isBuiltinCommand() list not found in command-parser.ts"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_hook_list_matches_the_server_parser():
    assert set(BUILTIN_COMMANDS) == _server_builtins()


def test_is_builtin_is_case_insensitive_like_the_parser():
    assert is_builtin_command("Status")
    assert not is_builtin_command("review")
    assert not is_builtin_command(None)


@pytest.fixture
def empty_catalog(monkeypatch):
    """A catalog with no prompts at all: the shape that made built-ins look unknown."""
    monkeypatch.setattr(prompt_suggest, "load_prompts_cache", lambda: True)
    monkeypatch.setattr(prompt_suggest, "get_prompt_by_id", lambda _pid: None)
    monkeypatch.setattr(prompt_suggest, "fuzzy_match_prompt_id", lambda _pid: [])
    monkeypatch.setattr(prompt_suggest, "get_valid_styles", lambda: [])
    monkeypatch.setattr(prompt_suggest, "get_valid_frameworks", lambda: [])


def _run(monkeypatch, message: str) -> dict:
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"prompt": message, "session_id": "t"})))
    out = io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    with pytest.raises(SystemExit):
        prompt_suggest.main()
    return json.loads(out.getvalue())


def test_builtin_routes_to_prompt_engine(monkeypatch, empty_catalog):
    response = _run(monkeypatch, ">>status")
    text = response["hookSpecificOutput"]["additionalContext"]
    assert "Unknown prompt" not in text
    assert 'command:">>status"' in text
    assert "prompt_engine" in text


def test_unknown_prompt_is_still_unknown(monkeypatch, empty_catalog):
    """Positive control: the unknown branch still fires for a name the server would refuse."""
    response = _run(monkeypatch, ">>statuz")
    assert "Unknown prompt 'statuz'" in json.dumps(response)
