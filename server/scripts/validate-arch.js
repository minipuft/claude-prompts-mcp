#!/usr/bin/env node

/**
 * Runs dependency-cruiser and proves it actually analysed something.
 *
 * WHY THIS EXISTS
 * dependency-cruiser needs the TypeScript compiler API to parse `.ts` sources. When the
 * installed TypeScript is outside its supported range it does not fail — it emits a
 * `missing-typescript-transpiler` issue at severity **warn**, finds no parseable modules,
 * and exits 0. Measured on TypeScript 7.0.2:
 *
 *   TS 6.0.3   x 2 dependency violations (0 errors, 2 warnings). 438 modules, 1790 deps cruised.
 *   TS 7.0.2   ✔ no dependency violations found (0 modules, 0 dependencies cruised)
 *
 * The second line is a green check mark over an empty graph. Every layer boundary and cycle
 * rule is switched off, `validate:all` passes, and CI reports success — the same shape as a
 * `|| true` appended to a command. TypeScript 7 is the Go-native compiler: `require('typescript')`
 * exposes 2 symbols instead of 2248, and the compiler API moved behind `./unstable/*`, so this
 * is not a transient packaging bug. It will recur for any tool version, transpiler, or config
 * change that costs dependency-cruiser its parser.
 *
 * A check that cannot distinguish "no violations" from "nothing was examined" is not a check.
 *
 * WHAT IT CHECKS
 * 1. dependency-cruiser exits 0 (unchanged behaviour — warnings still pass, errors still fail).
 * 2. Its summary reports at least MODULE_FLOOR modules cruised.
 * 3. The summary line exists at all. A parse failure fails closed rather than being read as OK,
 *    because "I could not tell" must never be reported as "fine".
 *
 * The floor only trips on a DROP. `src/` grows over time, so this needs no maintenance in the
 * normal direction; it fires when coverage collapses, which is the only case of interest.
 *
 * `--self-test` proves each rule can still fail.
 *
 * RETIREMENT CONDITION: delete when dependency-cruiser reports an explicit, non-zero exit code
 * for "I could not parse the sources" — at that point its own exit status carries this signal
 * and a second check is redundant.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

/**
 * Today's count is 438. The floor sits below it with room for ordinary churn, but far above
 * the collapse case (0). A partial collapse — a handful of modules parsed — is also caught,
 * which a bare `> 0` test would wave through.
 */
const MODULE_FLOOR = 400;

const SUMMARY_PATTERN = /(\d+)\s+modules,\s+(\d+)\s+dependencies\s+cruised/;

/**
 * Decide whether a dependency-cruiser run is trustworthy.
 *
 * Pure — the self-test drives it with fabricated inputs, so no depcruise run is needed to
 * prove the rules behave.
 *
 * @param {{ output: string, exitCode: number, floor?: number }} run
 * @returns {{ ok: boolean, modules: number | null, failures: string[] }}
 */
export function assessCruiseRun({ output, exitCode, floor = MODULE_FLOOR }) {
  const failures = [];
  const match = SUMMARY_PATTERN.exec(output ?? '');
  const modules = match ? Number(match[1]) : null;

  if (exitCode !== 0) {
    failures.push(`dependency-cruiser exited ${exitCode} — rule violations above warn severity`);
  }

  if (modules === null) {
    failures.push(
      'could not find the "N modules, M dependencies cruised" summary in the output. ' +
        'Failing closed: an unparseable run cannot be distinguished from an empty one.'
    );
  } else if (modules < floor) {
    failures.push(
      `only ${modules} modules cruised, below the floor of ${floor}. dependency-cruiser ` +
        'reports success when it cannot parse the sources, so this is what a silently ' +
        'disabled architecture gate looks like. Check that the installed TypeScript is ' +
        'within the range dependency-cruiser supports (src/meta.cjs supportedTranspilers).'
    );
  }

  return { ok: failures.length === 0, modules, failures };
}

function runDepcruise() {
  const bin = path.resolve(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'depcruise.cmd' : 'depcruise'
  );

  const result = spawnSync(bin, ['--config', '.dependency-cruiser.cjs', 'src'], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`could not run dependency-cruiser: ${result.error.message}`);
  }

  // Stream it through unchanged — this wraps `depcruise`, it does not replace its reporting.
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);

  return { output, exitCode: result.status ?? 1 };
}

function selfTest() {
  const cases = [
    {
      name: 'a healthy run is accepted',
      input: {
        output:
          'x 2 dependency violations (0 errors, 2 warnings). 438 modules, 1790 dependencies cruised.',
        exitCode: 0,
      },
      expectOk: true,
    },
    {
      name: 'a clean run with no violations is accepted',
      input: {
        output: '✔ no dependency violations found (438 modules, 1790 dependencies cruised)',
        exitCode: 0,
      },
      expectOk: true,
    },
    {
      name: 'the TypeScript 7 false green is rejected',
      input: {
        output: '✔ no dependency violations found (0 modules, 0 dependencies cruised)',
        exitCode: 0,
      },
      expectOk: false,
    },
    {
      name: 'a partial collapse is rejected',
      input: {
        output: '✔ no dependency violations found (12 modules, 3 dependencies cruised)',
        exitCode: 0,
      },
      expectOk: false,
    },
    {
      name: 'a missing summary line is rejected (fails closed)',
      input: { output: 'something went sideways and printed nothing useful', exitCode: 0 },
      expectOk: false,
    },
    {
      name: 'a real rule violation is still rejected',
      input: {
        output:
          'x 1 dependency violations (1 errors, 0 warnings). 438 modules, 1790 dependencies cruised.',
        exitCode: 1,
      },
      expectOk: false,
    },
  ];

  console.log('\nvalidate:arch self-test — every rule must behave\n');

  let failed = 0;
  for (const testCase of cases) {
    const { ok } = assessCruiseRun(testCase.input);
    if (ok === testCase.expectOk) {
      console.log(`  ok    ${testCase.name}`);
    } else {
      console.error(`  FAIL  ${testCase.name} (expected ok=${testCase.expectOk}, got ${ok})`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} self-test case(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nOK: all ${cases.length} rules are falsifiable`);
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const { output, exitCode } = runDepcruise();
  const { ok, modules, failures } = assessCruiseRun({ output, exitCode });

  if (ok) {
    console.log(`\nvalidate:arch OK — ${modules} modules cruised (floor ${MODULE_FLOOR}).`);
    return;
  }

  console.error('\nvalidate:arch FAILED:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
}

main();
