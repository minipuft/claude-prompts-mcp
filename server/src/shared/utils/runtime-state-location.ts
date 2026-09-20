// @lifecycle canonical - Names the two path segments state.db lives under.
/**
 * Runtime State Location
 *
 * `<runtime root>/runtime-state/state.db` is one path. `runtime/paths.ts`'s `PathResolver`
 * composes it against the resolved runtime root and is the one place under `src/` allowed to —
 * `scripts/validate-db-claim-order.js` fails any OTHER file that names either segment as a quoted
 * literal, so a second hand-typed copy cannot silently drift from the first.
 *
 * The standalone CLI (`cli-shared/version-history.ts`) needs the same two segment names to find
 * the same file, and cannot import `runtime/paths.ts` itself: `validate:arch`'s
 * `cli-shared-no-runtime` rule forbids `cli-shared/` from reaching `runtime/`, `infra/` or `mcp/`
 * even transitively, because the CLI bundles this barrel on its own, for a lower Node floor than
 * the server's (>=18.18.0 vs >=22.13.0 — this repo's root CLAUDE.md §Node.js Support Boundaries).
 *
 * These two constants are the shared definition both sides name instead of each hand-typing its
 * own copy of `'runtime-state'` / `'state.db'`. This file is declared as a second owner alongside
 * `runtime/paths.ts` in `scripts/validate-db-claim-order.js`.
 */

/** The directory `state.db` (and its siblings, e.g. `verify-state.db`) live under. */
export const RUNTIME_STATE_DIR_NAME = 'runtime-state';

/** The server's primary SQLite database file name, inside `RUNTIME_STATE_DIR_NAME`. */
export const STATE_DB_FILE_NAME = 'state.db';
