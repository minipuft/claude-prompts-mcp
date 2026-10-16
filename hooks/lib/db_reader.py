"""
SQLite reader for Claude Code hooks.
Queries resource_index table from state.db as a read-only data source.

Replaces JSON cache file reads for prompts and gates.
Uses stdlib sqlite3 — no external dependencies.
"""

import json
import os
import sqlite3

from session_state import RunIdentity, exact_run_identity, label_gate_ids, pause_fields
from workspace import get_state_db_path


def _connect_readonly() -> sqlite3.Connection | None:
    """Open a read-only connection to state.db."""
    db_path = get_state_db_path()
    if not db_path:
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
        return None


def load_prompts() -> dict | None:
    """
    Load all prompts from resource_index with metadata.

    Returns a dict with structure:
    {
        "prompts": { id: PromptInfo, ... },
        "_meta": { "valid_styles": [...], "valid_frameworks": [...] }
    }
    """
    conn = _connect_readonly()
    if not conn:
        return None

    try:
        cursor = conn.execute(
            "SELECT id, name, category, description, metadata_json FROM resource_index WHERE type = 'prompt'"
        )
        prompts = {}
        for row in cursor:
            meta = _parse_metadata(row["metadata_json"])
            prompts[row["id"]] = {
                "id": row["id"],
                "name": row["name"] or "",
                "category": row["category"] or "",
                "description": row["description"] or "",
                "is_chain": meta.get("is_chain", False),
                "chain_steps": meta.get("chain_steps", 0),
                "chain_step_ids": meta.get("chain_step_ids"),
                "chain_step_names": meta.get("chain_step_names"),
                "arguments": meta.get("arguments", []),
                "gates": meta.get("gates", []),
                "keywords": meta.get("keywords", []),
            }

        result = {
            "prompts": prompts,
            "_meta": {
                "valid_styles": get_valid_styles_from_db(conn),
                "valid_frameworks": get_valid_frameworks_from_db(conn),
            },
        }
        return result
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def get_prompt_by_id_from_db(prompt_id: str) -> dict | None:
    """Get a single prompt by ID (case-insensitive)."""
    conn = _connect_readonly()
    if not conn:
        return None

    try:
        cursor = conn.execute(
            "SELECT id, name, category, description, metadata_json "
            "FROM resource_index WHERE type = 'prompt' AND LOWER(id) = ?",
            (prompt_id.lower(),),
        )
        row = cursor.fetchone()
        if not row:
            return None

        meta = _parse_metadata(row["metadata_json"])
        return {
            "id": row["id"],
            "name": row["name"] or "",
            "category": row["category"] or "",
            "description": row["description"] or "",
            "is_chain": meta.get("is_chain", False),
            "chain_steps": meta.get("chain_steps", 0),
            "chain_step_ids": meta.get("chain_step_ids"),
            "chain_step_names": meta.get("chain_step_names"),
            "arguments": meta.get("arguments", []),
            "gates": meta.get("gates", []),
            "keywords": meta.get("keywords", []),
        }
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def load_gates() -> dict | None:
    """
    Load all gates from resource_index with metadata.

    Returns a dict with structure:
    { "gates": { id: GateInfo, ... } }
    """
    conn = _connect_readonly()
    if not conn:
        return None

    try:
        cursor = conn.execute("SELECT id, name, description, metadata_json FROM resource_index WHERE type = 'gate'")
        gates = {}
        for row in cursor:
            meta = _parse_metadata(row["metadata_json"])
            gates[row["id"]] = {
                "id": row["id"],
                "name": row["name"] or "",
                "type": meta.get("type", "validation"),
                "description": row["description"] or "",
                "triggers": meta.get("triggers", []),
            }

        return {"gates": gates}
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def get_valid_styles_from_db(conn: sqlite3.Connection | None = None) -> list[str]:
    """Get valid style IDs from resource_index."""
    should_close = False
    if conn is None:
        conn = _connect_readonly()
        should_close = True
    if not conn:
        return []

    try:
        cursor = conn.execute("SELECT LOWER(id) as id FROM resource_index WHERE type = 'style' ORDER BY id")
        return [row["id"] for row in cursor]
    except sqlite3.Error:
        return []
    finally:
        if should_close:
            conn.close()


