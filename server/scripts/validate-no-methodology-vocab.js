#!/usr/bin/env node

/**
 * Guards the methodology -> framework vocabulary rename against recurrence.
 *
 * Allowlist, not zero-tolerance. The rename left deliberate survivors: back-compat folds that
 * must keep naming the old spelling, the archived plan and changelog, and the historical record
 * of past renames. A zero check would have to be disabled on day one, and a disabled check is
 * worse than none.
 *
 * Every allowlist entry carries a RETIREMENT CONDITION. An entry whose condition has come true is
 * a deletion waiting to happen, not a permanent exemption.
 *
 * Exit 0 when every hit is allowlisted; exit 1 with the offending lines otherwise.
 *
 * MECHANISM: script — reach — ripgreps every git-tracked file including `.md`, `.json` and `.yaml` under `resources/`, which no linter parses
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

/**
 * Paths excluded wholesale, with why. Tested against repo-relative paths.
 *
 * These are regexes rather than globs because the scan passes explicit file paths to ripgrep, and
 * `--glob` does NOT filter paths given as arguments — only paths rg discovers by walking. Measured
 * 2026-08-11: `rg --glob '!CLAUDE.md' methodolog CLAUDE.md` still reports its 3 hits. Keeping the
 * globs would have looked like an exclusion list while excluding nothing.
 */
