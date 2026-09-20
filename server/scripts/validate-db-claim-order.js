#!/usr/bin/env node

/**
 * Guards the invariant that keeps runtime state where the PathResolver put it.
 *
 * WHY THIS EXISTS
 * Runtime state — `state.db`, `verify-state.db` — belongs under the runtime root
 * (`MCP_RUNTIME_ROOT`, else the workspace), which `PathResolver.getRuntimeStatePath()` resolves.
 * It was placed from the PACKAGE directory instead, in two shapes, until B.62 (2026-09-16):
 *
 *   - `SqliteEngine.getInstance` took an optional `dbPath` and fell back to
 *     `path.join(serverRoot, 'runtime-state', 'state.db')`. Six call sites relied on the
 *     composition root having opened the singleton first with the right path, so the database's
 *     location was decided by CALL ORDER. Four passed no `dbPath`; two passed one that could be
 *     `undefined`.
 *   - `pipeline-builder.ts` placed `verify-state.db` at `path.join(deps.serverRoot,
 *     'runtime-state')` — live, ignoring `MCP_RUNTIME_ROOT`, and under the Claude Code plugin in
 *     the install directory every update replaces.
 *
 * The package directory is read-only under a sandboxed MCP child and invisible to the workspace.
 *
 * WHAT IT CHECKS
 *   1. `claimStateDatabase(...)` is called in module-initializer.ts, and no `getInstance` call that
 *      omits `dbPath` precedes it. The composition root opens the database first; the rest of
 *      startup was written against that order.
 *   2. Every `getInstance` call site under `src/` names `dbPath`. No exceptions: the signature
 *      requires it, so a site without one is a cast around the type, not a design. (Before B.62
 *      this rule carried an `ACCEPTED_INHERITORS` list; B.62 satisfied all of it.)
 *   3. **No runtime state path segment — `runtime-state` or `state.db` — is composed outside the
 *      two declared owners, `runtime/paths.ts` and `shared/utils/runtime-state-location.ts`.** A
 *      string literal naming one — `'runtime-state'`, `"…/state.db"`, a template ending
 *      `/runtime-state` — is how both defects above were spelled, and it is spelled that way
 *      whatever variable it is joined to, so the rule keys on the SEGMENT, not on the name
 *      `serverRoot`. `state.db` is in the list because a second hand-join of the file name onto a
 *      correctly resolved directory is still a second derivation of one path, and B.62 briefly had
 *      one. A module that needs the directory asks `PathResolver.getRuntimeStatePath()` (in
 *      `runtime/`) or `ConfigManager.getRuntimeStateDirectory()`; one that needs the database asks
 *      `getStateDatabasePath()` on either. The second owner exists because the standalone CLI
 *      (`cli-shared/version-history.ts`) needs the same two segment NAMES and cannot import
 *      `runtime/paths.ts` (`cli-shared-no-runtime` in `.dependency-cruiser.cjs`) — it imports the
 *      two exported constants instead of retyping the literals, which is what made B.70's fix
 *      (resolving via `MCP_RUNTIME_ROOT`/`MCP_WORKSPACE` instead of disk discovery) satisfy this
 *      rule without a declared-reader exception. `'verify-state.db'` is a different file and does
 *      not match: the segment must start at a quote, backtick or `/`. A file that only DISCOVERS
 *      an existing runtime-state directory without importing these constants, rather than owning
 *      or being handed the segment names, is declared in `RUNTIME_STATE_READERS`, audited by the
 *      shared `lib/exception-hygiene.js` harness — an entry whose file stopped naming the segment
 *      is `satisfied` and must be deleted; one the `git grep … -- src` scan cannot reach is
 *      `unreachable` and must NOT be deleted until the scan is widened.
 *
 * WHAT IT DOES NOT CLAIM
 * Comment lines are skipped, so a path composed on a line that starts with `*` or `//` is not seen.
 * The scan reads git-tracked `src/**` only; `scripts/`, `tests/` and the Python hooks are outside
 * it (the hooks resolve the same directory in `hooks/lib/workspace.py`).
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
/** Path segments only a declared owner may compose. `.` is escaped where the pattern is built. */
const SEGMENTS = ['runtime-state', 'state.db'];
const SEGMENT_LABEL = SEGMENTS.join(' / ');
/** The module that composes the runtime state directory against the resolved runtime root. */
const RUNTIME_STATE_OWNER = 'src/runtime/paths.ts';
/**
 * The module that names the same two segments as exported constants, so a consumer that cannot
 * import `runtime/paths.ts` — the standalone CLI, via `cli-shared/version-history.ts` — imports
 * the names instead of retyping the literals. Declared as a second owner, not a reader: this file
 * PLACES the segment names (it is where they are defined), it does not merely discover them.
 */
