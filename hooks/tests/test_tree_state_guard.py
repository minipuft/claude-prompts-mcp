"""
The tree-state guard reports what a run left behind, and can be shown to do so.

Mirrors `server/tests/unit/scripts/tree-state-guard.test.ts` — read that file's docstring for why
the guard's own verdict has to be exercised from outside the fixture that runs it (a
session-scoped autouse fixture cannot assert on itself: a teardown that stopped detecting
anything would report every run clean).

NOTHING HERE TOUCHES THE REAL TREE. The verdict is driven over fabricated status lines, and the
substrate is driven against a scratch repository — planting a file in the real one to prove the
guard notices is the exact act the guard exists to prevent (that proof lives in the mutation drive
recorded in the row's handoff, run once by hand, never as a committed test).

THE SUBSTRATE TEST CLEARS GIT'S HOOK ENV VARS. `npm run validate:python` runs from
`.husky/pre-commit`, so this file's own pytest run already executes inside a git hook — GIT_DIR
and GIT_INDEX_FILE are set in the environment and point at the REAL repository regardless of the
`cwd` a subprocess is given. A `git init`/`git commit` against a scratch directory without
stripping them does not touch the scratch directory at all: it reads and writes the real
repository's index using paths resolved against the scratch `cwd`, which is how this test's first
draft (2026-09-19) committed a bogus "seed" commit onto the real worktree branch and clobbered its
committed `.gitignore`, caught only because `git log` looked wrong afterward. `tree_state_guard.
clean_git_env()` is the fix, reused here rather than re-derived.
"""

from __future__ import annotations

import subprocess
import sys
import typing
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from tree_state_guard import (
    DECLARED_SUFFIXES,
    classify,
    clean_git_env,
    declared_reason,
    entry_path,
    list_entries,
)

BASE = ["!! node_modules", " M server/src/index.ts"]


class TestVerdict:
    def test_reports_a_gitignored_directory_a_run_created(self):
        verdict = classify(BASE, [*BASE, "!! runtime-state/"])
        assert verdict["unreadable"] is None
        assert verdict["leaked"] == ["!! runtime-state/"]

    def test_reports_an_untracked_file_a_run_created(self):
        verdict = classify(BASE, [*BASE, "?? server/resources/prompts/leaked/prompt.yaml"])
        assert verdict["leaked"] == ["?? server/resources/prompts/leaked/prompt.yaml"]

    def test_reports_a_tracked_file_a_run_modified(self):
        # A suite that rewrites a committed fixture is the same class of defect as one that adds
        # a file, and a guard watching only additions would call that run clean.
        verdict = classify(BASE, [*BASE, " M server/resources/gates/code-quality/gate.yaml"])
        assert verdict["leaked"] == [" M server/resources/gates/code-quality/gate.yaml"]

    def test_reports_nothing_when_the_run_changed_nothing(self):
        """The negative control — every assertion above is also satisfied by a guard that calls
        everything a leak, which would be turned off within a week."""
        verdict = classify(BASE, [*BASE])
        assert verdict["leaked"] == []
        assert verdict["unreadable"] is None

    def test_does_not_report_a_path_that_preexisted_the_run(self):
        with_residue = [*BASE, "!! logs/"]
        assert classify(with_residue, with_residue)["leaked"] == []

    def test_routes_a_declared_path_to_declared_not_leaked(self):
        verdict = classify(BASE, [*BASE, "!! hooks/lib/__pycache__/"])
        assert verdict["leaked"] == []
        assert verdict["declared"] == ["!! hooks/lib/__pycache__/"]

    @pytest.mark.parametrize(
        ("before", "after"),
        [
            (None, ["!! logs/"]),
            ([], None),
        ],
    )
    def test_refuses_to_call_a_run_clean_when_git_could_not_enumerate(self, before, after):
        """A guard that answers "clean" from an enumeration that failed is worse than no guard:
        it converts an unmeasured run into a green one."""
        verdict = classify(before, after)
        assert verdict["unreadable"] is not None
        assert verdict["leaked"] == []


