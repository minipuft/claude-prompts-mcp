#!/usr/bin/env node

/**
 * Guards the package.json entry points against the declaration layout tsc actually produces.
 *
 * WHY THIS EXISTS
 * `rootDir` was unset, so tsc inferred the common source root as the package directory and
 * emitted `dist/src/index.d.ts`, while `types` and `exports["."].types` both advertised
 * `./dist/index.d.ts`. That path did not exist. The package shipped 405 declaration files and
 * no reachable entry to any of them, so every TypeScript consumer silently got no types at all.
 *
 * Nothing could notice: the build exited 0, `npm pack` happily included both `dist` and `src`,
 * and no test imports the package the way a consumer does. It is the same shape as the required
 * status checks that named job ids — a declared thing pointing at something that does not exist,
 * with no check standing behind the declaration.
 *
 * WHAT IT CHECKS
 * Statically, with no build required: given `rootDir` and `outDir` from tsconfig, the entry
 * `src/index.ts` must emit to `<outDir>/index.d.ts`, and that is what `types` and
 * `exports["."].types` must say. When `dist/` happens to exist, every declared entry target is
 * additionally checked on disk.
 *
 * `--self-test` proves each rule can still fail.
 *
 * RETIREMENT CONDITION: delete when the published package is verified end-to-end by a consumer
 * smoke test in CI (pack, install into a fixture, typecheck it) — that subsumes this.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** tsconfig.json carries comments and trailing commas; strip both before parsing. */
function readTsconfig(file) {
  const raw = readFileSync(file, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

/**
 * Returns the violations for one package.json against one tsconfig.
 * Pure — the self-test drives it with fabricated inputs.
 */
function findViolations(pkg, compilerOptions, distExists, fileExists) {
  const violations = [];
  const { rootDir, outDir } = compilerOptions;

  if (!rootDir) {
    violations.push(
      'tsconfig sets no `rootDir`, so tsc infers the source root and the emitted declaration ' +
        'layout depends on which files happen to be included. Set it explicitly.'
    );
    return violations;
  }

  // Where does the entry actually land? tsc strips `rootDir` from each input path and
  // re-roots the remainder under `outDir`. With rootDir "./src" the entry src/index.ts
  // emits to dist/index.d.ts; with rootDir "." it emits to dist/src/index.d.ts — which is
  // exactly the bug this guard exists for, so the relative step is the whole check.
  const ENTRY = 'src/index.ts';
  const normalizedRoot = path.posix.normalize(rootDir.replace(/^\.\//, '') || '.');
  const fromRoot = path.posix.relative(normalizedRoot === '.' ? '' : normalizedRoot, ENTRY);
  const expected = `./${path.posix.join(outDir ?? 'dist', fromRoot.replace(/\.ts$/, '.d.ts'))}`;

  const declared = [
    ['types', pkg.types && `./${pkg.types.replace(/^\.\//, '')}`],
    ['exports["."].types', pkg.exports?.['.']?.types],
  ];

  for (const [label, value] of declared) {
    if (!value) {
      violations.push(`${label} is not declared; consumers get no types.`);
    } else if (value !== expected) {
      violations.push(
        `${label} is ${JSON.stringify(value)} but tsc emits to ${JSON.stringify(expected)} ` +
          `(rootDir ${JSON.stringify(rootDir)}, outDir ${JSON.stringify(outDir)}). ` +
          `The advertised path does not exist, so the package ships no reachable types.`
      );
    }
  }

  // Only meaningful after a build; skipped otherwise so `validate:all` stays build-free.
  if (distExists) {
    const targets = [
      ['main', pkg.main],
      ['types', pkg.types],
      ...Object.entries(pkg.bin ?? {}).map(([k, v]) => [`bin.${k}`, v]),
    ];
    for (const [label, target] of targets) {
      if (target && !fileExists(target)) {
        violations.push(`${label} points at ${JSON.stringify(target)}, which does not exist.`);
      }
    }
  }

  return violations;
}

const OK_TSCONFIG = { rootDir: './src', outDir: 'dist' };
const OK_PKG = {
  types: 'dist/index.d.ts',
  exports: { '.': { types: './dist/index.d.ts' } },
};

/** Each case must produce at least one violation, or the rule it exercises is inert. */
const SELF_TEST_CASES = [
  {
    rule: 'missing rootDir is rejected',
    pkg: OK_PKG,
    tsconfig: { outDir: 'dist' },
  },
  {
    rule: 'the original bug is rejected (types at dist/index.d.ts, emit at dist/src/)',
    pkg: OK_PKG,
    tsconfig: { rootDir: '.', outDir: 'dist' },
  },
  {
    rule: 'a missing types field is rejected',
    pkg: { exports: { '.': { types: './dist/index.d.ts' } } },
    tsconfig: OK_TSCONFIG,
  },
  {
    rule: 'types and exports disagreeing is rejected',
    pkg: { types: 'dist/index.d.ts', exports: { '.': { types: './dist/main.d.ts' } } },
    tsconfig: OK_TSCONFIG,
  },
];

function runSelfTest() {
  console.log('\nvalidate:package-entries self-test — every rule must reject a wrong input\n');

  let failures = 0;
  for (const { rule, pkg, tsconfig } of SELF_TEST_CASES) {
    const rejected = findViolations(pkg, tsconfig, false, () => true).length > 0;
    console.log(`  ${rejected ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!rejected) failures += 1;
  }

  const cleanOk = findViolations(OK_PKG, OK_TSCONFIG, false, () => true).length === 0;
  console.log(`  ${cleanOk ? 'ok  ' : 'FAIL'}  a correct package is accepted`);
  if (!cleanOk) failures += 1;

  console.log(
    failures === 0
      ? `\nOK: all ${SELF_TEST_CASES.length + 1} rules are falsifiable\n`
      : `\nFAILED: ${failures} rule(s) cannot detect a wrong input\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const pkg = JSON.parse(readFileSync(path.join(SERVER, 'package.json'), 'utf8'));
  const { compilerOptions } = readTsconfig(path.join(SERVER, 'tsconfig.json'));
  const distExists = existsSync(path.join(SERVER, 'dist'));

  const violations = findViolations(pkg, compilerOptions, distExists, (target) =>
    existsSync(path.join(SERVER, target))
  );

  if (violations.length > 0) {
    console.error('package.json entry points do not match what the build emits:\n');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }

  console.log(
    `Package entry points match the emit layout${distExists ? ' and exist on disk' : ' (dist/ absent — on-disk check skipped)'}.`
  );
}

main();