const RUNTIME_STATE_SHARED_NAMES = 'src/shared/utils/runtime-state-location.ts';
const RUNTIME_STATE_OWNERS = new Set([RUNTIME_STATE_OWNER, RUNTIME_STATE_SHARED_NAMES]);

/**
 * Files that name a runtime state segment to FIND an existing path, never to place one.
 *
 * `closedBy` names what would let the entry be deleted rather than leaving it as a permanent
 * bypass wearing a temporary label.
 */
const RUNTIME_STATE_READERS = [];

/** Whether the text before `at` on its line makes the occurrence a comment. */
function onCommentLine(source, at) {
  const lineStart = source.lastIndexOf('\n', at) + 1;
  return /^\s*(\*|\/\/|\/\*)/.test(source.slice(lineStart, at));
}

const lineOf = (source, at) => source.slice(0, at).split('\n').length;

/** Every `SqliteEngine.getInstance(` call in `source`, with its line and whether it names dbPath. */
export function callSites(source) {
  const sites = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(CALL, from);
    if (at === -1) break;
    from = at + CALL.length;

    // Skip doc-comment occurrences — they are illustrations, not call sites.
    if (onCommentLine(source, at)) continue;

    // Walk to the matching close paren so `dbPath` is searched in THIS call, not the next one.
    let depth = 1;
    let i = from;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    sites.push({
      line: lineOf(source, at),
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
        'opens the SqliteEngine singleton ahead of its consumers',
    ];
  }
  const claimLine = lineOf(source, claimAt);

  return callSites(source)
    .filter((s) => !s.suppliesDbPath && s.line < claimLine)
    .map(
      (s) =>
        `module-initializer.ts:${s.line}: SqliteEngine.getInstance() with no dbPath runs BEFORE ` +
        `${CLAIM_FN}() at line ${claimLine}`
    );
}

/**
 * Rule 3's predicate: lines in `source` whose code names a runtime state path segment.
 *
 * A segment is one of `SEGMENTS` bounded on the left by a quote or `/`, and on the right by a
 * quote, backtick, `/` or end of line. Prose such as `root for runtime-state/ and logs/` or
 * `state.db at ${path}` does not match — a space is not a path boundary — and neither does
 * `'verify-state.db'`, whose `state.db` follows a `-`. A backtick is NOT a left boundary: inside a
 * description string it opens a markdown code span (the generated `resource_manager` schema says
 * "`state.db` is one file shared by every project"), and a template literal composes a path with a
 * `/` before the segment, which is matched. Unclaimed: a template literal holding ONLY the segment,
 * passed to a join — `` path.join(dir, `state.db`) `` — is not seen.
 */
export function runtimeStateSegmentLines(source) {
  const lines = [];
  const alternatives = SEGMENTS.map((segment) => segment.replaceAll('.', '\\.')).join('|');
  const pattern = new RegExp(`['"/](?:${alternatives})(?=['"\`/]|$)`, 'gm');
  for (const match of source.matchAll(pattern)) {
    if (onCommentLine(source, match.index)) continue;
    const line = lineOf(source, match.index);
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}

/** Git-tracked `.ts` files under `src/` containing `needle` (fast, respects tracked files). */
function trackedFilesContaining(needle) {
  let out;
  try {
    out = execFileSync('git', ['grep', '-l', '--fixed-strings', needle, '--', 'src'], {
      cwd: SERVER,
      encoding: 'utf8',
    });
  } catch (error) {
    // `git grep` exits 1 for "no match", which is a real answer here, not a failure.
    if (error.status === 1) return [];
    throw error;
  }
  return out.split('\n').filter((f) => f.endsWith('.ts'));
}

/** Exactly the reach of `trackedFilesContaining()`: git-tracked files under `src/`. */
function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '--', 'src'], { cwd: SERVER, encoding: 'utf8' });
  return new Set(out.split('\n').filter(Boolean));
}

