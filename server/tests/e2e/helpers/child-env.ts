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
 *   - `HOME`: a `system_control skills_sync export` writes client skill folders under `$HOME`.
 *     Measured 2026-09-15 against a temp home: one ordinary export wrote 224 files into
 *     `$HOME/.claude/skills`, refused by nothing. Every spawn here inherited the developer's real
 *     home until `buildServerEnv` started requiring an isolated one, so only the absence of such
 *     a scenario in this suite stood between a green run and a real `~/.claude/skills` overwrite.
 *     `HOME` is REQUIRED rather than scrubbed — an unset one falls back to the passwd entry.
 *
 * The scrub list and the builder live in `scripts/lib/hermetic-server-env.js`, because the scripts
 * that spawn the built server (`verify:mcp`, the tool-schema snapshot capture) are plain node and
 * cannot import TypeScript. Every spawn in `tests/e2e` goes through here, every server spawn in
 * `scripts` imports that module, and `validate:hermetic-child-env` fails a new one that does
 * neither.
 *
 * A THIRD silent failure lives at the same chokepoint: every `tests/e2e/*.ts` spawn of the built
 * server names `dist/index.js`, which does not track `src/` automatically. A stale build makes a
 * suite fail (or pass) against code that is not running — measured against
 * `prompt-quarantine.e2e.test.ts`, which failed expecting wording only `src/` had while `dist/`
 * still served the old string, costing ~20 minutes of triage before the mismatch was traced to a
 * build, not a regression. `verify-mcp-surface.mjs` already carried this exact refusal for its own
 * spawn; `buildServerEnv` below reuses that logic (`scripts/lib/dist-freshness.js`) rather than
 * re-deriving it, so every e2e file gets it for free through this one function.
 *
 * Use `createHermeticRoots()` for the `HOME` + `MCP_RUNTIME_ROOT` pair; `startServerWithHttp`
 * already creates a pair per spawn and tears it down in `killServer`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv as buildServerEnvBase } from '../../../scripts/lib/hermetic-server-env.js';
import { checkDistFreshness } from '../../../scripts/lib/dist-freshness.js';

export {
  createHermeticRoots,
  type HermeticRoots,
} from '../../../scripts/lib/hermetic-server-env.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
const SRC_DIR = path.join(SERVER_ROOT, 'src');

export function buildServerEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const freshness = checkDistFreshness(DIST_ENTRY, SRC_DIR);
  if (!freshness.fresh) {
    throw new Error(
      `buildServerEnv: refusing to prepare an environment for a stale ${DIST_ENTRY} — ` +
        `${freshness.reason}. Every tests/e2e spawn of the built server funnels through here — ` +
        'run `npm run build` before this suite.'
    );
  }
  return buildServerEnvBase(overrides);
}