def get_valid_frameworks_from_db(conn: sqlite3.Connection | None = None) -> list[str]:
    """Get valid framework IDs from resource_index."""
    should_close = False
    if conn is None:
        conn = _connect_readonly()
        should_close = True
    if not conn:
        return []

    try:
        # `framework` is the value the indexer writes (IndexedResourceType in
        # server/src/infra/database/resource-indexer.ts). This read is cross-language, so nothing
        # in the TypeScript build can catch it drifting: it previously used the pre-rename spelling
        # and silently returned zero rows, which the fail-open callers read as "DB unavailable".
        cursor = conn.execute("SELECT LOWER(id) as id FROM resource_index WHERE type = 'framework' ORDER BY id")
        return [row["id"] for row in cursor]
    except sqlite3.Error:
        return []
    finally:
        if should_close:
            conn.close()


def _is_pid_alive(pid: int) -> bool:
    """Check if a process is alive via kill(pid, 0)."""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def load_recoverable_chain_state(session_id: str | None) -> dict | None:
    """Load the chain state THIS conversation may recover — and no other.

    Cross-client scoping (interview 1A, hook side): several MCP server
    processes — launched by different clients — can share one state.db, so
    "the newest active chain owned by any live PID" is not this session's
    chain. Recovery is therefore keyed by the chain this session recorded in
    hooks-state.db (written by the PostToolUse chain tracker); state.db only
    refreshes that specific chain. A session that recorded nothing recovers
    nothing.

    Degradation ladder:
      - no session row, or no chain_id in it     → None (nothing to recover)
      - state.db reachable, a projected row for
        the chain with a live owner              → fresh state from state.db
      - state.db reachable, no such row          → None. The server projects a
        run to chain_sessions exactly while it is not complete (R30,
        `isSessionActiveForHooks`), so an absent row means the run completed,
        ended, or died with its server. A gated single prompt is a 1/1 run and
        is projected too (measured 2026-09-25: 1/1 `working` after the render,
        no row after the PASS verdict). The snapshot fallback that used to
        serve here replayed a finished run as a stale step (P6.31).
      - no state.db reachable                    → the session snapshot as-is
        (the pre-existing fallback for hosts without a readable server db)

    A recorded exact `run_identity` refreshes by that identity alone, and only such a refresh
    carries a pause. Absence never clears a tracked pause: no matching row (the next server's
    cleanup deletes a dead owner's row; its run is retained), no state.db or a failed refresh
    returns the tracked state with `pause_custody: "unconfirmed"`.
    """
    if not session_id:
        return None
    from session_state import load_session_state

    session = load_session_state(session_id)
    if not session:
        return None
    chain_id = session.get("chain_id") or ""
    if not chain_id:
        return None

    identity = exact_run_identity(session.get("run_identity"))
    if identity is not None and identity["chain_id"] != chain_id:
        identity = None
    paused = identity is not None and "conversation_pause" in session
    conn = _connect_readonly()
    if not conn:
        return {**session, "pause_custody": "unconfirmed"} if paused else dict(session)
    result = None
    try:
        result = _load_from_execution_view(conn, chain_id, identity)
        if result is None:
            result = _load_from_session_table(conn, chain_id, identity)
    except (sqlite3.Error, json.JSONDecodeError, KeyError, TypeError):
        result = None
    finally:
        conn.close()
    if result is None and paused:
        return {**session, "pause_custody": "unconfirmed"}
    return result