const EXCLUDED_PATHS = [
  // Archived record of the sweep itself; rewriting it would falsify the history it exists to keep.
  { pattern: /(^|\/)plans\//, reason: 'archived plan files' },
  { pattern: /^CHANGELOG\.md$/, reason: 'historical release record' },
  { pattern: /^cli\/dist\//, reason: 'build artifact, regenerated' },
  { pattern: /^server\/dist\//, reason: 'build artifact, regenerated' },
  { pattern: /(^|\/)node_modules\//, reason: 'third-party' },
];

/**
 * Retirement conditions, named so entries that retire TOGETHER share one.
 *
 * Row 4.2: these were prose comments above blocks of entries. That kept the reasoning readable
 * and made it uncheckable — `auditExceptions` was called without a `closedBy` accessor here, and
 * only here, so this was the one gate whose exemptions could never be asserted to have an exit.
 * A shared constant says "these 18 retire as a unit" in a form the gate can read, which grouped
 * prose only ever said to a human who happened to scroll to the right comment.
 */
const RETIREMENT = {
  // RENAME_MAJOR was RETIRED 2026-08-11 (plan row 5.7) along with all 19 entries that named it and
  // the 3 test entries that pinned them. Its condition — "the first major release after the rename"
  // — was met by v3.0.0 (tagged 2026-07-31, one day after the rename landed), and v3.2.1 is two
  // further releases on. Every fold it covered is deleted; nothing here is waiting on it.
  //
  // Kept as a comment rather than silently dropped because this is the first retirement condition
  // in this file to actually come true, and the shape is the reusable part: a condition stated so
  // it can be CHECKED (a tag comparison) rather than felt. Conditions worded as "when we no longer
  // need it" are the ones that never retire.
  NOTE_USEFUL: 'when the note stops being useful — delete the note and this entry together',
  ASSERTS_RETIRED:
    'never while the retirement is worth pinning — these name the old spelling to prove it is inert, so deleting them would remove the proof rather than a fold',
  BAN_WANTED:
    'never, while the ban is wanted — the pre-rename path must stay named in order to stay banned',
  REMOVAL_OLD: 'when the env-var removal is old enough to stop mentioning',
  WITH_COMMENT: 'with the comment that explains the defect',
  GUARD_DELETED: 'when this guard is deleted',
};

/**
 * Allowlisted survivors. `match` is a substring tested against the matching LINE, scoped to
 * `file` (a substring of the repo-relative path).
 *
 * RETIREMENT: every entry states what makes it deletable. When that becomes true, delete the
 * fold AND this entry in the same commit.
 */
const ALLOWLIST = [
  // --- The back-compat fold block that stood here (19 entries) and the 3 test entries that pinned
  // --- it were DELETED 2026-08-11 with the folds themselves — plan row 5.7. See the RENAME_MAJOR
  // --- note above for why the condition was considered met.
  // ---
  // --- What remains below are the survivors that never shared that condition. Do not re-add a
  // --- fold entry here without a fold to go with it: this file's whole premise is that an
  // --- exemption outlives what it exempted unless the two are deleted in one commit.

  // --- Tests asserting the retired folds are INERT. These name the old spelling in order to prove
  // --- it no longer does anything, which is the opposite of pinning a fold — deleting them would
  // --- remove the only evidence that the retirement took effect.
  {
    file: 'tests/unit/infra/config/legacy-key-migration.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.ASSERTS_RETIRED,
  },
  {
    file: 'tests/unit/gates/pass-criteria-framework-vocab.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.ASSERTS_RETIRED,
  },
  {
    file: 'tests/unit/frameworks/framework-gates-field.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.ASSERTS_RETIRED,
  },
  {
    file: 'tests/unit/frameworks/template-variable-substitution.test.ts',
    match: 'METHODOLOGY',
    closedBy: RETIREMENT.ASSERTS_RETIRED,
  },
  {
    file: 'tests/unit/mcp-tools/system-control/framework-action-handler.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.ASSERTS_RETIRED,
  },
  {
    file: 'tests/unit/versioning/version-history-service.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.ASSERTS_RETIRED,
  },

  // --- Prose recording what a rewritten test used to assert, so the next reader does not
  // --- "restore" it. Each is a comment, not an assertion — verify by re-reading the line.
  // --- RETIREMENT: when the note stops being useful, delete note and entry together.
  {
    file: 'tests/integration/database/resource-change-tracker-baseline.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.NOTE_USEFUL,
  },
  {
    file: 'tests/integration/framework/framework-creation.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.NOTE_USEFUL,
  },
  {
    file: 'tests/integration/resources/resource-registration.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.NOTE_USEFUL,
  },

  // --- Prose explaining what was renamed and why.
  // ---
  // --- Its condition was `FOLD_DOCUMENTED` ("when the fold this prose documents goes"), which was
  // --- wrong: re-read at 5.7, the comment records a dropped `keyword_count` ENTRY, not a fold. The
  // --- folds are now gone and this note is unaffected, which is exactly how a mis-stated condition
  // --- surfaces — it came due for a reason that had nothing to do with it.
  {
    file: 'resources/gates/framework-compliance/gate.yaml',
    match: 'methodology',
    closedBy: RETIREMENT.NOTE_USEFUL,
  },
  //
  // Two entries removed here 2026-08-06 (row 0.7), for DIFFERENT reasons — worth distinguishing:
  //
  //   { file: 'docs/', match: 'methodolog' }      — genuinely dead. `docs/` is scanned and now
  //                                                 contains zero hits; the prose it exempted is gone.
  //   { file: 'CLAUDE.md', match: 'methodolog' }  — inert, but NOT because the file is clean. It
  //                                                 held 3 hits the scan could not see: `.gitignore`
  //                                                 lists CLAUDE.md, and ripgrep honoured that. The
  //                                                 entry suppressed nothing only because nothing
  //                                                 reached it.
  //
  // RESOLVED 2026-08-11 (row 0.8). The scan now covers the git-tracked set, so all 57 formerly
  // unreachable files are searched. The 11 occupants turned out to be stale documentation, not
  // exemptions: every one was corrected rather than allowlisted, so no CLAUDE.md entry was
  // restored. `unreachable` remains a live verdict and now means "tracked but deliberately
  // excluded" — i.e. `plans/**` and CHANGELOG.md, the only paths still outside the set.

  // --- Banned-path regexes that keep the pre-rename directory name unusable. RETIREMENT: never
  // --- while the ban is wanted; the old path must stay named to stay banned.
  { file: 'eslint.config.js', match: 'methodology', closedBy: RETIREMENT.BAN_WANTED },

  // --- Names a removed env var so a user who copied it from an older revision can tell what
  // --- happened (Tier 6 policy). RETIREMENT: when the removal is old enough to stop mentioning.
  { file: 'server/README.md', match: 'MCP_METHODOLOGIES_PATH', closedBy: RETIREMENT.REMOVAL_OLD },

  // --- Explains a defect whose cause was the pre-rename key. RETIREMENT: with the comment.
  {
    file: 'system-control-router.ts',
    match: 'enableMethodologyGates',
    closedBy: RETIREMENT.WITH_COMMENT,
  },

  // --- This guard names the vocabulary it forbids, and package.json names the guard.
  // --- RETIREMENT: when the guard itself is deleted.
  {
    file: 'validate-no-methodology-vocab.js',
    match: 'methodolog',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
  // These three went RED at HEAD without anyone noticing, and the cause is worth naming: row 0.8
  // widened the scan from "what ripgrep walks" to "the git-tracked set", and the gate promptly
  // began seeing its OWN test file and type declarations — which name the vocabulary for the same
  // reason the guard itself does. Widening a gate's reach re-scopes what counts as a violation;
  // the new hits were not new code. RETIREMENT: identical to the guard's own entry above.
  {
    file: 'tests/unit/scripts/methodology-vocab-scope.test.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
  // Fourth instance of the same re-scoping, 2026-08-12 (plan row E6). `scripts/lib/tracked-scope.js`
  // was extracted so three other gates could adopt THIS gate's `git ls-files` mechanism, and it
  // cites this file by name as the precedent it implements. It went red the moment it was
  // committed — not when it was written — because the scan is index-scoped, which is the property
  // E6 deliberately introduced. A gate that reads the index re-scopes at `git add`, so "passes
  // locally" and "passes once staged" are different claims.
  {
    file: 'scripts/lib/tracked-scope.js',
    match: 'methodolog',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
  {
    file: 'validate-no-methodology-vocab.d.ts',
    match: 'methodolog',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
  {
    file: 'validate-suite-membership.js',
    match: 'validate-no-methodology-vocab.js',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
  // The second package.json entry (`match: 'validate-no-methodology-vocab.js'`) was removed
  // 2026-08-06 (row 0.7): the one line it covered is the same line the entry above already covers,
  // since a script value contains both the npm name and the filename. Redundant rather than stale —
  // it suppressed a real hit, just never one that needed it.
  {
    file: 'package.json',
    match: 'validate:no-methodology-vocab',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
  // Same cause as the package.json entry above, and added 2026-08-06 for the same reason: the
  // suite declaration has to name every step it runs, and one of the steps is this guard. It
  // moved out of `validate:all`'s `&&` string into `run-validation-suite.js` (row 3.1), so the
  // hit moved with it. RETIREMENT: when the guard itself is deleted — identical to the entry
  // above, and both retire in the same commit.
  {
    file: 'run-validation-suite.js',
    match: 'validate:no-methodology-vocab',
    closedBy: RETIREMENT.GUARD_DELETED,
  },
];

// `fileURLToPath` rather than `new URL(...).pathname`: the latter leaves percent-encoding in place,
// so a checkout under a path containing a space resolves to a directory that does not exist.
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '../..');

/**
 * The files this gate is allowed to search: every git-tracked path that is not excluded above.
 *
 * Pure, so the scope rules are testable without a repository. Exported for that reason only.
 *
 * SUPERSEDES the previous `rg`-walks-the-filesystem scope, which had the right intent and the
 * wrong mechanism. The intent was "shipped content", approximated by letting ripgrep honour
 * `.gitignore`. That approximation was wrong in both directions, measured 2026-08-11:
 *
 *   - It MISSED 57 tracked files. ripgrep skips dot-paths unless `--hidden`, so `.github/`,
 *     `.claude/` and `.husky/` were invisible; and `.gitignore` lists `CLAUDE.md`, which is
 *     nonetheless tracked, so the project's own handbook was invisible too. Four of those files
 *     held 11 live occurrences of the forbidden vocabulary while the gate reported success.
 *   - It ADDED 18 untracked files. That is how a `.ignore` file added on 2026-08-09 — for
 *     interactive `rg`/`fd` visibility into operator-local prompts — silently widened this gate
 *     and turned it red on files that ship to nobody.
 *
 * `git ls-files` IS the definition the approximation was reaching for, so both failures close at
 * once and neither can recur: an untracked file cannot enter the set, and no ignore rule can
 * remove a tracked one. `--hidden` would have fixed only the first, and would have dragged in
 * 5,405 files under `.git/`.
 *
 * The set is the index, not HEAD, so a newly `git add`ed file is in scope — which is what the
 * pre-commit hook needs, since it runs after staging.
 */
export function inScopeFiles(tracked) {
  return tracked.filter((file) => !EXCLUDED_PATHS.some(({ pattern }) => pattern.test(file)));
}

function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/**
 * Exactly the files this scan visits — the same array the search itself is given, so the two sets
 * cannot disagree. Compared against `git ls-files`, it separates "the file is clean" from "the
 * scan never reached the file".
 *
 * A tracked path deleted in the working tree is dropped: it has no content to search, and passing
 * it would make ripgrep exit 2 for a condition that is not a finding.
 */
function scannedFiles(tracked) {
  return inScopeFiles(tracked).filter((file) => existsSync(path.join(REPO_ROOT, file)));
}

/**
 * `spawnSync` with an argument array rather than a shell string: ~1,070 paths are passed
 * explicitly, which no quoting scheme survives intact, and bypassing the shell means the OS
 * argument limit (~2 MB) applies instead of the shell's, against ~50 KB of paths.
 */
function collectHits(files) {
  const result = spawnSync('rg', ['-n', '-i', '-H', '--no-heading', 'methodolog', ...files], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  // rg exits 1 when nothing matched, which is a clean pass.
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new Error(`ripgrep failed (exit ${result.status}): ${result.stderr ?? result.error}`);
  }
  return result.stdout.split('\n').filter((line) => line.trim() !== '');
}

function hitFile(hitLine) {
  return hitLine.slice(0, hitLine.indexOf(':'));
}

function hitText(hitLine) {
  const firstColon = hitLine.indexOf(':');
  return hitLine.slice(hitLine.indexOf(':', firstColon + 1) + 1);
}

function entryMatches(entry, hitLine) {
  return (
    hitFile(hitLine).includes(entry.file) &&
    hitText(hitLine).toLowerCase().includes(entry.match.toLowerCase())
  );
}

function isAllowlisted(hitLine) {
  return ALLOWLIST.some((entry) => entryMatches(entry, hitLine));
}

/**
 * Classifies one allowlist entry against the run's own hits.
 *
 * The order matters. An entry that matches nothing is NOT automatically stale: it is stale only if
 * the file it names was actually looked at. Deleting an entry that is merely unreached re-arms the
 * finding the moment the scan widens — which is exactly what row 0.8 caught happening to
 * `CLAUDE.md`, and why `unreachable` tells the reader NOT to delete.
 *
 * Since 0.8 the scan covers every tracked file, so `unreachable` no longer reports an accident. It
 * reports an entry naming one of the deliberate exclusions (`plans/**`, CHANGELOG.md) — still a
 * real finding, because such an entry can never suppress anything.
 */
function classifyEntry(entry, hits, scanned, tracked) {
  const matched = hits.filter((hit) => entryMatches(entry, hit));

  if (matched.length > 0) {
    const others = ALLOWLIST.filter((candidate) => candidate !== entry);
    const covered = matched.every((hit) => others.some((other) => entryMatches(other, hit)));
    return covered
      ? {
          verdict: VERDICT.REDUNDANT,
          detail: `all ${matched.length} hit(s) also matched elsewhere`,
        }
      : { verdict: VERDICT.LOAD_BEARING };
  }

  if (scanned.some((file) => file.includes(entry.file))) {
    return {
      verdict: VERDICT.SATISFIED,
      detail: `no line in ${entry.file} matches '${entry.match}'`,
    };
  }
  if (tracked.some((file) => file.includes(entry.file))) {
    return {
      verdict: VERDICT.UNREACHABLE,
      detail: `${entry.file} is tracked but outside the scan`,
    };
  }
  return { verdict: VERDICT.SUBJECT_MISSING, detail: `no file matches '${entry.file}'` };
}

function main() {
  const tracked = trackedFiles();
  const scanned = scannedFiles(tracked);
  const hits = collectHits(scanned);
  const violations = hits.filter((line) => !isAllowlisted(line));

  if (violations.length > 0) {
    console.error(`Found ${violations.length} non-allowlisted 'methodology' vocabulary hit(s).`);
    console.error(
      'The vocabulary is `framework`. If a hit is a deliberate back-compat fold, add it'
    );
    console.error('to ALLOWLIST in scripts/validate-no-methodology-vocab.js WITH a retirement');
    console.error('condition — an exemption without one is how the vocabulary came back.\n');
    for (const line of violations.slice(0, 40)) console.error(`  ${line}`);
    if (violations.length > 40) console.error(`  ... and ${violations.length - 40} more`);
    process.exit(1);
  }

  // The allowlist is audited on every run, not on request. An entry that stopped suppressing
  // anything is a finding of the same weight as an unsuppressed hit: both mean this file has
  // stopped describing the repository.
  const audit = auditExceptions({
    gate: 'no-methodology-vocab',
    entries: ALLOWLIST,
    describe: (entry) => `${entry.file} :: ${entry.match}`,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) => classifyEntry(entry, hits, scanned, tracked),
  });

  if (reportExceptionAudit('no-methodology-vocab', audit) > 0) process.exit(1);

  console.log(
    `No non-allowlisted methodology vocabulary found (${scanned.length} tracked files scanned).`
  );
}

// Importable for tests without running the scan; `inScopeFiles` is the part worth testing.
if (process.argv[1] === SCRIPT_PATH) main();
