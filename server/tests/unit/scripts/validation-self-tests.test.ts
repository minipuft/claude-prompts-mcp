/**
 * Runs every `*:self-test` npm script as a Jest test.
 *
 * A self-test asserts that a checker can still fail — it drives the checker with fabricated
 * inputs and exits non-zero if any rule stopped firing. That is a unit test wearing a CLI
 * costume, so it belongs in the suite rather than in `validate:all`, where 19 of them made the
 * gate's `&&` chain report only the first failure and hid the rest.
 *
 * WHY SPAWN RATHER THAN IMPORT: 18 of the 19 scripts call `main()` unconditionally at module
 * scope and `process.exit()` on failure (measured 2026-08-05; only `classify-validation-scope.js`
 * guards its entry). Importing one into a Jest worker executes it and then kills the worker, so
 * in-process execution would require refactoring the entry point of every safety-net script in
 * the repo. Spawning leaves those scripts untouched and still moves the assertions into the
 * suite. The trade is that subprocess internals are not instrumented by `--coverage` — acceptable
 * here, because the self-test IS the assertion about the checker; line coverage of a checker's
 * internals would add no signal the self-test does not already carry.
 *
 * The work list is derived from `package.json` rather than written out here, so a newly added
 * `*:self-test` script is covered the moment it exists and cannot be forgotten.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Generous relative to the slowest measured entry (state-field-writers, 561 ms). */
const SELF_TEST_TIMEOUT_MS = 120_000;

function selfTestScriptNames(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(manifest.scripts ?? {})
    .filter((name) => name.endsWith(':self-test'))
    .sort();
}

const scriptNames = selfTestScriptNames();

describe('validation checker self-tests', () => {
  it('finds self-test scripts to run', () => {
    // Guards the derivation itself. If the filter silently matched nothing, every test below
    // would vacuously pass and the suite would report green while checking nothing.
    expect(scriptNames.length).toBeGreaterThan(0);
  });

  it.each(scriptNames)(
    '%s proves its checker can still fail',
    (scriptName) => {
      try {
        execFileSync('npm', ['run', '--silent', scriptName], {
          cwd: SERVER_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; status?: number };
        const detail = [failure.stdout, failure.stderr]
          .filter((stream) => typeof stream === 'string' && stream.trim() !== '')
          .join('\n')
          .trim();
        throw new Error(
          `${scriptName} exited ${failure.status ?? 'non-zero'}:\n${detail || '(no output)'}`
        );
      }
    },
    SELF_TEST_TIMEOUT_MS
  );
});
