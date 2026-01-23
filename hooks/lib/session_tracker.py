"""
Session tracker for Ralph loops - tracks debugging journey across iterations.

Captures:
- Session story (what was tried, what failed, what was learned)
- Git-style file change summary
- Context for spawned CLI instances

Uses workspace resolution from workspace.py.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import TypedDict

from workspace import get_runtime_state_dir


class IterationRecord(TypedDict):
    """Record of a single verification iteration."""
    number: int
    approach: str  # "Tried URL-encoding the password"
    result: str    # "FAIL - broke existing tests"
    lesson: str    # "Encoding must happen after validation"
    timestamp: str
    files_changed: list[str]


class FileChange(TypedDict):
    """Record of a file change."""
    type: str       # "add", "remove", "modify"
    details: str    # "line 23: const encoded = ..."
    iteration: int


class RalphSessionState(TypedDict):
    """Complete state for a Ralph verification session."""
    session_id: str
    original_goal: str
    verification_command: str
    working_directory: str
    iterations: list[IterationRecord]
    file_changes: dict[str, list[FileChange]]
    created_at: str
    updated_at: str


def _get_ralph_sessions_dir() -> Path:
    """Get Ralph sessions directory using workspace resolution."""
    dev_fallback = Path(__file__).parent.parent.parent / "server" / "runtime-state"
    runtime_dir = get_runtime_state_dir(dev_fallback)
    return runtime_dir / "ralph-sessions"


class SessionTracker:
    """Tracks debugging session progress for Ralph loop context."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.sessions_dir = _get_ralph_sessions_dir()
        self.state_file = self.sessions_dir / f"{session_id}.json"
        self.state = self._load_or_create()

    def _load_or_create(self) -> RalphSessionState:
        """Load existing state or create new."""
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

        if self.state_file.exists():
            try:
                with open(self.state_file) as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass

        # Create new state
        return {
            "session_id": self.session_id,
            "original_goal": "",
            "verification_command": "",
            "working_directory": "",
            "iterations": [],
            "file_changes": {},
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

    def _save(self) -> None:
        """Persist state to disk."""
        self.state["updated_at"] = datetime.now().isoformat()
        try:
            with open(self.state_file, "w") as f:
                json.dump(self.state, f, indent=2)
        except IOError:
            pass

    def set_goal(self, goal: str, verification_command: str, working_directory: str = "") -> None:
        """Set the original goal for this session."""
        self.state["original_goal"] = goal
        self.state["verification_command"] = verification_command
        self.state["working_directory"] = working_directory
        self._save()

    def record_iteration(
        self,
        approach: str,
        result: str,
        lesson: str,
        files_changed: list[str] | None = None
    ) -> None:
        """Record what was tried and what was learned."""
        iteration_num = len(self.state["iterations"]) + 1
        self.state["iterations"].append({
            "number": iteration_num,
            "approach": approach,
            "result": result,
            "lesson": lesson,
            "timestamp": datetime.now().isoformat(),
            "files_changed": files_changed or []
        })
        self._save()

    def record_file_change(
        self,
        file_path: str,
        change_type: str,
        details: str
    ) -> None:
        """Track git-style changes made during session."""
        if file_path not in self.state["file_changes"]:
            self.state["file_changes"][file_path] = []

        current_iteration = len(self.state["iterations"]) + 1
        self.state["file_changes"][file_path].append({
            "type": change_type,
            "details": details,
            "iteration": current_iteration
        })
        self._save()

    def get_iteration_count(self) -> int:
        """Get current iteration count."""
        return len(self.state["iterations"])

    def generate_story(self) -> str:
        """Generate narrative 'session story' for spawned instance."""
        if not self.state["iterations"]:
            return "No iterations recorded yet."

        story_parts = [
            f"This task started with: {self.state['original_goal']}\n",
            "Here's what's been tried:\n"
        ]

        for it in self.state["iterations"]:
            story_parts.append(
                f"{it['number']}. **Iteration {it['number']}**: {it['approach']}\n"
                f"   - Result: {it['result']}\n"
                f"   - Lesson: {it['lesson']}"
            )
            if it.get("files_changed"):
                story_parts.append(f"   - Files: {', '.join(it['files_changed'])}")

        return "\n\n".join(story_parts)

    def generate_diff_summary(self) -> str:
        """Generate git-style diff summary of all changes."""
        if not self.state["file_changes"]:
            return "No file changes recorded."

        lines = ["```diff", "# Files modified this session:"]

        for file_path, changes in self.state["file_changes"].items():
            lines.append(file_path)
            for change in changes:
                prefix = {"add": "+", "remove": "-", "modify": "~"}.get(change["type"], "?")
                lines.append(f"  {prefix} {change['details']}")

        lines.append("```")
        return "\n".join(lines)

    def generate_what_to_try(self) -> str:
        """Generate suggestion for next iteration based on lessons learned."""
        # Extract directory hint from verification command
        cmd = self.state.get("verification_command", "")
        dir_hint = ""
        if cmd:
            import re
            # Look for file paths in the command
            paths = re.findall(r'(/[^\s]+)', cmd)
            if paths:
                from pathlib import Path
                test_path = Path(paths[0])
                if test_path.parent.exists():
                    dir_hint = f"\n- Look in `{test_path.parent}/` for source files to fix"

        if not self.state["iterations"]:
            return f"Start by reading files in the test directory to find the bug.{dir_hint}"

        last_iteration = self.state["iterations"][-1]
        lessons = [it["lesson"] for it in self.state["iterations"]]

        # Build suggestion based on accumulated lessons
        suggestion_parts = [
            f"Based on the session story ({len(self.state['iterations'])} iterations so far):\n"
        ]

        if len(lessons) >= 2:
            suggestion_parts.append(
                f"- Previous approaches have revealed: {'; '.join(lessons[-3:])}\n"
            )

        suggestion_parts.append(
            f"- The last failure was: {last_iteration['result']}\n"
            f"- Consider: What pattern connects these failures?{dir_hint}"
        )

        return "".join(suggestion_parts)

    def generate_task_context(self, last_failure_output: str = "") -> str:
        """Generate complete task context for spawned CLI instance."""
        sections = []

        # Original Goal
        sections.append(f"## Original Goal\n\n{self.state['original_goal']}")

        # Session Story
        sections.append(f"## Session Story\n\n{self.generate_story()}")

        # Git-Style Change Summary
        if self.state["file_changes"]:
            sections.append(f"## Git-Style Change Summary\n\n{self.generate_diff_summary()}")

        # Current State
        changed_files = list(self.state["file_changes"].keys())
        if changed_files:
            files_list = "\n".join(f"- `{f}` ({len(self.state['file_changes'][f])} changes)"
                                   for f in changed_files[:5])
            sections.append(f"## Current State\n\nFiles to focus on:\n{files_list}")

        # Last Failure
        if last_failure_output:
            iteration_num = len(self.state["iterations"])
            sections.append(
                f"## Last Failure (Iteration {iteration_num})\n\n"
                f"```\n{last_failure_output[:2000]}\n```"
            )

        # What To Try Next
        sections.append(f"## What To Try Next\n\n{self.generate_what_to_try()}")

        # Instructions
        cmd = self.state["verification_command"]
        sections.append(
            "## Instructions\n\n"
            "1. Review the session story to understand what's been tried\n"
            "2. Focus on patterns in the failures\n"
            "3. Make minimal changes to fix the issue\n"
            f"4. Run `{cmd}` to verify\n"
            "5. Report: PASS or FAIL with a brief summary of what you changed"
        )

        return "\n\n".join(sections)

    def clear(self) -> None:
        """Clear session state (call on successful verification)."""
        if self.state_file.exists():
            self.state_file.unlink()


def get_session_tracker(session_id: str) -> SessionTracker:
    """Factory function to get a session tracker."""
    return SessionTracker(session_id)


def clear_ralph_session(session_id: str) -> None:
    """Clear a Ralph session by ID."""
    tracker = SessionTracker(session_id)
    tracker.clear()
