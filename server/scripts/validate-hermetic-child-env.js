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
 * A THIRD ENUMERATION, over both shapes: every `buildServerEnv(` call must state a `HOME`.
 *
 * `HOME` is the one entry on the scrub list that a scrub makes worse, so the builder requires it
 * instead — see `lib/hermetic-server-env.js`. That requirement is enforced at RUNTIME by a throw,
 * which is the load-bearing half and cannot be spelled around. This check is the static half, and
 * it exists because the runtime throw only fires when something runs the spawner: a new spawn site
 * in a script CI does not reach, or in a test nobody runs locally, would otherwise ship. Here the
 * finding arrives from `validate:all`, before any server starts.
 *
 * `HOME` counts as stated when the call names the key, spreads a `createHermeticRoots()` pair
 * (`...roots.env`), or forwards an object this checker cannot see through — see
 * `OPAQUE_ARGUMENT` for the one spelling that is accepted on trust and why the trust is bounded.
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
const TESTS_DIR = path.join(SERVER_ROOT, 'tests');
const SCRIPTS_DIR = path.join(SERVER_ROOT, 'scripts');
/** Defines the builder and documents it in prose; every match inside is a definition or an example. */
const BUILDER_MODULE = path.join(SCRIPTS_DIR, 'lib', 'hermetic-server-env.js');
const SHARED_RELATIVE = 'scripts/lib/hermetic-server-env.js';

