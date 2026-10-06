"""
Tests for hooks/lib/task_protocol.py

Covers:
- Task file creation and rendering
- Task file parsing (YAML frontmatter + sections)
- Round-trip: create → render → parse
- Result file creation and parsing
- Task ID generation
"""

import sys
from pathlib import Path

HOOKS_LIB = Path(__file__).parent.parent / "lib"
sys.path.insert(0, str(HOOKS_LIB))


class TestTaskFileRoundTrip:
    def test_create_and_parse_task_file(self, patch_workspace):
        from session_tracker import SessionTracker
        from task_protocol import create_task_file, parse_task_file

        tracker = SessionTracker("roundtrip-test")
        tracker.set_goal("Fix login bug", "npm test", "/home/user/project")
        tracker.record_iteration("Tried X", "FAIL", "Didn't work")

        path, task_file = create_task_file(
            tracker=tracker,
            verification_command="npm test",
            last_failure_output="Error: assertion failed",
            max_iterations=5,
            timeout_seconds=300,
            working_directory="/home/user/project",
        )

        assert path.exists()
        content = path.read_text()

        # Parse it back
        parsed = parse_task_file(content)
        assert parsed is not None
        assert parsed.metadata.verification_command == "npm test"
        assert parsed.metadata.max_iterations == 5
        assert parsed.metadata.timeout_seconds == 300
        assert parsed.metadata.working_directory == "/home/user/project"

    def test_task_file_contains_required_sections(self, patch_workspace):
        from session_tracker import SessionTracker
        from task_protocol import create_task_file

        tracker = SessionTracker("protocol-test")
        tracker.set_goal("Fix bug", "npm test")

        path, _ = create_task_file(
            tracker=tracker,
            verification_command="npm test",
        )

        content = path.read_text()
        assert "## Original Goal" in content
        assert "## Session Story" in content
        assert "## Instructions" in content

    def test_task_file_yaml_frontmatter(self, patch_workspace):
        import re

        import yaml
        from session_tracker import SessionTracker
        from task_protocol import create_task_file

        tracker = SessionTracker("yaml-test")
        tracker.set_goal("Test goal", "echo test")

        path, task_file = create_task_file(
            tracker=tracker,
            verification_command="echo test",
        )

        content = path.read_text()
        frontmatter_match = re.match(r"^---\n(.+?)\n---", content, re.DOTALL)
        assert frontmatter_match is not None

        fm = yaml.safe_load(frontmatter_match.group(1))
        assert fm["id"].startswith("task-")
        assert fm["verification_command"] == "echo test"

    def test_task_file_includes_session_story(self, patch_workspace):
        from session_tracker import SessionTracker
        from task_protocol import create_task_file

        tracker = SessionTracker("story-test")
        tracker.set_goal("Fix auth", "npm test")
        tracker.record_iteration("First attempt", "FAIL", "Wrong approach")
        tracker.record_iteration("Second attempt", "FAIL", "Still wrong")

        path, _ = create_task_file(tracker=tracker, verification_command="npm test")
        content = path.read_text()
        assert "First attempt" in content
        assert "Second attempt" in content


class TestRenderTaskFile:
    def test_renders_all_sections(self, patch_workspace):
        from task_protocol import TaskFile, TaskMetadata, render_task_file

        metadata = TaskMetadata(
            id="task-abc123",
            created="2024-01-01T00:00:00",
            original_request="Fix the bug",
            verification_command="npm test",
        )
        task = TaskFile(
            metadata=metadata,
            session_story="Previous attempts failed.",
            diff_summary="```diff\nsrc/auth.ts\n```",
            current_state="Files modified: src/auth.ts",
            last_failure="Error on line 42",
            what_to_try="Try a different approach",
            instructions="Edit files to fix the bug.",
        )
        rendered = render_task_file(task)
        assert "## Original Goal" in rendered
        assert "## Session Story" in rendered
        assert "## Git-Style Change Summary" in rendered
        assert "## Current State" in rendered
        assert "## Last Failure" in rendered
        assert "## What To Try Next" in rendered
        assert "## Instructions" in rendered

    def test_omits_empty_diff_summary(self, patch_workspace):
        from task_protocol import TaskFile, TaskMetadata, render_task_file

        metadata = TaskMetadata(
            id="task-nodiff",
            created="2024-01-01T00:00:00",
            original_request="New task",
            verification_command="npm test",
        )
        task = TaskFile(
            metadata=metadata,
            session_story="Starting fresh.",
            diff_summary="No file changes recorded.",
            current_state="No files modified yet.",
            last_failure="No previous failure.",
            what_to_try="Start investigating.",
            instructions="Go.",
        )
        rendered = render_task_file(task)
        assert "## Git-Style Change Summary" not in rendered


class TestParseTaskFile:
    def test_parses_minimal_task(self):
        from task_protocol import parse_task_file

        content = (
            "---\n"
            "id: task-min\n"
            "created: '2024-01-01'\n"
            "original_request: Fix it\n"
            "verification_command: npm test\n"
            "---\n\n"
            "## Original Goal\n\nFix it\n\n"
            "## Instructions\n\nDo the thing\n"
        )
        parsed = parse_task_file(content)
        assert parsed is not None
        assert parsed.metadata.id == "task-min"
        assert parsed.metadata.verification_command == "npm test"

    def test_returns_none_for_no_frontmatter(self):
        from task_protocol import parse_task_file

        content = "Just plain text, no YAML frontmatter"
        assert parse_task_file(content) is None

    def test_returns_none_for_invalid_yaml(self):
        from task_protocol import parse_task_file

        content = "---\n: invalid: yaml: [unclosed\n---\n"
        assert parse_task_file(content) is None


class TestResultFile:
    def test_create_result_file(self, patch_workspace):
        from session_tracker import SessionTracker
        from task_protocol import create_result_file, create_task_file, parse_result_file

        tracker = SessionTracker("result-test")
        tracker.set_goal("Test", "echo test")

        path, task_file = create_task_file(
            tracker=tracker,
            verification_command="echo test",
        )

        result_path = create_result_file(
            task_id=task_file.metadata.id,
            status="PASS",
            summary="Fixed the issue",
            changes_made=["Modified src/auth.ts", "Added test"],
            verification_output="All tests passed",
            lesson_learned="Always check imports first",
        )

        assert result_path.exists()
        content = result_path.read_text()
        parsed = parse_result_file(content)
        assert parsed is not None
        assert parsed.metadata.status == "PASS"
        assert parsed.summary == "Fixed the issue"
        assert len(parsed.changes_made) == 2
        assert "Always check imports first" in parsed.lesson_learned

    def test_result_file_fail_status(self, patch_workspace):
        from session_tracker import SessionTracker
        from task_protocol import create_result_file, create_task_file, parse_result_file

        tracker = SessionTracker("fail-result-test")
        tracker.set_goal("Test", "echo test")

        _, task_file = create_task_file(
            tracker=tracker,
            verification_command="echo test",
        )

        result_path = create_result_file(
            task_id=task_file.metadata.id,
            status="FAIL",
            summary="Could not fix within iterations",
        )

        content = result_path.read_text()
        parsed = parse_result_file(content)
        assert parsed.metadata.status == "FAIL"


class TestGenerateTaskId:
    def test_unique_ids(self):
        from task_protocol import generate_task_id

        ids = {generate_task_id() for _ in range(100)}
        assert len(ids) == 100  # All unique

    def test_id_format(self):
        from task_protocol import generate_task_id

        task_id = generate_task_id()
        assert task_id.startswith("task-")
        assert len(task_id) == 13  # "task-" + 8 hex chars
