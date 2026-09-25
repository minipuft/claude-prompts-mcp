"""
Every tool hook that keys state by `session_id` answers "is this a subagent?" first.

A subagent's tool hooks arrive under its PARENT's `session_id`
(`session_state.is_subagent_payload`), so a PreToolUse/PostToolUse hook that loads,
saves or clears state by that id acts on the parent's chain unless it exits on a
subagent payload first (R31, #397). The hooks fixed there were found by hand; this
test is the enumeration, so a new session-keyed hook fails here by name instead of
reopening the class silently.

Predicate, per script registered under PreToolUse/PostToolUse in `hooks.json`:
the script reads `session_id` from its input AND calls a session-keyed function
-> `is_subagent_payload(` is called, in the same function, on an earlier line than
the first session-keyed call. "Session-keyed" is derived, not listed: every
`hooks/lib` function with a `session_id` parameter, plus every function in the
script itself that calls one (to a fixpoint).
"""

import ast
import json
import re
import shutil
from pathlib import Path

HOOKS_DIR = Path(__file__).parent.parent
HOOKS_JSON = HOOKS_DIR / "hooks.json"
LIB_DIR = HOOKS_DIR / "lib"
TOOL_EVENTS = ("PreToolUse", "PostToolUse")
GUARD = "is_subagent_payload"

# Script name -> stamped reason. An entry whose script now passes, or is no longer
# registered, fails `test_every_exemption_is_still_needed`: delete it then.
EXEMPT = {
    "ralph-context-tracker.py": (
        "records a worker's Edit/Write/Bash into the PARENT's active Ralph tracker, possibly by "
        "design (as of 2026-09-25 · flips when the owner rules P6.65 and the hook follows it)"
    ),
}

_SCRIPT = re.compile(r"hooks/([\w.-]+\.py)")


def registered_tool_hook_scripts(hooks_json: Path) -> list[Path]:
    """Every script a PreToolUse/PostToolUse command runs, resolved beside `hooks.json`."""
    config = json.loads(hooks_json.read_text(encoding="utf-8"))
    scripts = []
    for event in TOOL_EVENTS:
        for matcher in config["hooks"].get(event, []):
            for hook in matcher["hooks"]:
                found = _SCRIPT.findall(hook["command"])
                assert found, f"{event} command names no hooks/*.py script: {hook['command']}"
                script = hooks_json.parent / found[-1]
                assert script.is_file(), f"{event} command runs a missing script: {script}"
                scripts.append(script)
    return scripts


def _param_names(fn: ast.FunctionDef) -> set[str]:
    args = fn.args
    return {a.arg for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]}


def _called_name(call: ast.Call) -> str | None:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _calls(node: ast.AST) -> list[ast.Call]:
    return [n for n in ast.walk(node) if isinstance(n, ast.Call)]


def lib_session_keyed_functions(lib_dir: Path = LIB_DIR) -> set[str]:
    """Every `hooks/lib` function that takes a `session_id` (constructors excluded: `__init__` is no call name)."""
    keyed = set()
    for module in lib_dir.glob("*.py"):
        for node in ast.walk(ast.parse(module.read_text(encoding="utf-8"))):
            is_dunder = isinstance(node, ast.FunctionDef) and node.name.startswith("__")
            if isinstance(node, ast.FunctionDef) and not is_dunder and "session_id" in _param_names(node):
                keyed.add(node.name)
    return keyed


def _reads_session_id(node: ast.AST) -> bool:
    for n in ast.walk(node):
        if isinstance(n, ast.Call) and _called_name(n) == "get" and n.args:
            key = n.args[0]
            if isinstance(key, ast.Constant) and key.value == "session_id":
                return True
        if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant) and n.slice.value == "session_id":
            return True
    return False


