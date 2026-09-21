#!/usr/bin/env node
// @lifecycle canonical - Fails when a *.test.ts file jest.config.cjs would collect sits outside
// every CI-run test directory.
/**
 * Test Directory Membership
 *
 * WHY THIS EXISTS. `server/tests/tool-description-loader.test.ts` sat directly under `tests/`
 * (row 1.13's worker found it, notes F-T2-13). `jest.config.cjs` sets `roots: ['<rootDir>/tests']`
 * and a `testMatch` glob covering every `*.test.ts` file anywhere under it, so a bare `npx jest` run picks the file up —
 * but every test SCRIPT and every CI job passes a named subdirectory (`test:unit` → `tests/unit`,
 * `test:coverage` → `tests/unit`, `test:integration` → `tests/integration`, `test:e2e` →
 * `tests/e2e`), and `test:ci` — the one CI actually runs — is `npm run test:unit`. A file sitting
 * outside all three directories compiles, can pass when invoked directly, and is never run by
 * anything CI executes. It is the only such file today (239 under tests/unit, 64 under
 * tests/integration, 11 under tests/e2e, 1 at the root) — this check is what makes the NEXT one
 * fail instead of silently never running.
 *
 * TWO DISTINCT FAILURE MODES:
 *
 *   1. STRAY TEST FILE — a file jest.config.cjs's own `testMatch` would collect, sitting outside
 *      every declared CI-run directory. The motivating case.
 *   2. DECLARATION DRIFT — the directory list below (`DECLARED_TEST_DIRS`) no longer appears in
 *      any of the CI-run scripts' resolved commands (`CI_RUN_SCRIPTS`). If a script's target
 *      directory is renamed without updating this file, the declaration is now a lie about what
 *      CI actually runs, and this check must catch itself going stale before it ever gets a
 *      chance to miss a stray file.
 *
 * WHAT COUNTS AS A TEST FILE is read from `jest.config.cjs`'s `testMatch` array as TEXT (a regex
 * over the file's source, not `require()`), so it cannot drift from what Jest itself would collect
 * without this check reading the same declaration Jest reads.
 *
 * INDIRECTION. `test:ci` is `npm run test:unit` — its own command string names no directory, so
 * comparing it textually against a directory string would always miss. `resolveCommand` follows
 * one level of `npm run <script>` delegation (bounded against a cycle) before the drift check runs.
 *
 * `--self-test` proves both failure modes fire from data, never from memory: a temp fixture tree
 * (never a path under this repo) with a planted stray file, one with none, and synthetic
 * `package.json` script maps for the drift check — including the delegation and cycle cases.
 *
 * Usage:
 * - Check (default, in `validate:all`): `npm run validate:test-directory-membership`
 * - Prove the comparison logic:         `npm run validate:test-directory-membership:self-test`
 * Exit: 0 = every collected test file is inside a CI-run directory, 1 = a finding, 2 = invalid usage.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

/** The npm scripts CI actually invokes (`.github/workflows/ci.yml`, the Test job). */
const CI_RUN_SCRIPTS = ['test:ci', 'test:coverage', 'test:integration', 'test:e2e'];

/** The directories those scripts point at today. The drift check below keeps this honest. */
const DECLARED_TEST_DIRS = ['tests/unit', 'tests/integration', 'tests/e2e'];

const DELEGATE_PATTERN = /^npm run ([\w:.-]+)$/;

/**
 * Resolve an npm script name to the command it ultimately runs, following `npm run <name>`
 * delegation once per hop. Pure: takes the `scripts` map, never reads package.json itself.
 */
