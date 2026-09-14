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
 */

/**
 * Variables that must never reach a spawned server from the ambient environment.
 *
 * Jest markers make the child decline to boot; path overrides make it read the wrong tree. A
 * spawner that wants any of these passes it in `overrides`, which is applied after the scrub.
 */
export const SCRUBBED_KEYS = Object.freeze([
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
 * Inherit the ambient environment, scrub what would decide the spawner's answer, then apply
 * overrides.
 *
 * @param {Record<string, string>} [overrides] - Deliberate settings, applied after the scrub.
 * @returns {NodeJS.ProcessEnv}
 */
export function buildServerEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of SCRUBBED_KEYS) delete env[key];
  return { ...env, ...overrides };
}
