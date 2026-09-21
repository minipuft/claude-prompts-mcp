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
