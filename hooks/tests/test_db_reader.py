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
  C. chain liveness     : PID filtering, terminal-run exclusion, and both documented fallbacks
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import db_reader
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SQLITE_ENGINE_TS = REPO_ROOT / "server" / "src" / "infra" / "database" / "sqlite-engine.ts"

# Objects db_reader.py queries. Extraction failing to produce any of these means the reader is
# aimed at something applySchema() no longer declares.
READ_OBJECTS = (
    "resource_index",
    "chain_sessions",
    "chain_run_registry",
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

    marker = "this.getDb().exec(`"
    start = source.find(marker)
    if start == -1:
        raise AssertionError(f"applySchema() DDL template literal not found in {SQLITE_ENGINE_TS}")
    start += len(marker)

    end = source.find("`);", start)
    if end == -1:
        raise AssertionError("applySchema() DDL template literal is unterminated")

    ddl = source[start:end].replace("${SCHEMA_VERSION}", version_match.group(1))
    if "${" in ddl:
        raise AssertionError("applySchema() DDL carries an interpolation this extractor cannot resolve")

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
) -> str:
    """Serialize a ChainSession exactly as the only writer emits it.

    Ground truth is `ChainManager.collectActiveSessionRows()` (server/src/modules/chains/manager.ts),
    which puts `currentStep`/`totalSteps` at the TOP level. Do not "fix" this to the nested shape
    `v_execution_status` json_extracts — the mismatch between the two is a finding this file pins
    (see TestExecutionViewIsStructurallyDead), and a fixture written to the view's expectation
    hides it.
    """
    return json.dumps(
        {
            "sessionId": session_id,
            "chainId": "chain-demo",
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
    """Build a state.db carrying the server's real schema, at the path workspace.py resolves.

    `get_state_db_path()` looks for {MCP_WORKSPACE}/server/runtime-state/state.db and returns None
    when the file is absent, so the directory layout is load-bearing rather than cosmetic.
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
    for leaked in ("CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath"):
        monkeypatch.delenv(leaked, raising=False)

    yield conn
    conn.close()


@pytest.fixture
def no_state_db(tmp_path, monkeypatch):
    """A workspace with no state.db — the fail-open path every reader declares."""
    workspace = tmp_path / "empty-workspace"
    (workspace / "server" / "runtime-state").mkdir(parents=True)
    monkeypatch.setenv("MCP_WORKSPACE", str(workspace))
    for leaked in ("CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "GEMINI_EXTENSION_PATH", "extensionPath"):
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


def _insert_session(conn: sqlite3.Connection, tenant_id: str, state: str, *, run_status: str = "working") -> None:
    conn.execute(
        "INSERT INTO chain_sessions (tenant_id, chain_id, run_number, state, run_status) "
        "VALUES (?, 'chain-demo', 1, ?, ?)",
        (tenant_id, state, run_status),
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
        assert db_reader.load_active_chain_state() is None
        assert db_reader.get_valid_styles_from_db() == []
        assert db_reader.get_valid_frameworks_from_db() == []


# ── C. Chain liveness ─────────────────────────────────────────────────────────


class TestExecutionViewIsStructurallyDead:
    """`v_execution_status` cannot observe the rows its only writer produces.

    The view json_extracts `$.state.currentStep`; `collectActiveSessionRows()` writes
    `currentStep` at the top level. Every row therefore projects NULL steps, and
    `_view_row_to_hook_state` rejects NULL as 0 — so `_load_from_execution_view` returns None for
    every input and the documented "highest-fidelity first" read order collapses to its fallback.

    Consequence: the Tier-2 terminal-run exclusion lives ONLY in this view's WHERE clause, so it
    never runs either. Terminal runs are kept out of the hooks solely by `isSessionActiveForHooks`
    on the writer side.

    These tests pin the defect so the fix is detected rather than assumed. They fail when the JSON
    path and the writer are reconciled — which is the signal to delete them.
    """

    def test_the_view_projects_null_steps_for_a_writer_shaped_row(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        row = state_db.execute("SELECT current_step, total_steps FROM v_execution_status").fetchone()

        assert row is not None, "the row exists; only its step columns are unreadable"
        assert row[0] is None
        assert row[1] is None

    def test_the_view_path_returns_none_even_for_a_live_in_progress_run(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))
        conn = db_reader._connect_readonly()
        try:
            assert db_reader._load_from_execution_view(conn) is None
        finally:
            conn.close()

    def test_the_terminal_filter_exists_only_on_the_dead_view_path(self, state_db):
        """Reads that reach live data apply no run_status filter at all.

        The view excludes terminal runs and cannot be reached; the session-table query that IS
        reached selects every row regardless of run_status. Asserting both halves keeps the gap
        visible while writer-side filtering is the only thing closing it.
        """
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(), run_status="cancelled")

        survives_view_filter = state_db.execute(
            "SELECT COUNT(*) FROM v_execution_status WHERE run_status NOT IN ('completed', 'failed', 'cancelled')"
        ).fetchone()[0]
        reached_by_fallback = state_db.execute("SELECT COUNT(*) FROM chain_sessions").fetchone()[0]

        assert survives_view_filter == 0
        assert reached_by_fallback == 1

        # The reached path serves the cancelled run because it never inspects run_status.
        assert db_reader.load_active_chain_state() is not None


class TestActiveChainState:
    def test_returns_state_for_a_live_owner(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=2, total=5))

        state = db_reader.load_active_chain_state()

        assert state is not None
        assert state["chain_id"] == "chain-demo"
        assert state["current_step"] == 2
        assert state["total_steps"] == 5

    def test_rows_owned_by_a_dead_process_are_skipped(self, state_db):
        _insert_session(state_db, str(_dead_pid()), _chain_session_state())

        assert db_reader.load_active_chain_state() is None

    def test_a_non_numeric_owner_is_skipped(self, state_db):
        """The trisemy trap: `tenant_id` holds a server PID here and a workspace id elsewhere.

        A workspace id landing in this column must not be coerced into a liveness check.
        """
        _insert_session(state_db, "claude-prompts-mcp", _chain_session_state())

        assert db_reader.load_active_chain_state() is None

    def test_a_finished_chain_with_nothing_pending_is_not_active(self, state_db):
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=3, total=3))

        assert db_reader.load_active_chain_state() is None

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

        state = db_reader.load_active_chain_state()

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

        state = db_reader.load_active_chain_state()

        assert state is not None
        assert state["pending_shell_verify"] == "npm test"

    def test_session_table_serves_when_the_view_is_unavailable(self, state_db):
        """The documented fallback: "environments where the view query fails".

        Dropping the view reproduces exactly that — and it is the shape a column rename takes,
        since `v_execution_status` projects `cs.tenant_id` by name.
        """
        _insert_session(state_db, str(LIVE_PID), _chain_session_state(current=1, total=2))
        state_db.execute("DROP VIEW v_execution_status")
        state_db.commit()

        state = db_reader.load_active_chain_state()

        assert state is not None
        assert state["current_step"] == 1
        assert state["total_steps"] == 2

    def test_run_registry_serves_when_view_and_session_table_yield_nothing(self, state_db):
        state_db.execute("DROP VIEW v_execution_status")
        state_db.execute(
            "INSERT INTO chain_run_registry (tenant_id, state) VALUES (?, ?)",
            (
                str(LIVE_PID),
                json.dumps(
                    {
                        "runs": {
                            "run-1": {
                                "chainId": "chain-registry",
                                "lifecycle": "active",
                                "lastActivity": 500,
                                "state": {"currentStep": 1, "totalSteps": 4},
                            }
                        }
                    }
                ),
            ),
        )
        state_db.commit()

        state = db_reader.load_active_chain_state()

        assert state is not None
        assert state["chain_id"] == "chain-registry"
        assert state["current_step"] == 1

    def test_run_registry_prefers_the_most_recent_run_and_skips_dormant_ones(self, state_db):
        state_db.execute("DROP VIEW v_execution_status")
        state_db.execute(
            "INSERT INTO chain_run_registry (tenant_id, state) VALUES (?, ?)",
            (
                str(LIVE_PID),
                json.dumps(
                    {
                        "runs": {
                            "old": {
                                "chainId": "chain-old",
                                "lifecycle": "active",
                                "lastActivity": 100,
                                "state": {"currentStep": 1, "totalSteps": 4},
                            },
                            "recent": {
                                "chainId": "chain-recent",
                                "lifecycle": "active",
                                "lastActivity": 900,
                                "state": {"currentStep": 2, "totalSteps": 4},
                            },
                            "dormant": {
                                "chainId": "chain-dormant",
                                "lifecycle": "dormant",
                                "lastActivity": 9999,
                                "state": {"currentStep": 3, "totalSteps": 4},
                            },
                        }
                    }
                ),
            ),
        )
        state_db.commit()

        state = db_reader.load_active_chain_state()

        assert state is not None
        assert state["chain_id"] == "chain-recent"

    def test_registry_blobs_owned_by_a_dead_process_are_skipped(self, state_db):
        state_db.execute("DROP VIEW v_execution_status")
        state_db.execute(
            "INSERT INTO chain_run_registry (tenant_id, state) VALUES (?, ?)",
            (
                str(_dead_pid()),
                json.dumps(
                    {
                        "runs": {
                            "run-1": {
                                "chainId": "chain-dead",
                                "lifecycle": "active",
                                "lastActivity": 500,
                                "state": {"currentStep": 1, "totalSteps": 4},
                            }
                        }
                    }
                ),
            ),
        )
        state_db.commit()

        assert db_reader.load_active_chain_state() is None
