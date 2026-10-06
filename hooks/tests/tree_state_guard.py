"""
Fails the hook pytest run when a suite leaves anything behind in the WORKING TREE.

Ports `server/tests/helpers/tree-state-guard.cjs` to pytest — read that file's docstring first,
this is the same argument applied to a second suite that has no analog of it.

WHY THIS GATE EXISTS
`npm run validate:python` runs `python3 -m pytest hooks/tests` with no comparable check, and the
hook tests have exactly the shape the Jest guard was built for: `workspace.get_workspace_root()`
falls back to self-resolution when no `MCP_WORKSPACE` / `CLAUDE_PLUGIN_ROOT` / `PLUGIN_ROOT` /
`GEMINI_EXTENSION_PATH` is set — which is the CI shape, and also the shape of any local run whose
shell has none of those exported. Self-resolution finds `<repo>/server` and returns the repo root
itself as the "workspace". `hook_state_store.get_hooks_state_db_path()` then unconditionally
`mkdir`s `{workspace}/server/runtime-state` before anything checks whether there is state to write
— so calling it even once, from a test that never patches the workspace, plants a directory in the
real checkout.

Measured 2026-09-19: `test_ralph_stop.py::TestMainDecisions::test_verification_pass_allows` and
`test_integration_ralph_delegation.py::TestEdgeCases::test_pass_on_first_try_clears_state` both
drive `ralph_stop.main()` to its `result["passed"] is True` branch, which opportunistically calls
the real (unpatched) `cleanup_stale_rows` / `cleanup_old_sessions` / `cleanup_old_ralph_sessions` —
each fully green, each leaving `server/runtime-state/` on disk. It is gitignored, so plain
`git status` never showed it; only `--ignored=matching` does. Both sites were fixed in the same
change (given the `patch_workspace` fixture already used by their siblings), but this gate is what
keeps a third site closed — not the two individual fixes.

WHY A DIFF, NOT AN EMPTINESS CHECK; WHY THE WHOLE TREE: identical reasoning to
tree-state-guard.cjs — a pre-existing untracked file must not fail every run, and an ignored path
is exactly where this class of leak hides.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

# hooks/tests/tree_state_guard.py -> hooks/tests -> hooks -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]

# `git status` env vars a git HOOK invocation sets (GIT_DIR, GIT_INDEX_FILE, and friends), which
# `subprocess.run` otherwise inherits. `validate:python` is itself invoked from
# `.husky/pre-commit`, so every pytest run this guard protects already runs inside one such
# invocation — measured 2026-09-19: GIT_DIR there is
# `<repo>/.git/worktrees/<this-worktree>` and GIT_INDEX_FILE its `index`, regardless of the `cwd`
# a subprocess is given. Left alone, `git status` (or `git init`/`git commit` against a SCRATCH
# repo — see TestSubstrateSeesAnIgnoredPath) reads and writes the REAL repository's index no
# matter what `cwd` names. Every git call in this module clears them so `cwd` is what actually
# selects the repository.
_GIT_ENV_LEAK_VARS = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CEILING_DIRECTORIES",
)


def clean_git_env() -> dict[str, str]:
    """The current environment with git's own hook-injected variables stripped.

    Exported (not `_`-prefixed) because any test that shells out to `git` against a path other
    than `REPO_ROOT` needs the same scrub — see `TestSubstrateSeesAnIgnoredPath` in
    `test_tree_state_guard.py`.
    """
    return {key: value for key, value in os.environ.items() if key not in _GIT_ENV_LEAK_VARS}


# Paths a hook test run may legitimately create, matched as a SUFFIX (not prefix, unlike the Jest
# guard's DECLARED): a bytecode cache nests one `__pycache__/` per package level an import touches,
# so a prefix list would need one entry per level touched. Suffix matching covers all of them with
# one declaration, still naming the one generator responsible.
DECLARED_SUFFIXES: list[tuple[str, str]] = [
    ("__pycache__/", "CPython bytecode cache created on import — gitignored, never committed"),
]

# Paths a run DOES create because of a defect that is not fixed yet, each keyed by prefix like the
# Jest guard's KNOWN_LEAKS. Empty: the one entry this file exists to report (`server/runtime-state/`)
# was fixed in the same change that added this gate — see the module docstring.
KNOWN_LEAKS: list[tuple[str, str]] = []


def entry_path(line: str) -> str:
    """The repo-relative path a porcelain v1 line refers to.

    Porcelain v1 is `XY <path>`, with a rename spelled `R  <old> -> <new>`; the destination is
    what a run created.
    """
    rest = line[3:]
    arrow = rest.find(" -> ")
    return rest[arrow + 4 :] if arrow != -1 else rest


def declared_reason(path: str) -> str | None:
    """The DECLARED_SUFFIXES reason covering `path`, or None."""
    for suffix, reason in DECLARED_SUFFIXES:
        if path.endswith(suffix):
            return reason
    return None


def known_leak_reason(path: str, known_leaks: list[tuple[str, str]]) -> str | None:
    """The KNOWN_LEAKS reason covering `path`, or None."""
    for prefix, reason in known_leaks:
        if path.startswith(prefix):
            return reason
    return None


def list_entries(cwd: Path = REPO_ROOT) -> list[str] | None:
    """Every working-tree entry git can see under `cwd`, ignored ones included.

    Returns `None` (never `[]`) when git cannot answer — an empty list from a failed command
    would make the after-diff empty too, reporting a clean run from a probe that never ran.
    """
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--ignored=matching", "--untracked-files=all"],
            cwd=cwd,
            env=clean_git_env(),
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return [line for line in result.stdout.split("\n") if line.strip()]


def classify(
    before: list[str] | None,
    after: list[str] | None,
    known_leaks: list[tuple[str, str]] | None = None,
) -> dict:
    """Split what appeared between two enumerations into declared / known-leak / undeclared.

    Pure, and separate from the subprocess call, so the verdict can be asserted over fabricated
    inputs. `unreadable` is its own outcome: a run whose before- or after-state could not be
    enumerated has not been SHOWN to be clean.
    """
    if known_leaks is None:
        known_leaks = KNOWN_LEAKS
    if before is None:
        return {"unreadable": "git could not enumerate the tree before the run", "leaked": []}
    if after is None:
        return {"unreadable": "git could not enumerate the tree after the run", "leaked": []}

    known = set(before)
    fresh = sorted(line for line in after if line not in known)

    leaked: list[str] = []
    declared: list[str] = []
    leaks: list[str] = []
    for line in fresh:
        path = entry_path(line)
        if declared_reason(path) is not None:
            declared.append(line)
        elif known_leak_reason(path, known_leaks) is not None:
            leaks.append(line)
        else:
            leaked.append(line)

    return {"unreadable": None, "leaked": leaked, "declared": declared, "known_leaks": leaks}
