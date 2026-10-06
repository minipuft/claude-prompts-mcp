"""
Tests for hooks/lib/ralph_subagent_contract.py

Covers:
- Gate extraction from prompt text
- GATE_REVIEW verdict parsing (PASS/FAIL, em-dash/en-dash/hyphen/colon)
- MEMORY_UPDATE parsing
- Ralph protocol marker detection
- Protocol section rendering
"""

from ralph_subagent_contract import (
    DELEGATION_METHOD,
    extract_quality_gates,
    is_ralph_protocol_prompt,
    parse_gate_review,
    parse_memory_update,
    render_protocol_section,
)


class TestExtractQualityGates:
    def test_extracts_criteria_from_standard_section(self):
        prompt = "Some preamble\n\n### Quality Gates\n- Code must compile\n- All tests must pass\n\n### Next Section\n"
        result = extract_quality_gates(prompt)
        assert result is not None
        assert "Code must compile" in result
        assert "All tests must pass" in result

    def test_returns_none_without_quality_gates(self):
        prompt = "Just a normal prompt with no gates."
        assert extract_quality_gates(prompt) is None

    def test_extracts_until_next_heading(self):
        prompt = "### Quality Gates\n- Criterion A\n## Another H2 Section\nMore text"
        result = extract_quality_gates(prompt)
        assert result is not None
        assert "Criterion A" in result
        assert "Another H2 Section" not in result

    def test_extracts_until_respond_with(self):
        prompt = "### Quality Gates\n- Must be correct\nRespond with `GATE_REVIEW: PASS`\n"
        result = extract_quality_gates(prompt)
        assert result is not None
        assert "Must be correct" in result

    def test_extracts_until_end_of_string(self):
        prompt = "### Quality Gates\n- Only criterion"
        result = extract_quality_gates(prompt)
        assert result is not None
        assert "Only criterion" in result

    def test_extracts_until_separator_on_next_line(self):
        """Separator on the line after content terminates extraction."""
        prompt = "### Quality Gates\n- Criterion A\n---\nOther content"
        result = extract_quality_gates(prompt)
        assert result is not None
        assert "Criterion A" in result
        assert "Other content" not in result


class TestParseGateReview:
    def test_pass_with_em_dash(self):
        content = "GATE_REVIEW: PASS \u2014 All criteria met"
        result = parse_gate_review(content)
        assert result == ("PASS", "All criteria met")

    def test_fail_with_em_dash(self):
        content = "GATE_REVIEW: FAIL \u2014 Missing test coverage"
        result = parse_gate_review(content)
        assert result == ("FAIL", "Missing test coverage")

    def test_pass_with_en_dash(self):
        content = "GATE_REVIEW: PASS \u2013 Everything looks good"
        result = parse_gate_review(content)
        assert result == ("PASS", "Everything looks good")

    def test_pass_with_hyphen(self):
        content = "GATE_REVIEW: PASS - Simple rationale"
        result = parse_gate_review(content)
        assert result == ("PASS", "Simple rationale")

    def test_pass_with_colon(self):
        content = "GATE_REVIEW: PASS: All checks passed"
        result = parse_gate_review(content)
        assert result == ("PASS", "All checks passed")

    def test_no_verdict_returns_none(self):
        content = "Here is my analysis of the code."
        assert parse_gate_review(content) is None

    def test_verdict_in_multiline_content(self):
        content = (
            "I've completed the work.\n\n"
            "GATE_REVIEW: PASS \u2014 All tests passing\n\n"
            "Let me know if you need anything else."
        )
        result = parse_gate_review(content)
        assert result == ("PASS", "All tests passing")

    def test_case_insensitive_verdict_value(self):
        # The regex matches PASS/FAIL literally (uppercase)
        content = "GATE_REVIEW: pass - lowercase"
        result = parse_gate_review(content)
        # Should not match lowercase — protocol requires uppercase
        assert result is None

    def test_multiple_verdicts_returns_first_match(self):
        """parse_gate_review uses .search() which finds first match."""
        content = "GATE_REVIEW: FAIL \u2014 first attempt\nGATE_REVIEW: PASS \u2014 second attempt"
        result = parse_gate_review(content)
        # .search() returns first match
        assert result == ("FAIL", "first attempt")


class TestParseMemoryUpdate:
    def test_parses_memory_update(self):
        content = "MEMORY_UPDATE: Added findings about auth bug to run-memory.md"
        result = parse_memory_update(content)
        assert result == "Added findings about auth bug to run-memory.md"

    def test_returns_none_without_marker(self):
        content = "Just some normal text"
        assert parse_memory_update(content) is None

    def test_returns_none_for_empty_update(self):
        content = "MEMORY_UPDATE:   "
        assert parse_memory_update(content) is None

    def test_multiline_content(self):
        content = "Here is my work.\nMEMORY_UPDATE: Documented the root cause in run-memory.md\nDone."
        result = parse_memory_update(content)
        assert result == "Documented the root cause in run-memory.md"


class TestIsRalphProtocolPrompt:
    def test_detects_session_protocol_heading(self):
        prompt = "## Ralph Session Protocol\n\nSome content"
        assert is_ralph_protocol_prompt(prompt) is True

    def test_detects_run_memory_file_key(self):
        prompt = "run_memory_file: run-memory.md"
        assert is_ralph_protocol_prompt(prompt) is True

    def test_detects_loop_memory_file_key(self):
        prompt = "loop_memory_file: loop-memory.md"
        assert is_ralph_protocol_prompt(prompt) is True

    def test_detects_memory_update_prefix(self):
        prompt = "Include MEMORY_UPDATE: summary"
        assert is_ralph_protocol_prompt(prompt) is True

    def test_rejects_normal_prompt(self):
        prompt = "Just a regular prompt with no markers"
        assert is_ralph_protocol_prompt(prompt) is False

    def test_rejects_quality_gates_alone(self):
        """Quality Gates heading alone is NOT a Ralph protocol marker."""
        prompt = "### Quality Gates\n- Some criterion"
        assert is_ralph_protocol_prompt(prompt) is False


class TestRenderProtocolSection:
    def test_renders_with_correct_markers(self):
        result = render_protocol_section(
            verification_command="npm test",
            run_memory_file="run-memory.md",
        )
        assert "## Ralph Session Protocol" in result
        assert "### Quality Gates" in result
        assert "npm test" in result
        assert "run-memory.md" in result
        assert "GATE_REVIEW:" in result
        assert "MEMORY_UPDATE:" in result

    def test_delegation_method_constant(self):
        assert DELEGATION_METHOD == "subagent_delegation"
