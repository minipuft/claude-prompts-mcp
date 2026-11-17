#!/usr/bin/env node
/**
 * Fails when a test writes a resource-location variable on `process.env` by hand.
 *
 * Usage: `node scripts/validate-test-location-env.js` (from `server/`; registered as
 * `validate:test-location-env` in `validate:all`).
 *
 * Why. A maintainer's shell exports `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` at a personal library,
 * so a test that does not decide where resources, runtime state, config and the project folder
 * come from resolves against the owner's own tree. Thirty-odd test files each saved some of the
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
 * And, for a CHILD process, over `server/tests/` and `cli/tests/` (`CHILD_ENV_SCOPE`):
 *   - `...process.env`: the child inherits whatever the shell exports.
 *     Measured 2026-11-17 with `MCP_RUNTIME_ROOT` at a seeded probe database: the CLI suite wrote
 *     46 `version_history` rows into it and failed 21 tests, all through `run()` helpers that
 *     spread or passed no `env`. A spread followed by deletes is safe, but a line regex cannot see
 *     the deletes, so the spread lives only in a builder (`CHILD_ENV_BUILDERS`).
 *   - under `cli/tests/`, an import of `node:child_process` anywhere but
 *     `cli/tests/helpers/child-process.ts`. A spawn with NO `env` option inherits the whole
 *     environment too, and an omitted key is invisible to a line regex; routing every CLI spawn
 *     through that helper (`runCpm`, `runChild`, which remove the six location keys) is what
 *     makes the omission unwritable there.
 *
 * What it allows, on purpose:
 *   - a child-process environment literal (`env: { MCP_WORKSPACE: dir }` handed to `spawn`): that
 *     is not a write to the test's own `process.env`, and the child's locations are decided where
 *     the literal is built (`resourceLocationEnv` is the helper's spelling of it).
 *   - reads (`process.env['MCP_WORKSPACE']`), including `expect(...)` on them.
 *   - the helper itself and its own unit test, which seed variables directly on purpose.
 *
 * BLIND SPOTS, stated as of 2026-11-13 (each flips when the spelling appears in `tests/`):
 *   - a `server/tests/` spawn with no `env` option inherits the shell and is not matched (the
 *     omission needs a parse of the call, not a line). `tests/e2e` server spawns are held by
 *     `validate:hermetic-child-env`; as of 2026-11-17 no other server test spawns `cpm` or the
 *     server, and `tests/unit/cli-shared` passes with the six keys exported at a probe root.
 *   - direct writes in `cli/tests/` are not scanned: that tree cannot import the server helper,
 *     and its one in-process writer saves, clears and restores all six keys itself.
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
 * Every variable a helper option sets (`OPTION_VARIABLES`): the five that decide where resources,
 * runtime state, config and the project folder come from, and `MCP_SERVER_ROOT`, the package root
 * the skills-sync CLI reads. A test that writes `MCP_SERVER_ROOT` by hand restores only that one
 * key, so it is checked like the rest. `MCP_RESOURCES_PATH` is cleared and restored by the helper
 * but no option sets it: the server refuses it, and the refusal's own test sets it directly.
 */
const LOCATION_VARIABLES = [
  'MCP_WORKSPACE',
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

/** Tracked test trees a child-process environment is checked in, relative to `server/`. */
const CHILD_ENV_SCOPE = ['tests', '../cli/tests'];
/** The builders that may start from the whole environment, because they remove the keys next. */
const CHILD_ENV_BUILDERS = new Set(['../cli/tests/helpers/child-process.ts']);
/**
 * `...process.env`, not `...process.env.X`. `env: process.env` inherits exactly as an omitted
 * `env` does, so it shares that blind spot rather than a rule of its own: the spelling also
 * prints a child's environment in `tests/integration/scripts/fixtures/print-env.cjs`.
 */
const WHOLE_ENV = /\.\.\.\s*process\.env\b(?!\s*[.[])/;
/** `from 'node:child_process'`, `from 'child_process'`, `require('node:child_process')`. */
const CHILD_PROCESS_IMPORT = /(?:\bfrom\s*|\brequire\s*\(\s*)['"](?:node:)?child_process['"]/;
const CLI_TESTS_PREFIX = '../cli/tests/';

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

const childEnvFiles = trackedFilesUnder(CHILD_ENV_SCOPE, { cwd: SERVER_ROOT }).filter((file) =>
  /\.(?:[cm]?[jt]sx?)$/.test(file)
);
assertNonEmptyScope(
  childEnvFiles.filter((file) => file.startsWith(CLI_TESTS_PREFIX)),
  ['../cli/tests'],
  'validate:test-location-env'
);

const childFindings = [];
for (const file of childEnvFiles) {
  if (CHILD_ENV_BUILDERS.has(file)) continue;
  const inCliTests = file.startsWith(CLI_TESTS_PREFIX);
  readFileSync(path.join(SERVER_ROOT, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (isCommentLine(line)) return;
      if (WHOLE_ENV.test(line) || (inCliTests && CHILD_PROCESS_IMPORT.test(line))) {
        childFindings.push(`${path.posix.join('server', file)}:${index + 1}: ${line.trim()}`);
      }
    });
}

if (childFindings.length > 0) {
  console.error(
    `❌ validate:test-location-env: ${childFindings.length} child process(es) that may inherit the shell's location variables:\n` +
      childFindings.map((finding) => `   ${finding}`).join('\n') +
      '\n   In cli/tests, spawn through cli/tests/helpers/child-process.ts (runCpm / runChild); ' +
      'elsewhere build the env from resourceLocationEnv or the e2e buildServerEnv, never the whole process.env.'
  );
}

if (findings.length > 0) {
  console.error(
    `❌ validate:test-location-env: ${findings.length} direct write(s) of a resource-location variable in tests/:\n` +
      findings.map((finding) => `   ${finding}`).join('\n') +
      '\n   Use tests/helpers/resource-locations.ts (isolateResourceLocations / withResourceLocations ' +
      'for process.env, resourceLocationEnv for a child process).'
  );
}

if (findings.length > 0 || childFindings.length > 0) process.exit(1);

console.log(
  `✅ validate:test-location-env: ${files.length} test files, no direct write of ${LOCATION_VARIABLES.length} location variables; ` +
    `${childEnvFiles.length} files, no child process inheriting the whole environment`
);
