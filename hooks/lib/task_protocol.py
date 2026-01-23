"""
Task protocol for Ralph loop communication.

Defines the markdown format for task files that communicate between
the orchestrating Claude Code instance and spawned CLI instances.

Task files contain:
- YAML frontmatter with metadata
- Session story and context
- Instructions for the spawned instance
"""

import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

import yaml

from workspace import get_runtime_state_dir
from session_tracker import SessionTracker


@dataclass
class TaskMetadata:
    """Metadata for a Ralph task file."""
    id: str
    created: str
    original_request: str
    verification_command: str
    max_iterations: int = 5
    current_iteration: int = 1
    timeout_seconds: int = 300
    working_directory: str = ""
    max_budget_usd: float = 1.00


@dataclass
class TaskFile:
    """Complete task file for spawned CLI instance."""
    metadata: TaskMetadata
    session_story: str
    diff_summary: str
    current_state: str
    last_failure: str
    what_to_try: str
    instructions: str


@dataclass
class ResultMetadata:
    """Metadata for a task result file."""
    id: str
    completed: str
    status: Literal["PASS", "FAIL", "ERROR", "TIMEOUT"]
    iterations_used: int = 1


@dataclass
class ResultFile:
    """Result file from spawned CLI instance."""
    metadata: ResultMetadata
    summary: str
    changes_made: list[str] = field(default_factory=list)
    verification_output: str = ""
    lesson_learned: str = ""


def _get_tasks_dir() -> Path:
    """Get Ralph tasks directory."""
    dev_fallback = Path(__file__).parent.parent.parent / "server" / "runtime-state"
    runtime_dir = get_runtime_state_dir(dev_fallback)
    tasks_dir = runtime_dir / "ralph-tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    return tasks_dir


def generate_task_id() -> str:
    """Generate a unique task ID."""
    return f"task-{uuid.uuid4().hex[:8]}"


def create_task_file(
    tracker: SessionTracker,
    verification_command: str,
    last_failure_output: str = "",
    max_iterations: int = 5,
    timeout_seconds: int = 300,
    working_directory: str = "",
    max_budget_usd: float = 1.00
) -> tuple[Path, TaskFile]:
    """
    Create a task file from session tracker state.

    Returns the path to the task file and the TaskFile object.
    """
    task_id = generate_task_id()
    now = datetime.now().isoformat()

    # Build metadata
    metadata = TaskMetadata(
        id=task_id,
        created=now,
        original_request=tracker.state.get("original_goal", ""),
        verification_command=verification_command,
        max_iterations=max_iterations,
        current_iteration=tracker.get_iteration_count() + 1,
        timeout_seconds=timeout_seconds,
        working_directory=working_directory,
        max_budget_usd=max_budget_usd
    )

    # Generate sections from tracker
    session_story = tracker.generate_story()
    diff_summary = tracker.generate_diff_summary()
    what_to_try = tracker.generate_what_to_try()

    # Build current state section
    changed_files = list(tracker.state.get("file_changes", {}).keys())
    if changed_files:
        files_list = "\n".join(
            f"- `{f}` ({len(tracker.state['file_changes'][f])} changes)"
            for f in changed_files[:5]
        )
        current_state = f"Files to focus on:\n{files_list}"
    else:
        current_state = "No files modified yet."

    # Build last failure section
    if last_failure_output:
        iteration_num = tracker.get_iteration_count()
        last_failure = f"```\n{last_failure_output[:2000]}\n```"
    else:
        last_failure = "No previous failure recorded."

    # Build instructions - explicitly tell Claude it can edit files
    instructions = f"""You have full file editing capabilities. Use them to fix this issue.

1. Read the relevant source files to locate the bug
2. Edit the file(s) to fix the issue - you CAN and SHOULD edit files directly
3. Run `{verification_command}` to verify your fix works
4. If the test passes, you're done. If it fails, try again.

IMPORTANT: You must actually EDIT the files, not just describe the fix. Use your file editing tools."""

    task_file = TaskFile(
        metadata=metadata,
        session_story=session_story,
        diff_summary=diff_summary,
        current_state=current_state,
        last_failure=last_failure,
        what_to_try=what_to_try,
        instructions=instructions
    )

    # Write to file
    tasks_dir = _get_tasks_dir()
    file_path = tasks_dir / f"{task_id}.md"
    file_path.write_text(render_task_file(task_file))

    return file_path, task_file


