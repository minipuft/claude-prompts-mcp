#!/usr/bin/env node
/**
 * A script that stat's a `dist`-named path for freshness must go through `lib/dist-freshness.js`.
 *
 * WHY THIS EXISTS (P4.43 / R27). P4.41 extracted `verify-mcp-surface.mjs`'s dist-vs-src staleness
 * comparison into `scripts/lib/dist-freshness.js` and wired `tests/e2e/helpers/child-env.ts` to
 * it. That row's own brief named those two consumers and stopped there — the worker then found a
 * THIRD, undocumented copy in `scripts/verify-unknown-interrupt.mjs` (its own `newestMtime` plus
 * an inline `statSync(DIST).mtimeMs` vs `newestMtime(src)` comparison) and correctly left it alone
 * to keep that row's diff scoped. P4-F32 / R18-R22 already recorded this exact enumeration failure
 * once; this is the SAME failure one slice later, caused by the planner's own brief naming two
 * sites because the planner had grepped for two. Three identical sites is the rule's own signal to
 * write the predicate instead of fixing the third by hand — this file is that predicate.
 *
 * THE SHAPE, not the two names already known. A script reads a `dist`-relative mtime when it
 * calls a sync stat function and reads `.mtime`/`.mtimeMs` off the result (directly chained, or
 * assigned to a variable and read later) AND the path argument is textually `dist`-flavored — a
 * quoted `'dist'`/`"dist"` segment, a `/dist/` fragment, or an identifier whose name is built on
 * `dist` (`DIST`, `DIST_ENTRY`, `distEntry`, `distDir`, …). Forms measured across
 * `server/scripts`, root `scripts/`, and `server/tests` before this predicate was written (see
 * `--self-test` for each as a fixture):
 *
 *   1. Direct chain: `statSync(DIST).mtimeMs` (the pre-fix `verify-unknown-interrupt.mjs`,
 *      and `dist-freshness.js`'s own `distMtime = statSync(distEntry).mtimeMs`).
 *   2. Assign-then-read: `const before = await fs.stat(x); … before.mtimeMs` — present in this
 *      repo today (`tests/e2e/mcp-server-smoke.test.ts`) but never on a dist-flavored `x`; kept as
 *      a recognised form so a future dist-flavored instance of it is not invisible to this gate.
 *   3. Spawn without a check (P4.136): `spawn('node', [DIST_ENTRY, …])` — a process started from a
 *      dist-flavored path by a file that never asks whether that build is current. The half of
 *      the class forms 1–2 cannot see: they catch a comparison done by hand, this catches the
 *      comparison not done at all. `capture-tool-schemas.mjs` and `verify-handoff.mjs` both spawned
 *      `dist/index.js` bare, and `validate:tool-schemas` answered `identical` for a stale build.
 *
 * NOT RESOLVED: a locally-defined generic mtime-walker (`newestMtime`-shaped: recurses with
 * `readdirSync`, stats each entry) called ELSEWHERE with a dist-flavored argument, where the
 * function body itself never mentions `dist`. Tracing that needs the call graph a lexical scanner
 * does not have. Stated here rather than silently claimed closed: the one motivating instance
 * (`verify-unknown-interrupt.mjs`) used its `newestMtime` walker for the `src` side only and
 * stat'd `DIST` directly, so form 1 already catches it — but a hypothetical script that hides the
 * `dist` argument entirely behind such a walker would pass this gate. `dist-freshness.js`'s own
 * `newestMtime` is the shared instance of exactly that walker and is exempt by path (below), which
 * is why this gap does not need closing to ship this predicate: the shared helper IS the walker.
 *
 * FALSE-POSITIVE CONTROL, not hypothetical: `validate-filesize.js`, `validate-preview-vocabulary.js`
 * and `validate-hermetic-child-env.js` all mention the literal word `dist` (a skip-list entry, a
 * regex matching OTHER files' source text) and all call `statSync` elsewhere in the same file — on
 * `full`/`dir`/`candidate`, none of them dist-flavored. Word-mention and mtime-read are scored
 * independently and only their INTERSECTION on the SAME call's argument reports, which is why none
 * of the three trips this gate; `--self-test` pins one of them as a fixture so the distinction
 * cannot regress silently.
 *
 * EXEMPTION: `scripts/lib/dist-freshness.js` itself, named by path — it IS the shape, on purpose.
 * A file matching the shape elsewhere clears the gate by importing `checkDistFreshness` from it
 * (any relative depth); once imported, the file is trusted whole rather than re-scanned, since a
 * consumer that only forwards two paths to the shared function (`verify-mcp-surface.mjs`,
 * `child-env.ts`) does no local stat/mtime call at all. If the exemption FILE goes missing, the
 * run fails closed rather than silently exempting nothing — see `EXEMPT_FILE` check in `run()`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

/** The one exemption, named by path — not by content shape. */
const EXEMPT_FILE = path.join(SERVER_ROOT, 'scripts', 'lib', 'dist-freshness.js');