/**
 * Classifies one declared runtime-state reader against the question rule 3 asks: does the file it
 * names STILL name the segment?
 *
 * `unreachable` is a distinct verdict here and must not be folded into `satisfied`. The scan is
 * `git grep … -- src`, so an entry naming a file that exists but is untracked, or that lives
 * outside `src/`, is inert because nothing looked at it — deleting it would re-arm the very site
 * it declares the moment the scan widens (exception-hygiene.js § UNREACHABLE).
 *
 * @param {{ exists: boolean, reachable: boolean, namesSegment: boolean }} facts
 */
export function classifyEntry(facts) {
  if (!facts.exists) {
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such file under server/' };
  }
  if (!facts.reachable) {
    return { verdict: VERDICT.UNREACHABLE, detail: 'outside the git-tracked src/ scan' };
  }
  if (!facts.namesSegment) {
    return {
      verdict: VERDICT.SATISFIED,
      detail: `no code line in it names ${SEGMENT_LABEL} any more`,
    };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

function run() {
  const violations = [...orderViolations(readFileSync(INITIALIZER, 'utf8'))];

  // Rule 2.
  for (const rel of trackedFilesContaining(CALL)) {
    const sites = callSites(readFileSync(path.join(SERVER, rel), 'utf8'));
    for (const site of sites.filter((s) => !s.suppliesDbPath)) {
      violations.push(
        `${rel}:${site.line}: SqliteEngine.getInstance() names no dbPath. The signature requires ` +
          'one — resolve it through PathResolver.getStateDatabasePath() rather than casting.'
      );
    }
  }

  // Rule 3.
  const declared = new Set(RUNTIME_STATE_READERS.map((e) => e.file));
  const seenNaming = new Set();
  for (const rel of new Set(SEGMENTS.flatMap((segment) => trackedFilesContaining(segment)))) {
    const lines = runtimeStateSegmentLines(readFileSync(path.join(SERVER, rel), 'utf8'));
    if (lines.length === 0) continue;
    seenNaming.add(rel);
    if (RUNTIME_STATE_OWNERS.has(rel) || declared.has(rel)) continue;
    for (const line of lines) {
      violations.push(
        `${rel}:${line}: composes a ${SEGMENT_LABEL} path outside ` +
          `${[...RUNTIME_STATE_OWNERS].join(' or ')}. Runtime state belongs under the runtime ` +
          'root, named once — ask getRuntimeStatePath() / getStateDatabasePath() (PathResolver ' +
          'in runtime/) or getRuntimeStateDirectory() / getStateDatabasePath() (ConfigManager); ' +
          'never join it yourself. A consumer that cannot import runtime/paths.ts imports the ' +
          `segment names from ${RUNTIME_STATE_SHARED_NAMES} instead.`
      );
    }
  }

  const tracked = trackedSourceFiles();
  const audit = auditExceptions({
    gate: 'db-claim-order',
    entries: RUNTIME_STATE_READERS,
    describe: (entry) => entry.file,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) =>
      classifyEntry({
        exists: existsSync(path.join(SERVER, entry.file)),
        reachable: tracked.has(entry.file),
        namesSegment: seenNaming.has(entry.file),
      }),
  });

  if (violations.length > 0) {
    console.error(`✖ runtime state placement validation failed (${violations.length}):`);
    for (const v of violations) console.error(`  - ${v}`);
  }

  // Report both sections before deciding — a run that aborts at the first failure hides the rest.
  const exceptionProblems = reportExceptionAudit('db-claim-order', audit);
  if (violations.length > 0 || exceptionProblems > 0) return 1;

  console.log(
    `✔ runtime state placement: ${CLAIM_FN}() opens state.db first, every getInstance names ` +
      `dbPath, and ${SEGMENT_LABEL} is composed only in ${[...RUNTIME_STATE_OWNERS].join(' or ')} ` +
      `(${RUNTIME_STATE_READERS.length} declared reader(s)).`
  );
  return 0;
}

/** Each case must FAIL; a rule that cannot fail is not enforcing anything. */
function selfTest() {
  const cases = [
    {
      name: 'a missing claimStateDatabase() call is rejected',
      source: `async function initializeModules() {\n  const db = await ${CALL}logger, { dbPath });\n}\n`,
      rule: orderViolations,
    },
    {
      name: 'a call naming no dbPath BEFORE the claim is rejected',
      source: `async function initializeModules() {\n  const early = await ${CALL}logger);\n  await ${CLAIM_FN}(p, l);\n}\n`,
      rule: orderViolations,
    },
    {
      name: "the live B.62 defect — path.join(deps.serverRoot, 'runtime-state') — is rejected",
      source: `const store = create(logger, {\n  runtimeStateDir: path.join(deps.serverRoot, 'runtime-state'),\n});\n`,
      rule: runtimeStateSegmentLines,
    },
    {
      name: "the latent B.62 defect — 'runtime-state', 'state.db' — is rejected",
      source: `this.dbPath = config.dbPath ?? path.join(serverRoot, 'runtime-state', 'state.db');\n`,
      rule: runtimeStateSegmentLines,
    },
    {
      name: "a hand-joined 'state.db' onto a resolved directory is rejected",
      source: `const p = path.join(config.getRuntimeStateDirectory(), "state.db");\n`,
      rule: runtimeStateSegmentLines,
    },
    {
      name: 'a template-literal composition is rejected',
      source: 'const dir = `${root}/runtime-state`;\nconst db = `${dir}/state.db`;\n',
      rule: runtimeStateSegmentLines,
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

  // The correct shapes must PASS, or the cases above only prove nothing ever validates.
  const accepted = [
    [
      'correct ordering',
      orderViolations(
        `async function initializeModules() {\n  await ${CLAIM_FN}(p, l);\n  const db = await ${CALL}logger);\n}\n`
      ),
    ],
    [
      'the segment inside comments and prose',
      runtimeStateSegmentLines(
        ` * runtimeStateDir: path.join(serverRoot, 'runtime-state')\n` +
          `  // was path.join(serverRoot, 'runtime-state', 'state.db')\n` +
          `  const help = 'Writable root for runtime-state/ and relative logs/';\n` +
          `  const err = \`state.db at \${dbPath} is locked\`;\n` +
          `  const verify = path.join(dir, 'verify-state.db');\n` +
          "  const doc = '`state.db` is one file shared by every project';\n" +
          `  const ok = config.getStateDatabasePath();\n`
      ),
    ],
  ];
  for (const [name, found] of accepted) {
    if (found.length > 0) {
      console.error(`✖ self-test: ${name} was rejected`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${name} is accepted`);
    }
  }

  // dbPath detection must distinguish the two call shapes, or rule 2 is noise.
  const withPath = callSites(`await ${CALL}logger, { dbPath: p });`);
  const withoutPath = callSites(`await ${CALL}logger, config);`);
  if (!withPath[0]?.suppliesDbPath || withoutPath[0]?.suppliesDbPath) {
    console.error('✖ self-test: dbPath detection does not distinguish the two call shapes');
    failures += 1;
  } else {
    console.log('✔ self-test: dbPath detection distinguishes supplied from absent');
  }

  // Exception hygiene must separate the four non-passing verdicts, or the audit is one bit.
  const verdicts = [
    [
      'a live reader is load-bearing',
      { exists: true, reachable: true, namesSegment: true },
      VERDICT.LOAD_BEARING,
    ],
    [
      'an entry whose file stopped naming the segment is satisfied',
      { exists: true, reachable: true, namesSegment: false },
      VERDICT.SATISFIED,
    ],
    [
      'an entry naming a missing file is subject-missing',
      { exists: false, reachable: false, namesSegment: false },
      VERDICT.SUBJECT_MISSING,
    ],
    [
      'an entry outside the scan is unreachable, NOT satisfied',
      { exists: true, reachable: false, namesSegment: false },
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
