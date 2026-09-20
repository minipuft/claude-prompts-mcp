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