export function resolveCommand(scripts, name, seen = new Set()) {
  if (seen.has(name)) {
    throw new Error(`script "${name}" delegates in a cycle: ${[...seen, name].join(' -> ')}`);
  }
  const command = scripts[name];
  if (command === undefined) {
    throw new Error(`npm script "${name}" is not defined in package.json`);
  }
  const delegate = command.trim().match(DELEGATE_PATTERN);
  if (!delegate) return command;
  return resolveCommand(scripts, delegate[1], new Set([...seen, name]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `dir` as a whole path token inside `command` — not merely a substring. Plain `.includes()` was
 * tried first and reported "tests/unit" present in "tests/unit-renamed", because the shorter
 * string IS a substring of the longer one; that false match is exactly the drift this check exists
 * to catch, so it must fail closed on a shared prefix rather than pass on one.
 */
function commandNamesDir(command, dir) {
  return new RegExp(`${escapeRegExp(dir)}(?![\\w-])`).test(command);
}

/**
 * Failure mode 2 — DECLARATION DRIFT. Each declared directory must appear as a whole path token in
 * the resolved command of at least one CI-run script, or the declaration no longer describes what
 * CI runs.
 */
export function auditDeclaredDirs(
  scripts,
  ciScripts = CI_RUN_SCRIPTS,
  declaredDirs = DECLARED_TEST_DIRS
) {
  const findings = [];
  const resolved = [];

  for (const name of ciScripts) {
    try {
      resolved.push(resolveCommand(scripts, name));
    } catch (error) {
      findings.push(`CI-run script "${name}" could not be resolved: ${error.message}`);
    }
  }

  for (const dir of declaredDirs) {
    if (!resolved.some((command) => commandNamesDir(command, dir))) {
      findings.push(
        `declared test directory "${dir}" no longer appears in any CI-run script's resolved ` +
          `command (checked ${ciScripts.join(', ')}) — the declaration has drifted from package.json`
      );
    }
  }

  return findings;
}

/** Recursively collect every file under `dir`. */
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

/**
 * Read `jest.config.cjs`'s `testMatch` array as TEXT — a regex over the source, not `require()` —
 * so this check reads the same declaration Jest reads rather than a second copy that can drift.
 */
export function loadTestMatchPatterns(root) {
  const configPath = path.join(root, 'jest.config.cjs');
  if (!existsSync(configPath)) {
    throw new Error(`${configPath} not found — cannot derive what counts as a test file.`);
  }
  const text = readFileSync(configPath, 'utf8');
  const match = text.match(/testMatch:\s*\[([\s\S]*?)\]/);
  if (!match) {
    throw new Error(
      `${configPath} declares no testMatch array — cannot derive what counts as a test file.`
    );
  }
  const patterns = [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((entry) => entry[1]);
  if (patterns.length === 0) {
    throw new Error(`${configPath}'s testMatch array is empty.`);
  }
  return patterns;
}

/**
 * Glob -> RegExp for the narrow vocabulary this repo's `testMatch` actually uses: `**` (any depth,
 * including zero directories) and `*` (any run of non-separator characters). Everything else is
 * escaped literally so a real path character never becomes a metacharacter.
 */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') i++;
      out += '(?:.*/)?';
    } else if (ch === '*') {
      out += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/** Every file under `root/tests` that jest.config.cjs's `testMatch` patterns would collect. */
function collectTestFiles(root, patterns) {
  const matchers = patterns.map((pattern) => globToRegExp(pattern.replace('<rootDir>', root)));
  return walk(path.join(root, 'tests')).filter((file) => matchers.some((re) => re.test(file)));
}

/**
 * Failure mode 1 — STRAY TEST FILE. Every collected test file relative to `root`, filtered down to
 * the ones that sit outside every directory in `allowedDirs`. Sorted for stable output.
 */
export function strayTestFiles(root, patterns, allowedDirs) {
  return collectTestFiles(root, patterns)
    .map((file) => path.relative(root, file))
    .filter((rel) => !allowedDirs.some((dir) => rel === dir || rel.startsWith(`${dir}/`)))
    .sort();
}

function check() {
  const packageJsonPath = path.join(SERVER_ROOT, 'package.json');
  if (!existsSync(packageJsonPath)) {
    console.error(
      `[test-directory-membership] FAIL: ${packageJsonPath} not found. Run from server/.`
    );
    return 1;
  }
  const { scripts } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  const driftFindings = auditDeclaredDirs(scripts);
  if (driftFindings.length > 0) {
    console.error(
      '[test-directory-membership] FAIL: the declared test-directory list has drifted:\n'
    );
    for (const finding of driftFindings) console.error(`  ${finding}`);
    return 1;
  }

  let patterns;
  try {
    patterns = loadTestMatchPatterns(SERVER_ROOT);
  } catch (error) {
    console.error(`[test-directory-membership] FAIL: ${error.message}`);
    return 1;
  }

  const strays = strayTestFiles(SERVER_ROOT, patterns, DECLARED_TEST_DIRS);
  if (strays.length > 0) {
    console.error(
      `[test-directory-membership] FAIL: ${strays.length} test file(s) match jest.config.cjs's ` +
        `testMatch but sit outside every CI-run directory (${DECLARED_TEST_DIRS.join(', ')}):\n`
    );
    for (const file of strays) console.error(`  ${file}`);
    console.error(
      '\nA file here compiles and can even pass when invoked directly, but no test:*/CI script ever ' +
        'points at this path — move it under one of the directories above.'
    );
    return 1;
  }

  console.log(
    `[test-directory-membership] OK: every test file jest.config.cjs's testMatch would collect ` +
      `sits inside a CI-run directory (${DECLARED_TEST_DIRS.join(', ')}).`
  );
  return 0;
}

// ── self-test ────────────────────────────────────────────────────────────────

const FIXTURE_JEST_CONFIG = `module.exports = {\n  roots: ['<rootDir>/tests'],\n  testMatch: ['<rootDir>/tests/**/*.test.ts'],\n};\n`;

function withFixture(files, fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'validate-test-directory-membership-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function selfTestCases() {
  return [
    {
      name: 'a planted stray test file outside every declared directory is reported by name',
      run: () =>
        withFixture(
          {
            'jest.config.cjs': FIXTURE_JEST_CONFIG,
            'tests/tool-description-loader.test.ts': 'export {};\n',
            'tests/unit/mcp-tools/good.test.ts': 'export {};\n',
            // Not a test file by testMatch — must never be reported, positive control that the
            // check filters by pattern and does not simply flag every file under tests/.
            'tests/helpers/setup.ts': 'export {};\n',
          },
          (root) => strayTestFiles(root, loadTestMatchPatterns(root), DECLARED_TEST_DIRS)
        ),
      expect: (result) =>
        result.length === 1 && result[0] === 'tests/tool-description-loader.test.ts',
    },
    {
      name: 'a fixture with every test file inside a declared directory reports nothing',
      run: () =>
        withFixture(
          {
            'jest.config.cjs': FIXTURE_JEST_CONFIG,
            'tests/unit/mcp-tools/good.test.ts': 'export {};\n',
            'tests/integration/flow.test.ts': 'export {};\n',
            'tests/e2e/journey.test.ts': 'export {};\n',
          },
          (root) => strayTestFiles(root, loadTestMatchPatterns(root), DECLARED_TEST_DIRS)
        ),
      expect: (result) => result.length === 0,
    },
    {
      name: 'declared directories resolved through one level of npm-run indirection pass (test:ci case)',
      run: () =>
        auditDeclaredDirs(
          {
            'test:ci': 'npm run test:unit',
            'test:unit': 'jest --runInBand tests/unit',
            'test:coverage': 'jest --coverage tests/unit',
            'test:integration': 'jest --runInBand tests/integration',
            'test:e2e': 'jest --runInBand tests/e2e',
          },
          CI_RUN_SCRIPTS,
          DECLARED_TEST_DIRS
        ),
      expect: (result) => result.length === 0,
    },
    {
      name: 'a declared directory no CI-run script mentions anymore is reported',
      run: () =>
        auditDeclaredDirs(
          {
            'test:ci': 'npm run test:unit',
            'test:unit': 'jest --runInBand tests/unit-renamed',
            'test:coverage': 'jest --coverage tests/unit-renamed',
            'test:integration': 'jest --runInBand tests/integration',
            'test:e2e': 'jest --runInBand tests/e2e',
          },
          CI_RUN_SCRIPTS,
          DECLARED_TEST_DIRS
        ),
      expect: (result) => result.length === 1 && result[0].includes('tests/unit'),
    },
    {
      name: 'a CI-run script missing from package.json is reported rather than throwing',
      run: () =>
        auditDeclaredDirs(
          { 'test:ci': 'npm run test:unit', 'test:unit': 'jest --runInBand tests/unit' },
          CI_RUN_SCRIPTS,
          DECLARED_TEST_DIRS
        ),
      expect: (result) => result.some((finding) => finding.includes('test:coverage')),
    },
    {
      name: 'a self-referential delegation cycle is reported rather than looping forever',
      run: () => auditDeclaredDirs({ 'test:ci': 'npm run test:ci' }, ['test:ci'], ['tests/unit']),
      expect: (result) => result.some((finding) => finding.includes('cycle')),
    },
  ];
}

function selfTest() {
  console.log('\nvalidate:test-directory-membership self-test — every rule must behave\n');
  let failed = 0;

  for (const { name, run, expect } of selfTestCases()) {
    let ok;
    let actual;
    try {
      actual = run();
      ok = expect(actual);
    } catch (error) {
      ok = false;
      actual = `threw: ${error.message}`;
    }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
      failed += 1;
      console.log(`        got: ${JSON.stringify(actual)}`);
    }
  }

  if (failed > 0) {
    console.log(`\n❌ self-test: ${failed} rule(s) are not falsifiable\n`);
    return 1;
  }
  console.log(
    `\n✅ self-test: all ${selfTestCases().length} rules distinguish a stray test file from a ` +
      'covered one, and a live declaration from a drifted one\n'
  );
  return 0;
}

const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.length > 1 || (args.length === 1 && args[0] !== '--self-test')) {
  console.error('Usage: validate-test-directory-membership.js [--self-test]');
  process.exit(2);
}

if (process.argv[1] === SCRIPT_PATH) {
  process.exit(args[0] === '--self-test' ? selfTest() : check());
}
