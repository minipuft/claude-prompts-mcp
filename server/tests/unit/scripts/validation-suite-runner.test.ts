/**
 * Asserts the property `validate:all` did not have while it was a shell `&&` chain: that one
 * failing step does not hide the rest.
 *
 * WHY SPAWN THE BEHAVIOUR TESTS: the runner's `main()` calls `process.exit()` and spawns npm per
 * step, so invoking it inside a Jest worker would kill the worker. The exported `SUITE` is safe to
 * import because `main()` is guarded. Spawning mirrors `validation-self-tests.test.ts` — the
 * established shape for asserting a CLI checker in this repo.
 *
 * The broken steps are npm script names that do not exist. `npm run <missing>` exits non-zero
 * without touching the repo, which gives a genuine failing step without planting a broken check
 * into the real suite.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUITE } from '../../../scripts/run-validation-suite.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNNER = path.join(SERVER_ROOT, 'scripts', 'run-validation-suite.js');

const RUNNER_TIMEOUT_MS = 120_000;

interface RunnerResult {
  status: number;
  output: string;
}

/** `.mjs` because the manifest lives outside the package and cannot inherit `"type": "module"`. */
function runWithSuite(steps: Array<{ script: string }>): RunnerResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'validation-suite-'));
  const manifest = path.join(dir, 'suite.mjs');
  writeFileSync(manifest, `export const SUITE = ${JSON.stringify(steps)};\n`);
  try {
    const result = spawnSync('node', [RUNNER, '--manifest', manifest], {
      cwd: SERVER_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MISSING_ALPHA = 'validation-runner-fixture-alpha-does-not-exist';
const MISSING_BETA = 'validation-runner-fixture-beta-does-not-exist';

describe('validation suite runner', () => {
  it(
    'reports BOTH broken checks in one run, not just the first',
    () => {
      const { status, output } = runWithSuite([
        { script: MISSING_ALPHA },
        { script: MISSING_BETA },
      ]);

      expect(status).toBe(1);
      // The load-bearing assertion. Under `&&`, beta never runs and never appears at all.
      expect(output).toContain(MISSING_ALPHA);
      expect(output).toContain(MISSING_BETA);
      expect(output).toContain('2 of 2 steps failed');

      // Asserted against the RECAP specifically, not the whole log. Both names also appear in the
      // per-step output above it, so a whole-log assertion passes even when the recap lists one
      // failure — measured: a mutation truncating the recap to `failures.slice(0, 1)` survived
      // every assertion in this test until this slice was added.
      const recap = output.slice(output.indexOf('steps failed:'));
      expect(recap).toContain(MISSING_ALPHA);
      expect(recap).toContain(MISSING_BETA);
    },
    RUNNER_TIMEOUT_MS
  );

  it(
    'continues past a failure and still runs — and passes — the steps after it',
    () => {
      const { status, output } = runWithSuite([
        { script: MISSING_ALPHA },
        { script: 'validate:versions' },
        { script: MISSING_BETA },
      ]);

      expect(status).toBe(1);
      // A real check sandwiched between two failures. Asserting it reports PASS proves the runner
      // executed it, not merely that it printed the name from the manifest.
      expect(output).toMatch(/validate:versions\s+PASS/);
      expect(output).toContain('2 of 3 steps failed');
    },
    RUNNER_TIMEOUT_MS
  );

  it(
    'exits 0 and says so when every step passes',
    () => {
      const { status, output } = runWithSuite([{ script: 'validate:versions' }]);

      expect(status).toBe(0);
      expect(output).toContain('All 1 validation steps passed');
    },
    RUNNER_TIMEOUT_MS
  );

  it(
    'emits a summary line per step with a status and a duration',
    () => {
      const { output } = runWithSuite([{ script: 'validate:versions' }]);

      expect(output).toMatch(/Validation suite — 1 steps/);
      expect(output).toMatch(/validate:versions\s+PASS\s+\d+ ms/);
      expect(output).toMatch(/step time [\d.]+ s · runner overhead [\d.]+ s/);
    },
    RUNNER_TIMEOUT_MS
  );

  it('declares only steps that package.json actually defines', () => {
    // The suite list moved out of package.json, so a step name and its definition can now drift
    // apart. Before the move, `validate:all` referenced the names directly and could not.
    const manifest = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const declared = SUITE.map((step) => step.script);

    expect(declared.length).toBeGreaterThan(0);
    const undefinedSteps = declared.filter((name) => !manifest.scripts?.[name]);
    expect(undefinedSteps).toEqual([]);
  });
});
