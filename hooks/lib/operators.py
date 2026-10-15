"""
Operator detection patterns loaded from SSOT registry.

Source: server/tooling/contracts/registries/operators.json
These patterns are for USER CONTEXT HINTS only.
Full parsing happens server-side in symbolic-operator-parser.ts
"""

import json
import re
from functools import cache
from pathlib import Path
from typing import TypedDict

from _generated.extraction_patterns import EXTRACTION_PATTERNS
from workspace import get_workspace_root


class OperatorInfo(TypedDict):
    symbol: str
    description: str
    pattern: re.Pattern[str]
    role: str
    examples: list[str]


def _load_operators() -> dict[str, OperatorInfo]:
    """Load operator patterns from SSOT JSON contract."""
    contract_path = _resolve_contract_path()
    if contract_path is None:
        return {}

    try:
        contract = json.loads(contract_path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}

    result: dict[str, OperatorInfo] = {}
    for op in contract.get("operators", []):
        if not op.get("detectInHooks", False):
            continue

        flags_str = op.get("pattern", {}).get("flags", "")
        flags = re.IGNORECASE if "i" in flags_str else 0

        result[op["id"]] = {
            "symbol": op["symbol"],
            "description": op["description"],
            "pattern": re.compile(op["pattern"]["typescript"], flags),
            "role": op.get("role", "modifier"),
            "examples": op.get("examples", []),
        }

    return result


def _resolve_contract_path() -> Path | None:
    """Resolve path to operators.json via workspace or self-resolution."""
    workspace = get_workspace_root()
    if workspace:
        candidate = workspace / "server" / "tooling" / "contracts" / "registries" / "operators.json"
        if candidate.exists():
            return candidate

    # Fallback: resolve relative to this file
    # hooks/lib/operators.py -> hooks -> project_root -> server/tooling/...
    project_root = Path(__file__).resolve().parents[2]
    candidate = project_root / "server" / "tooling" / "contracts" / "registries" / "operators.json"
    if candidate.exists():
        return candidate

    return None


# Load once at import time
OPERATORS = _load_operators()


def detect_operator(message: str, operator_id: str) -> list[str]:
    """
    Detect operator matches in message.
    Returns list of captured groups or empty list if no match.
    """
    if operator_id not in OPERATORS:
        return []
    pattern = OPERATORS[operator_id]["pattern"]
    matches = [match for match in pattern.finditer(message) if not _inside_quotes(message, match.start())]
    if pattern.groups > 1:
        return [group for match in matches for group in match.groups() if group]
    return [(match.group(1) or "") if pattern.groups else match.group() for match in matches]


def detect_all_operators(message: str) -> dict[str, list[str]]:
    """Detect all operators in message. Returns dict of operator_id -> matches."""
    return {op_id: matches for op_id in OPERATORS if (matches := detect_operator(message, op_id))}


def get_delimiter_symbols() -> list[str]:
    """Get symbols that separate chain steps, from SSOT registry.

    Returns symbols for operators with role='delimiter' (e.g., '-->', '==>').
    """
    return [op["symbol"] for op in OPERATORS.values() if op.get("role") == "delimiter"]


@cache
def _annotation_pattern(name: str) -> re.Pattern[str]:
    return re.compile(EXTRACTION_PATTERNS[f"prompt{name}"])


def _inside_quotes(message: str, position: int) -> bool:
    quote = ""
    for index, char in enumerate(message[:position]):
        if char in EXTRACTION_PATTERNS["promptQuoteCharacters"] and (
            index == 0 or message[index - 1] != EXTRACTION_PATTERNS["promptQuoteEscape"]
        ):
            if not quote:
                quote = char
            elif char == quote:
                quote = ""
    return bool(quote)


def _selector_text(message: str) -> str:
    return "".join(
        "\n"
        if _annotation_pattern("DotLineTerminators").fullmatch(char)
        else " "
        if _annotation_pattern("SelectorWhitespace").fullmatch(char)
        else "\ufffd"
        if char.isspace()
        else char
        for char in message
    )


def annotate_prompt_references(message: str) -> list[str | None]:
    annotations = []
    for match in _annotation_pattern("Invocation").finditer(message):
        if _inside_quotes(message, match.start()):
            continue
        raw = message[match.start() :]
        text = _selector_text(raw)
        prefix = _annotation_pattern("SelectorPrefix").match(text)
        start = prefix.end() if prefix else 0
        end = start
        while (
            end < len(raw)
            and not _annotation_pattern("SelectorWhitespace").fullmatch(raw[end])
            and not _annotation_pattern("SelectorBoundary").match(text[end:])
        ):
            end += 1
        reference = raw[start:end]
        annotations.append(reference if _annotation_pattern("Reference").fullmatch(reference) else None)
    return annotations


def has_chain_delimiter(message: str) -> bool:
    return any(
        not _inside_quotes(message, match.start()) for match in _annotation_pattern("ChainDelimiter").finditer(message)
    )