def render_task_file(task: TaskFile) -> str:
    """Render a TaskFile to markdown string."""
    # Build YAML frontmatter
    frontmatter = {
        "id": task.metadata.id,
        "created": task.metadata.created,
        "original_request": task.metadata.original_request,
        "verification_command": task.metadata.verification_command,
        "max_iterations": task.metadata.max_iterations,
        "current_iteration": task.metadata.current_iteration,
        "timeout_seconds": task.metadata.timeout_seconds,
        "working_directory": task.metadata.working_directory,
    }

    sections = [
        f"---\n{yaml.dump(frontmatter, default_flow_style=False)}---",
        f"## Original Goal\n\n{task.metadata.original_request}",
        f"## Session Story\n\n{task.session_story}",
    ]

    # Only include diff summary if there are changes
    if task.diff_summary and "No file changes" not in task.diff_summary:
        sections.append(f"## Git-Style Change Summary\n\n{task.diff_summary}")

    sections.extend([
        f"## Current State\n\n{task.current_state}",
        f"## Last Failure (Iteration {task.metadata.current_iteration - 1})\n\n{task.last_failure}",
        f"## What To Try Next\n\n{task.what_to_try}",
        f"## Instructions\n\n{task.instructions}"
    ])

    return "\n\n".join(sections)


def parse_task_file(content: str) -> TaskFile | None:
    """Parse a task file from markdown string."""
    # Extract frontmatter
    frontmatter_match = re.match(r"^---\n(.+?)\n---", content, re.DOTALL)
    if not frontmatter_match:
        return None

    try:
        frontmatter = yaml.safe_load(frontmatter_match.group(1))
    except yaml.YAMLError:
        return None

    metadata = TaskMetadata(
        id=frontmatter.get("id", ""),
        created=frontmatter.get("created", ""),
        original_request=frontmatter.get("original_request", ""),
        verification_command=frontmatter.get("verification_command", ""),
        max_iterations=frontmatter.get("max_iterations", 5),
        current_iteration=frontmatter.get("current_iteration", 1),
        timeout_seconds=frontmatter.get("timeout_seconds", 300),
        working_directory=frontmatter.get("working_directory", ""),
        max_budget_usd=frontmatter.get("max_budget_usd", 1.00)
    )

    # Extract sections (simplified parsing)
    body = content[frontmatter_match.end():]

    def extract_section(name: str) -> str:
        pattern = rf"## {name}\n\n(.+?)(?=\n## |\Z)"
        match = re.search(pattern, body, re.DOTALL)
        return match.group(1).strip() if match else ""

    return TaskFile(
        metadata=metadata,
        session_story=extract_section("Session Story"),
        diff_summary=extract_section("Git-Style Change Summary"),
        current_state=extract_section("Current State"),
        last_failure=extract_section(r"Last Failure \(Iteration \d+\)") or extract_section("Last Failure"),
        what_to_try=extract_section("What To Try Next"),
        instructions=extract_section("Instructions")
    )


