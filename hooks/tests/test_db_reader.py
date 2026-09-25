"""
Tests for hooks/lib/db_reader.py — the Python half of a cross-language contract.

WHY THIS FILE EXISTS
--------------------
`db_reader.py` reads `state.db`, whose schema is declared in TypeScript
(`server/src/infra/database/sqlite-engine.ts`). Nothing in the TypeScript build can observe these
reads, so a column rename lands green on the server side and silently degrades the hooks: every
query in `db_reader.py` catches `sqlite3.OperationalError` and returns `None`, which fail-open
callers read as "database unavailable" rather than "schema drifted". That failure has already
happened once — see the comment on `get_valid_frameworks_from_db`, which queried the pre-rename
resource type and returned zero rows for an unknown period.

So the fixture here does NOT mirror the schema by hand. `_extract_server_schema()` pulls the DDL
out of `applySchema()` and executes it verbatim. A rename on the TypeScript side therefore reaches
these tests as a failure on the next run, which is the point: this file is the drift detector for
the reads, not just coverage for them.

CRITERIA UNDER TEST (enumerated — a behaviour not listed here is not covered)
  A. schema parity      : the extracted DDL is real, current, and creates every object read below
  B. resource_index     : prompts, gates, styles, frameworks — including the resource-type spelling
  C. chain liveness     : PID filtering, terminal-run exclusion, and the documented fallback
  D. view repair (v20)  : the primary read path returns rows, and terminal runs stay out of both
  E. cross-client scope : recovery is keyed by the session's own recorded chain; the unscoped
                          newest-chain-of-any-live-PID scan (the 2026-08 leakage defect) is dead
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import ClassVar

import db_reader
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SQLITE_ENGINE_TS = REPO_ROOT / "server" / "src" / "infra" / "database" / "sqlite-engine.ts"

# Objects db_reader.py queries. Extraction failing to produce any of these means the reader is
# aimed at something applySchema() no longer declares.
READ_OBJECTS = (
    "resource_index",
    "chain_sessions",
    "v_execution_status",
)


def _extract_server_schema() -> tuple[str, int]:
    """Pull the DDL out of SqliteEngine.applySchema() so the fixture cannot drift from it.

    Returns (ddl, schema_version). Raises AssertionError naming what changed if the TypeScript
    was restructured — a loud failure here is preferable to a hand-maintained mirror that goes
    stale without anyone noticing.
    """
    source = SQLITE_ENGINE_TS.read_text(encoding="utf-8")

    version_match = re.search(r"^const SCHEMA_VERSION = (\d+);", source, re.MULTILINE)
    if not version_match:
        raise AssertionError(f"SCHEMA_VERSION constant not found in {SQLITE_ENGINE_TS}")

    # The engine's DDL spans more than one exec() literal since applyViews() was split out
    # of applySchema() (views are dropped+recreated unconditionally on the TS side, so view
    # DDL lives in its own literal). Concatenate every literal in source order — reading only
    # the first one silently dropped v_execution_status from this fixture.
    marker = "this.getDb().exec(`"
    segments: list[str] = []
    start = source.find(marker)
    if start == -1:
        raise AssertionError(f"engine DDL template literal not found in {SQLITE_ENGINE_TS}")
    while start != -1:
        seg_start = start + len(marker)
        end = source.find("`);", seg_start)
        if end == -1:
            raise AssertionError("an engine DDL template literal is unterminated")
        segments.append(source[seg_start:end])
        start = source.find(marker, end)

    ddl = "\n".join(segments).replace("${SCHEMA_VERSION}", version_match.group(1))
    if "${" in ddl:
        raise AssertionError("engine DDL carries an interpolation this extractor cannot resolve")

    return ddl, int(version_match.group(1))


def _dead_pid() -> int:
    """A PID that is reliably not alive: spawn a trivial child and reap it."""
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    return proc.pid


LIVE_PID = os.getpid()


def _chain_session_state(
    *,
    session_id: str = "sess-1",
    current: int = 1,
    total: int = 3,
    run_status: str = "working",
    pending_gate_review: dict | None = None,
    pending_shell_verification: dict | None = None,
    chain_id: str = "chain-demo",
) -> str:
    """Serialize a ChainSession exactly as the only writer emits it.

    Ground truth is `ChainManager.collectActiveSessionRows()` (server/src/modules/chains/manager.ts),
    which puts `currentStep`/`totalSteps` at the TOP level. `v_execution_status` extracted the
    nested `$.state.currentStep` until schema v20 and therefore read NULL from every row it had
    (F12); the paths agree now, and this fixture is what proves they still do.
    """
    return json.dumps(
        {
            "sessionId": session_id,
            "chainId": chain_id,
            "currentStep": current,
            "totalSteps": total,
            "lastActivity": 1000,
            "pendingGateReview": pending_gate_review,
            "pendingShellVerification": pending_shell_verification,
            "runStatus": run_status,
            "runCompletedAt": None,
        }
    )


@pytest.fixture
def state_db(tmp_path, monkeypatch):
    """Build a state.db carrying the server's real schema, at a path workspace.py resolves.

    Seeded at the legacy {MCP_WORKSPACE}/server/runtime-state layout, which
    `get_state_db_path()` probes after {MCP_WORKSPACE}/runtime-state; the layout
    is load-bearing rather than cosmetic (TestStateDbPathResolution covers the
    precedence).
    """
    workspace = tmp_path / "workspace"
    runtime_state = workspace / "server" / "runtime-state"
    runtime_state.mkdir(parents=True)
    db_path = runtime_state / "state.db"

    ddl, _version = _extract_server_schema()
    conn = sqlite3.connect(db_path)
    conn.executescript(ddl)
    conn.commit()

    monkeypatch.setenv("MCP_WORKSPACE", str(workspace))
    # Any of these would out-rank a stale value from the developer's own shell.
    for leaked in ("CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath"):
        monkeypatch.delenv(leaked, raising=False)

    yield conn
    conn.close()


@pytest.fixture
def no_state_db(tmp_path, monkeypatch):
    """A workspace with no state.db — the fail-open path every reader declares."""
    workspace = tmp_path / "empty-workspace"
    (workspace / "server" / "runtime-state").mkdir(parents=True)
    monkeypatch.setenv("MCP_WORKSPACE", str(workspace))
    for leaked in ("CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath"):
        monkeypatch.delenv(leaked, raising=False)
    return workspace


def _insert_resource(conn: sqlite3.Connection, **kwargs) -> None:
    row = {
        "id": "x",
        "type": "prompt",
        "name": "",
        "category": "",
        "description": "",
        "metadata_json": None,
        **kwargs,
    }
    conn.execute(
        "INSERT INTO resource_index (id, type, name, category, description, metadata_json) "
        "VALUES (:id, :type, :name, :category, :description, :metadata_json)",
        row,
    )
    conn.commit()


def _insert_session(
    conn: sqlite3.Connection,
    run_owner_pid: str,
    state: str,
    *,
    run_status: str = "working",
    chain_id: str = "chain-demo",
) -> None:
    conn.execute(
        "INSERT INTO chain_sessions (run_owner_pid, chain_id, run_number, state, run_status) VALUES (?, ?, 1, ?, ?)",
        (run_owner_pid, chain_id, state, run_status),
    )
    conn.commit()


# ── A. Schema parity ──────────────────────────────────────────────────────────


class TestSchemaParity:
    def test_extracted_ddl_declares_every_object_db_reader_queries(self, state_db):
        names = {row[0] for row in state_db.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}
        missing = [obj for obj in READ_OBJECTS if obj not in names]
        assert not missing, f"db_reader.py queries objects applySchema() no longer declares: {missing}"

    def test_extracted_schema_version_matches_the_seeded_row(self, state_db):
        _ddl, version = _extract_server_schema()
        seeded = state_db.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert seeded == version

    def test_run_status_is_not_null_so_the_reader_null_branch_is_unreachable(self, state_db):
        """`_load_from_execution_view` retains rows with NULL run_status as a legacy allowance.

        The column is declared NOT NULL and `v_execution_status` selects it straight off
        `chain_sessions` with no outer join, so no row can reach that branch. Recorded as a test
        rather than a comment: if the DDL ever relaxes the constraint, the branch becomes live and
        this assertion says so.
        """
        columns = state_db.execute("PRAGMA table_info(chain_sessions)").fetchall()
        run_status = next(col for col in columns if col[1] == "run_status")
        notnull = run_status[3]
        assert notnull == 1, "run_status is now nullable — the NULL branch in _load_from_execution_view is live again"


# ── B. resource_index reads ───────────────────────────────────────────────────


class TestResourceIndexReads:
    def test_load_prompts_projects_metadata_json_into_chain_fields(self, state_db):
        _insert_resource(
            state_db,
            id="content_analysis",
            type="prompt",
            name="Content Analysis",
            category="analysis",
            description="Analyze content",
            metadata_json=json.dumps(
                {
                    "is_chain": True,
                    "chain_steps": 4,
                    "chain_step_ids": ["a", "b", "c", "d"],
                    "arguments": [{"name": "content"}],
                    "gates": ["code-quality"],
                    "keywords": ["analysis"],
                }
            ),
        )

        result = db_reader.load_prompts()

        assert result is not None
        prompt = result["prompts"]["content_analysis"]
        assert prompt["is_chain"] is True
        assert prompt["chain_steps"] == 4
        assert prompt["chain_step_ids"] == ["a", "b", "c", "d"]
        assert prompt["gates"] == ["code-quality"]

    def test_load_prompts_tolerates_malformed_metadata_json(self, state_db):
        _insert_resource(state_db, id="broken", type="prompt", metadata_json="{not json")

        result = db_reader.load_prompts()

        assert result is not None
        assert result["prompts"]["broken"]["is_chain"] is False

    def test_load_prompts_meta_carries_styles_and_frameworks(self, state_db):
        _insert_resource(state_db, id="Conversational", type="style")
        _insert_resource(state_db, id="CAGEERF", type="framework")

        result = db_reader.load_prompts()

        assert result is not None
        assert result["_meta"]["valid_styles"] == ["conversational"]
        assert result["_meta"]["valid_frameworks"] == ["cageerf"]

    def test_frameworks_read_the_resource_type_the_indexer_writes(self, state_db):
        """Regression guard for the drift documented in get_valid_frameworks_from_db.

        The reader once queried the pre-rename spelling and returned zero rows, which fail-open
        callers could not distinguish from an unavailable database. Seeding only the current
        spelling means a reader that reverts reads empty and fails here.
        """
        _insert_resource(state_db, id="ReACT", type="framework")

        assert db_reader.get_valid_frameworks_from_db() == ["react"]

    def test_get_prompt_by_id_is_case_insensitive(self, state_db):
        _insert_resource(state_db, id="Notes", type="prompt", name="Notes")

        assert db_reader.get_prompt_by_id_from_db("notes")["name"] == "Notes"
        assert db_reader.get_prompt_by_id_from_db("NOTES")["name"] == "Notes"
        assert db_reader.get_prompt_by_id_from_db("absent") is None

    def test_load_gates_projects_type_and_triggers(self, state_db):
        _insert_resource(
            state_db,
            id="code-quality",
            type="gate",
            name="Code Quality",
            description="Standards",
            metadata_json=json.dumps({"type": "validation", "triggers": ["edit"]}),
        )

        gates = db_reader.load_gates()

        assert gates is not None
        assert gates["gates"]["code-quality"]["triggers"] == ["edit"]

    def test_every_reader_fails_open_when_the_database_is_absent(self, no_state_db):
        assert db_reader.load_prompts() is None
        assert db_reader.load_gates() is None
        assert db_reader.get_prompt_by_id_from_db("anything") is None
        assert db_reader.load_active_chain_state("chain-demo") is None
        assert db_reader.get_valid_styles_from_db() == []
        assert db_reader.get_valid_frameworks_from_db() == []


# ── C. Chain liveness ─────────────────────────────────────────────────────────


class TestActiveChainState:
    def test_returns_state_for_a_live_owner(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        state = db_reader.load_active_chain_state("chain-demo")

        assert state is not None
        assert state["chain_id"] == "chain-demo"
        assert state["current_step"] == 2
        assert state["total_steps"] == 5

    def test_rows_owned_by_a_dead_process_are_skipped(self, state_db):
        _insert_session(state_db, str(_dead_pid()), _chain_session_state())

        assert db_reader.load_active_chain_state("chain-demo") is None

    def test_a_non_numeric_owner_is_skipped(self, state_db):
        """A non-PID value must not be coerced into a liveness check.

        `run_owner_pid` was named `tenant_id` until v20, when the same name also meant a workspace
        id in `kv_state`. The name no longer invites the confusion; this guards the value anyway,
        because a bad write is still a bad write.
        """
        _insert_session(state_db, "claude-prompts-mcp", _chain_session_state())

        assert db_reader.load_active_chain_state("chain-demo") is None

    def test_a_chain_standing_on_its_last_step_is_active(self, state_db):
        """3/3 is the last step still owed its answer, not a finished run (R30).

        The server projects a row exactly while `!isRunComplete(session)`; a finished run is
        terminal or absent, never `currentStep == totalSteps`.
        """
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=3, total=3))

        state = db_reader.load_active_chain_state("chain-demo")

        assert state is not None
        assert state["current_step"] == 3

    def test_a_final_step_awaiting_a_gate_verdict_is_still_active(self, state_db):
        _insert_session(
            state_db,
            str(LIVE_PID),
            _chain_session_state(
                current=3,
                total=3,
                pending_gate_review={"gateIds": ["code-quality", "test-coverage"], "attemptCount": 2},
            ),
        )

        state = db_reader.load_active_chain_state("chain-demo")

        assert state is not None
        assert state["pending_gate"] == "code-quality, test-coverage"
        assert state["shell_verify_attempts"] == 2

    def test_a_final_step_awaiting_shell_verification_is_still_active(self, state_db):
        _insert_session(
            state_db,
            str(LIVE_PID),
            _chain_session_state(
                current=3,
                total=3,
                pending_shell_verification={"shellVerify": {"command": "npm test"}, "attemptCount": 1},
            ),
        )

        state = db_reader.load_active_chain_state("chain-demo")

        assert state is not None
        assert state["pending_shell_verify"] == "npm test"

    def test_session_table_serves_when_the_view_is_unavailable(self, state_db):
        """The documented fallback: "environments where the view query fails".

        Dropping the view reproduces exactly that — and it is the shape a column rename takes,
        since `v_execution_status` projects `cs.run_owner_pid` by name.
        """
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=1, total=2))
        state_db.execute("DROP VIEW v_execution_status")
        state_db.commit()

        state = db_reader.load_active_chain_state("chain-demo")

        assert state is not None
        assert state["current_step"] == 1
        assert state["total_steps"] == 2

    def test_no_state_when_the_view_and_session_table_both_yield_nothing(self, state_db):
        """The retired third fallback (`chain_run_registry`, dropped at schema v22 — P3 Tier 4)
        used to serve a run here; now the read order stops after the session table and reports
        no active state.
        """
        state_db.execute("DROP VIEW v_execution_status")
        state_db.execute("DELETE FROM chain_sessions")
        state_db.commit()

        assert db_reader.load_active_chain_state("chain-demo") is None


class TestHeldPastTheLastNode:
    """P6.29 + P6.31 (R30): a run held open after walking past its last node stays visible.

    The server writes such a row at `currentStep = totalSteps + 1` (`currentOrdinal` of a null
    node) with a non-terminal status, and only while something holds it. Each converter is pinned
    on its own: through `load_active_chain_state` a view-path drop would be hidden by the
    session-table fallback.
    """

    SHELL: ClassVar[dict] = {"nodeId": "n2", "shellVerify": {"command": "test -f M"}, "attemptCount": 1}
    DETACHED_REVIEW: ClassVar[dict] = {
        "nodeId": "n2",
        "kind": "detached",
        "gateIds": ["late-report"],
        "attemptCount": 0,
    }

    def _via_view(self, state_db) -> dict | None:
        state_db.row_factory = sqlite3.Row
        try:
            row = state_db.execute("SELECT * FROM v_execution_status").fetchone()
        finally:
            state_db.row_factory = None
        return db_reader._view_row_to_hook_state(row)

    @pytest.mark.parametrize(
        "pending",
        [{"pending_shell_verification": SHELL}, {"pending_gate_review": DETACHED_REVIEW}],
        ids=["shell-verification", "detached-review"],
    )
    def test_a_held_run_past_its_last_node_is_kept_on_both_paths(self, state_db, pending):
        blob = _chain_session_state(current=3, total=2, **pending)
        _insert_session(state_db, str(LIVE_PID), blob)

        via_view = self._via_view(state_db)
        via_session = db_reader._session_to_hook_state(json.loads(blob))

        for state in (via_view, via_session):
            assert state is not None
            assert (state["current_step"], state["total_steps"]) == (3, 2)
        assert db_reader.load_active_chain_state("chain-demo") is not None

    def test_an_in_progress_row_is_unchanged(self, state_db):
        blob = _chain_session_state(current=1, total=2)
        _insert_session(state_db, str(LIVE_PID), blob)

        for state in (self._via_view(state_db), db_reader._session_to_hook_state(json.loads(blob))):
            assert state is not None
            assert (state["current_step"], state["pending_shell_verify"]) == (1, None)

    def test_a_terminal_row_past_its_last_node_is_dropped(self):
        blob = _chain_session_state(current=3, total=2, run_status="completed", pending_shell_verification=self.SHELL)

        assert db_reader._session_to_hook_state(json.loads(blob)) is None


# ── D. View repair (schema v20) ───────────────────────────────────────────────


class TestExecutionViewIsLive:
    """Until v20 `v_execution_status` json_extracted a path no writer produced, so the primary
    read path returned None for every input and every call fell through to the session table.
    These assert the repair and would fail if the json paths drift from the writer again.
    """

    def test_the_view_projects_the_steps_its_writer_wrote(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        row = state_db.execute("SELECT current_step, total_steps FROM v_execution_status").fetchone()

        assert row == (2, 5)

    def test_the_primary_path_serves_without_falling_back(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))
        conn = db_reader._connect_readonly()
        try:
            state = db_reader._load_from_execution_view(conn, "chain-demo")
        finally:
            conn.close()

        assert state is not None
        assert state["current_step"] == 2

    @pytest.mark.parametrize("terminal", ["completed", "failed", "cancelled"])
    def test_terminal_runs_are_excluded_on_every_path(self, state_db, terminal):
        """The view filters these in SQL; the fallbacks converge on `_session_to_hook_state`.

        Seeded with a mid-chain step so the run looks active on every signal except run_status —
        a fixture at the final step would pass without the boundary check being consulted.
        """
        _insert_session(
            state_db,
            str(LIVE_PID),
            _chain_session_state(current=1, total=3, run_status=terminal),
            run_status=terminal,
        )

        assert db_reader.load_active_chain_state("chain-demo") is None

        # And again with the view removed, so the session-table fallback is the path under test.
        state_db.execute("DROP VIEW v_execution_status")
        state_db.commit()
        assert db_reader.load_active_chain_state("chain-demo") is None


# ── E. Cross-client scoping ───────────────────────────────────────────────────


class TestCrossClientScoping:
    """Several clients' MCP servers can share one state.db. Recovery keyed by
    "newest active chain owned by any live PID" injected one client's chain
    into another client's conversation (measured 2026-08-21: an OpenCode-owned
    chain surfaced in a Claude Code compact recovery). These pin the fix:
    selection requires the chain THIS session recorded.
    """

    SESSION = "sess-scope-test"

    def _record_session_chain(self, chain_id: str = "chain-demo") -> None:
        from session_state import save_session_state

        save_session_state(self.SESSION, {"chain_id": chain_id, "current_step": 1, "total_steps": 3})

    def test_the_unscoped_scan_is_dead(self, state_db):
        """THE leak regression: an active chain with a live owner exists, and a
        call without a chain_id must not return it."""
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        assert db_reader.load_active_chain_state() is None

    def test_a_foreign_chain_id_is_not_served(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        assert db_reader.load_active_chain_state("chain-someone-elses#1") is None

    def test_a_session_with_no_recorded_chain_recovers_nothing(self, state_db):
        """End-to-end leak regression: a foreign active chain sits in state.db,
        and a conversation that never recorded a chain must not adopt it."""
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        assert db_reader.load_recoverable_chain_state(self.SESSION) is None
        assert db_reader.load_recoverable_chain_state(None) is None
        assert db_reader.load_recoverable_chain_state("") is None

    def test_the_sessions_own_chain_is_recovered_fresh(self, state_db):
        """The session recorded chain-demo; state.db has newer step data for it
        — recovery returns the fresh db state, not the stale snapshot."""
        self._record_session_chain("chain-demo")
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        state = db_reader.load_recoverable_chain_state(self.SESSION)

        assert state is not None
        assert state["chain_id"] == "chain-demo"
        assert state["current_step"] == 2

    def test_a_terminal_chain_is_not_resurrected_from_the_snapshot(self, state_db):
        """state.db is reachable and says the session's chain finished — the
        stale hooks-state snapshot (retained 24h) must not revive it."""
        self._record_session_chain("chain-demo")
        _insert_session(
            state_db,
            str(LIVE_PID),
            _chain_session_state(current=1, total=3, run_status="completed"),
            run_status="completed",
        )

        assert db_reader.load_recoverable_chain_state(self.SESSION) is None

    def test_a_live_run_with_no_projected_row_recovers_nothing(self, state_db):
        """P6.61: the server projects a run exactly while it is not complete (R30), so with
        state.db reachable and no row for the recorded chain the run is over. The session
        snapshot still says step 2/3; serving it replayed a finished run as a stale step.
        Another chain's live row stays in the table so the probe reads a populated db."""
        self._record_session_chain("chain-demo")
        _insert_session(
            state_db,
            str(LIVE_PID),
            _chain_session_state(current=2, total=5, chain_id="chain-other"),
            chain_id="chain-other",
        )

        assert db_reader.load_recoverable_chain_state(self.SESSION) is None

    def test_control_the_same_chain_projected_is_recovered(self, state_db):
        """Positive control for the absence above: one row for the recorded chain, the rest
        identical, and the loader serves that row."""
        self._record_session_chain("chain-demo")
        _insert_session(
            state_db,
            str(LIVE_PID),
            _chain_session_state(current=2, total=5, chain_id="chain-other"),
            chain_id="chain-other",
        )
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=4, total=3))

        state = db_reader.load_recoverable_chain_state(self.SESSION)

        assert state is not None
        assert state["chain_id"] == "chain-demo"
        assert state["current_step"] == 4

    def test_a_dead_owner_expires_the_chain(self, state_db):
        """The owning server exited (or its rows were PID-deleted): recovery
        expires rather than continuing against a server that cannot resume it."""
        self._record_session_chain("chain-demo")
        _insert_session(state_db, str(_dead_pid()), _chain_session_state(current=1, total=3))

        assert db_reader.load_recoverable_chain_state(self.SESSION) is None

    def test_without_a_server_db_the_session_snapshot_serves(self, no_state_db):
        """Degraded mode parity with the pre-fix fallback: no state.db is
        reachable, so the session's own snapshot is the best available truth."""
        self._record_session_chain("chain-demo")

        state = db_reader.load_recoverable_chain_state(self.SESSION)

        assert state is not None
        assert state["chain_id"] == "chain-demo"
        assert state["current_step"] == 1


