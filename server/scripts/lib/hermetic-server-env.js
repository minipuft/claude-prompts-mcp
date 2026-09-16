/**
 * The one list of ambient variables a spawned server must not inherit, and the one builder.
 *
 * A process that boots this server and reports on what it serves — an e2e test, `verify:mcp`, the
 * schema snapshot capture — is only meaningful if the SPAWNER decides where that server reads
 * from. Spreading the caller's environment hands the decision to whoever ran it, and both failure
 * directions are silent:
 *
 *   - `NODE_ENV=test` / `JEST_WORKER_ID`: `src/index.ts` declines to run `main()`, so the child
 *     starts, does nothing, and exits 0. The only symptom is a request that never gets an answer.
 *   - `MCP_RESOURCES_PATH` / `MCP_WORKSPACE` / `MCP_RUNTIME_ROOT` / `MCP_CONFIG_PATH`: the child
 *     reads the operator's own library, state and config instead of the tree the spawner meant.
 *     Measured 2026-08-29: `bundled-resource-fallback.e2e.test.ts` booted against 121 personal
 *     prompts while asserting about a fixture holding one.
 *
 * WHY PLAIN JS IN `scripts/lib`. The consumers straddle a boundary: `node`-run `.mjs`/`.js`
 * scripts cannot import TypeScript without a build step, while the Jest suite can import a `.js`
 * module (the `exception-hygiene.js` arrangement). So the list lives here, typed for the tests by
 * `hermetic-server-env.d.ts`, and `tests/e2e/helpers/child-env.ts` re-exports the builder.
 * Before 2026-09-14 the e2e helper held the list and four scripts each kept their own subset;
 * three of them scrubbed only the jest markers, including the one that writes the committed
 * `tests/snapshots/mcp-input-schemas.json`.
 *
 * `validate:hermetic-child-env` fails any server spawn that builds its environment elsewhere.
 *
 * ── HOME IS SET, NEVER SCRUBBED ──────────────────────────────────────────────────────────────
 *
 * `HOME` is the one sink on this list that a scrub makes WORSE, so it is the one entry that is
 * required rather than deleted. Two independent fallbacks defeat a scrub, measured 2026-09-15:
 *
 *   - `os.homedir()` consults `$HOME` first and otherwise looks the effective uid up in the
 *     passwd database, so a child with no `HOME` resolves the developer's real home anyway.
 *   - `skills-sync`'s own tilde expansion is `path.join(process.env['HOME'] ?? '', dir.slice(1))`
 *     (`src/modules/skills-sync/service.ts`), so an unset `HOME` turns `~/.claude/skills` into a
 *     path resolved against the child's cwd — a write into the repository instead.
 *
 * What is at stake is not a stale read. A `system_control skills_sync export` writes the client
 * skill folders under `$HOME`: measured 2026-09-15 against a temp home, one ordinary export
 * (`operation: export, client: claude-code, scope: user` — no preview, refused by nothing) wrote
 * **224 files** under `$HOME/.claude/skills`. Every spawn site here inherited the developer's real
 * `HOME` until this contract existed, so nothing but the absence of such a scenario in the suite
 * stood between a green test run and 224 files overwriting a real `~/.claude/skills`.
 *
 * So `buildServerEnv` REFUSES to build an environment that does not name an isolated `HOME`. A
 * throw, not a lint finding, because this is the one leak that lands OUTSIDE the repository where
 * no working-tree gate can see it — `tests/helpers/tree-state-guard.cjs` catches every sibling
 * leak empirically, and cannot catch this one. `validate:hermetic-child-env` enforces the same
 * requirement statically, so a new spawn site fails the validation suite rather than waiting for
 * someone to run it.
 *
 * Pair the two roots with `createHermeticRoots()`: it hands back `HOME` and `MCP_RUNTIME_ROOT`
 * in a single `env` object, because they are the two directories a spawned server WRITES into and
 * a caller given one without the other leaks through whichever it was not given.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Variables that must never reach a spawned server from the ambient environment.
 *
 * Jest markers make the child decline to boot; path overrides make it read the wrong tree. A
 * spawner that wants any of these passes it in `overrides`, which is applied after the scrub.
 *
 * `HOME` is deliberately absent — see the header. Deleting it does not isolate the child, it
 * only changes which wrong directory the child resolves. It is required in `overrides` instead.
 */
