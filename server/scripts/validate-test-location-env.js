#!/usr/bin/env node
/**
 * Fails when a test writes a resource-location variable on `process.env` by hand.
 *
 * Usage: `node scripts/validate-test-location-env.js` (from `server/`; registered as
 * `validate:test-location-env` in `validate:all`).
 *
 * Why. The Claude Code plugin exports `MCP_RESOURCES_PATH` into the maintainer's shell, so a test
 * that does not decide where resources, runtime state, config and the project folder come from
 * resolves against the owner's personal library. Thirty-odd test files each saved some of the
 * variables, deleted them and restored them by hand, each choosing a different subset; one that
 * forgot `CLAUDE_PROJECT_DIR` left the same hole one variable over. `tests/helpers/resource-locations.ts`
 * is the one place a test says where things come from and the one place that snapshots, clears and
 * restores every variable. Fixing the files found does not close the class: nothing failed when
 * the next file wrote one directly. This does.
 *
 * What it flags, per code line (comment lines are skipped), for each name in
 * `LOCATION_VARIABLES` (below):
 *   - `process.env['NAME'] = ...` and `process.env.NAME = ...`
 *   - `delete process.env['NAME']` and `delete process.env.NAME`
 *
 * What it allows, on purpose:
 *   - a child-process environment literal (`env: { MCP_WORKSPACE: dir }` handed to `spawn`): that
 *     is not a write to the test's own `process.env`, and the child's locations are decided where
 *     the literal is built (`resourceLocationEnv` is the helper's spelling of it).
 *   - reads (`process.env['MCP_WORKSPACE']`), including `expect(...)` on them.
 *   - the helper itself and its own unit test, which seed variables directly on purpose.
 *
 * BLIND SPOTS, stated as of 2026-11-13 (each flips when the spelling appears in `tests/`):
 *   - a computed key (`process.env[key] = ...`) or `Object.assign(process.env, {...})` naming a
 *     location variable is not matched; measured: neither spelling occurs outside the helper.
 *   - an untracked file is not scanned (the scope is the git index, as for the sibling gates), so
 *     a brand-new test is first seen when it is staged, which is when the pre-commit hook runs.
 *
 * Exit 0 when clean; exit 1 with one `file:line` per site and the fix.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNonEmptyScope, trackedFilesUnder } from './lib/tracked-scope.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every variable the helper snapshots, clears and restores (`RESOURCE_LOCATION_ENV_KEYS`): the six
 * that decide where resources, runtime state, config and the project folder come from, and
 * `MCP_SERVER_ROOT`, the package root the skills-sync CLI reads. A test that
 * writes `MCP_SERVER_ROOT` by hand restores only that one key, so it is checked like the rest.
 */
const LOCATION_VARIABLES = [
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_RUNTIME_ROOT',
  'MCP_CONFIG_PATH',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PROJECT_DIR',
  'MCP_SERVER_ROOT',
];

/** Files that write these variables directly because writing them is their subject. */
const EXEMPT = new Set([
  'tests/helpers/resource-locations.ts',
  'tests/unit/helpers/resource-locations.test.ts',
]);

const NAMES = LOCATION_VARIABLES.join('|');
/** `process.env['NAME']` / `process.env["NAME"]` / `` process.env[`NAME`] `` / `process.env.NAME`. */
const ENV_REF = `process\\.env(?:\\[\\s*['"\`](?:${NAMES})['"\`]\\s*\\]|\\.(?:${NAMES})\\b)`;
const ASSIGNMENT = new RegExp(`${ENV_REF}\\s*(?:[-+*/%&|^]|\\*\\*|\\?\\?|\\|\\||&&)?=(?![=>])`);
const DELETION = new RegExp(`\\bdelete\\s+${ENV_REF}`);

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

const scope = ['tests'];
const files = trackedFilesUnder(scope, { cwd: SERVER_ROOT }).filter(
  (file) => /\.(?:[cm]?[jt]sx?)$/.test(file) && !EXEMPT.has(file)
);
assertNonEmptyScope(files, scope, 'validate:test-location-env');

const findings = [];
for (const file of files) {
  readFileSync(path.join(SERVER_ROOT, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (ASSIGNMENT.test(line) || DELETION.test(line)) {
        findings.push(`server/${file}:${index + 1}: ${line.trim()}`);
      }
    });
}

if (findings.length > 0) {
  console.error(
    `❌ validate:test-location-env: ${findings.length} direct write(s) of a resource-location variable in tests/:\n` +
      findings.map((finding) => `   ${finding}`).join('\n') +
      '\n   Use tests/helpers/resource-locations.ts (isolateResourceLocations / withResourceLocations ' +
      'for process.env, resourceLocationEnv for a child process).'
  );
  process.exit(1);
}

console.log(
  `✅ validate:test-location-env: ${files.length} test files, no direct write of ${LOCATION_VARIABLES.length} location variables`
);