class TestStateDbPathResolution:
    """The server writes {MCP_RUNTIME_ROOT || MCP_WORKSPACE}/runtime-state/state.db
    (paths.ts getRuntimeRoot). The hook read {workspace}/server/runtime-state only,
    so with MCP_WORKSPACE at the repo root it read a database its own session's
    server never writes — and the only chains it could find were other clients'.
    """

    def test_the_servers_actual_layout_is_preferred(self, tmp_path, monkeypatch):
        import workspace

        ws = tmp_path / "ws"
        primary = ws / "runtime-state"
        legacy = ws / "server" / "runtime-state"
        primary.mkdir(parents=True)
        legacy.mkdir(parents=True)
        (primary / "state.db").touch()
        (legacy / "state.db").touch()
        monkeypatch.setenv("MCP_WORKSPACE", str(ws))
        for leaked in (
            "MCP_RUNTIME_ROOT",
            "CLAUDE_PLUGIN_ROOT",
            "CLAUDE_PLUGIN_DATA",
            "PLUGIN_ROOT",
            "GEMINI_EXTENSION_PATH",
            "extensionPath",
        ):
            monkeypatch.delenv(leaked, raising=False)

        assert workspace.get_state_db_path() == primary / "state.db"

    def test_the_legacy_server_layout_still_serves(self, tmp_path, monkeypatch):
        import workspace

        ws = tmp_path / "ws"
        legacy = ws / "server" / "runtime-state"
        legacy.mkdir(parents=True)
        (legacy / "state.db").touch()
        monkeypatch.setenv("MCP_WORKSPACE", str(ws))
        for leaked in (
            "MCP_RUNTIME_ROOT",
            "CLAUDE_PLUGIN_ROOT",
            "CLAUDE_PLUGIN_DATA",
            "PLUGIN_ROOT",
            "GEMINI_EXTENSION_PATH",
            "extensionPath",
        ):
            monkeypatch.delenv(leaked, raising=False)

        assert workspace.get_state_db_path() == legacy / "state.db"

    def test_mcp_runtime_root_outranks_the_workspace(self, tmp_path, monkeypatch):
        import workspace

        ws = tmp_path / "ws"
        (ws / "runtime-state").mkdir(parents=True)
        (ws / "runtime-state" / "state.db").touch()
        rt = tmp_path / "rt"
        (rt / "runtime-state").mkdir(parents=True)
        (rt / "runtime-state" / "state.db").touch()
        monkeypatch.setenv("MCP_WORKSPACE", str(ws))
        monkeypatch.setenv("MCP_RUNTIME_ROOT", str(rt))
        for leaked in (
            "CLAUDE_PLUGIN_ROOT",
            "CLAUDE_PLUGIN_DATA",
            "PLUGIN_ROOT",
            "GEMINI_EXTENSION_PATH",
            "extensionPath",
        ):
            monkeypatch.delenv(leaked, raising=False)

        assert workspace.get_state_db_path() == rt / "runtime-state" / "state.db"


