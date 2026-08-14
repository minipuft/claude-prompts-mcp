#!/usr/bin/env node

/**
 * Guards the one invariant that keeps `state.db` where the PathResolver put it.
 *
 * WHY THIS EXISTS
 * `SqliteEngine.getInstance` is a singleton accessor: it keeps the config of whichever call
 * arrives FIRST and silently discards every later one. Five of its seven call sites pass no
 * `dbPath` and fall back to `path.join(serverRoot, 'runtime-state', 'state.db')` — the PACKAGE
 * directory, which is read-only under a sandboxed MCP child and invisible to the workspace
 * either way. Only the composition root knows the resolved runtime path.
 *
 * So the location of the database is decided by CALL ORDER, and call order is not a thing any
 * type or test naturally pins. Before Tier 0.1 it was correct by accident: `ResourceChangeTracker`
 * happened to initialize first and is one of the two sites that passes the resolved path.
 *
 * WHAT IT CHECKS
 *   1. `claimStateDatabase(...)` is actually called in module-initializer.ts, and its call site
 *      precedes every other `getInstance` call in that file. This is a SOURCE-ORDER assertion
 *      because the property being protected is source order — a runtime test would have to
 *      reconstruct the whole composition root to observe it.
 *   2. Every `getInstance` call site repo-wide either supplies `dbPath` or is a declared
 *      inheritor. A NEW site that omits `dbPath` without being declared is a finding: it is
 *      exactly the shape that can win the race and relocate the database.
 *   3. **Exception hygiene**, via the shared `lib/exception-hygiene.js` harness — every
 *      `ACCEPTED_INHERITORS` entry must name what retires it (`closedBy`) AND still suppress a
 *      real finding. A declared inheritor that now supplies `dbPath` is `satisfied` and must be
 *      deleted; one naming a file that is gone is `subject-missing`; one the `git grep … -- src`
 *      scan cannot reach is `unreachable` and must NOT be deleted until the scan is widened. An
 *      exception list only ever grows otherwise, and a green run stops meaning what it says
 *      (cleanup-standards.md § A Suppression Outlives What It Suppressed).
 *
 * WHAT IT DOES NOT CLAIM
 * This does not prove the defect was ever reachable in production. It was not, measured
 * 2026-08-09: `context.ts` declares `serverRoot: string` and `resolvePackageRoot` throws rather
 * than returning empty, so the tracker block always runs. This gate protects a LATENT hazard —
 * its value is that reordering the composition root, or adding a sixth inheriting call site
 * upstream of the claim, now fails here instead of silently moving the database.
 *
 * `--self-test` proves each rule can still fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(SERVER, 'src');
const INITIALIZER = path.join(SRC, 'runtime', 'module-initializer.ts');

const CLAIM_FN = 'claimStateDatabase';
const CALL = 'SqliteEngine.getInstance(';

/**
 * Call sites that deliberately inherit the claimed path instead of supplying their own.
 *
 * Each is downstream of the composition-root claim, so inheriting is correct — but each is also
 * a site that WOULD relocate the database if it ever ran first. `closedBy` names what would let
 * the entry be deleted rather than leaving it as a permanent bypass wearing a temporary label.
 */
const ACCEPTED_INHERITORS = [
  {
    file: 'src/runtime/application.ts',
    reason: 'fullServerRefresh — hot reload, runs long after startup has claimed',
    closedBy: 'threading the resolved dbPath through Application, or removing the refresh path',
  },
  {
    file: 'src/runtime/module-initializer.ts',
    reason: 'tool-index and script-loader blocks, both after claimStateDatabase in this file',
    closedBy: 'rule 1 already pins the ordering; delete if these sites gain an explicit dbPath',
  },
  {
    file: 'src/engine/gates/gate-state-store.ts',
    reason: 'constructed inside initializeModules, after the claim',
    closedBy: 'passing the resolved path into the store like ResourceChangeTracker does',
  },
  {
    file: 'src/engine/frameworks/framework-state-store.ts',
    reason:
      'constructed inside initializeModules, after the claim. NOTE: its root comes from ' +
      'configManager.getServerRoot(), NOT the PathResolver — so if it ever ran first it would ' +
      'claim a genuinely different directory, not merely an unresolved one',
    closedBy: 'passing the resolved path into the store like ResourceChangeTracker does',
  },
];

