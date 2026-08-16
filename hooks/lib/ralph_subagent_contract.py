"""
Canonical contract for Ralph sub-agent delegation prompts and responses.

This module defines the protocol markers and parsing rules shared by:
- task prompt generation (task_protocol.py)
- sub-agent completion enforcement (subagent-gate-enforce.py)
- stop-hook delegation metadata (ralph-stop.py)
"""

import re
from typing import Final

RALPH_SESSION_PROTOCOL_HEADING: Final[str] = "## Ralph Session Protocol"
QUALITY_GATES_HEADING: Final[str] = "### Quality Gates"
RUN_MEMORY_FILE_KEY: Final[str] = "run_memory_file:"
LOOP_MEMORY_FILE_KEY: Final[str] = "loop_memory_file:"

GATE_REVIEW_PREFIX: Final[str] = "GATE_REVIEW:"
MEMORY_UPDATE_PREFIX: Final[str] = "MEMORY_UPDATE:"

DELEGATION_METHOD: Final[str] = "subagent_delegation"

RALPH_PROTOCOL_MARKERS: Final[tuple[str, ...]] = (
    RALPH_SESSION_PROTOCOL_HEADING,
    RUN_MEMORY_FILE_KEY,
    LOOP_MEMORY_FILE_KEY,
    MEMORY_UPDATE_PREFIX,
)

QUALITY_GATES_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"###\s*Quality Gates\s*\n(.*?)(?=\n#{1,3}\s|\n---|\nRespond with|$)",
    re.DOTALL,
)

GATE_REVIEW_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"GATE_REVIEW:\s*(PASS|FAIL)\s*[\u2014\u2013\-:]\s*(.*?)(?:\n|$)"
)

MEMORY_UPDATE_PATTERN: Final[re.Pattern[str]] = re.compile(r"MEMORY_UPDATE:\s*(.*?)(?:\n|$)", re.DOTALL)

CRITERION_VERDICTS_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"CRITERION_VERDICTS:\s*\n((?:\[?\d+\]?\s*(?:PASS|FAIL).*\n?)*)",
    re.IGNORECASE | re.MULTILINE,
)

ORIGINAL_INTENT_HEADING: Final[str] = "### Original Request Intent"


def is_ralph_protocol_prompt(prompt_text: str) -> bool:
    """Return True if prompt includes Ralph protocol markers."""
    return any(marker in prompt_text for marker in RALPH_PROTOCOL_MARKERS)


def extract_quality_gates(prompt_text: str) -> str | None:
    """Extract criteria from the Quality Gates section."""
    match = QUALITY_GATES_PATTERN.search(prompt_text)
    if not match:
        return None

    criteria = match.group(1).strip()
    return criteria or None


def parse_gate_review(content: str) -> tuple[str, str] | None:
    """Parse a GATE_REVIEW line and return (PASS|FAIL, rationale)."""
    match = GATE_REVIEW_PATTERN.search(content)
    if not match:
        return None
    return (match.group(1).upper(), match.group(2).strip())


def parse_memory_update(content: str) -> str | None:
    """Parse MEMORY_UPDATE line and return summary text."""
    match = MEMORY_UPDATE_PATTERN.search(content)
    if not match:
        return None
    summary = match.group(1).strip()
    return summary or None


def parse_criterion_verdicts(content: str) -> list[tuple[int, str, str]] | None:
    """Parse CRITERION_VERDICTS block and return list of (index, verdict, rationale).

    Returns None if no block found. Returns empty list if block exists but is empty.
    """
    match = CRITERION_VERDICTS_PATTERN.search(content)
    if not match:
        return None

    results = []
    for line in match.group(1).strip().splitlines():
        line_match = re.match(r"\[?(\d+)\]?\s*(PASS|FAIL)\s*[-\u2013\u2014:]\s*(.*)", line, re.IGNORECASE)
        if line_match:
            results.append(
                (
                    int(line_match.group(1)),
                    line_match.group(2).upper(),
                    line_match.group(3).strip(),
                )
            )
    return results


def has_original_intent(prompt_text: str) -> bool:
    """Return True if prompt includes Original Request Intent heading."""
    return ORIGINAL_INTENT_HEADING in prompt_text


def render_protocol_section(verification_command: str, run_memory_file: str) -> str:
    """Render canonical Ralph Session Protocol markdown section."""
    return (
        f"{RALPH_SESSION_PROTOCOL_HEADING}\n\n"
        f"{QUALITY_GATES_HEADING}\n\n"
        f"- Run and evaluate `{verification_command}`.\n"
        f"- Update `{run_memory_file}` with concrete findings from this attempt.\n"
        "- Keep edits minimal and relevant to the failing verification.\n\n"
        "Respond with `GATE_REVIEW: PASS - [rationale]` "
        "or `GATE_REVIEW: FAIL - [rationale]`.\n"
        f"Also include `MEMORY_UPDATE: [summary of updates to {run_memory_file}]`.\n"
    )
