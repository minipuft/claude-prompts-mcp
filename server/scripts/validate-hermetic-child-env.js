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
 * Three enumerations:
 *
 *   - `tests/e2e/**.ts`: no file may spread `process.env`.
 *   - SERVER SPAWN SITES, per call, across `tests/` and `scripts/`: every child-process call that
 *     launches the server must pass an `env`, may not pass `env: process.env`, and its file must
 *     import the shared builder (directly, or through `tests/e2e/helpers/child-env.ts`). A call
 *     launches the server when its argument names the entry — `'dist', 'index.js'`, the installed
 *     `bin['claude-prompts']`, or a name bound to either, transitively and across a local import
 *     (`http-mcp-client.ts` spawns `args`, where `const args = [SERVER_PATH, ...]`). A missing
 *     `env` inherits exactly like a spread and contains nothing a spread ban can see: measured
 *     2026-09-16, a planted e2e file spawning `dist/index.js` with no `env` passed the previous,
 *     scripts-only, per-FILE classifier. Calls that spawn something else — `tsc`, `git`, `bash` —
 *     are not sites, even in a file that also spawns the server.
 *
 *   - every `buildServerEnv(` call must state a `HOME`.
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
 * BLIND SPOTS, stated as of 2026-09-16 — each flips when the named spelling appears in the repo:
 *
 *   - A server launched through a spelling the classifier does not recognise — a bare
 *     `'dist/index.js'` string, `npm start`, an entry built in a function return rather than a
 *     `const` — is not a site. The self-test pins the spellings it does recognise, and the run
 *     fails if it classifies zero sites, so a classifier that stops matching cannot report success
 *     over nothing. The run prints the per-file site count; 19 sites in 17 files at this date.
 *   - An `env` whose value was hand-built rather than returned by `buildServerEnv` passes, if the
 *     file imports the builder for some other call. `env` presence is checked per call; its
 *     PROVENANCE is not. The runtime throw does not cover this case, because the builder is never
 *     called.
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
/**
 * The builder's own unit test. Every `buildServerEnv(` call in it is a FIXTURE — several omit
 * `HOME` on purpose, to assert the throw — so reading them as spawn sites would make the gate
 * red over the very test that proves the runtime half works. Measured 2026-09-16: that is what
 * happened when the test landed without this exemption.
 */
const BUILDER_TEST = path.join(TESTS_DIR, 'unit', 'scripts', 'hermetic-server-env.test.ts');
const SHARED_RELATIVE = 'scripts/lib/hermetic-server-env.js';

/** `...process.env` or `{ ...process.env` — the spread that inherits the caller's decisions. */
const SPREAD = /\.\.\.\s*process\.env/;
/** The built server's entry, as the scripts spell it: a path join, or the installed package bin. */
const SERVER_ENTRY = /['"]dist['"]\s*,\s*['"]index\.js['"]|bin\[\s*['"]claude-prompts['"]\s*\]/;
/** A child-process call, global so every call in a file is visited. */
const SPAWN_CALLS = /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/g;
/**
 * An import of the shared builder, from any relative depth — directly, or through the e2e
 * suite's re-export `tests/e2e/helpers/child-env.ts`.
 */
const SHARED_IMPORT = /from\s+['"][^'"]*\/(?:hermetic-server-env|child-env)\.js['"]/;
/** An `env` property on a spawn's options: `env: x` or shorthand `env,` / `env }`. */
const ENV_PROPERTY = /\benv\s*(?::|,|\})/;
/** The spawner's own environment handed over whole, without even a spread to flag. */
const RAW_PROCESS_ENV = /\benv\s*:\s*process\.env\b/;
/** `const NAME = <initializer>` up to its terminating `;`, for entry-identifier discovery. */
const CONST_BINDING = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;]{1,400});/g;
/** `import { A, B as C } from './x.js'` — named local imports only; that is the only shape used. */
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g;
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

const wordPattern = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);

/**
 * Names in `text` that hold the server entry — bound to a spelling of it, or (transitively) to
 * an expression mentioning another such name. The transitive step is what finds
 * `http-mcp-client.ts`, whose spawn reads `args`, where `const args = [SERVER_PATH, ...]`.
 * A binding whose initializer is itself a spawn is not an entry: `const proc = spawn(...)`.
 */
