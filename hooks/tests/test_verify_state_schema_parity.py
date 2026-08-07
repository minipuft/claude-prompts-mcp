"""
Cross-language schema parity for `verify-state.db`.

WHY THIS FILE EXISTS INSTEAD OF A DELETED DDL
---------------------------------------------
`verify_active_state` is created by two independent writers: `VerifyActiveStateStore.ensureSchema()`
in TypeScript and `_ensure_schema()` here in Python. The remediation plan (Tier 6.2) proposed
deleting one copy as the cheap fix — the same drift shape that made a `cpm` invocation able to stop
the server booting (Tier 6.1).

That fix does not apply here, and the difference is worth stating because it is not obvious:

  * In `state.db`, `SqliteEngine` is a genuine OWNER and the CLI is a guest. One side can be told
    to stop creating tables.
  * In `verify-state.db` there is no owner. `save_verify_active_state()` is part of the
    `hooks/lib/*` module API that downstream plugins import (declared public surface in CLAUDE.md),
    so it has to work when nothing else has run. Deleting this DDL was measured against the suite
    and breaks 3 tests in `test_integration_ralph_delegation.py`, which create the database cold
    with no TypeScript process in sight.

So both copies stay, and the actual risk — that two identical DDLs drift apart silently — is closed
by comparing them instead. The comparison is on EFFECTIVE schema, not text: each DDL is executed
into its own in-memory database and the resulting `PRAGMA table_info` is compared, so formatting,
quoting and clause order are free to differ while a real divergence fails.
"""

import re
import sqlite3
import sys
from pathlib import Path

import pytest

HOOKS_LIB = Path(__file__).resolve().parent.parent / "lib"
if str(HOOKS_LIB) not in sys.path:
    sys.path.insert(0, str(HOOKS_LIB))

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TS_STORE = REPO_ROOT / "server" / "src" / "engine" / "gates" / "shell" / "verify-active-state-store.ts"
PY_STORE = HOOKS_LIB / "verify_active_store.py"

TABLE = "verify_active_state"
CREATE_RE = re.compile(
    r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+" + TABLE + r"\s*\((.*?)\)\s*;?",
    re.IGNORECASE | re.DOTALL,
)


def _extract_create_table(source_file: Path) -> str:
    """Pull the CREATE TABLE for verify_active_state out of a source file.

    Raises AssertionError naming the file if it is absent — a writer that stopped declaring the
    table is exactly the change this test exists to notice, and a silent skip would hide it.
    """
    text = source_file.read_text(encoding="utf-8")
    match = CREATE_RE.search(text)
    if not match:
        raise AssertionError(f"No CREATE TABLE {TABLE} found in {source_file}")
    return f"CREATE TABLE {TABLE} ({match.group(1)})"


def _effective_schema(ddl: str) -> list[tuple]:
    """Execute the DDL and return PRAGMA table_info, so only real differences register."""
    conn = sqlite3.connect(":memory:")
    try:
        conn.execute(ddl)
        # (cid, name, type, notnull, dflt_value, pk) — cid dropped: column ORDER is not a contract,
        # since every access site in both languages names its columns explicitly.
        return sorted(tuple(row[1:]) for row in conn.execute(f"PRAGMA table_info({TABLE})"))
    finally:
        conn.close()


@pytest.fixture(scope="module")
def schemas() -> dict[str, list[tuple]]:
    return {
        "typescript": _effective_schema(_extract_create_table(TS_STORE)),
        "python": _effective_schema(_extract_create_table(PY_STORE)),
    }


def test_both_writers_declare_the_same_effective_schema(schemas):
    assert schemas["typescript"] == schemas["python"], (
        f"verify_active_state has drifted between its two writers.\n"
        f"  {TS_STORE.relative_to(REPO_ROOT)}: {schemas['typescript']}\n"
        f"  {PY_STORE.relative_to(REPO_ROOT)}: {schemas['python']}\n"
        "Neither is the owner — this table has two legitimate first-writers, so both copies must "
        "be updated together."
    )


def test_the_shared_shape_is_the_one_both_languages_query(schemas):
    """Guards the column names every read and write in both languages spells out."""
    names = {column[0] for column in schemas["python"]}
    assert names == {"session_id", "state_json", "updated_at"}


def test_session_id_is_the_primary_key_on_both_sides(schemas):
    """Single-slot-per-session is the behaviour `save_verify_active_state` relies on.

    It writes with INSERT OR REPLACE, which silently becomes an append if the primary key is ever
    dropped — a second save would stop overwriting the first and the Stop hook would read a stale
    iteration count.
    """
    for language, schema in schemas.items():
        pk = [column[0] for column in schema if column[4]]
        assert pk == ["session_id"], f"{language} lost the session_id primary key: {schema}"
