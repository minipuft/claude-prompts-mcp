"""
SQLite reader for Claude Code hooks.
Queries resource_index table from state.db as a read-only data source.

Replaces JSON cache file reads for prompts and gates.
Uses stdlib sqlite3 — no external dependencies.
"""

import json
import os
import sqlite3

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


def load_active_chain_state() -> dict | None:
    """Load active chain session state from server's execution SSOT.

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
    conn = _connect_readonly()
    if not conn:
        return None
    try:
        result = _load_from_execution_view(conn)
        if result is not None:
            return result

        return _load_from_session_table(conn)
    except (sqlite3.Error, json.JSONDecodeError, KeyError, TypeError):
        return None
    finally:
        conn.close()


def _load_from_execution_view(conn: sqlite3.Connection) -> dict | None:
    """Query v_execution_status — Tier 1 cross-language SSOT view.

    Boundary check uses run_status (Tier 2): rows with run_status in
    {completed, failed, cancelled} are excluded so the hook never reports a
    terminal chain as active. Rows with NULL run_status are retained (legacy
    rows from before Tier 2 landed) and reach the same in-progress check as
    the session-table fallback.
    """
    try:
        cursor = conn.execute(
            "SELECT run_owner_pid, chain_id, run_status, current_step, total_steps, "
            "last_activity, pending_gate_review, pending_shell_verification "
            "FROM v_execution_status "
            "WHERE run_status IS NULL "
            "OR run_status NOT IN ('completed', 'failed', 'cancelled') "
            "ORDER BY last_activity DESC, updated_at DESC"
        )
        rows = cursor.fetchall()
    except sqlite3.OperationalError:
        return None

    if not rows:
        return None

    for row in rows:
        pid_str = row["run_owner_pid"]
        try:
            pid = int(pid_str)
        except (ValueError, TypeError):
            continue
        if not _is_pid_alive(pid):
            continue

        hook_state = _view_row_to_hook_state(row)
        if hook_state is not None:
            return hook_state

    return None


def _view_row_to_hook_state(row: sqlite3.Row) -> dict | None:
    """Convert a v_execution_status row to the hook ChainState shape."""
    current = row["current_step"] or 0
    total = row["total_steps"] or 0

    pending_gate_review = _parse_json_field(row["pending_gate_review"])
    pending_shell_verification = _parse_json_field(row["pending_shell_verification"])

    has_pending_review = bool(pending_gate_review)
    has_pending_verify = bool(pending_shell_verification)
    in_progress = current > 0 and current < total
    pending_at_final = current > 0 and current == total and (has_pending_review or has_pending_verify)

    if not in_progress and not pending_at_final:
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

    if isinstance(pending_gate_review, dict):
        gate_ids = pending_gate_review.get("gateIds", [])
        if gate_ids:
            result["pending_gate"] = ", ".join(gate_ids)
        result["shell_verify_attempts"] = pending_gate_review.get("attemptCount", 0)

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


def _load_from_session_table(conn: sqlite3.Connection) -> dict | None:
    """Query chain_sessions per-row table. Returns session for a live PID, or None."""
    try:
        cursor = conn.execute("SELECT run_owner_pid, chain_id, state FROM chain_sessions ORDER BY updated_at DESC")
        rows = cursor.fetchall()
    except sqlite3.OperationalError:
        return None

    if not rows:
        return None

    for row in rows:
        pid_str = row["run_owner_pid"]
        try:
            pid = int(pid_str)
        except (ValueError, TypeError):
            continue
        if not _is_pid_alive(pid):
            continue

        state_json = row["state"]
        if not state_json:
            continue

        session = json.loads(state_json)
        return _session_to_hook_state(session)

    return None


# Run statuses that mean the run is over. Kept next to the reader that enforces them so the
# constant and its check cannot drift; mirrors isTerminalRunStatus() on the TypeScript side.
TERMINAL_RUN_STATUSES = frozenset({"completed", "failed", "cancelled"})


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

    has_pending_review = bool(session.get("pendingGateReview"))
    has_pending_verify = bool(session.get("pendingShellVerification"))
    in_progress = current > 0 and current < total
    pending_at_final = current > 0 and current == total and (has_pending_review or has_pending_verify)

    if not in_progress and not pending_at_final:
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

    gate_review = session.get("pendingGateReview")
    if gate_review and isinstance(gate_review, dict):
        gate_ids = gate_review.get("gateIds", [])
        if gate_ids:
            result["pending_gate"] = ", ".join(gate_ids)
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
