// @lifecycle test - The e2e suite's entry point to the one server-environment builder.
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
 * The scrub list and the builder live in `scripts/lib/hermetic-server-env.js`, because the scripts
 * that spawn the built server (`verify:mcp`, the tool-schema snapshot capture) are plain node and
 * cannot import TypeScript. Every spawn in `tests/e2e` goes through here, every server spawn in
 * `scripts` imports that module, and `validate:hermetic-child-env` fails a new one that does
 * neither.
 */

export { buildServerEnv } from '../../../scripts/lib/hermetic-server-env.js';
