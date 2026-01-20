# AUTO-GENERATED - Do not edit directly
# Source: server/tooling/contracts/registries/operators.json
"""
Operator detection patterns for hooks.

These patterns are for USER CONTEXT HINTS only.
Full parsing happens server-side in symbolic-operator-parser.ts
"""
import re
from typing import TypedDict, Pattern


class OperatorInfo(TypedDict):
    symbol: str
    description: str
    pattern: Pattern[str]
    examples: list[str]


# Operator detection patterns
OPERATORS: dict[str, OperatorInfo] = {
    'chain': {
        'symbol': '-->',
        'description': 'Sequential execution of prompts',
        'pattern': re.compile(r'''-->'''),
        'examples': [">>step1 --> >>step2",">>analyze --> >>implement --> >>test"],
    },
    'gate': {
        'symbol': '::',
        'description': 'Quality gate for validation',
        'pattern': re.compile(r'''\s+(::|=)\s*(?:([a-z][a-z0-9_-]*):["']([^"']+)["']|["']([^"']+)["']|([^\s"']+))''', re.IGNORECASE),
        'examples': [":: 'cite sources'",":: security:'no secrets'",":: verify:'npm test' :full"],
    },
    'framework': {
        'symbol': '@',
        'description': 'Apply methodology framework',
        'pattern': re.compile(r'''(?:^|\s)@([A-Za-z0-9_-]+)(?=\s|$)'''),
        'examples': ["@CAGEERF >>analyze","@ReACT >>debug"],
    },
    'style': {
        'symbol': '#',
        'description': 'Response formatting style',
        'pattern': re.compile(r'''(?:^|\s)#([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)'''),
        'examples': ["#analytical >>report","#procedural >>tutorial"],
    },
    'repetition': {
        'symbol': '* N',
        'description': 'Chain shorthand - repeat N times',
        'pattern': re.compile(r'''\s+\*\s*(\d+)(?=\s|$|-->)'''),
        'examples': [">>prompt * 3",">>analyze * 2 --> >>summarize"],
    },
}


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
    return {
        op_id: matches
        for op_id in OPERATORS
        if (matches := detect_operator(message, op_id))
    }