const SCRUBBED_KEYS = Object.freeze([
  'NODE_ENV',
  'JEST_WORKER_ID',
  // Jest's `--experimental-vm-modules`, which the child neither needs nor should inherit.
  'NODE_OPTIONS',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_RUNTIME_ROOT',
  'MCP_CONFIG_PATH',
]);

/**
 * The directories this process would call its own — every spelling a supplied `HOME` must not be.
 *
 * Both are read, not one: `$HOME` is what the child's `process.env['HOME']` lookups would find,
 * and `os.homedir()` is what its `os.homedir()` calls would find. They disagree exactly when
 * someone has already set `HOME` to something, which is the case a presence check would pass.
 */
function ownHomeDirectories() {
  const candidates = [process.env['HOME'], os.homedir()];
  return candidates.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

/** `parent` is `child` or contains it. */
function contains(parent, child) {
  if (parent === child) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/**
 * Refuse any `HOME` that is not a directory this run owns.
 *
 * Checked as a PROPERTY (does this path reach the developer's home?) rather than as a token (is
 * the key present?), because the obvious way to satisfy a presence check is
 * `HOME: process.env.HOME`, which is the defect spelled as a fix. The ancestor case is refused
 * for the same reason: `HOME: '/home'` passes an equality test and still puts
 * `~minipuft/.claude` one directory away.
 *
 * @param {unknown} home
 */
function assertIsolatedHome(home) {
  const hint =
    'Build the pair with createHermeticRoots() from scripts/lib/hermetic-server-env.js and ' +
    'spread its `env`: buildServerEnv({ ...roots.env, PORT: String(port) }).';

  if (typeof home !== 'string' || home.length === 0) {
    throw new Error(
      '[hermetic-server-env] buildServerEnv() requires an isolated HOME override. A spawned ' +
        "server inherits the developer's real home otherwise, and a skills_sync export writes " +
        `client skill folders there (224 files, measured 2026-09-15). ${hint}`
    );
  }
  if (!path.isAbsolute(home)) {
    throw new Error(
      `[hermetic-server-env] HOME must be an absolute path; received ${JSON.stringify(home)}. ` +
        'A relative home resolves against the child cwd, which is inside the repository. ' +
        hint
    );
  }

  const resolved = path.resolve(home);
  for (const own of ownHomeDirectories()) {
    const ownResolved = path.resolve(own);
    if (contains(resolved, ownResolved)) {
      throw new Error(
        `[hermetic-server-env] HOME ${JSON.stringify(resolved)} reaches this process's own home ` +
          `${JSON.stringify(ownResolved)}, so the child can write the developer's real client ` +
          `skill folders. ${hint}`
      );
    }
  }
}

/**
 * A temp `HOME` and a temp runtime root, created together.
 *
 * They are returned as one `env` object rather than two fields because they fail as a pair: a
 * server given an isolated `HOME` and no `MCP_RUNTIME_ROOT` still writes `runtime-state/state.db`
 * and `logs/mcp-server.log` into whatever it resolves as its workspace, which for every spawn
 * site in this repository is the repository (measured 2026-09-15: a fully green `test:e2e` left
 * `logs/`, `runtime-state/` and `server/runtime-state/` behind). Handing back one field makes the
 * half-adoption unspellable.
 *
 * @param {string} [label] - Prefix for the temp directory, so a leaked one names its creator.
 * @returns {{ root: string, home: string, runtimeRoot: string, env: { HOME: string, MCP_RUNTIME_ROOT: string }, cleanup: () => void }}
 */
export function createHermeticRoots(label = 'hermetic-server') {
  const root = mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  const home = path.join(root, 'home');
  const runtimeRoot = path.join(root, 'runtime');
  mkdirSync(home, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });

  return {
    root,
    home,
    runtimeRoot,
    env: { HOME: home, MCP_RUNTIME_ROOT: runtimeRoot },
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

/**
 * Inherit the ambient environment, scrub what would decide the spawner's answer, then apply
 * overrides.
 *
 * Throws unless `overrides.HOME` names a directory outside this process's own home — see the
 * header for why that one key is required rather than scrubbed.
 *
 * @param {Record<string, string>} [overrides] - Deliberate settings, applied after the scrub.
 * @returns {NodeJS.ProcessEnv}
 */
export function buildServerEnv(overrides = {}) {
  assertIsolatedHome(overrides['HOME']);

  const env = { ...process.env };
  for (const key of SCRUBBED_KEYS) delete env[key];
  return { ...env, ...overrides };
}
