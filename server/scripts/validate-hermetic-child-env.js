#!/usr/bin/env node
/**
 * Every spawned server must take its environment from `scripts/lib/hermetic-server-env.js`.
 *
 * A process that boots a server and reports on what it serves is only meaningful if the SPAWNER
 * decides where that server reads from. Spreading `...process.env` into the child hands the
 * decision to whoever ran it, and both failure directions are silent:
 *
 *   - jest's own markers (`NODE_ENV=test`, `JEST_WORKER_ID`) make `src/index.ts` decline to run
 *     `main()`. The child starts, does nothing, exits 0. The only symptom is a request with no
 *     answer, which reads like a protocol bug rather than a server that never booted.
 *   - an inherited `MCP_RESOURCES_PATH` — a supported way to point the server at a personal
 *     library — makes the child read the developer's own catalog instead of the fixture.
 *
 * Measured 2026-08-29: five e2e spawn sites had grown five different partial scrubs, and
 * `bundled-resource-fallback.e2e.test.ts` booted against 121 personal prompts while asserting
 * about a fixture holding one. Measured 2026-09-14: the same class sat outside this gate's walk —
 * four scripts spawned the built server, three of them scrubbing only the jest markers, one of
 * them writing the committed `tests/snapshots/mcp-input-schemas.json`.
 *
 * Two enumerations, one per consumer shape:
 *
 *   - `tests/e2e/**.ts`: no file may spread `process.env`. Every spawn goes through
 *     `tests/e2e/helpers/child-env.ts`, which re-exports the shared builder.
 *   - `scripts/**`: a file that SPAWNS THE SERVER must import the shared builder and must not
 *     spread `process.env`. A script is a server spawner when it names the server entry
 *     (`'dist', 'index.js'` or the installed `bin['claude-prompts']`) and calls a child-process
 *     function. A missing `env` inherits exactly like a spread, which is why the import is
 *     required rather than the spread merely forbidden. Scripts that spawn something else —
 *     `tsc`, `git`, `bash` — may build their environment however they need.
 *
 * The classifier is the blind spot, stated: a server spawned through a spelling it does not
 * recognise (a bare `'dist/index.js'` string, `npm start`) is not enumerated. The self-test pins
 * the spellings it does recognise, and the run fails if it classifies zero spawners, so a
 * classifier that stops matching cannot report success over nothing.
 * A second, narrower one: the scripts check is per FILE, so a spawner that imports the builder
 * and passes it to one spawn call while a second spawn call omits `env` is not caught.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(SELF), '..');
const E2E_DIR = path.join(SERVER_ROOT, 'tests', 'e2e');
const SCRIPTS_DIR = path.join(SERVER_ROOT, 'scripts');
const SHARED_RELATIVE = 'scripts/lib/hermetic-server-env.js';

/** `...process.env` or `{ ...process.env` — the spread that inherits the caller's decisions. */
const SPREAD = /\.\.\.\s*process\.env/;
/** The built server's entry, as the scripts spell it: a path join, or the installed package bin. */
const SERVER_ENTRY = /['"]dist['"]\s*,\s*['"]index\.js['"]|bin\[\s*['"]claude-prompts['"]\s*\]/;
/** A child-process call. */
const SPAWN_CALL = /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/;
/** An import of the shared builder, from any relative depth. */
const SHARED_IMPORT = /from\s+['"][^'"]*\/hermetic-server-env\.js['"]/;

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) out.push(full);
  }
  return out;
}

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('*') || trimmed.startsWith('//');
}

/** `relative:line: text` for every spread on a code line. */
function spreadFindings(relative, text) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    if (SPREAD.test(line) && !isCommentLine(line)) {
      findings.push(`${relative}:${i + 1}: ${line.trim()}`);
    }
  });
  return findings;
}

function isServerSpawner(text) {
  return SERVER_ENTRY.test(text) && SPAWN_CALL.test(text);
}

