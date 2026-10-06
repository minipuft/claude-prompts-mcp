"""
Tests for prompt-id display fidelity (2026-08-20).

Resolution is case-insensitive on both sides -- command-parser.ts folds case to
find the prompt and then returns `found.id` -- so the folded lookup key is an
implementation detail. The hook used to print that key, which meant a suggestion
told the user to type a name that does not exist: a camelCase id such as
`releasePlanner` echoed as "releaseplanner", and a typo of `reviewCard` suggested
"reviewcard". The ids below are fixtures, not catalog entries: bundled ids are
snake_case, but the API still accepts case-bearing ids, so a library can hold one.

The rule these tests pin: DISPLAY RESOLVES THROUGH THE RECORD. `authored_id()`
takes the record where the caller has one, so there is no folded key available to
print by accident. Only an unresolvable name echoes what the user typed, because
that is the only honest thing to show when there is no record to be faithful to.
"""

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

_spec = importlib.util.spec_from_file_location("prompt_suggest", HOOKS_DIR / "prompt-suggest.py")
prompt_suggest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prompt_suggest)

# Two case-bearing ids, the shape display fidelity exists for.
CATALOG = {
    "releasePlanner": {
        "id": "releasePlanner",
        "description": "Release planner",
        "arguments": [{"name": "task", "type": "string", "required": True}],
    },
    "reviewCard": {"id": "reviewCard", "description": "Review card", "arguments": []},
    "notes": {"id": "notes", "description": "Notes", "arguments": []},
}


def _lookup(pid):
    """Case-insensitive, exactly like the SQLite-backed lookup it stands in for."""
    for key, value in CATALOG.items():
        if key.lower() == (pid or "").lower():
            return value
    return None


@pytest.fixture
def stub_catalog(monkeypatch):
    monkeypatch.setattr(prompt_suggest, "load_prompts_cache", lambda: True)
    monkeypatch.setattr(prompt_suggest, "get_prompt_by_id", _lookup)
    monkeypatch.setattr(prompt_suggest, "get_valid_frameworks", lambda: set())
    monkeypatch.setattr(prompt_suggest, "get_valid_styles", lambda: set())
    monkeypatch.setattr(prompt_suggest, "is_expanded_output", lambda: False)
    monkeypatch.setattr(
        prompt_suggest,
        "fuzzy_match_prompt_id",
        lambda pid: ["reviewCard"] if pid.lower().startswith("review") else [],
    )


def run_hook(monkeypatch, capsys, user_prompt):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"session_id": "t", "prompt": user_prompt})))
    with pytest.raises(SystemExit):
        prompt_suggest.main()
    return json.loads(capsys.readouterr().out)


def context_of(out):
    return out["hookSpecificOutput"]["additionalContext"]


class TestAuthoredIdHelper:
    def test_resolves_to_the_registry_spelling(self, stub_catalog):
        assert prompt_suggest.authored_id("releaseplanner") == "releasePlanner"
        assert prompt_suggest.authored_id("RELEASEPLANNER") == "releasePlanner"

    def test_prefers_the_record_the_caller_already_has(self, stub_catalog):
        """The structural point: given a record, it must not go looking one up.
        That is what stops a folded key being printed by accident."""
        record = {"id": "reviewCard"}
        assert prompt_suggest.authored_id("anything-at-all", record) == "reviewCard"

    def test_unresolvable_echoes_what_was_typed(self, stub_catalog):
        assert prompt_suggest.authored_id("no_such_prompt") == "no_such_prompt"

    def test_record_without_an_id_falls_back(self, stub_catalog):
        assert prompt_suggest.authored_id("typed_name", {"description": "no id here"}) == "typed_name"


class TestEchoUsesAuthoredCasing:
    @pytest.mark.parametrize("typed", ["releasePlanner", "releaseplanner", "RELEASEPLANNER"])
    def test_every_spelling_echoes_the_authored_one(self, stub_catalog, monkeypatch, capsys, typed):
        out = run_hook(monkeypatch, capsys, f">>{typed}")
        assert "[>> prompt_engine] releasePlanner" in context_of(out)

    def test_directive_still_carries_what_the_user_typed(self, stub_catalog, monkeypatch, capsys):
        """The echo is normalised for the reader; the command passed to the
        server stays verbatim, because the server parses it."""
        ctx = context_of(run_hook(monkeypatch, capsys, ">>releaseplanner"))
        assert 'command:">>releaseplanner"' in ctx


class TestSuggestionsUseAuthoredCasing:
    def test_typo_suggests_the_spelling_that_exists(self, stub_catalog, monkeypatch, capsys):
        """The row-6 falsifier."""
        ctx = context_of(run_hook(monkeypatch, capsys, ">>reviewcrd"))
        assert ">>reviewCard" in ctx
        assert ">>reviewcard" not in ctx


class TestChainStepsUseAuthoredCasing:
    def test_adhoc_chain_steps_resolve(self, stub_catalog, monkeypatch, capsys):
        ctx = context_of(run_hook(monkeypatch, capsys, ">>releaseplanner --> >>reviewcard"))
        assert "1. releasePlanner" in ctx
        assert "2. reviewCard" in ctx
