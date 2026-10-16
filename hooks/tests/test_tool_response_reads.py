"""Every hook reads a PostToolUse `tool_response` through `read_tool_response`, and nothing else.

Claude Code sends an MCP result as a block list or as the JSON string of its structuredContent, and
never `isError`; a hook that reads `tool_response.get("content")`, `.get("isError")`,
`.get("structuredContent")` or `str(tool_response)` sees a shape the host does not send, so its
branch never runs. The gate walks the AST of every hook and library module, keyed on the
`tool_response` name or a `hook_input` lookup of it; an alias under another name is outside it.
"""

import ast
import importlib.util
import shutil
import sys
from pathlib import Path

HOOKS = Path(__file__).parent.parent
HELPER = ("session_state.py", "read_tool_response")
SHAPE_KEYS = {"content", "isError", "structuredContent"}


def _is_tool_response(node: ast.AST) -> bool:
    """`tool_response`, or `hook_input.get("tool_response"...)` / `hook_input["tool_response"]`."""
    if isinstance(node, ast.Name):
        return node.id == "tool_response"
    key = None
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args:
        key = node.args[0]
    elif isinstance(node, ast.Subscript):
        key = node.slice
    return isinstance(key, ast.Constant) and key.value == "tool_response"


def _direct_reads(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    skip: set[int] = set()
    for fn in ast.walk(tree):
        if (path.name, getattr(fn, "name", None)) == HELPER and isinstance(fn, ast.FunctionDef):
            skip |= set(range(fn.lineno, (fn.end_lineno or fn.lineno) + 1))
    found = []
    for node in ast.walk(tree):
        if getattr(node, "lineno", 0) in skip:
            continue
        shape_get = (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and _is_tool_response(node.func.value)
            and bool(node.args)
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value in SHAPE_KEYS
        )
        shape_index = (
            isinstance(node, ast.Subscript)
            and _is_tool_response(node.value)
            and isinstance(node.slice, ast.Constant)
            and node.slice.value in SHAPE_KEYS
        )
        stringified = (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "str"
            and any(_is_tool_response(arg) for arg in node.args)
        )
        if shape_get or shape_index or stringified:
            found.append(f"{path.name}:{node.lineno}")
    return found


def _hook_modules(root: Path) -> list[Path]:
    return sorted([*root.glob("*.py"), *(root / "lib").glob("*.py")])


def test_no_hook_reads_tool_response_outside_the_helper():
    modules = _hook_modules(HOOKS)
    assert any(path.name == "post-prompt-engine.py" for path in modules)
    assert [read for path in modules for read in _direct_reads(path)] == []


def test_the_gate_catches_a_planted_direct_read(tmp_path):
    """Positive control: each forbidden shape planted in a copy of a real hook is reported."""
    (tmp_path / "lib").mkdir()
    shutil.copy(HOOKS / "lib" / "session_state.py", tmp_path / "lib" / "session_state.py")
    source = (HOOKS / "ralph-context-tracker.py").read_text(encoding="utf-8")
    anchor = "    tool_input = hook_input.get"
    assert source.count(anchor) == 1
    plants = [
        'tool_response.get("content", "")',
        'tool_response.get("isError")',
        'hook_input.get("tool_response", {}).get("structuredContent")',
        "str(tool_response)",
        'tool_response["content"]',
    ]
    for plant in plants:
        planted = tmp_path / "ralph-context-tracker.py"
        planted.write_text(source.replace(anchor, f"    _probe = {plant}\n{anchor}"), encoding="utf-8")
        assert [read.split(":")[0] for read in _direct_reads(planted)] == ["ralph-context-tracker.py"], plant
    planted.write_text(source, encoding="utf-8")
    assert [read for path in _hook_modules(tmp_path) for read in _direct_reads(path)] == []


def test_ralph_context_tracker_reads_the_bash_dict(tmp_path, monkeypatch):
    """Claude Code's Bash result is `{stdout, stderr, ...}` with no `content`; its text is both streams."""
    monkeypatch.setenv("MCP_WORKSPACE", str(tmp_path))
    sys.path.insert(0, str(HOOKS / "lib"))
    try:
        spec = importlib.util.spec_from_file_location("ralph_context_tracker", HOOKS / "ralph-context-tracker.py")
        assert spec is not None and spec.loader is not None
        tracker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tracker)
        bash = {"stdout": "1 passed", "stderr": "Error: expected 2", "interrupted": False, "isImage": False}
        text, structured, is_error = tracker.read_tool_response(bash)
        assert (text, structured, is_error) == ("1 passed\nError: expected 2", None, None)
        details = tracker.extract_bash_details({"command": "npm test"}, text)
        assert details["is_verification"] and "expected 2" in details["output_summary"]
    finally:
        sys.path.remove(str(HOOKS / "lib"))
