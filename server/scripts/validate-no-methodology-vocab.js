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
 * MECHANISM: script — reach — ripgreps the whole repo including `.md`, `.json` and `.yaml` under `resources/`, which no linter parses
 */

import { execSync } from 'node:child_process';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

/** Paths excluded wholesale, with why. */
const EXCLUDED_PATHS = [
  // Archived record of the sweep itself; rewriting it would falsify the history it exists to keep.
  { glob: '**/plans/**', reason: 'archived plan files' },
  { glob: 'CHANGELOG.md', reason: 'historical release record' },
  { glob: 'cli/dist/**', reason: 'build artifact, regenerated' },
  { glob: 'server/dist/**', reason: 'build artifact, regenerated' },
  { glob: '**/node_modules/**', reason: 'third-party' },
];

/**
 * Allowlisted survivors. `match` is a substring tested against the matching LINE, scoped to
 * `file` (a substring of the repo-relative path).
 *
 * RETIREMENT: every entry states what makes it deletable. When that becomes true, delete the
 * fold AND this entry in the same commit.
 */
const ALLOWLIST = [
  // --- Back-compat folds. All retire together once no supported release's resources use the
  // --- pre-rename spellings. v2.1.0 shipped 7 framework files containing `methodologyGates`, so
  // --- a user who copied one into their workspace still depends on these. RETIREMENT: the first
  // --- major release after the rename ships, i.e. when v2.1.0 workspaces are no longer supported.
  { file: 'framework-schema.ts', match: 'methodologyGates' },
  { file: 'gate-schema.ts', match: 'methodology' },
  { file: 'core-config.ts', match: 'methodologyGates' },
  { file: 'infra/config/index.ts', match: 'methodologies' },
  { file: 'infra/config/index.ts', match: 'methodologyGates' },
  { file: 'config-input-validator.ts', match: 'gates.methodologyGates' },
  { file: 'config-utils.ts', match: 'gates.methodologyGates' },
  { file: 'config-operations.ts', match: 'gates.methodologyGates' },
  { file: 'config.schema.json', match: 'methodologyGates' },
  { file: 'framework-authoring-keys.ts', match: 'methodology_' },
  { file: 'framework-lifecycle-processor.ts', match: 'methodology_' },
  { file: 'framework-file-writer.ts', match: 'methodology' },
  { file: 'resource-manager/core/router.ts', match: 'methodology_' },
  { file: 'resource-manager/core/types.ts', match: 'methodology_' },
  { file: 'framework-manager/core/types.ts', match: 'methodology_' },
  { file: 'template-variables.ts', match: 'METHODOLOGY' },
  { file: 'framework_builder/script.py', match: 'methodology_' },
  { file: 'resources/schemas/framework.schema.json', match: 'methodologyGates' },

  // --- Tests that pin the folds above, scoped one entry per test file so each names the fold it
  // --- actually guards.
  // ---
  // --- This was a single blanket `{ file: 'tests/', match: 'methodolog' }`. That exempted the
  // --- whole test tree, so 18 stale `methodology` assertions in tests/integration survived a
  // --- guard written to prevent exactly them — four suites were failing against production that
  // --- had correctly renamed. Its retirement condition ("same commit as the fold each one
  // --- guards") could not be checked, because the entry named no fold. An exemption you cannot
  // --- retire is the defect this file exists to catch, so it does not get to keep one.
  { file: 'tests/unit/infra/config/legacy-key-migration.test.ts', match: 'methodolog' },
  { file: 'tests/unit/gates/pass-criteria-framework-fold.test.ts', match: 'methodolog' },
  {
    file: 'tests/unit/mcp-tools/framework-manager/authoring-key-fold.test.ts',
    match: 'methodolog',
  },
  {
    file: 'tests/unit/mcp-tools/system-control/framework-action-handler.test.ts',
    match: 'methodolog',
  },
  { file: 'tests/unit/frameworks/template-variable-substitution.test.ts', match: 'methodolog' },
  { file: 'tests/unit/frameworks/framework-gates-field.test.ts', match: 'methodolog' },
  { file: 'tests/unit/versioning/version-history-service.test.ts', match: 'methodolog' },

  // --- Prose recording what a rewritten test used to assert, so the next reader does not
  // --- "restore" it. Each is a comment, not an assertion — verify by re-reading the line.
  // --- RETIREMENT: when the note stops being useful, delete note and entry together.
  {
    file: 'tests/integration/database/resource-change-tracker-baseline.test.ts',
    match: 'methodolog',
  },
  { file: 'tests/integration/framework/framework-creation.test.ts', match: 'methodolog' },
  { file: 'tests/integration/resources/resource-registration.test.ts', match: 'methodolog' },

  // --- Prose explaining what was renamed and why. RETIREMENT: when the fold it documents goes.
  { file: 'resources/gates/framework-compliance/gate.yaml', match: 'methodology' },
  //
  // Two entries removed here 2026-08-06 (row 0.7), for DIFFERENT reasons — worth distinguishing:
  //
  //   { file: 'docs/', match: 'methodolog' }      — genuinely dead. `docs/` is scanned and now
  //                                                 contains zero hits; the prose it exempted is gone.
  //   { file: 'CLAUDE.md', match: 'methodolog' }  — inert, but NOT because the file is clean. It
  //                                                 holds 3 hits this scan cannot see: `.gitignore`
  //                                                 lists CLAUDE.md, and ripgrep honours that. The
  //                                                 entry suppressed nothing only because nothing
  //                                                 reached it.
  //
  // Deleting an entry that is inert for the second reason hides a reach gap. It is recorded as plan
  // row 0.8 instead: 57 git-tracked files are invisible to this scan (dot-paths, which rg skips
  // without `--hidden`, plus gitignored-but-tracked CLAUDE.md), and 4 of them contain the
  // vocabulary. Restore a CLAUDE.md entry if 0.8 widens the scan and its hits prove legitimate.

  // --- Banned-path regexes that keep the pre-rename directory name unusable. RETIREMENT: never
  // --- while the ban is wanted; the old path must stay named to stay banned.
  { file: 'eslint.config.js', match: 'methodology' },

  // --- Names a removed env var so a user who copied it from an older revision can tell what
  // --- happened (Tier 6 policy). RETIREMENT: when the removal is old enough to stop mentioning.
  { file: 'server/README.md', match: 'MCP_METHODOLOGIES_PATH' },

  // --- Explains a defect whose cause was the pre-rename key. RETIREMENT: with the comment.
  { file: 'system-control-router.ts', match: 'enableMethodologyGates' },

  // --- This guard names the vocabulary it forbids, and package.json names the guard.
  // --- RETIREMENT: when the guard itself is deleted.
  { file: 'validate-no-methodology-vocab.js', match: 'methodolog' },
  // The second package.json entry (`match: 'validate-no-methodology-vocab.js'`) was removed
  // 2026-08-06 (row 0.7): the one line it covered is the same line the entry above already covers,
  // since a script value contains both the npm name and the filename. Redundant rather than stale —
  // it suppressed a real hit, just never one that needed it.
  { file: 'package.json', match: 'validate:no-methodology-vocab' },
  // Same cause as the package.json entry above, and added 2026-08-06 for the same reason: the
  // suite declaration has to name every step it runs, and one of the steps is this guard. It
  // moved out of `validate:all`'s `&&` string into `run-validation-suite.js` (row 3.1), so the
  // hit moved with it. RETIREMENT: when the guard itself is deleted — identical to the entry
  // above, and both retire in the same commit.
  { file: 'run-validation-suite.js', match: 'validate:no-methodology-vocab' },
];

