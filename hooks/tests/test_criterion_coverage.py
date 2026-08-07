"""
Tests for criterion verdict parsing and original intent detection.

Covers:
- parse_criterion_verdicts() parsing of CRITERION_VERDICTS blocks
- has_original_intent() detection of Original Request Intent heading
- Integration with subagent-gate-enforce criterion coverage advisory
"""

from ralph_subagent_contract import (
    ORIGINAL_INTENT_HEADING,
    has_original_intent,
    parse_criterion_verdicts,
)


class TestParseCriterionVerdicts:
    def test_parses_standard_block(self):
        content = (
            "Some preamble.\n\n"
            "CRITERION_VERDICTS:\n"
            "[1] PASS - All tests pass\n"
            "[2] FAIL - Missing error handling\n"
            "[3] PASS - Documentation complete\n\n"
            "GATE_REVIEW: PASS \u2014 Overall good"
        )
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert len(result) == 3
        assert result[0] == (1, "PASS", "All tests pass")
        assert result[1] == (2, "FAIL", "Missing error handling")
        assert result[2] == (3, "PASS", "Documentation complete")

    def test_returns_none_without_block(self):
        content = "GATE_REVIEW: PASS \u2014 No criterion verdicts here"
        assert parse_criterion_verdicts(content) is None

    def test_handles_brackets_optional(self):
        content = "CRITERION_VERDICTS:\n1 PASS - Without brackets\n2 FAIL - Also without"
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert len(result) == 2
        assert result[0] == (1, "PASS", "Without brackets")
        assert result[1] == (2, "FAIL", "Also without")

    def test_handles_em_dash_separator(self):
        content = "CRITERION_VERDICTS:\n[1] PASS \u2014 em-dash rationale\n"
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert result[0] == (1, "PASS", "em-dash rationale")

    def test_handles_en_dash_separator(self):
        content = "CRITERION_VERDICTS:\n[1] FAIL \u2013 en-dash rationale\n"
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert result[0] == (1, "FAIL", "en-dash rationale")

    def test_handles_colon_separator(self):
        content = "CRITERION_VERDICTS:\n[1] PASS: colon rationale\n"
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert result[0] == (1, "PASS", "colon rationale")

    def test_stops_at_non_matching_line(self):
        """Regex capture group stops at first non-matching line."""
        content = "CRITERION_VERDICTS:\n[1] PASS - Good\nNot a criterion line\n[3] FAIL - Bad\n"
        result = parse_criterion_verdicts(content)
        assert result is not None
        # Regex stops capturing at the non-matching line
        assert len(result) == 1
        assert result[0] == (1, "PASS", "Good")

    def test_case_insensitive_header(self):
        content = "criterion_verdicts:\n[1] PASS - lowercase header\n"
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert len(result) == 1

    def test_case_insensitive_verdict(self):
        content = "CRITERION_VERDICTS:\n[1] pass - lowercase\n[2] Pass - mixed\n"
        result = parse_criterion_verdicts(content)
        assert result is not None
        assert len(result) == 2
        assert result[0][1] == "PASS"
        assert result[1][1] == "PASS"

    def test_empty_block_returns_empty_list(self):
        content = "CRITERION_VERDICTS:\n\nGATE_REVIEW: PASS - Done"
        result = parse_criterion_verdicts(content)
        # Pattern matches but no valid lines → empty list
        assert result is not None
        assert len(result) == 0


class TestHasOriginalIntent:
    def test_detects_heading(self):
        prompt = (
            "## Task Instructions\n\n"
            "### Original Request Intent\n\n"
            "This chain was initiated with the following request.\n"
        )
        assert has_original_intent(prompt) is True

    def test_rejects_without_heading(self):
        prompt = "### Quality Gates\n- Criterion A\n"
        assert has_original_intent(prompt) is False

    def test_heading_constant_value(self):
        assert ORIGINAL_INTENT_HEADING == "### Original Request Intent"

    def test_partial_match_rejected(self):
        prompt = "## Original Request\nNot the exact heading"
        assert has_original_intent(prompt) is False