def load_active_chain_state(chain_id: str | None = None) -> dict | None:
    """Load active chain session state from server's execution SSOT.

    Requires the chain_id to look up. The unscoped form — scan every row and
    return the newest active chain owned by any live server PID — is the
    defect that injected one client's chain into another client's
    conversation, so a call without a chain_id deliberately returns None
    instead of scanning. Callers that want "this conversation's chain" use
    load_recoverable_chain_state(session_id).

    Read order (highest-fidelity first):
      1. v_execution_status view (Tier 1 — SEP-1686 cross-language SSOT;
         joins chain_sessions JSON state with execution_records aggregates).
         Boundary detection uses the canonical run_status column (Tier 2)
         instead of inferring from current_step vs total_steps.
      2. chain_sessions per-row table — fallback for environments where the
         view query fails (e.g., column-shape divergence during rollout).

    A third fallback previously read the PID-scoped `chain_run_registry` blob
    table, retired at schema v22 (P3 Tier 4) in favor of the per-row
    `chain_runs` + `chain_run_nodes` tables that `chain_sessions` is derived
    from in the same transaction. Removed rather than left guarded: at v22 the
    table no longer exists, so the SELECT could only ever hit its
    OperationalError branch and return None.

    All paths perform a PID liveness check on run_owner_pid so the hook only
    returns sessions belonging to a live server process. The column was named
    tenant_id until schema v20, when it was renamed because the same name held a
    workspace id in kv_state; there is deliberately no fallback to the old name,
    since both tables are dropped by the bump that renames them.
    """
    if not chain_id:
        return None
    conn = _connect_readonly()
    if not conn:
        return None
    try:
        result = _load_from_execution_view(conn, chain_id)
        if result is not None:
            return result

        return _load_from_session_table(conn, chain_id)
    except (sqlite3.Error, json.JSONDecodeError, KeyError, TypeError):
        return None
    finally:
        conn.close()


def resolve_run_identity(chain_id: str) -> RunIdentity | None:
    """The exact identity of the one projected run of `chain_id` a live server owns, or None.

    The chain id alone cannot name a run: two scopes can each hold `chain-x#1`. So the identity
    comes only from a `chain_sessions` row, by the same liveness and visibility tests the loaders
    apply, and only when exactly one row passes them. No such row (none projected, or only a dead
    owner's, whose run is not live) or several (another scope runs the same chain id) gives None:
    nothing is borrowed from a run this conversation cannot be shown to own. A passing row whose
    identity is incomplete still counts, so it can make a choice ambiguous but never supplies one.
    """
    conn = _connect_readonly() if chain_id else None
    if not conn:
        return None
    sql = (
        "SELECT run_owner_pid, organization_id, workspace_id, continuity_scope_id, chain_id, state "
        "FROM chain_sessions WHERE chain_id = ?"
    )
    try:
        rows = conn.execute(sql, [chain_id]).fetchall()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    candidates: list[RunIdentity | None] = []
    for row in rows:
        session = _parse_json_field(row["state"]) if _owner_alive(row) else None
        if not isinstance(session, dict) or _session_to_hook_state(session) is None:
            continue
        raw = {key: row[key] for key in ("chain_id", "organization_id", "workspace_id", "continuity_scope_id")}
        candidates.append(exact_run_identity({**raw, "run_id": session.get("sessionId")}))
    return candidates[0] if len(candidates) == 1 else None


def _owner_alive(row: sqlite3.Row) -> bool | None:
    """Whether the row's `run_owner_pid` is a live process; None when the column is not a PID."""
    try:
        return _is_pid_alive(int(row["run_owner_pid"]))
    except (ValueError, TypeError):
        return None


def _identity_params(identity: RunIdentity) -> list[object]:
    """Bind values for the identity clause both routes append, in clause order."""
    keys = ("run_id", "continuity_scope_id", "organization_id", "workspace_id")
    return [identity[key] for key in keys]