def unguarded_reason(script: Path, lib_keyed: set[str]) -> str | None:
    """None when the script passes the predicate; otherwise why it fails."""
    tree = ast.parse(script.read_text(encoding="utf-8"))
    functions = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]

    keyed = set(lib_keyed)
    grew = True
    while grew:
        grew = False
        for fn in functions:
            if fn.name not in keyed and any(_called_name(c) in keyed for c in _calls(fn)):
                keyed.add(fn.name)
                grew = True

    for fn in functions:
        if not _reads_session_id(fn):
            continue
        keyed_lines = [c.lineno for c in _calls(fn) if _called_name(c) in keyed]
        if not keyed_lines:
            continue
        first_keyed = min(keyed_lines)
        guard_lines = [c.lineno for c in _calls(fn) if _called_name(c) == GUARD]
        if not guard_lines or min(guard_lines) > first_keyed:
            return (
                f"{script.name}: {fn.name}() reads session_id and makes a session-keyed call at line "
                f"{first_keyed} with no {GUARD}() before it"
            )
    return None


def enumerate_verdicts(hooks_json: Path) -> dict[str, str | None]:
    lib_keyed = lib_session_keyed_functions()
    return {s.name: unguarded_reason(s, lib_keyed) for s in registered_tool_hook_scripts(hooks_json)}


def unexempted_failures(hooks_json: Path) -> list[str]:
    return [reason for name, reason in enumerate_verdicts(hooks_json).items() if reason and name not in EXEMPT]


def test_the_derived_keyed_set_covers_the_calls_the_hooks_make():
    """Positive control on the derivation: the calls R31's fixes guard are in it."""
    keyed = lib_session_keyed_functions()
    for name in ("load_session_state", "save_session_state", "clear_session_state", "load_verify_active_state"):
        assert name in keyed, f"{name} fell out of the derived session-keyed set: {sorted(keyed)}"


def test_every_session_keyed_tool_hook_checks_for_a_subagent_first():
    verdicts = enumerate_verdicts(HOOKS_JSON)
    # The R31 hooks are enumerated AND pass: a registration change that drops one
    # from the scan is a failure here, not a silent shrink of the class.
    for name in ("post-prompt-engine.py", "gate-enforce.py", "delegation-enforce.py"):
        assert name in verdicts, f"{name} is no longer registered under {TOOL_EVENTS}: {sorted(verdicts)}"
    failures = unexempted_failures(HOOKS_JSON)
    assert not failures, "\n".join(failures)


def test_every_exemption_is_still_needed():
    verdicts = enumerate_verdicts(HOOKS_JSON)
    for name in EXEMPT:
        assert name in verdicts, f"exempt {name} is no longer a registered tool hook: delete its entry"
        assert verdicts[name], f"exempt {name} now passes the predicate: delete its entry"


def test_a_planted_unguarded_hook_is_reported_by_name(tmp_path):
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    shutil.copy(HOOKS_JSON, hooks / "hooks.json")
    for script in registered_tool_hook_scripts(HOOKS_JSON):
        shutil.copy(script, hooks / script.name)
    config = json.loads((hooks / "hooks.json").read_text(encoding="utf-8"))
    config["hooks"]["PostToolUse"].append(
        {
            "matcher": "Read",
            "hooks": [{"type": "command", "command": 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/planted-tracker.py"'}],
        }
    )
    (hooks / "hooks.json").write_text(json.dumps(config), encoding="utf-8")
    (hooks / "planted-tracker.py").write_text(
        "from session_state import save_session_state\n\n\n"
        "def main(hook_input):\n"
        '    session_id = hook_input.get("session_id", "")\n'
        '    save_session_state(session_id, {"chain_id": "x"})\n',
        encoding="utf-8",
    )

    assert unexempted_failures(hooks / "hooks.json") == [
        "planted-tracker.py: main() reads session_id and makes a session-keyed call at line 6 "
        f"with no {GUARD}() before it"
    ]
    # Twin differing only in the guard: the same script passes once it checks first.
    (hooks / "planted-tracker.py").write_text(
        "from session_state import is_subagent_payload, save_session_state\n\n\n"
        "def main(hook_input):\n"
        f"    if {GUARD}(hook_input):\n"
        "        return\n"
        '    session_id = hook_input.get("session_id", "")\n'
        '    save_session_state(session_id, {"chain_id": "x"})\n',
        encoding="utf-8",
    )
    assert enumerate_verdicts(hooks / "hooks.json")["planted-tracker.py"] is None
    assert unexempted_failures(hooks / "hooks.json") == []