function entryIdentifiers(text, seed = new Set()) {
  const bindings = [...text.matchAll(CONST_BINDING)].map((m) => ({ name: m[1], init: m[2] }));
  const names = new Set(seed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { name, init } of bindings) {
      if (names.has(name) || /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/.test(init)) {
        continue;
      }
      if (SERVER_ENTRY.test(init) || [...names].some((known) => wordPattern(known).test(init))) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
}

/** Resolve a relative import specifier the way these files write them (`.js` naming `.ts`). */
function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const stem = base.replace(/\.(?:[cm]?js)$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.mjs`, `${stem}.js`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this spelling.
    }
  }
  return null;
}

/** Entry names this file IMPORTS — `SERVER_PATH` from the e2e HTTP helper, for one. */
function importedEntryNames(file, text) {
  const imported = new Set();
  for (const match of text.matchAll(NAMED_IMPORT)) {
    const target = resolveLocal(file, match[2]);
    if (target === null) continue;
    const exported = entryIdentifiers(readFileSync(target, 'utf8'));
    for (const part of match[1].split(',')) {
      const [original, alias] = part
        .replace(/\btype\b/, '')
        .trim()
        .split(/\s+as\s+/);
      if (original && exported.has(original.trim())) imported.add((alias ?? original).trim());
    }
  }
  return imported;
}

/**
 * Every child-process call in `text` that launches the server, as `{ line, argument }`.
 *
 * Per CALL, not per file: a file-level classifier cannot tell the server spawn in
 * `verify-mcp-surface.mjs` from the `git` spawn beside it, and so could never ask whether each
 * server spawn carries an `env`. The argument is read balanced, so multi-line calls count.
 */
function serverSpawnSites(text, seed = new Set()) {
  const names = entryIdentifiers(text, seed);
  const sites = [];
  SPAWN_CALLS.lastIndex = 0;
  let match;
  while ((match = SPAWN_CALLS.exec(text)) !== null) {
    const line = text.slice(0, match.index).split('\n').length;
    if (isCommentLine(text.split('\n')[line - 1] ?? '')) continue;
    const argument = argumentText(text, match.index + match[0].length - 1);
    if (argument === null) continue;
    const code = withoutComments(argument);
    const launchesServer =
      SERVER_ENTRY.test(code) || [...names].some((name) => wordPattern(name).test(code));
    if (launchesServer) sites.push({ line, argument: code });
  }
  return sites;
}

/** A spawn site's own findings: no `env` inherits everything; `env: process.env` is the same. */
function siteFindings(relative, site) {
  if (RAW_PROCESS_ENV.test(site.argument)) {
    return [`${relative}:${site.line}: spawns the server with env: process.env`];
  }
  if (!ENV_PROPERTY.test(site.argument)) {
    return [`${relative}:${site.line}: spawns the server with no env — it inherits the caller's`];
  }
  return [];
}