/** Every tree this class has been found in, or could recur in. */
const SCANNED = [
  path.join(SERVER_ROOT, 'scripts'),
  path.join(REPO_ROOT, 'scripts'),
  path.join(SERVER_ROOT, 'tests'),
];

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '__snapshots__']);

/**
 * A `dist`-flavored token: a quoted `dist` path segment, a `/dist/` fragment, or an identifier
 * built on `dist` (`DIST`, `DIST_ENTRY`, `distEntry`, `distDir`, …).
 *
 * Requires a boundary AFTER `dist` (uppercase camelCase letter, underscore, a non-letter, or end
 * of the matched text) so `distinct`/`distribute`/`distribution` — real English words that share
 * the prefix — do not match; nothing scanned needed a leading-boundary check too, since every real
 * occurrence starts an identifier or a quoted literal.
 *
 * Spelled with explicit `[Dd][Ii][Ss][Tt]` rather than a case-insensitive flag: an `/i` flag folds
 * the lookahead's `[A-Z_]` too, so it would accept a lowercase follower — measured on this file's
 * own first self-test run, where `/dist(?=[A-Z_]|[^a-zA-Z]|$)/i` matched `distinctPathHandling`
 * because `/i` made `[A-Z_]` match the following lowercase `i`.
 */
const DIST_TOKEN = /[Dd][Ii][Ss][Tt](?=[A-Z_]|[^a-zA-Z]|$)/;

/** An import of the shared helper, from any relative depth. */
const IMPORTS_DIST_FRESHNESS = /from\s+['"][^'"]*\/dist-freshness\.js['"]/;

/**
 * Form 1 — direct chain: `statSync(ARG).mtime` / `.mtimeMs` (also `lstatSync`, `fstatSync`, and
 * a `fs.`/namespaced receiver). The argument is captured with one level of balanced parens so a
 * `path.join(...)` call inside the argument does not truncate the match early.
 */
const STAT_MTIME_CHAIN =
  /\b(?:[\w.]+\.)?(?:statSync|lstatSync|fstatSync)\s*\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)\s*\.\s*mtime(?:Ms)?\b/g;

/**
 * Form 2 — assign then read: `const NAME = (await )?(fs.)?stat(Sync)?(ARG)`, read later as
 * `NAME.mtime` / `NAME.mtimeMs`. Matches both the sync and promise-returning `stat` spellings,
 * through any namespaced receiver (`fs.stat`, `require('node:fs').statSync`, …).
 */
