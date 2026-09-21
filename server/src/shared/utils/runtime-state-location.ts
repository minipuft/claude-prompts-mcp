// @lifecycle canonical - The one definition of the two path segments state.db lives under.
/**
 * Runtime State Location
 *
 * `<runtime root>/runtime-state/state.db` is one path, and these two constants are its ONLY
 * definition under `src/`. `runtime/paths.ts`'s `PathResolver` composes the path by importing
 * `RUNTIME_STATE_DIR_NAME` / `STATE_DB_FILE_NAME` from here rather than naming either segment
 * itself — `scripts/validate-db-claim-order.js` fails any file under `src/` that names either
 * segment as a quoted literal, this file included in that rule; the two `export const` lines
 * below are exempted as the declaration, not a second literal site.
 *
 * The standalone CLI (`cli-shared/version-history.ts`) needs the same two segment names to find
 * the same file, and cannot import `runtime/paths.ts` itself: `validate:arch`'s
 * `cli-shared-no-runtime` rule forbids `cli-shared/` from reaching `runtime/`, `infra/` or `mcp/`
 * even transitively, because the CLI bundles this barrel on its own, for a lower Node floor than
 * the server's (>=18.18.0 vs >=22.13.0 — this repo's root CLAUDE.md §Node.js Support Boundaries).
 *
 * So both the server and the CLI import these constants instead of each hand-typing its own copy
 * of `'runtime-state'` / `'state.db'` — there is one owner of the literals, not two that could
 * silently drift apart.
 */

/** The directory `state.db` (and its siblings, e.g. `verify-state.db`) live under. */
export const RUNTIME_STATE_DIR_NAME = 'runtime-state';

/** The server's primary SQLite database file name, inside `RUNTIME_STATE_DIR_NAME`. */
export const STATE_DB_FILE_NAME = 'state.db';

/**
 * How long a connection to `state.db` waits for a lock another connection holds, in milliseconds.
 *
 * One file, several processes: the server, `cpm`, and the Python hooks all open it, so a writer
 * meeting a held lock is ordinary operation, not an incident. The choice a `busy_timeout` makes is
 * therefore between WAITING and FAILING, and failing fast is only correct if nobody would have
 * finished in time — which is false here, where every transaction against this file is a handful of
 * statements. Unset (SQLite's default 0) the loser of a race gets `SQLITE_BUSY` immediately, which
 * surfaced as a thrown version save rather than as the brief wait it should be.
 *
 * It lives beside the path segments for the same reason they do: the CLI opens its own connection
 * and cannot import `runtime/`, so without one owner there would be two hand-typed values that
 * drift, and the pair would disagree about how patient the file is. The Python hooks are the third
 * reader and cannot import this at all — they open read-only and inherit `sqlite3.connect`'s own
 * 5-second default, which is the same number by coincidence rather than by contract. Changing this
 * value means checking `hooks/lib/db_reader.py` too.
 */
export const STATE_DB_BUSY_TIMEOUT_MS = 5000;

/**
 * Every per-connection PRAGMA a WRITER of `state.db` must set, in order, as one list.
 *
 * `busy_timeout` already lived here because both writers need the same value and the CLI cannot
 * import `runtime/`. `foreign_keys` joins it for a sharper reason: without this line the schema's
 * foreign keys are still enforced, because `node:sqlite`'s `DatabaseSync` turns them on by
 * default — measured 2026-09-20, `PRAGMA foreign_keys` reads 1 on a fresh connection. That is a
 * property of the DRIVER, not a commitment this repository makes, and since schema v29 the
 * correctness of `version_entries` depends on it: the manifest's `ON DELETE CASCADE` and the
 * object store's `ON DELETE RESTRICT` are what stop a delete from stranding rows.
 *
 * So the line is an ASSERTION, and it is honest about what it can and cannot prove. Removing it
 * changes no behaviour on this driver today, and no test can be written that goes red when it is
 * deleted — say so rather than pretending otherwise. What it buys is that a driver default change,
 * a Node version whose `DatabaseSync` decides differently, or a new opener written from this list
 * cannot silently withdraw the guarantee. What IS testable, and is tested, is the behaviour itself
 * and the live value on each opener's connection.
 *
 * NOT `journal_mode=WAL`: that one is written into the database file and persists, so it belongs
 * to whoever creates the file (the engine) rather than to every connection.
 *
 * The Python hooks are a third opener and cannot import this. `db_reader.py` connects read-only
 * (`mode=ro`) through `sqlite3`, where foreign keys default to OFF — which costs nothing, because
 * a reader cannot violate a constraint.
 */
export const STATE_DB_WRITER_PRAGMAS: readonly string[] = [
  `PRAGMA busy_timeout = ${STATE_DB_BUSY_TIMEOUT_MS}`,
  'PRAGMA foreign_keys = ON',
];