function isServerSpawner(text) {
  return serverSpawnSites(text).length > 0;
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
    if (file === SELF || file === BUILDER_MODULE || file === BUILDER_TEST) continue;
    if (file.endsWith('.d.ts')) continue;
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
 * Every server spawn site across `tests/` and `scripts/`, each checked for an `env`, and every
 * file holding one checked for an import of the builder and for spreads.
 *
 * Both trees, because a spawn site is defined by what it launches, not by where it lives: before
 * 2026-09-16 only `scripts/` was classified, and a new e2e file spawning `dist/index.js` with no
 * `env` at all passed — measured with a planted file. The e2e spread ban could not see it, since
 * an omitted `env` contains nothing to ban.
 *
 * This validator is skipped: it holds the self-test fixtures, which name the server entry and a
 * spawn call as strings, and it spawns nothing.
 */
function scanSpawnSites() {
  const findings = [];
  const spawners = [];
  let siteCount = 0;
  const files = [...walk(TESTS_DIR, ['.ts']), ...walk(SCRIPTS_DIR, ['.js', '.mjs', '.cjs', '.ts'])];
  for (const file of files) {
    if (file === SELF || file.endsWith('.d.ts')) continue;
    const text = readFileSync(file, 'utf8');
    if (!/\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(/.test(text)) continue;

    const sites = serverSpawnSites(text, importedEntryNames(file, text));
    if (sites.length === 0) continue;

    const relative = path.relative(SERVER_ROOT, file);
    spawners.push(`${relative} (${sites.length})`);
    siteCount += sites.length;
    for (const site of sites) findings.push(...siteFindings(relative, site));
    if (!SHARED_IMPORT.test(text)) {
      findings.push(`${relative}: spawns the server without importing ${SHARED_RELATIVE}`);
    }
    if (file.startsWith(SCRIPTS_DIR)) findings.push(...spreadFindings(relative, text));
  }
  return { findings, spawners, siteCount };
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const e2e = scanE2e();
  const spawns = scanSpawnSites();
  const builders = scanBuilderCalls();
  const findings = [...e2e.findings, ...spawns.findings, ...builders.findings];

  if (builders.calls + builders.findings.length === 0) {
    findings.push(
      'tests/ + scripts/: classified zero buildServerEnv calls — the call pattern stopped ' +
        'matching, so the HOME enumeration would have measured nothing'
    );
  }

  if (spawns.siteCount === 0) {
    findings.push(
      'tests/ + scripts/: classified zero server spawn sites — the classifier stopped matching ' +
        'the entry spellings, so this run would have measured nothing'
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
      `${spawns.siteCount} server spawn site(s) in ${spawns.spawners.length} file(s) pass an env ` +
      `and import the shared builder (${spawns.spawners.join(', ')}); ` +
      `${builders.calls} buildServerEnv call(s) state a HOME.`
  );
}

/** Findings over the server spawn sites of a one-file fixture, expecting `sites` of them. */
function siteCount(text, sites) {
  const found = serverSpawnSites(text);
  if (found.length !== sites) return -1;
  return found.flatMap((site) => siteFindings('f.ts', site)).length;
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
    // ── per-call spawn sites ─────────────────────────────────────────────────────────────────
    [
      'a spawn with no env is a finding',
      siteCount(`spawn('node', [path.join(R, 'dist', 'index.js')], { stdio: 'pipe' });`, 1),
      1,
    ],
    [
      'a spawn handing over process.env whole is a finding',
      siteCount(`spawn('node', [path.join(R, 'dist', 'index.js')], { env: process.env });`, 1),
      1,
    ],
    [
      'a spawn with env shorthand passes',
      siteCount(`spawn('node', [path.join(R, 'dist', 'index.js')], { cwd, env, stdio });`, 1),
      0,
    ],
    [
      'a MULTI-LINE spawn is still a site',
      serverSpawnSites(`spawn(\n  'node',\n  [path.join(R, 'dist', 'index.js')],\n  {}\n);`).length,
      1,
    ],
    [
      'an entry reached through a second binding is still a site',
      serverSpawnSites(
        `const E = path.join(R, 'dist', 'index.js');\nconst args = [E, '--q'];\nspawn('node', args);`
      ).length,
      1,
    ],
    [
      'an entry name imported from elsewhere is honoured',
      serverSpawnSites(`spawn('node', [SERVER_PATH], {});`, new Set(['SERVER_PATH'])).length,
      1,
    ],
    [
      'a git spawn beside a server spawn is not a site',
      serverSpawnSites(
        `const E = path.join(R, 'dist', 'index.js');\nexecFileSync('git', ['status']);`
      ).length,
      0,
    ],
    [
      'a binding that IS a spawn does not become an entry',
      serverSpawnSites(
        `const E = path.join(R, 'dist', 'index.js');\nconst proc = spawn('node', [E], { env });\nfork('w.js', [proc]);`
      ).length,
      1,
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
      'reports a buildServerEnv call that states no HOME while accepting a stated one, a ' +
      'spread pair and a forwarded object, and finds every server spawn per call — multi-line, ' +
      'through a second binding or an import — reporting one with no env or a raw process.env.'
  );
}

main();
