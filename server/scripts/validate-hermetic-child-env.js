#!/usr/bin/env node
/**
 * Every server spawned by the e2e suite must take its environment from `buildServerEnv`.
 *
 * A test that boots a server and asserts on what it serves is only meaningful if the TEST decides
 * where that server reads from. Spreading `...process.env` into the child hands the decision to
 * whoever ran jest, and both failure directions are silent:
 *
 *   - jest's own markers (`NODE_ENV=test`, `JEST_WORKER_ID`) make `src/index.ts` decline to run
 *     `main()`. The child starts, does nothing, exits 0. The only symptom is a request with no
 *     answer, which reads like a protocol bug rather than a server that never booted.
 *   - an inherited `MCP_RESOURCES_PATH` — a supported way to point the server at a personal
 *     library — makes the child read the developer's own catalog instead of the fixture.
 *
 * Measured 2026-08-29: five spawn sites had grown five different partial scrubs. One deleted the
 * two jest markers, one also deleted `NODE_OPTIONS`, one blanked `MCP_RUNTIME_ROOT` and no other
 * path var. `bundled-resource-fallback.e2e.test.ts` booted against 121 personal prompts while
 * asserting about a fixture holding one; its assertion was `> 1`, so it passed, and the leak
 * surfaced only when a stricter case landed beside it.
 *
 * This is the enumeration half of that fix. Consolidating the five sites closes the instances;
 * this closes the CLASS, by failing on the sixth.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DIR = path.join(SERVER_ROOT, 'tests', 'e2e');
const HELPER = path.join(E2E_DIR, 'helpers', 'child-env.ts');

/** The one file allowed to read the ambient environment directly. */
const HELPER_RELATIVE = path.relative(SERVER_ROOT, HELPER);

/** `...process.env` or `{ ...process.env` — the spread that inherits the caller's decisions. */
const SPREAD = /\.\.\.\s*process\.env/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function main() {
  const selfTest = process.argv.includes('--self-test');
  if (selfTest) return runSelfTest();

  const findings = [];
  for (const file of walk(E2E_DIR)) {
    const relative = path.relative(SERVER_ROOT, file);
    if (relative === HELPER_RELATIVE) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (SPREAD.test(line) && !line.trimStart().startsWith('*')) {
        findings.push(`${relative}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  if (findings.length > 0) {
    console.error(
      `[hermetic-child-env] FAIL: ${findings.length} site(s) build a child environment outside ` +
        `${HELPER_RELATIVE}.\n` +
        'A spawned server must not inherit the ambient MCP_* path overrides or jest markers — ' +
        'use buildServerEnv({ ...overrides }) instead:\n'
    );
    for (const finding of findings) console.error(`  ${finding}`);
    process.exit(1);
  }

  console.log('[hermetic-child-env] OK: every e2e child environment goes through buildServerEnv.');
}

/**
 * Prove the check can fail. A validator that has only ever returned OK is unverified, not passing —
 * so run the same predicate over a string that SHOULD trip it and over one that should not.
 */
function runSelfTest() {
  const offending = '      env: { ...process.env, MCP_WORKSPACE: workspace },';
  const clean = '      env: buildServerEnv({ MCP_WORKSPACE: workspace }),';
  const commented = '   * a child spawned with a plain `...process.env` from inside jest';

  const failures = [];
  if (!SPREAD.test(offending)) failures.push('predicate missed a real `...process.env` spread');
  if (SPREAD.test(clean)) failures.push('predicate flagged a buildServerEnv call');
  if (!commented.trimStart().startsWith('*'))
    failures.push('doc-comment guard does not recognise a comment line');

  if (failures.length > 0) {
    for (const failure of failures)
      console.error(`[hermetic-child-env] SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    '[hermetic-child-env] SELF-TEST OK: detects a spread, ignores the helper call and prose.'
  );
}

main();
