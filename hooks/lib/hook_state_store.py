"""
SQLite-backed state store for hook-local session state.

This module owns runtime-state/hooks-state.db for hook-only state and keeps
server/runtime-state/state.db read-only from hooks.
"""

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

from workspace import get_runtime_state_dir

LOCK_RETRIES = 80
LOCK_RETRY_DELAY_SECONDS = 0.025
STALE_LOCK_SECONDS = 30
TABLE_CHAIN_SESSION_STATE = "chain_session_state"
TABLE_RALPH_SESSION_STATE = "ralph_session_state"
TABLE_NAMES = {TABLE_CHAIN_SESSION_STATE, TABLE_RALPH_SESSION_STATE}


def get_hooks_state_db_path() -> Path:
    """Get path to hooks-state.db in runtime-state."""
    dev_fallback = Path(__file__).parent.parent.parent / "runtime-state"
    runtime_dir = get_runtime_state_dir(dev_fallback)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    return runtime_dir / "hooks-state.db"


def get_state_ref(table_name: str, session_id: str) -> str:
    """Build a stable runtime-state relative pointer for task metadata."""
    _validate_table_name(table_name)
    return f"runtime-state/hooks-state.db#{table_name}/{session_id}"


def load_state(table_name: str, session_id: str) -> dict[str, Any] | None:
    """Load JSON state for a session row."""
    _validate_table_name(table_name)
    db_path = get_hooks_state_db_path()
    if not db_path.exists():
        return None

    try:
        conn = _connect()
        _ensure_schema(conn)
        row = conn.execute(
            f"SELECT state_json FROM {table_name} WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        conn.close()
        if row is None:
            return None
        raw = row["state_json"]
        if not isinstance(raw, str) or raw.strip() == "":
            return None
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return None
    except (sqlite3.Error, json.JSONDecodeError):
        return None


def save_state(table_name: str, session_id: str, state: dict[str, Any]) -> None:
    """Persist JSON state for a session row."""
    _validate_table_name(table_name)
    _acquire_lock()
    try:
        conn = _connect()
        _ensure_schema(conn)
        conn.execute(
            f"""
            INSERT OR REPLACE INTO {table_name} (session_id, state_json, updated_at)
            VALUES (?, ?, datetime('now'))
            """,
            (session_id, json.dumps(state)),
        )
        conn.commit()
        conn.close()
    finally:
        _release_lock()


def delete_state(table_name: str, session_id: str) -> None:
    """Delete state for a session row."""
    _validate_table_name(table_name)
    _acquire_lock()
    try:
        conn = _connect()
        _ensure_schema(conn)
        conn.execute(f"DELETE FROM {table_name} WHERE session_id = ?", (session_id,))
        conn.commit()
        conn.close()
    finally:
        _release_lock()


def _validate_table_name(table_name: str) -> None:
    if table_name not in TABLE_NAMES:
        raise ValueError(f"Unsupported hook state table: {table_name}")


def _get_lock_path() -> Path:
    return Path(f"{get_hooks_state_db_path()}.lock")


def _acquire_lock() -> None:
    lock_path = _get_lock_path()
    # Clear stale locks (e.g. from crashes) older than STALE_LOCK_SECONDS
    try:
        lock_stat = lock_path.stat()
        if time.time() - lock_stat.st_mtime > STALE_LOCK_SECONDS:
            lock_path.unlink()
    except FileNotFoundError:
        pass
    for _ in range(LOCK_RETRIES):
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return
        except FileExistsError:
            time.sleep(LOCK_RETRY_DELAY_SECONDS)
    raise TimeoutError(f"Timed out acquiring hooks-state lock: {lock_path}")


def _release_lock() -> None:
    lock_path = _get_lock_path()
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(get_hooks_state_db_path()), timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chain_session_state (
            session_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ralph_session_state (
            session_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def cleanup_stale_rows(max_age_hours: int = 24) -> int:
    """Delete rows older than max_age from all tables. Returns count deleted."""
    db_path = get_hooks_state_db_path()
    if not db_path.exists():
        return 0

    _acquire_lock()
    try:
        conn = _connect()
        _ensure_schema(conn)
        total = 0
        for table in TABLE_NAMES:
            cursor = conn.execute(
                f"DELETE FROM {table} WHERE updated_at < datetime('now', ?)",
                (f"-{max_age_hours} hours",),
            )
            total += cursor.rowcount
        conn.commit()
        conn.close()
        return total
    finally:
        _release_lock()