const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const GLOB_ARGS = EXCLUDED_PATHS.map((p) => `--glob '!${p.glob}'`).join(' ');

function ripgrep(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\n')
      .filter((line) => line.trim() !== '');
  } catch (error) {
    // rg exits 1 when nothing matched, which is a clean pass.
    if (error.status === 1) return [];
    throw error;
  }
}

function collectHits() {
  return ripgrep(`rg -n -i --no-heading ${GLOB_ARGS} 'methodolog' .`);
}

/**
 * Exactly the files this scan visits. `rg --files` applies the same ignore rules and the same
 * globs as the search itself, so the two sets cannot disagree — which is the whole point. Compared
 * against `git ls-files`, it separates "the file is clean" from "the scan never reached the file".
 */
function scannedFiles() {
  return ripgrep(`rg --files ${GLOB_ARGS} .`);
}

function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 })
    .split('\n')
    .filter((line) => line.trim() !== '');
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
 * the file it names was actually looked at. `.gitignore` lists `CLAUDE.md` and ripgrep skips
 * dot-paths, so a tracked file can be invisible to this scan while holding live hits — deleting
 * the entry then re-arms the finding the moment the scan is widened (plan row 0.8).
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

const hits = collectHits();
const violations = hits.filter((line) => !isAllowlisted(line));

if (violations.length > 0) {
  console.error(`Found ${violations.length} non-allowlisted 'methodology' vocabulary hit(s).`);
  console.error('The vocabulary is `framework`. If a hit is a deliberate back-compat fold, add it');
  console.error('to ALLOWLIST in scripts/validate-no-methodology-vocab.js WITH a retirement');
  console.error('condition — an exemption without one is how the vocabulary came back.\n');
  for (const line of violations.slice(0, 40)) console.error(`  ${line}`);
  if (violations.length > 40) console.error(`  ... and ${violations.length - 40} more`);
  process.exit(1);
}

// The allowlist is audited on every run, not on request. An entry that stopped suppressing
// anything is a finding of the same weight as an unsuppressed hit: both mean this file has
// stopped describing the repository.
const scanned = scannedFiles();
const tracked = trackedFiles();
const audit = auditExceptions({
  gate: 'no-methodology-vocab',
  entries: ALLOWLIST,
  describe: (entry) => `${entry.file} :: ${entry.match}`,
  classify: (entry) => classifyEntry(entry, hits, scanned, tracked),
});

if (reportExceptionAudit('no-methodology-vocab', audit) > 0) process.exit(1);

console.log('No non-allowlisted methodology vocabulary found.');