/** `...process.env` or `{ ...process.env` — the spread that inherits the caller's decisions. */
const SPREAD = /\.\.\.\s*process\.env/;
/** The built server's entry, as the scripts spell it: a path join, or the installed package bin. */
const SERVER_ENTRY = /['"]dist['"]\s*,\s*['"]index\.js['"]|bin\[\s*['"]claude-prompts['"]\s*\]/;
/** A child-process call. */
const SPAWN_CALL = /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/;
/** An import of the shared builder, from any relative depth. */
const SHARED_IMPORT = /from\s+['"][^'"]*\/hermetic-server-env\.js['"]/;
/** A `buildServerEnv(` call, and the balanced argument list that follows it. */
const BUILDER_CALL = /\bbuildServerEnv\s*\(/g;
/**
 * `HOME` stated directly, or the whole pair spread from `createHermeticRoots()`.
 *
 * `...<name>.env` rather than `...roots.env`: the five call sites that spread a pair spell the
 * variable four different ways (`roots`, `this.roots`, `ROOTS`, a parameter), and pinning one
 * spelling would turn a rename into a silent pass.
 */
const HOME_STATED = /\bHOME\s*:|\.{3}\s*[\w.]+\.env\b/;
/**
 * A call whose whole argument is one identifier or spread — `buildServerEnv(env)`,
 * `buildServerEnv(scenarioEnv(scenario))`.
 *
 * Accepted on trust, because the object is built elsewhere and this checker reads one file at a
 * time. The trust is bounded by the runtime throw: such a call still fails the moment it runs
 * without a `HOME`, which is a worse place to learn it but not a silent one.
 *
 * THIS ARM IS NOT DECORATIVE — measured 2026-09-15, exactly one site takes it:
 * `tests/e2e/gate-toggle-restart.e2e.test.ts` forwards `scenarioEnv(scenario)`, whose `HOME` comes
 * from a `Scenario` field. That is the whole blind spot, and it is one grep from being re-measured
 * (`rg 'buildServerEnv\([A-Za-z]'`). An earlier draft of this comment claimed the arm matched
 * nothing; the gate's own positive control disproved it, which is the reason the count is stated
 * here as a measurement with a date rather than as an assurance.
 */
const OPAQUE_ARGUMENT = /^\s*(?:\.{3})?[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\([^()]*\))?\s*,?\s*$/;

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

/**
 * The balanced argument text of the call whose `(` sits at `open`, or `null` if it never closes.
 *
 * Brace-counting rather than a regex, because every real argument here contains nested braces and
 * a regex that stops at the first `)` would read `buildServerEnv({ ...roots.env, PORT: String(p) })`
 * as ending at `String(p`.
 */
function argumentText(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Comments cannot state a `HOME`; strip them before asking whether the argument does. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** `relative:line: text` for every `buildServerEnv(` call that states no `HOME`. */
function homeFindings(relative, text) {
  const findings = [];
  BUILDER_CALL.lastIndex = 0;
  let match;
  while ((match = BUILDER_CALL.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const line = text.slice(0, match.index).split('\n').length;
    if (isCommentLine(text.split('\n')[line - 1] ?? '')) continue;

    const argument = argumentText(text, open);
    if (argument === null) {
      findings.push(`${relative}:${line}: buildServerEnv( never closes — cannot read its argument`);
      continue;
    }
    const stripped = withoutComments(argument);
    if (HOME_STATED.test(stripped)) continue;
    if (stripped.trim() !== '' && OPAQUE_ARGUMENT.test(stripped)) continue;

    findings.push(
      `${relative}:${line}: buildServerEnv(${stripped.trim().slice(0, 60)}) states no HOME`
    );
  }
  return findings;
}

/**
 * Every `buildServerEnv(` call across `tests/` and `scripts/` must state a `HOME`.
 *
 * Wider than the spread check above, which is e2e-only: the builder is importable from anywhere,
 * and an integration test that starts spawning servers would sit outside `tests/e2e`.
 */
function scanBuilderCalls() {
  const findings = [];
  let calls = 0;
  const files = [...walk(TESTS_DIR, ['.ts']), ...walk(SCRIPTS_DIR, ['.js', '.mjs', '.cjs', '.ts'])];
  for (const file of files) {
    if (file === SELF || file === BUILDER_MODULE || file.endsWith('.d.ts')) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes('buildServerEnv')) continue;
    const relative = path.relative(SERVER_ROOT, file);
    const before = findings.length;
    findings.push(...homeFindings(relative, text));
    calls += (text.match(/\bbuildServerEnv\s*\(/g) ?? []).length - (findings.length - before);
  }
  return { findings, calls };
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
  const builders = scanBuilderCalls();
  const findings = [...e2e.findings, ...scripts.findings, ...builders.findings];

  if (builders.calls + builders.findings.length === 0) {
    findings.push(
      'tests/ + scripts/: classified zero buildServerEnv calls — the call pattern stopped ' +
        'matching, so the HOME enumeration would have measured nothing'
    );
  }

  if (scripts.spawners.length === 0) {
    findings.push(
      'scripts/: classified zero server spawners — the classifier stopped matching the entry ' +
        'spellings, so this run would have measured nothing'
    );
  }

  if (findings.length > 0) {
    console.error(
      `[hermetic-child-env] FAIL: ${findings.length} finding(s). A spawned server must not ` +
        'inherit the ambient MCP_* path overrides or jest markers, and must be given an ' +
        'isolated HOME — a skills_sync export writes client skill folders there (224 files, ' +
        'measured 2026-09-15). Build the pair with createHermeticRoots() and spread it: ' +
        `buildServerEnv({ ...roots.env, ...overrides }) from ${SHARED_RELATIVE}:\n`
    );
    for (const finding of findings) console.error(`  ${finding}`);
    process.exit(1);
  }

  console.log(
    `[hermetic-child-env] OK: ${e2e.count} e2e file(s) spread no environment; ` +
      `${scripts.spawners.length} server-spawning script(s) use the shared builder ` +
      `(${scripts.spawners.join(', ')}); ${builders.calls} buildServerEnv call(s) state a HOME.`
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
    // ── the HOME enumeration ────────────────────────────────────────────────────────────────
    ['a call stating HOME', homeFindings('f.ts', 'buildServerEnv({ HOME: home });').length, 0],
    [
      'a call spreading a pair',
      homeFindings('f.ts', 'buildServerEnv({ ...roots.env, PORT: p });').length,
      0,
    ],
    [
      'a call spreading a pair off `this`',
      homeFindings('f.ts', 'buildServerEnv({ ...this.roots.env, MCP_WORKSPACE: w });').length,
      0,
    ],
    ['a call stating no HOME', homeFindings('f.ts', 'buildServerEnv({ PORT: p });').length, 1],
    ['a call with no argument at all', homeFindings('f.ts', 'buildServerEnv();').length, 1],
    [
      'nested parens do not truncate the argument',
      homeFindings('f.ts', 'buildServerEnv({ PORT: String(p), HOME: h });').length,
      0,
    ],
    [
      'a HOME that only appears in a comment',
      homeFindings('f.ts', 'buildServerEnv({\n  // HOME: h,\n  PORT: p,\n});').length,
      1,
    ],
    [
      'a doc-comment example is not a call site',
      homeFindings('f.ts', ' * buildServerEnv({ PORT: p })').length,
      0,
    ],
    [
      'an opaque forwarded argument is accepted on trust',
      homeFindings('f.ts', 'buildServerEnv(scenarioEnv(scenario));').length,
      0,
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
      'server spawn, ignores prose, a builder call, a read-only entry and a non-server spawn, ' +
      'and reports a buildServerEnv call that states no HOME while accepting a stated one, a ' +
      'spread pair and a forwarded object.'
  );
}

main();
