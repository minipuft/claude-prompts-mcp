// @lifecycle test - The one place a spawned server's environment is constructed.
/**
 * The environment for a server this suite spawns.
 *
 * A test that boots a server and asserts on what it serves is only meaningful if the test decides
 * where the server reads from. Spreading `...process.env` hands that decision to whoever ran jest,
 * and the failure is silent in both directions:
 *
 *   - `NODE_ENV=test` / `JEST_WORKER_ID`: `src/index.ts` refuses to run `main()`, so the child
 *     starts, does nothing, and exits 0. No output, no error, no spawn failure — the only symptom
 *     is a request that never gets an answer, which reads like a protocol bug.
 *   - `MCP_RESOURCES_PATH` / `MCP_WORKSPACE` / `MCP_RUNTIME_ROOT` / `MCP_CONFIG_PATH`: the child
 *     reads the developer's own resource library instead of the fixture. Measured 2026-08-29: with
 *     `MCP_RESOURCES_PATH` exported — a supported way to point the server at a personal store —
 *     `bundled-resource-fallback.e2e.test.ts` booted against 121 personal prompts while asserting
 *     about a fixture holding one. Its assertion was `> 1`, so it passed, and the leak stayed
 *     invisible until a stricter case landed beside it.
 *
 * Every spawn in `tests/e2e` goes through here, and `validate:hermetic-child-env` fails a new one
 * that does not. Four sites had grown their own copy, each scrubbing a different subset.
 */

/**
 * Variables that must never reach a spawned server from the ambient environment.
 *
 * Jest markers make the child decline to boot; path overrides make it read the wrong tree. A test
 * that wants any of these passes it in `overrides`, which is applied after the scrub.
 */
const SCRUBBED_KEYS = [
  'NODE_ENV',
  'JEST_WORKER_ID',
  // Jest's `--experimental-vm-modules`, which the child neither needs nor should inherit.
  'NODE_OPTIONS',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_RUNTIME_ROOT',
  'MCP_CONFIG_PATH',
] as const;

/** Inherit the ambient environment, scrub what would decide the test's answer, then apply overrides. */
export function buildServerEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SCRUBBED_KEYS) delete env[key];
  return { ...env, ...overrides };
}