def create_result_file(
    task_id: str,
    status: Literal["PASS", "FAIL", "ERROR", "TIMEOUT"],
    summary: str,
    changes_made: list[str] | None = None,
    verification_output: str = "",
    lesson_learned: str = "",
    iterations_used: int = 1
) -> Path:
    """Create a result file for a completed task."""
    now = datetime.now().isoformat()

    metadata = ResultMetadata(
        id=task_id,
        completed=now,
        status=status,
        iterations_used=iterations_used
    )

    result = ResultFile(
        metadata=metadata,
        summary=summary,
        changes_made=changes_made or [],
        verification_output=verification_output,
        lesson_learned=lesson_learned
    )

    tasks_dir = _get_tasks_dir()
    result_path = tasks_dir / f"{task_id}-result.md"
    result_path.write_text(render_result_file(result))

    return result_path


def render_result_file(result: ResultFile) -> str:
    """Render a ResultFile to markdown string."""
    frontmatter = {
        "id": result.metadata.id,
        "completed": result.metadata.completed,
        "status": result.metadata.status,
        "iterations_used": result.metadata.iterations_used,
    }

    sections = [
        f"---\n{yaml.dump(frontmatter, default_flow_style=False)}---",
        f"## Summary\n\n{result.summary}",
    ]

    if result.changes_made:
        changes_list = "\n".join(f"- {c}" for c in result.changes_made)
        sections.append(f"## Changes Made\n\n{changes_list}")

    if result.verification_output:
        sections.append(f"## Verification Output\n\n```\n{result.verification_output}\n```")

    if result.lesson_learned:
        sections.append(f"## Lesson Learned\n\n{result.lesson_learned}")

    return "\n\n".join(sections)


def parse_result_file(content: str) -> ResultFile | None:
    """Parse a result file from markdown string."""
    # Extract frontmatter
    frontmatter_match = re.match(r"^---\n(.+?)\n---", content, re.DOTALL)
    if not frontmatter_match:
        return None

    try:
        frontmatter = yaml.safe_load(frontmatter_match.group(1))
    except yaml.YAMLError:
        return None

    metadata = ResultMetadata(
        id=frontmatter.get("id", ""),
        completed=frontmatter.get("completed", ""),
        status=frontmatter.get("status", "ERROR"),
        iterations_used=frontmatter.get("iterations_used", 1)
    )

    body = content[frontmatter_match.end():]

    def extract_section(name: str) -> str:
        pattern = rf"## {name}\n\n(.+?)(?=\n## |\Z)"
        match = re.search(pattern, body, re.DOTALL)
        return match.group(1).strip() if match else ""

    # Parse changes_made as list
    changes_section = extract_section("Changes Made")
    changes_made = []
    if changes_section:
        for line in changes_section.split("\n"):
            line = line.strip()
            if line.startswith("- "):
                changes_made.append(line[2:])

    # Extract verification output from code block
    verification_output = extract_section("Verification Output")
    if verification_output.startswith("```"):
        verification_output = verification_output.strip("`").strip()

    return ResultFile(
        metadata=metadata,
        summary=extract_section("Summary"),
        changes_made=changes_made,
        verification_output=verification_output,
        lesson_learned=extract_section("Lesson Learned")
    )


def get_pending_tasks() -> list[Path]:
    """Get list of pending (unprocessed) task files."""
    tasks_dir = _get_tasks_dir()
    task_files = list(tasks_dir.glob("task-*.md"))

    # Filter out those that have result files
    pending = []
    for tf in task_files:
        result_file = tf.parent / f"{tf.stem}-result.md"
        if not result_file.exists():
            pending.append(tf)

    return sorted(pending, key=lambda p: p.stat().st_mtime)


def cleanup_old_tasks(max_age_hours: int = 24) -> int:
    """Remove task files older than max_age_hours."""
    tasks_dir = _get_tasks_dir()
    now = datetime.now()
    removed = 0

    for f in tasks_dir.glob("task-*.md"):
        age = now.timestamp() - f.stat().st_mtime
        if age > max_age_hours * 3600:
            f.unlink()
            removed += 1

            # Also remove corresponding result file
            result_file = f.parent / f"{f.stem}-result.md"
            if result_file.exists():
                result_file.unlink()
                removed += 1

    return removed
