"""
Tests for hooks/subagent-gate-enforce.py

Covers:
- Verdict parsing from transcripts (PASS/FAIL/missing)
- Gate extraction from context envelope
- Block/allow decisions
- stop_hook_active guard (infinite loop prevention)
- Corrupt/missing transcript graceful degradation
- Multiple verdicts (last-wins scan)
- Content as list of blocks
- Ralph protocol + missing MEMORY_UPDATE
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Import the hook module functions directly
HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))


# Import as module (filename has hyphens)
import importlib.util

spec = importlib.util.spec_from_file_location(
    "subagent_gate_enforce",
    HOOKS_DIR / "subagent-gate-enforce.py",
)
hook_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook_mod)

read_transcript = hook_mod.read_transcript
find_initial_prompt = hook_mod.find_initial_prompt
find_verdict = hook_mod.find_verdict
find_memory_update = hook_mod.find_memory_update
parse_hook_input = hook_mod.parse_hook_input


class TestReadTranscript:
    def test_reads_valid_jsonl(self, tmp_path):
        path = tmp_path / "t.jsonl"
        path.write_text('{"type":"human","content":"hello"}\n{"type":"assistant","content":"hi"}\n')
        msgs = read_transcript(str(path))
        assert len(msgs) == 2
        assert msgs[0]["type"] == "human"
        assert msgs[1]["type"] == "assistant"

    def test_skips_corrupt_lines(self, tmp_path):
        path = tmp_path / "t.jsonl"
        path.write_text('{"type":"human","content":"hello"}\nnot valid json\n{"type":"assistant","content":"hi"}\n')
        msgs = read_transcript(str(path))
        assert len(msgs) == 2

    def test_returns_empty_for_missing_file(self):
        msgs = read_transcript("/nonexistent/path.jsonl")
        assert msgs == []

    def test_returns_empty_for_empty_file(self, tmp_path):
        path = tmp_path / "empty.jsonl"
        path.write_text("")
        msgs = read_transcript(str(path))
        assert msgs == []

    def test_skips_blank_lines(self, tmp_path):
        path = tmp_path / "t.jsonl"
        path.write_text('{"type":"human","content":"hello"}\n\n\n{"type":"assistant","content":"hi"}\n')
        msgs = read_transcript(str(path))
        assert len(msgs) == 2


class TestFindInitialPrompt:
    def test_extracts_string_content(self):
        transcript = [
            {"type": "human", "content": "The task prompt"},
            {"type": "assistant", "content": "Response"},
        ]
        assert find_initial_prompt(transcript) == "The task prompt"

    def test_extracts_block_content(self):
        transcript = [
            {
                "type": "human",
                "content": [
                    {"text": "Part 1"},
                    {"text": "Part 2"},
                ],
            }
        ]
        result = find_initial_prompt(transcript)
        assert "Part 1" in result
        assert "Part 2" in result

    def test_handles_mixed_blocks(self):
        transcript = [
            {
                "type": "human",
                "content": [
                    {"text": "Text block"},
                    "String block",
                ],
            }
        ]
        result = find_initial_prompt(transcript)
        assert "Text block" in result
        assert "String block" in result

    def test_returns_empty_for_no_human(self):
        transcript = [{"type": "assistant", "content": "No human here"}]
        assert find_initial_prompt(transcript) == ""

    def test_returns_empty_for_empty_transcript(self):
        assert find_initial_prompt([]) == ""

    def test_uses_role_field_fallback(self):
        transcript = [{"role": "human", "content": "Via role field"}]
        assert find_initial_prompt(transcript) == "Via role field"


class TestFindVerdict:
    def test_finds_pass_verdict(self):
        transcript = [
            {"type": "human", "content": "Prompt"},
            {"type": "assistant", "content": "Done.\nGATE_REVIEW: PASS \u2014 All good"},
        ]
        result = find_verdict(transcript)
        assert result == ("PASS", "All good")

    def test_finds_fail_verdict(self):
        transcript = [
            {"type": "human", "content": "Prompt"},
            {"type": "assistant", "content": "GATE_REVIEW: FAIL \u2014 Tests broken"},
        ]
        result = find_verdict(transcript)
        assert result == ("FAIL", "Tests broken")

    def test_returns_none_without_verdict(self):
        transcript = [
            {"type": "human", "content": "Prompt"},
            {"type": "assistant", "content": "I did the work but forgot the verdict"},
        ]
        assert find_verdict(transcript) is None

    def test_last_verdict_wins(self):
        """Scan from end — last assistant message with verdict wins."""
        transcript = [
            {"type": "human", "content": "Prompt"},
            {"type": "assistant", "content": "GATE_REVIEW: FAIL \u2014 First attempt"},
            {"type": "assistant", "content": "GATE_REVIEW: PASS \u2014 Fixed it"},
        ]
        result = find_verdict(transcript)
        assert result == ("PASS", "Fixed it")

    def test_multiple_verdicts_in_same_message(self):
        """Within a single message, parse_gate_review returns first match."""
        transcript = [
            {"type": "human", "content": "Prompt"},
            {
                "type": "assistant",
                "content": ("GATE_REVIEW: FAIL \u2014 First\nGATE_REVIEW: PASS \u2014 Second"),
            },
        ]
        # find_verdict scans from end, finds this message, parse_gate_review returns first match
        result = find_verdict(transcript)
        assert result == ("FAIL", "First")

    def test_verdict_in_block_content(self):
        transcript = [
            {"type": "human", "content": "Prompt"},
            {
                "type": "assistant",
                "content": [
                    {"text": "Some work done."},
                    {"text": "GATE_REVIEW: PASS \u2014 Looks great"},
                ],
            },
        ]
        result = find_verdict(transcript)
        assert result == ("PASS", "Looks great")

    def test_skips_human_messages(self):
        transcript = [
            {"type": "human", "content": "GATE_REVIEW: PASS \u2014 From human"},
            {"type": "assistant", "content": "No verdict here"},
        ]
        assert find_verdict(transcript) is None

    def test_hyphen_separator(self):
        transcript = [
            {"type": "assistant", "content": "GATE_REVIEW: PASS - With hyphen"},
        ]
        result = find_verdict(transcript)
        assert result == ("PASS", "With hyphen")

    def test_en_dash_separator(self):
        transcript = [
            {"type": "assistant", "content": "GATE_REVIEW: PASS \u2013 With en-dash"},
        ]
        result = find_verdict(transcript)
        assert result == ("PASS", "With en-dash")

    def test_colon_separator(self):
        transcript = [
            {"type": "assistant", "content": "GATE_REVIEW: PASS: With colon"},
        ]
        result = find_verdict(transcript)
        assert result == ("PASS", "With colon")


class TestFindMemoryUpdate:
    def test_finds_memory_update(self):
        transcript = [
            {"type": "assistant", "content": "MEMORY_UPDATE: Updated run-memory.md"},
        ]
        result = find_memory_update(transcript)
        assert result == "Updated run-memory.md"

    def test_returns_none_without_marker(self):
        transcript = [
            {"type": "assistant", "content": "No memory update here"},
        ]
        assert find_memory_update(transcript) is None

    def test_last_message_wins(self):
        transcript = [
            {"type": "assistant", "content": "MEMORY_UPDATE: First"},
            {"type": "assistant", "content": "MEMORY_UPDATE: Second"},
        ]
        result = find_memory_update(transcript)
        assert result == "Second"


class TestMainHookDecisions:
    """Test the hook's main() decision logic via subprocess or mock."""

    def _run_hook(self, hook_input, transcript_path=None):
        """Simulate running the hook by calling main() with mocked stdin."""
        import contextlib
        import io

        input_data = dict(hook_input)
        if transcript_path:
            input_data["agent_transcript_path"] = transcript_path

        captured = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(input_data))):
            with contextlib.redirect_stdout(captured):
                with pytest.raises(SystemExit) as exc_info:
                    hook_mod.main()

        output = captured.getvalue().strip()
        exit_code = exc_info.value.code
        return exit_code, json.loads(output) if output else None

    def test_stop_hook_active_allows(self):
        """stop_hook_active=true prevents infinite blocking loop."""
        exit_code, output = self._run_hook({"stop_hook_active": True})
        assert exit_code == 0
        assert output is None  # No output = allow

    def test_no_transcript_path_allows(self):
        exit_code, output = self._run_hook({})
        assert exit_code == 0
        assert output is None

    def test_empty_transcript_allows(self, tmp_path):
        path = tmp_path / "empty.jsonl"
        path.write_text("")
        exit_code, output = self._run_hook({}, str(path))
        assert exit_code == 0
        assert output is None

    def test_no_gates_no_ralph_allows(self, transcript_builder):
        path = (
            transcript_builder.add_human("Just a regular prompt without gates")
            .add_assistant("Here is my response")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is None

    def test_gates_with_pass_allows(self, transcript_builder):
        path = (
            transcript_builder.add_human("### Quality Gates\n- Code must compile\n- Tests must pass")
            .add_assistant("Done.\nGATE_REVIEW: PASS \u2014 All criteria satisfied")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is None

    def test_gates_with_fail_blocks(self, transcript_builder):
        path = (
            transcript_builder.add_human("### Quality Gates\n- Code must compile")
            .add_assistant("GATE_REVIEW: FAIL \u2014 Compilation error on line 42")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
        assert "Gate Review Failed" in output["reason"]
        assert "Compilation error" in output["reason"]

    def test_gates_with_no_verdict_blocks(self, transcript_builder):
        path = (
            transcript_builder.add_human("### Quality Gates\n- Code must compile\n- All tests pass")
            .add_assistant("I finished the work. Here's what I did...")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
        assert "Gate Verdict Missing" in output["reason"]
        assert "Code must compile" in output["reason"]

    def test_ralph_protocol_pass_without_memory_update_blocks(self, transcript_builder):
        path = (
            transcript_builder.add_human(
                "## Ralph Session Protocol\n"
                "### Quality Gates\n"
                "- Fix the bug\n"
                "run_memory_file: run-memory.md\n"
                "MEMORY_UPDATE: required"
            )
            .add_assistant("GATE_REVIEW: PASS \u2014 Fixed it")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
        assert "Memory Update Missing" in output["reason"]

    def test_ralph_protocol_pass_with_memory_update_allows(self, transcript_builder):
        path = (
            transcript_builder.add_human(
                "## Ralph Session Protocol\n"
                "### Quality Gates\n"
                "- Fix the bug\n"
                "run_memory_file: run-memory.md\n"
                "MEMORY_UPDATE: required"
            )
            .add_assistant("GATE_REVIEW: PASS \u2014 Fixed it\nMEMORY_UPDATE: Documented root cause in run-memory.md")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is None  # Allow

    def test_corrupt_transcript_allows(self, tmp_path):
        """Corrupt JSONL transcript should degrade gracefully to allow."""
        path = tmp_path / "corrupt.jsonl"
        path.write_text("not json\n{broken")
        exit_code, output = self._run_hook({}, str(path))
        assert exit_code == 0
        assert output is None  # Empty transcript = allow

    def test_missing_transcript_file_allows(self):
        exit_code, output = self._run_hook({}, "/nonexistent/transcript.jsonl")
        assert exit_code == 0
        assert output is None

    def test_ralph_protocol_no_gates_no_verdict_blocks(self, transcript_builder):
        """Ralph protocol without explicit gates still requires verdict."""
        path = (
            transcript_builder.add_human(
                "## Ralph Session Protocol\nrun_memory_file: run-memory.md\nMEMORY_UPDATE: required"
            )
            .add_assistant("I finished the work.")
            .write()
        )
        exit_code, output = self._run_hook({}, path)
        assert exit_code == 0
        assert output is not None
        assert output["decision"] == "block"
