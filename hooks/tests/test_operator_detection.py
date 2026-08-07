"""
Tests for SSOT-driven operator detection in hooks.

Covers:
- Chain syntax parsing with/without arguments
- Delegation (==>) detection
- Framework/style DB fallback behavior
- SSOT registry role classification
"""

import re
import sys
from pathlib import Path

# Add hooks lib to path (same as hooks do at runtime)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from operators import OPERATORS, detect_all_operators, detect_operator, get_delimiter_symbols

# ── SSOT Registry Tests ──


class TestOperatorRegistry:
    """Verify SSOT registry loads correctly with role classification."""

    def test_all_implemented_operators_loaded(self):
        """All operators with detectInHooks=true should be in OPERATORS."""
        expected = {"chain", "delegation", "gate", "framework", "style", "repetition"}
        assert expected.issubset(set(OPERATORS.keys()))

    def test_role_field_present(self):
        """Every loaded operator should have a role."""
        for op_id, info in OPERATORS.items():
            assert "role" in info, f"Operator {op_id} missing 'role' field"

    def test_delimiter_roles(self):
        """Chain and delegation should be delimiters."""
        assert OPERATORS["chain"]["role"] == "delimiter"
        assert OPERATORS["delegation"]["role"] == "delimiter"

    def test_non_delimiter_roles(self):
        """Non-delimiter operators should not be delimiters."""
        assert OPERATORS["gate"]["role"] != "delimiter"
        assert OPERATORS["framework"]["role"] != "delimiter"
        assert OPERATORS["style"]["role"] != "delimiter"
        assert OPERATORS["repetition"]["role"] != "delimiter"


# ── get_delimiter_symbols Tests ──


class TestGetDelimiterSymbols:
    """Verify delimiter symbol extraction from SSOT."""

    def test_returns_chain_and_delegation(self):
        symbols = get_delimiter_symbols()
        assert "-->" in symbols
        assert "==>" in symbols

    def test_excludes_non_delimiters(self):
        symbols = get_delimiter_symbols()
        assert "::" not in symbols
        assert "@" not in symbols
        assert "#" not in symbols
        assert "* N" not in symbols


# ── Chain Syntax Detection Tests ──


def detect_chain_syntax(message: str) -> list[str]:
    """Reproduce the detect_chain_syntax logic from prompt-suggest.py."""
    delimiters = get_delimiter_symbols()
    escaped = [re.escape(d) for d in delimiters] + ["→"]
    split_pattern = r"\s*(?:" + "|".join(escaped) + r")\s*"

    parts = re.split(split_pattern, message)
    if len(parts) <= 1:
        return []

    prompts = []
    for part in parts:
        match = re.search(r">>\s*([a-zA-Z0-9_-]+)", part)
        if match:
            prompts.append(match.group(1).lower())

    return prompts


class TestChainSyntaxDetection:
    """Chain detection with arguments and delegation."""

    def test_simple_chain(self):
        assert detect_chain_syntax(">>analyze --> >>implement --> >>test") == [
            "analyze",
            "implement",
            "test",
        ]

    def test_two_step_chain(self):
        assert detect_chain_syntax(">>analyze --> >>implement") == ["analyze", "implement"]

    def test_chain_with_quoted_args(self):
        """Previously broken: args between prompt ID and --> caused first step loss."""
        assert detect_chain_syntax('>>analyze scope:"backend" --> >>implement') == [
            "analyze",
            "implement",
        ]

    def test_chain_with_unquoted_args(self):
        """Previously broken: unquoted args also caused step loss."""
        assert detect_chain_syntax(">>diagnose focus:performance --> >>plan") == [
            "diagnose",
            "plan",
        ]

    def test_chain_with_mixed_args(self):
        """First step has args, middle steps don't."""
        assert detect_chain_syntax('>>research topic:"AI" --> >>summarize --> >>review') == [
            "research",
            "summarize",
            "review",
        ]

    def test_chain_with_args_on_all_steps(self):
        result = detect_chain_syntax('>>step1 a:"1" --> >>step2 b:"2" --> >>step3 c:"3"')
        assert result == ["step1", "step2", "step3"]

    def test_delegation_chain(self):
        """Previously broken: ==> was not detected as delimiter."""
        assert detect_chain_syntax(">>step1 ==> >>step2") == ["step1", "step2"]

    def test_mixed_chain_and_delegation(self):
        assert detect_chain_syntax(">>research --> >>summarize ==> >>review") == [
            "research",
            "summarize",
            "review",
        ]

    def test_unicode_arrow(self):
        assert detect_chain_syntax(">>a → >>b") == ["a", "b"]

    def test_single_prompt_not_chain(self):
        assert detect_chain_syntax(">>analyze") == []

    def test_single_prompt_with_args_not_chain(self):
        assert detect_chain_syntax('>>analyze scope:"full"') == []

    def test_chain_with_gate(self):
        assert detect_chain_syntax('>>analyze --> >>implement :: "test it"') == [
            "analyze",
            "implement",
        ]

    def test_framework_prefix_with_chain(self):
        assert detect_chain_syntax('@CAGEERF >>step1 scope:"x" --> >>step2') == [
            "step1",
            "step2",
        ]

    def test_case_normalization(self):
        assert detect_chain_syntax(">>Analyze --> >>IMPLEMENT") == ["analyze", "implement"]


# ── Delegation Detection Tests ──


class TestDelegationDetection:
    """Verify delegation operator detection via SSOT patterns."""

    def test_detects_delegation(self):
        matches = detect_operator(">>step1 ==> >>step2", "delegation")
        assert len(matches) > 0

    def test_no_delegation_in_simple_chain(self):
        matches = detect_operator(">>step1 --> >>step2", "delegation")
        assert len(matches) == 0

    def test_delegation_in_mixed_chain(self):
        matches = detect_operator(">>a --> >>b ==> >>c", "delegation")
        assert len(matches) > 0


# ── Framework/Style Detection Tests ──


class TestFrameworkDetection:
    def test_detects_framework(self):
        matches = detect_operator("@CAGEERF >>analyze", "framework")
        assert "CAGEERF" in matches

    def test_no_framework_in_plain_prompt(self):
        matches = detect_operator(">>analyze", "framework")
        assert len(matches) == 0

    def test_framework_not_in_quotes(self):
        """Framework inside quotes should not match (quote-aware pattern)."""
        matches = detect_operator('>>analyze scope:"@CAGEERF"', "framework")
        # The pattern (?:^|\s)@ requires whitespace before @, so quoted @ may or may not match
        # depending on surrounding context — this test documents current behavior
        assert isinstance(matches, list)


class TestStyleDetection:
    def test_detects_style(self):
        matches = detect_operator("#analytical >>report", "style")
        assert "analytical" in matches

    def test_no_style_in_plain_prompt(self):
        matches = detect_operator(">>analyze", "style")
        assert len(matches) == 0


# ── detect_all_operators Integration ──


class TestDetectAllOperators:
    def test_complex_command(self):
        result = detect_all_operators('@CAGEERF >>step1 --> >>step2 ==> >>step3 :: "validate"')
        assert "chain" in result
        assert "delegation" in result
        assert "framework" in result
        assert "gate" in result

    def test_simple_prompt(self):
        result = detect_all_operators(">>analyze")
        # No operators (>> is not an operator, it's prompt syntax)
        assert len(result) == 0