def _select_row(rows: list[sqlite3.Row], identity: RunIdentity | None, convert) -> dict | None:
    """The first row a live server owns; else, for an exact identity (already filtered in SQL), a
    pause a dead owner retained: guidance for an explicit claim, never adoption."""
    retained = None
    for row in rows:
        alive = _owner_alive(row)
        if alive is None or (not alive and identity is None):
            continue
        hook_state, document = convert(row)
        if hook_state is None:
            continue
        if identity is not None:
            fields = pause_fields(document.get("conversationPause"), document.get("owed"))
            if not alive and not fields:
                continue
            hook_state["run_identity"] = identity
            if fields:
                hook_state.update(fields)
                hook_state["pause_custody"] = "owned" if alive else "retained"
        if alive:
            return hook_state
        retained = retained or hook_state
    return retained


def _load_from_execution_view(
    conn: sqlite3.Connection, chain_id: str, identity: RunIdentity | None = None
) -> dict | None:
    """Query v_execution_status — Tier 1 cross-language SSOT view.

    Boundary check uses run_status (Tier 2): rows with run_status in
    {completed, failed, cancelled} are excluded so the hook never reports a
    terminal chain as active. The column is NOT NULL, so every row carries a
    status and there is no unset phase to admit.

    The view projects neither the pause nor the continuity scope, so it joins its own row
    (`row_id`); an exact identity selects only that run UUID in that exact scope.
    """
    sql = (
        "SELECT v.run_owner_pid, v.chain_id, v.run_status, v.current_step, v.total_steps, "
        "v.last_activity, v.current_step_review, v.pending_shell_verification, cs.state "
        "FROM v_execution_status v JOIN chain_sessions cs ON cs.id = v.row_id "
        "WHERE v.chain_id = ? "
        "AND v.run_status NOT IN ('completed', 'failed', 'cancelled') "
    )
    params: list[object] = [chain_id]
    if identity is not None:
        sql += "AND v.session_id = ? AND cs.continuity_scope_id = ? AND v.organization_id IS ? AND v.workspace_id IS ? "
        params += _identity_params(identity)
    try:
        rows = conn.execute(sql + "ORDER BY v.last_activity DESC, v.updated_at DESC", params).fetchall()
    except sqlite3.OperationalError:
        return None

    def convert(row: sqlite3.Row) -> tuple[dict | None, dict]:
        document = _parse_json_field(row["state"])
        return _view_row_to_hook_state(row), document if isinstance(document, dict) else {}

    return _select_row(rows, identity, convert)


def _view_row_to_hook_state(row: sqlite3.Row) -> dict | None:
    """Convert a v_execution_status row to the hook ChainState shape."""
    current = row["current_step"] or 0
    total = row["total_steps"] or 0

    current_step_review = _parse_json_field(row["current_step_review"])
    pending_shell_verification = _parse_json_field(row["pending_shell_verification"])

    if not _is_projected_run_visible(current, total):
        return None

    result: dict[str, object] = {
        "chain_id": row["chain_id"] or "",
        "current_step": current,
        "total_steps": total,
        "pending_gate": None,
        "gate_criteria": [],
        "last_prompt_id": "",
        "pending_shell_verify": None,
        "shell_verify_attempts": 0,
    }

    if isinstance(current_step_review, dict):
        gate_ids = current_step_review.get("gateIds", [])
        if gate_ids:
            result["pending_gate"] = label_gate_ids(gate_ids)
        result["shell_verify_attempts"] = current_step_review.get("attemptCount", 0)

    if isinstance(pending_shell_verification, dict):
        cmd_info = pending_shell_verification.get("shellVerify", {})
        result["pending_shell_verify"] = cmd_info.get("command")
        result["shell_verify_attempts"] = pending_shell_verification.get("attemptCount", 0)

    return result