class TestKnownLeak:
    BASE: typing.ClassVar = ["!! node_modules"]
    # Fabricated: KNOWN_LEAKS is empty (this guard's one motivating leak was fixed in the same
    # change that added it), and the mechanism must still route a declared leak correctly the
    # next time one is needed.
    FAKE_LEAK: typing.ClassVar = ("hooks/leaky-dir/", "fabricated for this test")

    def test_is_reported_apart_from_both_leaked_and_declared(self):
        verdict = classify(self.BASE, [*self.BASE, "!! hooks/leaky-dir/"], [self.FAKE_LEAK])
        assert verdict["leaked"] == []
        assert verdict["declared"] == []
        assert verdict["known_leaks"] == ["!! hooks/leaky-dir/"]

    def test_does_not_shelter_a_sibling_path_that_merely_shares_a_prefix_word(self):
        verdict = classify(self.BASE, [*self.BASE, "!! leaky-dir/"], [self.FAKE_LEAK])
        assert verdict["leaked"] == ["!! leaky-dir/"]

    def test_reports_server_runtime_state_as_a_leak_since_nothing_excuses_it(self):
        """Regression pin for the leak this guard was built to catch (2026-09-19):
        `hook_state_store.get_hooks_state_db_path()` unconditionally `mkdir`s
        `server/runtime-state` when a hook test reaches the workspace self-resolution fallback.
        KNOWN_LEAKS is empty, so this is a plain failure rather than a reported-and-excused one."""
        verdict = classify(self.BASE, [*self.BASE, "!! server/runtime-state/"])
        assert verdict["leaked"] == ["!! server/runtime-state/"]
        assert verdict["known_leaks"] == []


class TestPorcelainPathParser:
    @pytest.mark.parametrize(
        ("line", "expected"),
        [
            (" M server/src/index.ts", "server/src/index.ts"),
            ("?? server/tests/new.test.ts", "server/tests/new.test.ts"),
            ("!! runtime-state/", "runtime-state/"),
            # A rename's DESTINATION is what the run created; the source is what it removed.
            ("R  docs/old.md -> docs/new.md", "docs/new.md"),
        ],
    )
    def test_reads_line_as_expected(self, line, expected):
        assert entry_path(line) == expected


class TestEveryDeclaredEntry:
    def test_names_a_generator_as_its_reason(self):
        assert len(DECLARED_SUFFIXES) > 0
        for suffix, reason in DECLARED_SUFFIXES:
            assert len(suffix) > 0
            # A reason short enough to be "generated" is not a reason — it has to name what
            # writes there.
            assert len(reason) > 20

    def test_matches_by_path_suffix(self):
        assert declared_reason("hooks/lib/__pycache__/") is not None
        assert declared_reason("runtime-state/state.db") is None


class TestSubstrateSeesAnIgnoredPath:
    """The substrate, against a scratch repository.

    `git status` without `--ignored` is silent about exactly the paths this gate was blind to, so
    the flags are load-bearing rather than incidental.
    """

    @staticmethod
    def _git(repo: Path, *args: str) -> None:
        # clean_git_env(): see the module docstring — this pytest run is itself inside a git
        # hook, and an unscrubbed GIT_DIR/GIT_INDEX_FILE would make every one of these calls
        # operate on the REAL repository regardless of `cwd=repo`.
        subprocess.run(["git", *args], cwd=repo, env=clean_git_env(), check=True, capture_output=True)

    def test_reports_a_file_under_an_ignored_directory(self, tmp_path):
        repo = tmp_path / "substrate"
        repo.mkdir()

        self._git(repo, "init", "--quiet")
        self._git(repo, "config", "user.email", "test@example.com")
        self._git(repo, "config", "user.name", "test")
        (repo / ".gitignore").write_text("runtime-state/\n")
        self._git(repo, "add", ".gitignore")
        self._git(repo, "commit", "--quiet", "-m", "seed")

        before = list_entries(repo)
        assert before == []

        (repo / "runtime-state").mkdir()
        (repo / "runtime-state" / "state.db").write_text("x")

        after = list_entries(repo)
        assert after is not None
        assert any(line.startswith("!!") and "runtime-state" in line for line in after)
        assert len(classify(before, after)["leaked"]) == 1

    def test_returns_none_rather_than_an_empty_list_when_not_a_repository(self, tmp_path):
        not_a_repo = tmp_path / "not-a-repo"
        not_a_repo.mkdir()
        # Depends on git refusing a non-repository; if it ever stopped refusing, `classify` would
        # read the empty result as "nothing leaked", which is the silent pass this asserts
        # against.
        assert list_entries(not_a_repo) is None
