"""
Prompt-id suggestion scoring parameters, loaded from the SSOT JSON contract.

Source: server/tooling/contracts/registries/suggestion-scoring.json

This module exists because the scoring lived twice -- once here in Python and
once in server/src/engine/execution/parsers/command-parser.ts -- and
cache_manager's docstring promised "Same algorithm as TypeScript
generatePromptSuggestions()", a promise nothing enforced. The numbers now have
one home; only the traversal is written twice, because the hook deliberately
avoids a server round-trip on the unknown-prompt path.

Falls back to the shipped defaults if the contract cannot be read, so a hook
never dies over a missing file -- the same posture operators.py takes.
"""

import json
from pathlib import Path
from typing import TypedDict

from workspace import get_workspace_root


class ScoringParams(TypedDict):
    prefixMatchScore: int
    wordOverlapScore: int
    minOverlapWordLength: int
    levenshteinBaseScore: int
    levenshteinPenaltyPerEdit: int
    levenshteinMinThreshold: int
    levenshteinLengthDivisor: int
    maxResults: int


# Mirrors the contract. Used only when the contract file cannot be read.
DEFAULTS: ScoringParams = {
    "prefixMatchScore": 100,
    "wordOverlapScore": 30,
    "minOverlapWordLength": 3,
    "levenshteinBaseScore": 50,
    "levenshteinPenaltyPerEdit": 10,
    "levenshteinMinThreshold": 3,
    "levenshteinLengthDivisor": 2,
    "maxResults": 3,
}

CONTRACT_RELATIVE = Path("server") / "tooling" / "contracts" / "registries" / "suggestion-scoring.json"


def _resolve_contract_path() -> Path | None:
    """Resolve the contract via workspace, then relative to this file."""
    workspace = get_workspace_root()
    if workspace:
        candidate = workspace / CONTRACT_RELATIVE
        if candidate.exists():
            return candidate

    # hooks/lib/suggestion_scoring.py -> hooks/lib -> hooks -> project_root
    project_root = Path(__file__).resolve().parents[2]
    candidate = project_root / CONTRACT_RELATIVE
    return candidate if candidate.exists() else None


def _load_scoring() -> ScoringParams:
    path = _resolve_contract_path()
    if path is None:
        return dict(DEFAULTS)  # type: ignore[return-value]
    try:
        contract = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULTS)  # type: ignore[return-value]

    merged = dict(DEFAULTS)
    for key, value in (contract.get("scoring") or {}).items():
        if key in merged and isinstance(value, int):
            merged[key] = value
    return merged  # type: ignore[return-value]


SCORING: ScoringParams = _load_scoring()
