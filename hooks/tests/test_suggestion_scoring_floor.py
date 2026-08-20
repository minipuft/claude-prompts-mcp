"""
Tests for the prompt-id suggestion scoring floor (2026-08-19).

The word-overlap term scores on unbounded substring containment. Without a
minimum word length a two-letter query word matched broadly -- `"notes"`
contains `"no"` -- so every query scored at least once and the
"No similar prompts found" branch was effectively unreachable:
`>>zzzqqq_no_such_thing` returned note_integration, note_refinement, notes.

The weights now live in server/tooling/contracts/registries/suggestion-scoring.json,
which command-parser.ts reads too. These tests pin the floor's behaviour and
guard the Python fallback against drifting from the contract.
"""

import json
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

import cache_manager
from suggestion_scoring import DEFAULTS, SCORING, _resolve_contract_path

# Short ids chosen so the Levenshtein term cannot mask what word-overlap does.
CATALOG = {
    "prompts": {
        "notes": {},
        "note_integration": {},
        "code_review": {},
        "content_analysis": {},
    }
}


@pytest.fixture
def stub_catalog(monkeypatch):
    monkeypatch.setattr(cache_manager, "load_prompts_cache", lambda: CATALOG)


class TestContractIsTheSingleSource:
    def test_contract_file_is_reachable(self):
        assert _resolve_contract_path() is not None, "contract must resolve from the repo"

    def test_python_fallback_matches_the_contract(self):
        """DEFAULTS exists only for when the file cannot be read. If it drifts
        from the contract, the fallback silently scores differently than the
        server -- which is the exact failure this contract was created to end."""
        contract = json.loads(_resolve_contract_path().read_text())
        assert contract["scoring"] == DEFAULTS

    def test_loaded_scoring_matches_the_contract(self):
        contract = json.loads(_resolve_contract_path().read_text())
        assert contract["scoring"] == SCORING


class TestOverlapFloor:
    def test_short_word_no_longer_matches(self, stub_catalog):
        """'no' is 2 chars and is a substring of 'notes'. Before the floor this
        returned suggestions; the whole defect in one query."""
        assert cache_manager.fuzzy_match_prompt_id("zzzqqq_no_such_thing") == []

    def test_word_at_the_floor_still_matches(self, stub_catalog):
        """'cod' is exactly minOverlapWordLength and is a substring of 'code',
        so it must still reach code_review. Pins the floor at 3, not higher."""
        assert "code_review" in cache_manager.fuzzy_match_prompt_id("zzz_cod_qqq")

    def test_real_typo_still_resolves(self, stub_catalog):
        """The floor must not cost typo correction -- that is the whole point
        of the feature it guards."""
        assert cache_manager.fuzzy_match_prompt_id("contnet_analysis")[0] == "content_analysis"

    def test_genuine_shared_word_still_matches(self, stub_catalog):
        """A real word shared with an id is a match, not noise."""
        assert "code_review" in cache_manager.fuzzy_match_prompt_id("the_code_thing")

    def test_floor_is_read_from_contract_not_hardcoded(self, stub_catalog, monkeypatch):
        """Raising the floor must change behaviour -- proof the literal is gone."""
        monkeypatch.setitem(cache_manager.SCORING, "minOverlapWordLength", 99)
        assert cache_manager.fuzzy_match_prompt_id("zzz_cod_qqq") == []