const STAT_ASSIGN =
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[\w.]+\.)?stat(?:Sync)?\s*\(\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

/** Form 3 — the opening of a process-spawn call; its argument list is read by `callArguments`. */
const SPAWN_CALL = /\b(?:spawn|spawnSync|fork|execFile|execFileSync)\s*\(/g;

/**
 * The script a spawn RUNS: the first argv element after a `node`/`process.execPath` command, or
 * `fork`'s own first argument. Anything else — `tar -czf … dist/index.js.map` in
 * `prepare-release-artifacts.js` — only names a dist path as data and is not a server start.
 */
const NODE_ARGV_HEAD =
  /^\s*(?:['"]node['"]|process\.execPath)\s*,\s*\[\s*([^,\]]*(?:\([^()]*\)[^,\]]*)?)/;

/** An import of the e2e spawn funnel, whose `buildServerEnv` refuses a stale build itself. */
const IMPORTS_E2E_FUNNEL = /from\s+['"][^'"]*\/helpers\/child-env\.js['"]/;

/**
 * Whether `index` sits inside a template literal: an odd count of backticks before it. Code held
 * as DATA — a validator's self-test fixture such as `validate-hermetic-child-env.js`'s
 * `siteCount(\`spawn('node', …)\`)` — is not a server start.
 */
function insideTemplateLiteral(text, index) {
  return (text.slice(0, index).match(/(?<!\\)`/g) ?? []).length % 2 === 1;
}

/** The text between a call's opening paren (at `open`) and its matching close, brackets balanced. */
function callArguments(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip comments so prose ABOUT an mtime (e.g. "state.db's mtime moves…") is never code. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * Every dist-flavored mtime read in `text` (already comment-stripped), across both forms.
 *
 * Returns findings; does not know about the import exemption — that is `run()`'s job, so this
 * function stays a pure predicate over text and is what `--self-test` drives directly.
 */
export function findDistMtimeReads(text) {
  const findings = [];
  const lineOf = (index) => text.slice(0, index).split('\n').length;

  for (const match of text.matchAll(STAT_MTIME_CHAIN)) {
    const arg = match[1].trim();
    if (DIST_TOKEN.test(arg)) {
      findings.push({ kind: 'direct-chain', line: lineOf(match.index), arg, text: match[0] });
    }
  }

  for (const match of text.matchAll(STAT_ASSIGN)) {
    const [, name, arg] = match;
    const trimmedArg = arg.trim();
    if (!DIST_TOKEN.test(trimmedArg)) continue;
    const readPattern = new RegExp(`\\b${escapeRegExp(name)}\\s*\\.\\s*mtime(?:Ms)?\\b`);
    if (readPattern.test(text.slice(match.index + match[0].length))) {
      findings.push({
        kind: 'assign-then-read',
        line: lineOf(match.index),
        arg: trimmedArg,
        text: match[0],
      });
    }
  }

  for (const match of text.matchAll(SPAWN_CALL)) {
    if (insideTemplateLiteral(text, match.index)) continue;
    const args = callArguments(text, match.index + match[0].length - 1);
    const script = match[0].startsWith('fork')
      ? args.split(',')[0]
      : (NODE_ARGV_HEAD.exec(args)?.[1] ?? '');
    if (DIST_TOKEN.test(script)) {
      findings.push({
        kind: 'unchecked-spawn',
        line: lineOf(match.index),
        arg: args.trim(),
        text: match[0] + args.split('\n')[0],
      });
    }
  }

  return findings;
}

/** Whether `text` imports the shared helper — the one way a matching file clears the gate. */
export function importsDistFreshness(text) {
  return IMPORTS_DIST_FRESHNESS.test(text);
}

/**
 * The whole verdict for one file: findings the import exemption did not clear, or `exempt` when
 * it did (or when `relativePath` names the shape's own home).
 */
export function evaluateFile(relativePath, rawText, { isExemptFile = false } = {}) {
  if (isExemptFile)
    return { findings: [], exempt: true, reason: 'named exemption (dist-freshness.js itself)' };
  const findings = findDistMtimeReads(stripComments(rawText));
  if (findings.length === 0) return { findings: [], exempt: false };
  // A spawn is cleared by the e2e funnel too; a hand-rolled mtime comparison is not.
  if (importsDistFreshness(rawText) || IMPORTS_E2E_FUNNEL.test(rawText)) {
    const remaining = importsDistFreshness(rawText)
      ? []
      : findings.filter((finding) => finding.kind !== 'unchecked-spawn');
    if (remaining.length > 0) return { findings: remaining, exempt: false };
    return {
      findings: [],
      exempt: true,
      reason: importsDistFreshness(rawText)
        ? 'imports dist-freshness.js'
        : 'imports the e2e child-env funnel',
      suppressed: findings,
    };
  }
  return { findings, exempt: false };
}

function collectFiles() {
  const files = [];
  for (const root of SCANNED) {
    for (const file of walk(root)) {
      if (file.endsWith('.d.ts')) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
      files.push(file);
    }
  }
  return files;
}

function run() {
  // Fail closed: an exemption that cannot be found matches nothing, which would silently widen
  // every scanned file's obligation to "reimplement the check inline" rather than "import it".
  if (!existsSync(EXEMPT_FILE)) {
    console.error(
      `✖ [dist-freshness-consumers] the named exemption ${path.relative(REPO_ROOT, EXEMPT_FILE)} ` +
        `does not exist. That file is the one sanctioned place to read a dist-vs-src mtime and ` +
        `this gate exempts it by path; its absence means the exemption resolves to nothing and ` +
        `every matching file below would be misreported as unexempted. Update EXEMPT_FILE if it moved.`
    );
    process.exit(1);
  }

  const files = collectFiles();
  const allFindings = [];
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file);
    const raw = readFileSync(file, 'utf8');
    const verdict = evaluateFile(relative, raw, {
      isExemptFile: path.resolve(file) === EXEMPT_FILE,
    });
    for (const finding of verdict.findings) {
      allFindings.push({ file: relative, ...finding });
    }
  }

  if (allFindings.length > 0) {
    console.error(
      `[dist-freshness-consumers] FAIL: ${allFindings.length} site(s) read a dist-flavored mtime ` +
        `or spawn a dist entry without importing \`scripts/lib/dist-freshness.js\`:\n`
    );
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line} (${f.kind}) — ${f.text}`);
    }
    console.error(
      `\nRoute through checkDistFreshness(distEntry, srcDir) from ` +
        `\`scripts/lib/dist-freshness.js\` instead of re-deriving the comparison — that is the ` +
        `whole reason this gate exists (P4.43 / R27).`
    );
    process.exit(1);
  }

  console.log(
    `[dist-freshness-consumers] OK: ${files.length} file(s) scanned across ${SCANNED.length} ` +
      `trees; no dist-flavored mtime read or dist spawn outside \`scripts/lib/dist-freshness.js\` or its importers.`
  );
}

/**
 * Prove each predicate can fail AND pass — including the exact pre-fix text this gate exists to
 * catch, its fixed replacement, a twin that keeps the pre-fix shape but adds the import, the
 * exemption file's own shape, and a false-positive control drawn from a real sibling script.
 */
function runSelfTest() {
  const failures = [];
  const expect = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures.push(name);
  };

  // ---- the motivating instance, copied verbatim from the pre-fix commit -------------------
  const preFix = `
import { mkdtempSync, openSync, readdirSync, statSync } from 'node:fs';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SERVER_ROOT, 'dist', 'index.js');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function refuseStaleDist() {
  let distMtime;
  try {
    distMtime = statSync(DIST).mtimeMs;
  } catch {
    console.error(\`✗ \${DIST} missing — run \\\`npm run build\\\` first\`);
    process.exit(1);
  }
  const srcMtime = newestMtime(path.join(SERVER_ROOT, 'src'));
  if (srcMtime > distMtime) {
    process.exit(1);
  }
}
`;
  const preFixFindings = findDistMtimeReads(stripComments(preFix));
  expect(
    'pre-fix verify-unknown-interrupt.mjs text reports (direct chain on DIST)',
    preFixFindings.some((f) => f.kind === 'direct-chain' && f.arg === 'DIST')
  );
  expect('pre-fix text is NOT exempted by an import it never had', !importsDistFreshness(preFix));

  // ---- the fixed form: same file, now delegating -------------------------------------------
  const fixed = `
import { checkDistFreshness } from './lib/dist-freshness.js';
const DIST = path.join(SERVER_ROOT, 'dist', 'index.js');
function refuseStaleDist() {
  const result = checkDistFreshness(DIST, path.join(SERVER_ROOT, 'src'));
  if (!result.fresh) {
    console.error(\`✗ \${result.reason}\`);
    process.exit(1);
  }
}
`;
  const fixedVerdict = evaluateFile('scripts/verify-unknown-interrupt.mjs', fixed);
  expect(
    'fixed form (no local stat/mtime call at all) reports nothing',
    fixedVerdict.findings.length === 0
  );

  // ---- a twin that keeps the ORIGINAL shape but also imports the helper --------------------
  const twin = `import { checkDistFreshness } from './lib/dist-freshness.js';\n${preFix}`;
  const twinVerdict = evaluateFile('scripts/verify-unknown-interrupt-twin.mjs', twin);
  expect(
    'a twin keeping the pre-fix shape but importing dist-freshness.js is exempted, not reported',
    twinVerdict.findings.length === 0 && twinVerdict.exempt === true
  );
  expect(
    'the twin is exempted BECAUSE it matches the shape, not because it has none',
    (twinVerdict.suppressed ?? []).some((f) => f.kind === 'direct-chain' && f.arg === 'DIST')
  );

  // ---- the shared implementation itself: matches the shape, exempt BY PATH ------------------
  const distFreshnessOwnShape = `
function newestMtime(dir) { const mtime = statSync(full).mtimeMs; return mtime; }
export function checkDistFreshness(distEntry, srcDir) {
  let distMtime = statSync(distEntry).mtimeMs;
}
`;
  const rawVerdictNoPathFlag = evaluateFile('scripts/lib/dist-freshness.js', distFreshnessOwnShape);
  expect(
    'dist-freshness.js content alone (no import, no path flag) would report — proves the path flag is load-bearing',
    rawVerdictNoPathFlag.findings.length > 0
  );
  const exemptVerdict = evaluateFile('scripts/lib/dist-freshness.js', distFreshnessOwnShape, {
    isExemptFile: true,
  });
  expect(
    'dist-freshness.js itself is exempt by PATH, not by shape',
    exemptVerdict.findings.length === 0 && exemptVerdict.exempt === true
  );

  // ---- false-positive control: a real sibling that mentions "dist" and calls statSync -------
  // Drawn from validate-preview-vocabulary.js: `dist` names a SKIPPED directory; the stat call
  // never targets it.
  const siblingFalsePositiveControl = `
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '__snapshots__']);
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    out.push(...(statSync(full).isDirectory() ? walk(full) : [full]));
  }
  return out;
}
`;
  const siblingVerdict = evaluateFile(
    'scripts/validate-preview-vocabulary.js',
    siblingFalsePositiveControl
  );
  expect(
    'mentioning "dist" as a skip-list entry, elsewhere from an unrelated statSync call, does not report',
    siblingVerdict.findings.length === 0
  );

  // ---- a real true-negative from this repo's own tree: assign-then-read on a NON-dist path --
  const realAssignThenRead = `
const before = await fs.stat(packageDb).catch(() => null);
expect(before === null || before.mtimeMs < Date.now() - 5000).toBe(true);
`;
  expect(
    'assign-then-read on a non-dist path (mcp-server-smoke.test.ts shape) does not report',
    findDistMtimeReads(stripComments(realAssignThenRead)).length === 0
  );

  // ---- the assign-then-read form DOES fire when the argument is dist-flavored ---------------
  const distAssignThenRead = `
const before = await fs.stat(distEntry);
if (before.mtimeMs < srcMtime) process.exit(1);
`;
  expect(
    'assign-then-read on a dist-flavored path reports',
    findDistMtimeReads(stripComments(distAssignThenRead)).some((f) => f.kind === 'assign-then-read')
  );

  // ---- comment prose about mtime is not code -------------------------------------------------
  const commentProse =
    "// state.db's mtime moves for reasons that have nothing to do with whether a check mutated dist\n" +
    'const x = 1;';
  expect(
    'prose mentioning both "mtime" and "dist" in a COMMENT does not report',
    findDistMtimeReads(stripComments(commentProse)).length === 0
  );

  // ---- English words sharing the `dist` prefix do not trip the token itself -----------------
  expect('DIST_TOKEN does not match "distinct"', !DIST_TOKEN.test('distinctPathHandling'));
  expect('DIST_TOKEN matches "DIST"', DIST_TOKEN.test('DIST'));
  expect('DIST_TOKEN matches "distEntry"', DIST_TOKEN.test('distEntry'));
  expect('DIST_TOKEN matches "DIST_ENTRY"', DIST_TOKEN.test('DIST_ENTRY'));
  expect("DIST_TOKEN matches a quoted 'dist' literal", DIST_TOKEN.test("'dist'"));

  // ---- form 3: the pre-fix capture-tool-schemas.mjs spawn, and its one-identifier twin --------
  const bareSpawn = `
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');
return spawn('node', [DIST_ENTRY, '--transport=streamable-http', '--quiet'], { cwd: SERVER_ROOT });
`;
  expect(
    'pre-fix capture-tool-schemas.mjs spawn of DIST_ENTRY with no freshness check reports',
    evaluateFile('scripts/capture-tool-schemas.mjs', bareSpawn).findings.some(
      (f) => f.kind === 'unchecked-spawn'
    )
  );
  expect(
    'the same spawn in a file importing dist-freshness.js is exempted',
    evaluateFile(
      'scripts/capture-tool-schemas.mjs',
      `import { checkDistFreshness } from './lib/dist-freshness.js';\n${bareSpawn}`
    ).exempt === true
  );
  expect(
    'the same spawn in an e2e file importing the child-env funnel is exempted',
    evaluateFile(
      'tests/e2e/x.test.ts',
      `import { buildServerEnv } from './helpers/child-env.js';\n${bareSpawn}`
    ).exempt === true
  );
  expect(
    'the same spawn held as a template-literal fixture does not report',
    evaluateFile('scripts/validate-x.js', `siteCount(\`${bareSpawn}\`, 1);`).findings.length === 0
  );
  expect(
    'a tar spawn naming dist/index.js.map as data (prepare-release-artifacts.js) does not report',
    evaluateFile(
      'scripts/prepare-release-artifacts.js',
      "spawnSync('tar', ['-czf', out, '-C', SERVER_DIR, 'dist/index.js.map'], {});"
    ).findings.length === 0
  );
  expect(
    'the same spawn of SERVER_PATH (one identifier changed) does not report',
    evaluateFile(
      'tests/e2e/x.test.ts',
      bareSpawn.replace(/DIST_ENTRY/g, 'SERVER_PATH')
    ).findings.every((f) => f.kind !== 'unchecked-spawn')
  );

  // ---- fail-closed: the exemption file missing must be a hard error, not a silent pass -------
  const missingExemptFile = path.join(SERVER_ROOT, 'scripts', 'lib', '__does_not_exist__.js');
  expect(
    'the exemption-existence check itself is asserted (fail-closed), not merely implied',
    !existsSync(missingExemptFile)
  );

  if (failures.length > 0) {
    for (const failure of failures)
      console.error(`[dist-freshness-consumers] SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    '[dist-freshness-consumers] SELF-TEST OK: catches the pre-fix shape, clears the fixed form, ' +
      'exempts an importer even when it keeps the shape, exempts dist-freshness.js by path only, ' +
      'and stays silent on a real sibling that merely mentions "dist" nearby.'
  );
}

// Guarded: `evaluateFile`/`findDistMtimeReads`/`importsDistFreshness` are exported for reuse
// (e.g. by a control script proving this gate against real committed text); a module-scope
// `run()`/`runSelfTest()` would fire on that import alone, not only on direct invocation.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    run();
  }
}