def _parse_json_field(raw: object) -> object:
    """Parse a JSON column value. SQLite json_extract may return either a
    Python object (when SQLite parsed JSON natively) or a string (when the
    underlying column held raw JSON text)."""
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str) or raw.strip() == "":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _load_from_session_table(
    conn: sqlite3.Connection, chain_id: str, identity: RunIdentity | None = None
) -> dict | None:
    """Query chain_sessions per-row table: the view route's equivalent, identity clause included."""
    sql = "SELECT run_owner_pid, chain_id, state FROM chain_sessions WHERE chain_id = ? "
    params: list[object] = [chain_id]
    if identity is not None:
        sql += (
            "AND json_extract(state, '$.sessionId') = ? AND continuity_scope_id = ? "
            "AND organization_id IS ? AND workspace_id IS ? "
        )
        params += _identity_params(identity)
    try:
        rows = conn.execute(sql + "ORDER BY updated_at DESC", params).fetchall()
    except sqlite3.OperationalError:
        return None

    def convert(row: sqlite3.Row) -> tuple[dict | None, dict]:
        if not row["state"]:
            return None, {}
        session = json.loads(row["state"])
        return _session_to_hook_state(session), session

    return _select_row(rows, identity, convert)


# Run statuses that mean the run is over. Kept next to the reader that enforces them so the
# constant and its check cannot drift; mirrors isTerminalRunStatus() on the TypeScript side.
TERMINAL_RUN_STATUSES = frozenset({"completed", "failed", "cancelled"})


def _is_projected_run_visible(current: int, total: int) -> bool:
    """Whether a non-terminal projected row is a run hooks should see (R30).

    Visibility is decided once, server-side: `isSessionActiveForHooks` projects a row exactly
    while `!isRunComplete(session)`. So a row standing on a node (`1..total`) is in progress, and
    a row at `total + 1` is a run held open past its last node — a pending review, shell check,
    or owed detached report; a completed run is never projected there. `current == 0` is a
    zero-node run, which the server treats as complete on arrival and never projects.
    """
    return 0 < current <= total + 1


def _session_to_hook_state(session: dict) -> dict | None:
    """Convert a chain session dict to the hook ChainState shape.

    Applies the terminal-run boundary that `v_execution_status` applies in SQL. Both fallback
    paths converge here, so without this check a run excluded by the view was served straight back
    by the session-table query, which selects every row regardless of run_status.
    """
    if session.get("runStatus") in TERMINAL_RUN_STATUSES:
        return None

    current = session.get("currentStep", 0)
    total = session.get("totalSteps", 0)

    # Also check nested state (chain_run_registry format)
    if current == 0 and total == 0:
        chain_state = session.get("state", {})
        if isinstance(chain_state, dict):
            current = chain_state.get("currentStep", 0)
            total = chain_state.get("totalSteps", 0)

    if not _is_projected_run_visible(current, total):
        return None

    result: dict[str, object] = {
        "chain_id": session.get("chainId", session.get("chain_id", "")),
        "current_step": current,
        "total_steps": total,
        "pending_gate": None,
        "gate_criteria": [],
        "last_prompt_id": "",
        "pending_shell_verify": None,
        "shell_verify_attempts": 0,
    }

    gate_review = session.get("currentStepReview")
    if gate_review and isinstance(gate_review, dict):
        gate_ids = gate_review.get("gateIds", [])
        if gate_ids:
            result["pending_gate"] = label_gate_ids(gate_ids)
        result["shell_verify_attempts"] = gate_review.get("attemptCount", 0)

    shell_verify = session.get("pendingShellVerification")
    if shell_verify and isinstance(shell_verify, dict):
        cmd_info = shell_verify.get("shellVerify", {})
        result["pending_shell_verify"] = cmd_info.get("command")
        result["shell_verify_attempts"] = shell_verify.get("attemptCount", 0)

    return result


def _parse_metadata(metadata_json: str | None) -> dict:
    """Parse metadata_json column, returning empty dict on failure."""
    if not metadata_json:
        return {}
    try:
        return json.loads(metadata_json)
    except (json.JSONDecodeError, TypeError):
        return {}
