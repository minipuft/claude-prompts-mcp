"""
SQLite-backed verify-active state store for Ralph loop hooks.

This stores verify-active hook state in runtime-state/verify-state.db.
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


def get_verify_state_db_path() -> Path:
    """Get path to verify-state.db in runtime-state."""
    dev_fallback = Path(__file__).parent.parent.parent / "runtime-state"
    runtime_dir = get_runtime_state_dir(dev_fallback)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    return runtime_dir / "verify-state.db"


def _get_lock_path() -> Path:
    return Path(f"{get_verify_state_db_path()}.lock")


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
    raise TimeoutError(f"Timed out acquiring verify-state lock: {lock_path}")


def _release_lock() -> None:
    lock_path = _get_lock_path()
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


def _connect() -> sqlite3.Connection:
    db_path = get_verify_state_db_path()
    conn = sqlite3.connect(str(db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS verify_active_state (
            session_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def load_verify_active_state(session_id: str | None = None) -> dict[str, Any] | None:
    """Load verify-active state from SQLite.

    Args:
        session_id: If provided, load state for this specific session.
                    If None, load the first active row (any session).
    """
    db_path = get_verify_state_db_path()
    if not db_path.exists():
        return None

    try:
        conn = _connect()
        _ensure_schema(conn)
        if session_id:
            row = conn.execute(
                "SELECT state_json FROM verify_active_state WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT state_json FROM verify_active_state LIMIT 1",
            ).fetchone()
        conn.close()
        if row is None:
            return None
        raw = row["state_json"]
        if not isinstance(raw, str) or raw.strip() == "":
            return None
        return json.loads(raw)
    except (sqlite3.Error, json.JSONDecodeError):
        return None


def save_verify_active_state(state: dict[str, Any], session_id: str = "") -> None:
    """Persist verify-active state to SQLite.

    Args:
        state: The verify-active state dict.
        session_id: Claude Code session ID to scope this state to.
    """
    _acquire_lock()
    try:
        conn = _connect()
        _ensure_schema(conn)
        conn.execute(
            """
            INSERT OR REPLACE INTO verify_active_state (session_id, state_json, updated_at)
            VALUES (?, ?, datetime('now'))
            """,
            (session_id, json.dumps(state)),
        )
        conn.commit()
        conn.close()
    finally:
        _release_lock()


def clear_verify_active_state(session_id: str | None = None) -> None:
    """Clear verify-active state from SQLite.

    Args:
        session_id: If provided, clear only this session's state.
                    If None, clear ALL rows (used for full cleanup).
    """
    _acquire_lock()
    try:
        conn = _connect()
        _ensure_schema(conn)
        if session_id:
            conn.execute("DELETE FROM verify_active_state WHERE session_id = ?", (session_id,))
        else:
            conn.execute("DELETE FROM verify_active_state")
        conn.commit()
        conn.close()
    finally:
        _release_lock()
