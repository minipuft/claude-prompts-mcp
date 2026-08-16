"""
Operator detection patterns loaded from SSOT registry.

Source: server/tooling/contracts/registries/operators.json
These patterns are for USER CONTEXT HINTS only.
Full parsing happens server-side in symbolic-operator-parser.ts
"""

import json
import re
from pathlib import Path
from typing import TypedDict

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
    matches = pattern.findall(message)
    # Flatten tuple results from groups
    if matches and isinstance(matches[0], tuple):
        return [m for group in matches for m in group if m]
    return list(matches)


def detect_all_operators(message: str) -> dict[str, list[str]]:
    """Detect all operators in message. Returns dict of operator_id -> matches."""
    return {op_id: matches for op_id in OPERATORS if (matches := detect_operator(message, op_id))}


def get_delimiter_symbols() -> list[str]:
    """Get symbols that separate chain steps, from SSOT registry.

    Returns symbols for operators with role='delimiter' (e.g., '-->', '==>').
    Used by detect_chain_syntax() to split commands into steps.
    """
    return [op["symbol"] for op in OPERATORS.values() if op.get("role") == "delimiter"]
