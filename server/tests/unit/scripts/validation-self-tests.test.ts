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
 * The work list is derived from the package manifests rather than written out here, so a newly
 * added `*:self-test` script is covered the moment it exists and cannot be forgotten.
 *
 * BOTH MANIFESTS, since 2026-09-15. This read `server/package.json` alone while claiming, in the
 * paragraph above, that a new self-test "cannot be forgotten" — and the root manifest already held
 * two the suite had never run (`guidance:self-test`, `renovate:request-run:self-test`). A checker
 * whose enumeration stops short of where the construct lives reports green over the gap, which is
 * the failure this file exists to prevent, reached one level up. The per-manifest guard below is
 * what keeps the widening honest: dropping a manifest fails loudly instead of silently narrowing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

/** Generous relative to the slowest measured entry (state-field-writers, 561 ms). */
const SELF_TEST_TIMEOUT_MS = 120_000;

/** Every manifest in this repo that may declare a `*:self-test`, with the cwd `npm run` needs. */
const MANIFESTS = [
  { label: 'server/package.json', cwd: SERVER_ROOT },
  { label: 'package.json', cwd: REPO_ROOT },
];

interface SelfTestScript {
  label: string;
  cwd: string;
  name: string;
}

function selfTestScripts(): SelfTestScript[] {
  return MANIFESTS.flatMap(({ label, cwd }) => {
    const manifest = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return Object.keys(manifest.scripts ?? {})
      .filter((name) => name.endsWith(':self-test'))
      .sort()
      .map((name) => ({ label, cwd, name }));
  });
}

const scripts = selfTestScripts();

describe('validation checker self-tests', () => {
  it('finds self-test scripts to run', () => {
    // Guards the derivation itself. If the filter silently matched nothing, every test below
    // would vacuously pass and the suite would report green while checking nothing.
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(MANIFESTS)('$label contributes at least one self-test', ({ label }) => {
    // Per-manifest, not just in aggregate: the server manifest holds enough self-tests to keep
    // the total above zero on its own, so an aggregate guard would pass while the root manifest
    // silently contributed nothing — exactly the state this file was in before 2026-09-15.
    expect(scripts.filter((script) => script.label === label)).not.toHaveLength(0);
  });

  it.each(scripts)(
    '$label $name proves its checker can still fail',
    ({ cwd, name: scriptName }) => {
      try {
        execFileSync('npm', ['run', '--silent', scriptName], {
          cwd,
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
