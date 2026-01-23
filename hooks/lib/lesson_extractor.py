"""
Lesson extractor for Ralph loops - extracts insights from Claude's reasoning.

Parses Claude responses to identify key learnings from each iteration,
building a knowledge base that helps future iterations avoid repeated mistakes.

Uses workspace resolution from workspace.py.
"""

import re
from typing import NamedTuple


class ExtractedLesson(NamedTuple):
    """Extracted lesson with confidence and source."""
    insight: str
    confidence: float  # 0.0 - 1.0
    pattern_matched: str | None


# Patterns ordered by specificity (more specific = higher confidence)
LESSON_PATTERNS = [
    # High confidence: explicit realizations
    (r"I (?:now )?(?:realize|understand|see) (?:that |now )?(.+?)(?:\.|$)", 0.9, "realization"),
    (r"(?:The )?(?:root )?(?:cause|issue|problem|bug|error) (?:is|was|seems to be) (.+?)(?:\.|$)", 0.9, "root_cause"),
    (r"(?:This|That) (?:means|indicates|suggests|implies) (.+?)(?:\.|$)", 0.85, "implication"),

    # Medium confidence: conclusions
    (r"(?:So|Therefore|Thus|Hence),? (.+?)(?:\.|$)", 0.75, "conclusion"),
    (r"(?:It )?(?:turns out|appears) (?:that )?(.+?)(?:\.|$)", 0.75, "discovery"),
    (r"(?:The )?(?:solution|fix|answer) (?:is|was|requires) (.+?)(?:\.|$)", 0.8, "solution"),

    # Medium confidence: observations
    (r"(?:I )?(?:notice|noticed|found|discovered) (?:that )?(.+?)(?:\.|$)", 0.7, "observation"),
    (r"(?:Looking at|After examining|Upon inspection)[^,]*,? (.+?)(?:\.|$)", 0.65, "inspection"),

    # Lower confidence: warnings/errors
    (r"(?:The )?(?:test|build|lint|check) (?:fails|failed|errors?) (?:because|due to|with) (.+?)(?:\.|$)", 0.6, "failure_reason"),
    (r"(?:Error|Warning|Issue): (.+?)(?:\.|$)", 0.5, "error_message"),
]


def extract_lesson(claude_response: str) -> ExtractedLesson:
    """
    Extract the key insight from Claude's response.

    Returns the highest-confidence lesson found, or a fallback summary.
    """
    if not claude_response or not claude_response.strip():
        return ExtractedLesson("No response to analyze", 0.0, None)

    best_match: ExtractedLesson | None = None

    for pattern, confidence, pattern_name in LESSON_PATTERNS:
        match = re.search(pattern, claude_response, re.IGNORECASE | re.MULTILINE)
        if match:
            insight = match.group(1).strip()
            # Clean up the insight
            insight = _clean_insight(insight)
            if insight and len(insight) > 10:  # Minimum meaningful length
                candidate = ExtractedLesson(insight, confidence, pattern_name)
                if best_match is None or candidate.confidence > best_match.confidence:
                    best_match = candidate

    if best_match:
        return best_match

    # Fallback: extract last meaningful sentence
    fallback = _extract_fallback_lesson(claude_response)
    return ExtractedLesson(fallback, 0.3, "fallback")


def _clean_insight(insight: str) -> str:
    """Clean and normalize an extracted insight."""
    # Remove leading/trailing whitespace and quotes
    insight = insight.strip().strip('"\'')

    # Remove common filler phrases
    filler_patterns = [
        r"^(?:I think |I believe |It seems |Perhaps |Maybe |Probably )",
        r"^(?:we need to |we should |we must |we have to )",
        r"^(?:you need to |you should |you must |you have to )",
    ]
    for pattern in filler_patterns:
        insight = re.sub(pattern, "", insight, flags=re.IGNORECASE)

    # Capitalize first letter
    if insight:
        insight = insight[0].upper() + insight[1:]

    # Truncate if too long (keep first 200 chars)
    if len(insight) > 200:
        insight = insight[:197] + "..."

    return insight


def _extract_fallback_lesson(response: str) -> str:
    """Extract a fallback lesson from the last paragraph or sentence."""
    # Split into paragraphs
    paragraphs = [p.strip() for p in response.split("\n\n") if p.strip()]

    if not paragraphs:
        return "Unable to extract lesson"

    # Try the last paragraph
    last_para = paragraphs[-1]

    # If it's a code block, try the paragraph before
    if last_para.startswith("```") and len(paragraphs) > 1:
        last_para = paragraphs[-2]

    # Get the last sentence
    sentences = re.split(r'(?<=[.!?])\s+', last_para)
    sentences = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 20]

    if sentences:
        return _clean_insight(sentences[-1])

    # Really fallback: just truncate the last paragraph
    return _clean_insight(last_para[:200])


def extract_approach(claude_response: str) -> str:
    """
    Extract what approach Claude tried from its response.

    Looks for action-oriented statements about what was attempted.
    """
    approach_patterns = [
        r"(?:I )?(?:tried|attempted|changed|modified|updated|added|removed|fixed|refactored) (.+?)(?:\.|$)",
        r"(?:Let me |I'll |I will |Going to )(.+?)(?:\.|$)",
        r"(?:The )?(?:change|modification|update|fix) (?:I made |was )(.+?)(?:\.|$)",
    ]

    for pattern in approach_patterns:
        match = re.search(pattern, claude_response, re.IGNORECASE | re.MULTILINE)
        if match:
            approach = _clean_insight(match.group(1))
            if approach and len(approach) > 10:
                return approach

    return "Attempted fix (details unclear)"


def classify_failure(error_output: str) -> str:
    """
    Classify the type of failure from error output.

    Returns a category like "test_failure", "type_error", "syntax_error", etc.
    """
    error_output_lower = error_output.lower()

    classifications = [
        ("syntax_error", ["syntaxerror", "unexpected token", "parsing error"]),
        ("type_error", ["typeerror", "type mismatch", "cannot read property", "undefined is not"]),
        ("import_error", ["cannot find module", "module not found", "importerror", "no module named"]),
        ("test_failure", ["fail", "expected", "received", "assertion", "test failed"]),
        ("lint_error", ["eslint", "lint", "prettier", "formatting"]),
        ("build_error", ["build failed", "compilation error", "cannot compile"]),
        ("runtime_error", ["runtime error", "exception", "crash", "segfault"]),
        ("timeout", ["timeout", "timed out", "exceeded"]),
        ("permission_error", ["permission denied", "access denied", "eacces"]),
    ]

    for category, keywords in classifications:
        if any(kw in error_output_lower for kw in keywords):
            return category

    return "unknown_error"


def summarize_error(error_output: str, max_length: int = 150) -> str:
    """
    Create a concise summary of an error output.

    Extracts the most relevant error message for the session story.
    """
    if not error_output or not error_output.strip():
        return "No error output"

    lines = error_output.strip().split("\n")

    # Look for lines that contain actual error info
    error_indicators = ["error", "fail", "expected", "received", "cannot", "undefined", "null"]

    for line in lines:
        line_lower = line.lower()
        if any(ind in line_lower for ind in error_indicators):
            clean_line = line.strip()
            if len(clean_line) > max_length:
                return clean_line[:max_length - 3] + "..."
            return clean_line

    # Fallback: return first non-empty line
    for line in lines:
        if line.strip():
            clean_line = line.strip()
            if len(clean_line) > max_length:
                return clean_line[:max_length - 3] + "..."
            return clean_line

    return "Error details unavailable"