function scanE2e() {
  const findings = [];
  const files = walk(E2E_DIR, ['.ts']);
  for (const file of files) {
    findings.push(...spreadFindings(path.relative(SERVER_ROOT, file), readFileSync(file, 'utf8')));
  }
  return { findings, count: files.length };
}

/**
 * This validator is skipped: it holds the self-test fixtures, which name the server entry and a
 * spawn call as strings, and it spawns nothing.
 */
function scanScripts() {
  const findings = [];
  const spawners = [];
  for (const file of walk(SCRIPTS_DIR, ['.js', '.mjs', '.cjs', '.ts'])) {
    if (file === SELF) continue;
    const text = readFileSync(file, 'utf8');
    if (!isServerSpawner(text)) continue;

    const relative = path.relative(SERVER_ROOT, file);
    spawners.push(relative);
    if (!SHARED_IMPORT.test(text)) {
      findings.push(`${relative}: spawns the server without importing ${SHARED_RELATIVE}`);
    }
    findings.push(...spreadFindings(relative, text));
  }
  return { findings, spawners };
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const e2e = scanE2e();
  const scripts = scanScripts();
  const findings = [...e2e.findings, ...scripts.findings];

  if (scripts.spawners.length === 0) {
    findings.push(
      'scripts/: classified zero server spawners — the classifier stopped matching the entry ' +
        'spellings, so this run would have measured nothing'
    );
  }

  if (findings.length > 0) {
    console.error(
      `[hermetic-child-env] FAIL: ${findings.length} finding(s). A spawned server must not ` +
        'inherit the ambient MCP_* path overrides or jest markers — build its environment with ' +
        `buildServerEnv({ ...overrides }) from ${SHARED_RELATIVE}:\n`
    );
    for (const finding of findings) console.error(`  ${finding}`);
    process.exit(1);
  }

  console.log(
    `[hermetic-child-env] OK: ${e2e.count} e2e file(s) spread no environment; ` +
      `${scripts.spawners.length} server-spawning script(s) use the shared builder ` +
      `(${scripts.spawners.join(', ')}).`
  );
}

/** Each case is `[label, actual, expected]`. */
function selfTestCases() {
  const joinEntry = "const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');";
  const binEntry = "spawnSync(process.execPath, [join(root, pkg.bin['claude-prompts']), '--help'])";
  return [
    ['a real `...process.env` spread', SPREAD.test('  env: { ...process.env, PORT: port },'), true],
    ['a buildServerEnv call', SPREAD.test('  env: buildServerEnv({ PORT: port }),'), false],
    ['a doc-comment line', isCommentLine('   * a plain `...process.env` spread'), true],
    ['a line comment', isCommentLine('  // no ...process.env here'), true],
    [
      'a path-join entry + spawn',
      isServerSpawner(`${joinEntry}\nspawn('node', [DIST_ENTRY]);`),
      true,
    ],
    ['the installed bin + spawnSync', isServerSpawner(binEntry), true],
    ['an entry that is only read', isServerSpawner(`readFileSync(${joinEntry.slice(20)})`), false],
    ['a spawn of tsc', isServerSpawner("spawnSync(tsc, ['--noEmit'])"), false],
    [
      'an import of the builder',
      SHARED_IMPORT.test("import { buildServerEnv } from './lib/hermetic-server-env.js';"),
      true,
    ],
    [
      'a prose mention of the builder',
      SHARED_IMPORT.test('// see lib/hermetic-server-env.js'),
      false,
    ],
  ];
}

/**
 * Prove the check can fail. A validator that has only ever returned OK is unverified, not passing —
 * so run each predicate over input that SHOULD trip it and over input that should not.
 */
function runSelfTest() {
  const failures = selfTestCases()
    .filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual]) => `${label}: predicate returned ${actual}`);

  if (failures.length > 0) {
    for (const failure of failures)
      console.error(`[hermetic-child-env] SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `[hermetic-child-env] SELF-TEST OK: ${selfTestCases().length} cases — detects a spread and a ` +
      'server spawn, ignores prose, a builder call, a read-only entry and a non-server spawn.'
  );
}

main();
