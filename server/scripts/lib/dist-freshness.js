/**
 * Is a built entry point at least as new as everything under its source tree?
 *
 * `dist/` is the runtime SSOT and does not track `src/` automatically. Verifying — or spawning —
 * a stale binary is worse than not doing either: it returns a result for code that is not
 * running. Measured 2026-07-31 (a wasted Claude Code restart: `dist/` was three hours older than
 * the change under test) and again ahead of 2026-09-15 (`prompt-quarantine.e2e.test.ts` failed
 * expecting new wording while `src/` had it and `dist/` still had the old — ~20 minutes of triage
 * before the mismatch was traced to a stale build rather than a defect in the code under test).
 *
 * Extracted from `verify-mcp-surface.mjs`'s `checkDistFreshness`, which owned this logic first —
 * `tests/e2e/helpers/child-env.ts` reuses it rather than re-deriving a second copy, since every
 * `tests/e2e/*.ts` spawn of `dist/index.js` funnels through `buildServerEnv` there.
 *
 * WHY PLAIN JS IN `scripts/lib`. `scripts/verify-mcp-surface.mjs` is a node-run script outside
 * both tsconfigs and cannot import TypeScript; `tests/e2e/helpers/child-env.ts` is inside
 * `tsconfig.test.json` and can import a `.js` module directly. One file, typed for the TS side by
 * `dist-freshness.d.ts` — same arrangement as `hermetic-server-env.js`/`.d.ts`.
 *
 * NOT folded into `hermetic-server-env.js`'s `buildServerEnv`: that function is called by
 * `scripts/verify-package-artifact.js` to spawn a server extracted from a freshly packed npm
 * tarball into an unrelated temp directory, not this checkout's `server/dist/index.js` — comparing
 * that binary's mtime against THIS repo's `src/` would refuse a legitimately fresh artifact for an
 * unrelated reason. The check belongs where the specific `distEntry`/`srcDir` pair is known, not
 * inside the generic env builder every spawner shares.
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Newest mtime under a directory, ignoring nothing — staleness must not be under-reported. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/**
 * @param {string} distEntry - Absolute path to the built entry point (e.g. `dist/index.js`).
 * @param {string} srcDir - Absolute path to the source tree the entry is built from.
 * @returns {
 *   | { fresh: true, builtAt: number }
 *   | { fresh: false, kind: 'missing' | 'stale', reason: string }
 * }
 */
export function checkDistFreshness(distEntry, srcDir) {
  let distMtime;
  try {
    distMtime = statSync(distEntry).mtimeMs;
  } catch {
    return {
      fresh: false,
      kind: 'missing',
      reason: `${distEntry} missing — run \`npm run build\``,
    };
  }

  const srcMtime = newestMtime(srcDir);
  if (srcMtime > distMtime) {
    const lagMin = Math.round((srcMtime - distMtime) / 60_000);
    return {
      fresh: false,
      kind: 'stale',
      reason:
        `${distEntry} is ${lagMin < 1 ? '<1' : lagMin} min stale relative to ${srcDir} — ` +
        `run \`npm run build\` first`,
    };
  }
  return { fresh: true, builtAt: distMtime };
}