/** Every `SqliteEngine.getInstance(` call in `source`, with its line and whether it names dbPath. */
export function callSites(source) {
  const sites = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(CALL, from);
    if (at === -1) break;
    from = at + CALL.length;

    // Skip doc-comment occurrences — they are illustrations, not call sites.
    const lineStart = source.lastIndexOf('\n', at) + 1;
    if (/^\s*\*/.test(source.slice(lineStart, at))) continue;

    // Walk to the matching close paren so `dbPath` is searched in THIS call, not the next one.
    let depth = 1;
    let i = from;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    sites.push({
      line: source.slice(0, at).split('\n').length,
      suppliesDbPath: source.slice(from, i).includes('dbPath'),
    });
  }
  return sites;
}

/** Rule 1, as a pure function so the self-test can drive it with fabricated sources. */
export function orderViolations(source) {
  const claimAt = source.indexOf(`await ${CLAIM_FN}(`);
  if (claimAt === -1) {
    return [
      `module-initializer.ts: ${CLAIM_FN}() is never called — the composition root no longer ` +
        'claims the SqliteEngine singleton, so state.db location reverts to call order',
    ];
  }
  const claimLine = source.slice(0, claimAt).split('\n').length;

  // The call inside claimStateDatabase itself is the claim; every OTHER site must follow it.
  return callSites(source)
    .filter((s) => !s.suppliesDbPath && s.line < claimLine)
    .map(
      (s) =>
        `module-initializer.ts:${s.line}: SqliteEngine.getInstance() with no dbPath runs BEFORE ` +
        `${CLAIM_FN}() at line ${claimLine} — it would claim the singleton first`
    );
}

/** Files under src/ containing a real call site, via git (fast, and respects tracked files). */
function filesWithCallSites() {
  const out = execFileSync('git', ['grep', '-l', '--fixed-strings', CALL, '--', 'src'], {
    cwd: SERVER,
    encoding: 'utf8',
  });
  return out.split('\n').filter((f) => f.endsWith('.ts'));
}

/** Exactly the reach of `filesWithCallSites()`: git-tracked files under `src/`, call site or not. */
function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '--', 'src'], { cwd: SERVER, encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}

/**
 * Classifies one accepted inheritor against the question this gate actually asks: does the file it
 * names STILL have a `getInstance` call site that inherits the claimed path?
 *
 * `unreachable` is a distinct verdict here and must not be folded into `satisfied`. The scan is
 * `git grep … -- src`, so an entry naming a file that exists but is untracked, or that lives
 * outside `src/`, is inert because nothing looked at it — deleting it would re-arm the very call
 * site it declares the moment the scan widens (exception-hygiene.js § UNREACHABLE).
 *
 * @param {{ exists: boolean, reachable: boolean, inheriting: boolean }} facts
 */