class TestClaudePluginDataStateDb:
    """The Claude Code plugin runs its server with MCP_RUNTIME_ROOT=${CLAUDE_PLUGIN_DATA},
    so state.db lives in the plugin data directory. Hooks do not inherit that setting;
    they receive CLAUDE_PLUGIN_DATA and CLAUDE_PLUGIN_ROOT from Claude Code. Without the
    data candidate a hook finds nothing, or a state.db an earlier plugin version left
    in the install directory.
    """

    OTHER_ROOTS = ("MCP_WORKSPACE", "MCP_RUNTIME_ROOT", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath")

    @staticmethod
    def _seed(root):
        (root / "runtime-state").mkdir(parents=True)
        db_path = root / "runtime-state" / "state.db"
        db_path.touch()
        return db_path

    def test_the_plugin_data_state_db_outranks_the_install_directory(self, tmp_path, monkeypatch):
        import workspace

        self._seed(tmp_path / "install")
        data_db = self._seed(tmp_path / "data")
        monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(tmp_path / "install"))
        monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(tmp_path / "data"))
        for leaked in self.OTHER_ROOTS:
            monkeypatch.delenv(leaked, raising=False)

        assert workspace.get_state_db_path() == data_db

    @pytest.mark.parametrize("value", [None, "", "   "], ids=["unset", "empty", "blank"])
    def test_unset_or_blank_plugin_data_adds_no_candidate(self, tmp_path, monkeypatch, value):
        import workspace

        install_db = self._seed(tmp_path / "install")
        monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(tmp_path / "install"))
        if value is None:
            monkeypatch.delenv("CLAUDE_PLUGIN_DATA", raising=False)
        else:
            monkeypatch.setenv("CLAUDE_PLUGIN_DATA", value)
        for leaked in self.OTHER_ROOTS:
            monkeypatch.delenv(leaked, raising=False)

        assert workspace.get_state_db_path() == install_db

    def test_mcp_runtime_root_outranks_plugin_data(self, tmp_path, monkeypatch):
        import workspace

        runtime_db = self._seed(tmp_path / "rt")
        self._seed(tmp_path / "data")
        monkeypatch.setenv("MCP_RUNTIME_ROOT", str(tmp_path / "rt"))
        monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(tmp_path / "data"))
        for leaked in ("MCP_WORKSPACE", "CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath"):
            monkeypatch.delenv(leaked, raising=False)

        assert workspace.get_state_db_path() == runtime_db


