// @lifecycle canonical - Where the CLI looks for state.db, and nothing else.
/**
 * Resolving `state.db`'s location for a `cpm` process.
 *
 * Its own module because it answers one question — WHICH FILE — and answers it from the
 * environment alone, with no SQL and no knowledge of what the file holds. Split out of
 * `version-history.ts` when that file crossed the 1000-line gate; a pure move.
 */

import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import { resolveSettingPath } from '#shared/utils/path-setting.js';
import {
  RUNTIME_STATE_DIR_NAME,
  STATE_DB_FILE_NAME,
} from '#shared/utils/runtime-state-location.js';

/** First of `values` that is set and not all-whitespace, else `undefined`. */
function firstNonEmptyEnvValue(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolve `state.db`'s location the way the server does, without importing the server.
 *
 * Restates `PathResolver.getRuntimeRoot()` / `getStateDatabasePath()` (`server/src/runtime/
 * paths.ts`) rather than importing it: `validate:arch`'s `cli-shared-no-runtime` rule forbids
 * `cli-shared/` from reaching `runtime/` even transitively, because the CLI bundles this barrel
 * on its own, for a lower Node floor than the server's — >=18.18.0 vs >=22.13.0, per this repo's
 * root CLAUDE.md §Node.js Support Boundaries. The precedence is env-only, which is what a
 * standalone CLI process can actually observe; the server's `--workspace` CLI flag and
 * package-root fallback have no CLI-side equivalent:
 *
 *   1. `MCP_RUNTIME_ROOT`, if set to a non-empty value — matches `getRuntimeRoot()`'s own first
 *      branch exactly.
 *   2. `MCP_WORKSPACE`, if set to a non-empty value — matches `getRuntimeRoot()` falling back to
 *      `getWorkspace()`, whose own first two branches (`--workspace` flag, then this variable)
 *      collapse to this one for a CLI process.
 *   3. Neither set: fall back to discovering an existing `runtime-state/` by walking up from the
 *      resource directory, as this function always did. There is no env-derived root to trust in
 *      that case, and this keeps a bare local checkout — no plugin, no env vars — working as it
 *      always has.
 *
 * Branches 1 and 2 resolve through `resolveSettingPath`, the exact function `PathResolver` itself
 * calls for both variables, so a relative value is resolved against the CLI's cwd the same way the
 * server resolves it against its own.
 */
export function resolveStateDbPath(resourceDir: string): string | null {
  const envRoot = firstNonEmptyEnvValue(
    process.env['MCP_RUNTIME_ROOT'],
    process.env['MCP_WORKSPACE']
  );
  if (envRoot !== undefined) {
    return join(resolveSettingPath(envRoot), RUNTIME_STATE_DIR_NAME, STATE_DB_FILE_NAME);
  }

  let current = normalize(resourceDir);
  for (;;) {
    const runtimeStateDir = join(current, RUNTIME_STATE_DIR_NAME);
    if (existsSync(runtimeStateDir)) {
      return join(runtimeStateDir, STATE_DB_FILE_NAME);
    }
    const serverRuntimeStateDir = join(current, 'server', RUNTIME_STATE_DIR_NAME);
    if (existsSync(serverRuntimeStateDir)) {
      return join(serverRuntimeStateDir, STATE_DB_FILE_NAME);
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