export function classifyEntry(facts) {
  if (!facts.exists) {
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such file under server/' };
  }
  if (!facts.reachable) {
    return { verdict: VERDICT.UNREACHABLE, detail: 'outside the git-tracked src/ scan' };
  }
  if (!facts.inheriting) {
    return { verdict: VERDICT.SATISFIED, detail: 'every call site in it now supplies dbPath' };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

function run() {
  const violations = [...orderViolations(readFileSync(INITIALIZER, 'utf8'))];

  const declared = new Map(ACCEPTED_INHERITORS.map((e) => [e.file, e]));
  const seenInheriting = new Set();

  for (const rel of filesWithCallSites()) {
    const sites = callSites(readFileSync(path.join(SERVER, rel), 'utf8'));
    const inheriting = sites.filter((s) => !s.suppliesDbPath);
    if (inheriting.length === 0) continue;
    seenInheriting.add(rel);
    if (!declared.has(rel)) {
      violations.push(
        `${rel}: ${inheriting.length} getInstance call(s) with no dbPath and no declared ` +
          'inheritor entry. A site that omits dbPath relocates state.db if it ever runs first — ' +
          'either pass the resolved path, or declare it in ACCEPTED_INHERITORS with a closedBy.'
      );
    }
  }

  // Exception hygiene — the shared definition, not a private idea of "still true". This replaces
  // the hand-rolled satisfied-only loop: `closedBy` was being declared (the form half) with
  // nothing auditing it (the truth half), which is what claude/require-exception-audit flags.
  const tracked = trackedSourceFiles();
  const audit = auditExceptions({
    gate: 'db-claim-order',
    entries: ACCEPTED_INHERITORS,
    describe: (entry) => entry.file,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) =>
      classifyEntry({
        exists: existsSync(path.join(SERVER, entry.file)),
        reachable: tracked.has(entry.file),
        inheriting: seenInheriting.has(entry.file),
      }),
  });

  if (violations.length > 0) {
    console.error(`✖ state.db claim-order validation failed (${violations.length}):`);
    for (const v of violations) console.error(`  - ${v}`);
  }

  // Report both sections before deciding — a run that aborts at the first failure hides the rest.
  const exceptionProblems = reportExceptionAudit('db-claim-order', audit);
  if (violations.length > 0 || exceptionProblems > 0) return 1;

  console.log(
    `✔ state.db claim order: ${CLAIM_FN}() precedes all inheriting call sites; ` +
      `${ACCEPTED_INHERITORS.length} declared inheritor(s), all still inheriting.`
  );
  return 0;
}

/** Each case must FAIL; a rule that cannot fail is not enforcing anything. */
function selfTest() {
  const cases = [
    {
      name: 'a missing claimStateDatabase() call is rejected',
      source: `async function initializeModules() {\n  const db = await ${CALL}serverRoot, logger);\n}\n`,
      rule: orderViolations,
    },
    {
      name: 'an inheriting call BEFORE the claim is rejected',
      source: `async function initializeModules() {\n  const early = await ${CALL}serverRoot, logger);\n  await ${CLAIM_FN}(p, s, l);\n}\n`,
      rule: orderViolations,
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const found = c.rule(c.source);
    if (found.length === 0) {
      console.error(`✖ self-test: "${c.name}" produced no violation — the rule is not enforced.`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${c.name}`);
    }
  }

  // The correct ordering must PASS, or the cases above only prove nothing ever validates.
  const good = `async function initializeModules() {\n  await ${CLAIM_FN}(p, s, l);\n  const db = await ${CALL}serverRoot, logger);\n}\n`;
  if (orderViolations(good).length > 0) {
    console.error('✖ self-test: correct ordering was rejected');
    failures += 1;
  } else {
    console.log('✔ self-test: correct ordering is accepted');
  }

  // dbPath detection must distinguish the two call shapes, or rule 2 is noise.
  const withPath = callSites(`await ${CALL}root, logger, { dbPath: p });`);
  const withoutPath = callSites(`await ${CALL}root, logger);`);
  if (!withPath[0]?.suppliesDbPath || withoutPath[0]?.suppliesDbPath) {
    console.error('✖ self-test: dbPath detection does not distinguish the two call shapes');
    failures += 1;
  } else {
    console.log('✔ self-test: dbPath detection distinguishes supplied from inherited');
  }

  // Exception hygiene must separate the four non-passing verdicts, or the audit is one bit.
  const verdicts = [
    [
      'a live inheritor is load-bearing',
      { exists: true, reachable: true, inheriting: true },
      VERDICT.LOAD_BEARING,
    ],
    [
      'an entry whose file stopped inheriting is satisfied',
      { exists: true, reachable: true, inheriting: false },
      VERDICT.SATISFIED,
    ],
    [
      'an entry naming a missing file is subject-missing',
      { exists: false, reachable: false, inheriting: false },
      VERDICT.SUBJECT_MISSING,
    ],
    [
      'an entry outside the scan is unreachable, NOT satisfied',
      { exists: true, reachable: false, inheriting: false },
      VERDICT.UNREACHABLE,
    ],
  ];
  for (const [name, facts, expected] of verdicts) {
    const actual = classifyEntry(facts).verdict;
    if (actual !== expected) {
      console.error(`✖ self-test: "${name}" — expected ${expected}, got ${actual}`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${name}`);
    }
  }

  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