class TestVerifyStateBesideStateDb:
    """The server writes verify-state.db beside its state.db, under its runtime root
    (B.62). The hook used to resolve it separately, as {workspace}/server/runtime-state,
    which under the Claude Code plugin is the install directory — a place the server
    stopped writing to, so the Stop hook would never see a loop the server started.
    """

    ROOTS = (
        "MCP_WORKSPACE",
        "MCP_RUNTIME_ROOT",
        "CLAUDE_PLUGIN_ROOT",
        "CLAUDE_PLUGIN_DATA",
        "PLUGIN_ROOT",
        "GEMINI_EXTENSION_PATH",
        "extensionPath",
    )

    @pytest.fixture(autouse=True)
    def _clean_roots(self, tmp_path, monkeypatch):
        for leaked in self.ROOTS:
            monkeypatch.delenv(leaked, raising=False)
        # A workspace root inside tmp_path even for a test that sets none: with no root at all,
        # workspace resolution falls back to this repository, and the fallback branch creates
        # server/runtime-state there.
        (tmp_path / "unset-install").mkdir()
        monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(tmp_path / "unset-install"))

    @staticmethod
    def _seed_state_db(root):
        (root / "runtime-state").mkdir(parents=True)
        (root / "runtime-state" / "state.db").touch()
        return root / "runtime-state"

    def test_plugin_shape_reads_the_data_directory_not_the_install(self, tmp_path, monkeypatch):
        import verify_active_store

        (tmp_path / "install" / "server" / "runtime-state").mkdir(parents=True)
        data_state = self._seed_state_db(tmp_path / "data")
        monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(tmp_path / "install"))
        monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(tmp_path / "data"))

        assert verify_active_store.get_verify_state_db_path() == data_state / "verify-state.db"

    def test_mcp_runtime_root_is_where_the_server_wrote_it(self, tmp_path, monkeypatch):
        import verify_active_store

        workspace_root = tmp_path / "ws"
        (workspace_root / "server").mkdir(parents=True)
        runtime_state = self._seed_state_db(tmp_path / "rt")
        monkeypatch.setenv("MCP_WORKSPACE", str(workspace_root))
        monkeypatch.setenv("MCP_RUNTIME_ROOT", str(tmp_path / "rt"))

        assert verify_active_store.get_verify_state_db_path() == runtime_state / "verify-state.db"

    def test_a_row_the_server_wrote_is_the_row_the_hook_loads(self, tmp_path, monkeypatch):
        import json
        import sqlite3

        import verify_active_store

        runtime_state = self._seed_state_db(tmp_path / "data")
        monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(tmp_path / "data"))
        conn = sqlite3.connect(str(runtime_state / "verify-state.db"))
        conn.execute(
            "CREATE TABLE verify_active_state (session_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.execute(
            "INSERT INTO verify_active_state VALUES (?, ?, datetime('now'))",
            ("client-1", json.dumps({"sessionId": "client-1", "config": {"command": "npm test"}})),
        )
        conn.commit()
        conn.close()

        loaded = verify_active_store.load_verify_active_state("client-1")
        assert loaded is not None
        assert loaded["config"]["command"] == "npm test"

    def test_without_a_server_state_db_the_hook_owned_directory_is_used(self, tmp_path, monkeypatch):
        import verify_active_store

        workspace_root = tmp_path / "ws"
        (workspace_root / "server").mkdir(parents=True)
        monkeypatch.setenv("MCP_WORKSPACE", str(workspace_root))

        assert (
            verify_active_store.get_verify_state_db_path()
            == workspace_root / "server" / "runtime-state" / "verify-state.db"
        )
