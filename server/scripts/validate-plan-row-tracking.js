#!/usr/bin/env node

/**
 * Plan rows are checked in two layers, and this gate runs both.
 *
 * 1. INDEX TRACKING (this file). A ✓ row must not name a file that exists on disk but is not
 *    tracked by git. Only this repository's gate can read the index, so the managed validator
 *    leaves it here, together with the accepted-exceptions audit (`auditGrandfathered`).
 * 2. ROW GRAMMAR (managed). The glyph vocabulary, the stamps each glyph requires, status-column
 *    and table-contiguity parsing, and the `status:` vocabulary belong to the delivery-contract
 *    scripts `scripts/plan-rows.mjs` and `scripts/validate-plan-rows.mjs`
 *    (`conventions/plan-rows.md` in repository-standards). This gate imports the vocabulary and
 *    chains the validator with `--strict-stamps` over `git ls-files -- plans`, so the scope stays
 *    committed plans only.
 *
 * WHY THE INDEX CHECK EXISTS
 * A 2026-08 audit of the Agent Plugins migration plan found SEVEN rows marked ✓ whose deliverables
 * had never been committed. `validate:all` measured 32/34 in the working tree and 7/34 at
 * HEAD for three days, because every gate read the working tree while CI checks out the commit.
 * One row asserted that `skills/` "is committed" when it was 0 tracked, 2 present.
 *
 * A ✓ had come to mean "I made the edit", not "the edit is in the repository", and nothing could
 * tell the two apart. `typecheck:committed` closes the compile half; it cannot close this half:
 * an untracked SCRIPT, YAML, or doc breaks nothing at compile time and still leaves the row's
 * claim false.
 *
 * WHAT IT CHECKS
 * For every table row in `plans/**` bearing ✓, every backticked path that (a) looks like a repo
 * file and (b) EXISTS on disk must be tracked by git.
 *
 * The "exists on disk" condition is the whole precision of this gate, and it is deliberate rather
 * than convenient. Plans name paths for three reasons: files they created, files they deleted, and
 * files they merely discuss — often renamed since, or belonging to another repository. Only the
 * first is checkable. A path that is absent from disk AND from git is indistinguishable from a
 * retired one, so it is counted and skipped, never failed. A path present on disk and absent from
 * git has no innocent reading: the work exists and the repository does not have it.
 *
 * A ⊘ row is exempt: by definition it wrote nothing, so the paths it names are ones it
 * deliberately did not touch.
 *
 * WHAT IT DOES NOT CLAIM
 * This does not verify that a ✓ row's work is correct, complete, or that the tracked file contains
 * what the row says. It answers one question — is the named artifact in the repository.
 *
 * SCOPE
 * Every plan is re-read on every run, not only changed ones: the motivating case went stale
 * precisely because nobody touched it. `planFiles()` lists TRACKED files, so a plan that is not
 * yet committed is invisible here, the same HEAD-orientation the rest of this gate family has.
 *
 * This file imports only node builtins and the managed `../../scripts/plan-rows.mjs`: CI runs it
 * on the lightweight routes with no `node_modules` installed.
 *
 * `--self-test` proves the index rule and the chained managed run can each still fail.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditExceptions, reportExceptionAudit, VERDICT } from './lib/exception-hygiene.js';
import { readFrontmatter, STAMPS, STATUS_GLYPHS } from '../../scripts/plan-rows.mjs';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');

/** The managed row-grammar validator this gate chains (delivery-contract script). */
const MANAGED_VALIDATOR = path.join(REPO, 'scripts', 'validate-plan-rows.mjs');

/** The glyph the vocabulary names `name`; the one definition is the managed `plan-rows.mjs`. */
function glyphNamed(name) {
  const entry = STATUS_GLYPHS.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`plan-rows.mjs declares no "${name}" status glyph`);
  return entry.glyph;
}

/** Rows are markdown table rows; ✓ may sit in any cell, usually the status column. */
const DONE_MARK = glyphNamed('done');

/** Closed, no change required — names files it deliberately did not touch, so rule 1 skips it. */
const CLOSED_MARK = glyphNamed('closed-no-change');

/** The unmarked status; `classifyGrandfathered` looks for it without its stamp. */
const OPEN_MARK = glyphNamed('open');

/**
 * A backticked token that looks like a path to a file in this repository.
 *
 * Requires a known extension; a directory separator is NOT required. Requiring one was the first
 * cut and it silently dropped every root-level deliverable. Replayed against the real audit above,
 * it caught `scripts/render-targets.json` while `plugin.json` and `mcp.json` — untracked under ✓
 * rows in the same tier — stayed invisible. Two thirds of that finding would have been missed by a
 * gate reporting success, which is the precise shape this file exists to stop.
 *
 * Bare names resolve against the repo root, so a generic mention like `index.js` almost never
 * exists there and is skipped by the on-disk condition below rather than producing noise.
 * Extensions still bound it: `server/src/engine` is a directory, not a deliverable.
 */
const PATH_IN_BACKTICKS = /`([A-Za-z0-9_.\-/]+\.(?:ts|js|mjs|cjs|json|ya?ml|md|py|sh))`/g;

/** Paths that are legitimately absent from git; naming one in a ✓ row is not a finding. */
const IGNORED_PREFIXES = ['node_modules/', 'server/dist/', 'cli/dist/'];

/** Frontmatter `status:` of a plan, or null. */
function planStatus(content) {
  return readFrontmatter(content)?.status ?? null;
}

/**
 * Plans accepted with unstamped open rows. Each entry is itself a marker and therefore carries
 * what retires it (`closedBy`).
 *
 * `auditGrandfathered()` below FAILS when an entry stops being necessary: a list that only grows
 * is how a green run stops meaning anything. It delegates to the shared `exception-hygiene`
 * vocabulary rather than hand-rolling the verdicts, because that module already separates
 * `satisfied` (delete) from `unreachable` (do NOT delete — widen the scan first).
 *
 * The managed validator takes no exception list, so an entry here is audited for staleness and
 * does not itself silence a managed finding.
 */
const GRANDFATHERED_OPEN_ROWS = [
  // Retired 2026-08-13: the P5 visibility-policy entry's closedBy arrived — every row in that
  // plan is now ✓ (rows 4.4/4.5/5.5 landed), so the exception was satisfied and deleted the same
  // day, per the satisfied-exception rule this gate itself enforces.
];

function trackedFiles() {
  const output = execFileSync('git', ['ls-files'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(output.split('\n').filter(Boolean));
}

function planFiles() {
  const output = execFileSync('git', ['ls-files', '--', 'plans'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return output
    .split('\n')
    .filter((file) => file.endsWith('.md'))
    .filter((file) => existsSync(path.join(REPO, file)));
}

/**
 * Findings for one plan's text. Pure — takes content, so the self-test feeds it fabricated plans.
 *
 * @returns {{violations: string[], skipped: number, checked: number}}
 */
export function auditPlanText(planPath, content, tracked) {
  const violations = [];
  let skipped = 0;
  let checked = 0;

  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    // Table rows only. Prose routinely says "✓ landed" without the row structure that makes the
    // claim machine-readable, and reading those produces findings nobody can act on.
    if (!line.startsWith('|') || !line.includes(DONE_MARK)) continue;

    // A ⊘ row names files it deliberately did NOT touch — that is the whole point of the mark —
    // so the git-tracked check below would be asking the wrong question of it. Exempt the entire
    // row, not just the ⊘ mention, in case a row transitions through both marks in one edit.
    if (line.includes(CLOSED_MARK)) continue;

    for (const match of line.matchAll(PATH_IN_BACKTICKS)) {
      const rel = match[1];
      if (IGNORED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;

      // Absent from disk: renamed, deleted, or another repo's file. Not decidable, not failed.
      if (!existsSync(path.join(REPO, rel))) {
        skipped += 1;
        continue;
      }

      checked += 1;
      if (!tracked.has(rel)) {
        violations.push(
          `${planPath}:${index + 1}: a row marked ${DONE_MARK} names \`${rel}\`, which exists on ` +
            'disk but is not tracked by git. The work is not in the repository.'
        );
      }
    }
  }

  return { violations, skipped, checked };
}

/**
 * Classifies one grandfathered entry against the shared exception vocabulary.
 *
 * The `unreachable` branch is the one worth reading. A grandfathered plan can go inert two ways
 * that look identical from here: its rows got stamped (SATISFIED — delete), or it stopped being
 * tracked and this gate can no longer see it at all (UNREACHABLE — do NOT delete, or the
 * suppression re-arms the moment it is committed again). A hand-rolled check written for this file
 * collapsed both into "delete the entry", which is the wrong remedy for the second.
 *
 * @param {{plan: string, reason: string, closedBy: string}} entry
 * @param {Map<string, string>} planTexts   Tracked plans only — the gate's actual reach.
 */
function classifyGrandfathered(entry, planTexts) {
  const content = planTexts.get(entry.plan);

  if (content === undefined) {
    return existsSync(path.join(REPO, entry.plan))
      ? { verdict: VERDICT.UNREACHABLE, detail: 'present on disk but untracked, so never scanned' }
      : { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such plan file' };
  }

  const status = planStatus(content);
  if (status !== 'active') {
    return {
      verdict: VERDICT.SATISFIED,
      detail: `plan is now \`${status}\`, which the managed open-stamp rule skips`,
    };
  }

  const bare = content
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes(OPEN_MARK))
    .filter((line) => !STAMPS.open.test(line));

  return bare.length > 0
    ? { verdict: VERDICT.LOAD_BEARING }
    : { verdict: VERDICT.SATISFIED, detail: 'every open row is stamped' };
}

/** @param {Map<string, string>} planTexts */
export function auditGrandfathered(planTexts, entries = GRANDFATHERED_OPEN_ROWS) {
  return auditExceptions({
    gate: 'plan-row-tracking',
    entries,
    describe: (entry) => entry.plan,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) => classifyGrandfathered(entry, planTexts),
  });
}

/** Absolute paths of the committed plans the managed validator is asked to read. */
function committedPlanPaths() {
  return planFiles().map((file) => path.join(REPO, file));
}

/**
 * Runs the managed plan-row validator over explicit files, with the strict stamp rules on.
 *
 * Explicit paths, because with none the validator walks the plans directory and would read
 * uncommitted plans too. The child's own output is forwarded by the caller.
 *
 * @param {string} root   Directory finding paths are reported relative to.
 * @param {string[]} files Absolute plan paths; must be non-empty.
 */
function runManagedPlanRows(root, files) {
  return spawnSync(
    process.execPath,
    [MANAGED_VALIDATOR, '--root', root, '--strict-stamps', ...files],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
}

/** @returns {number} 0 clean, 1 findings, 2 the managed validator itself failed. */
function chainManagedValidator(files) {
  if (files.length === 0) {
    console.log('✔ Managed plan-row validator: no committed plans to read.');
    return 0;
  }

  const result = runManagedPlanRows(REPO, files);
  if (result.error || result.status === null || result.status > 1) {
    console.error(
      `✖ scripts/validate-plan-rows.mjs failed to run (exit ${result.status ?? 'none'}` +
        `${result.error ? `: ${result.error.message}` : ''}). This gate fails with it.`
    );
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return 2;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status;
}

function run() {
  const tracked = trackedFiles();
  const doneViolations = [];
  const planTexts = new Map();
  let skipped = 0;
  let checked = 0;

  const plans = planFiles();
  for (const plan of plans) {
    const content = readFileSync(path.join(REPO, plan), 'utf8');
    planTexts.set(plan, content);

    const done = auditPlanText(plan, content, tracked);
    doneViolations.push(...done.violations);
    skipped += done.skipped;
    checked += done.checked;
  }

  const exceptionAudit = auditGrandfathered(planTexts);

  if (doneViolations.length > 0) {
    console.error(
      `✖ Plan rows marked ${DONE_MARK} name untracked files (${doneViolations.length}):`
    );
    for (const violation of doneViolations) console.error(`  - ${violation}`);
    console.error(
      `\nEither commit the file, or correct the row — a ${DONE_MARK} that means "I made the edit" ` +
        'is what let seven rows diverge from HEAD for three days.'
    );
  }

  const exceptionProblems = reportExceptionAudit('plan-row-tracking', exceptionAudit);
  const managedStatus = chainManagedValidator(committedPlanPaths());

  if (doneViolations.length + exceptionProblems > 0 || managedStatus !== 0) return 1;

  // Report counts rather than a bare success. A gate that checked nothing and a gate that checked
  // everything print the same "OK" otherwise, which is how a scope regression hides.
  console.log(
    `✔ Plan rows: ${checked} path(s) named by ${DONE_MARK} rows are tracked ` +
      `(${skipped} not on disk — renamed, deleted, or external; not decidable here); ` +
      `${plans.length} committed plan(s) passed to the managed validator.`
  );
  return 0;
}

/** Each case must FAIL; a rule that cannot fail is not enforcing anything. */
function selfTest() {
  const tracked = new Set(['server/src/real.ts']);
  const onDisk = 'server/scripts/validate-plan-row-tracking.js'; // this file — exists, and tracked
  let failures = 0;

  const expectFinding = (name, planText, trackedSet = tracked) => {
    const { violations } = auditPlanText('plans/fake.md', planText, trackedSet);
    if (violations.length === 0) {
      console.error(`✖ self-test: "${name}" produced no violation — the rule is not enforced.`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${name}`);
    }
  };

  const expectClean = (name, planText, trackedSet = tracked) => {
    const { violations } = auditPlanText('plans/fake.md', planText, trackedSet);
    if (violations.length > 0) {
      console.error(`✖ self-test: "${name}" reported a finding it should not — ${violations[0]}`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${name}`);
    }
  };

  expectFinding(
    'a ✓ row naming an on-disk but untracked file is caught',
    `| 1.1 | ✓ | wrote \`${onDisk}\` | done |`,
    new Set() // nothing tracked → the file on disk is untracked
  );

  expectClean(
    'the same file passes once tracked',
    `| 1.1 | ✓ | wrote \`${onDisk}\` | done |`,
    new Set([onDisk])
  );

  expectClean(
    'an unmarked row is not audited',
    `| 1.1 | ☐ | will write \`${onDisk}\` | pending |`,
    new Set()
  );

  expectClean(
    'prose outside a table is not audited',
    `Landed ✓ — see \`${onDisk}\` for details.`,
    new Set()
  );

  expectClean(
    'a path that is not on disk is skipped, not failed',
    '| 1.1 | ✓ | wrote `server/src/renamed-away.ts` | done |',
    new Set()
  );

  expectClean(
    'a declared build output is ignored',
    '| 1.1 | ✓ | built `server/dist/index.js` | done |',
    new Set()
  );

  expectClean(
    'a ⊘ row naming an on-disk-but-untracked file does not trigger the ✓ path rule',
    `| 1.1 | ⊘ (verified 2026-08-17 · no change needed) | did not touch \`${onDisk}\` | closed |`,
    new Set() // nothing tracked — would fail rule 1 if ⊘ rows were not exempt
  );

  expectClean(
    'a row carrying BOTH ✓ and ⊘ is still exempt from the ✓ path rule',
    `| 1.1 | ✓ ⊘ (verified 2026-08-17 · reason) | \`${onDisk}\` | closed |`,
    new Set()
  );

  // The skip path must not swallow everything: if `existsSync` were inverted or the regex broke,
  // every case above would pass vacuously. Prove the matcher still finds a real path.
  const { checked } = auditPlanText(
    'plans/fake.md',
    `| 1.1 | ✓ | wrote \`${onDisk}\` | done |`,
    new Set([onDisk])
  );
  if (checked !== 1) {
    console.error(`✖ self-test: expected 1 checked path, got ${checked} — the matcher is broken.`);
    failures += 1;
  } else {
    console.log('✔ self-test: the path matcher still resolves a real repo path');
  }

  // ---- The chained managed validator must be observed redden AND pass ------------------------
  // The row grammar lives in `scripts/validate-plan-rows.mjs`; what this gate owns is that the
  // chain reaches it. A temp plan outside the repository is fed through the same call `run()`
  // makes: a bare ☐ must fail it, a clean plan must pass it, so a chain that stopped invoking the
  // validator (or swallowed its exit) cannot stay green.
  const ACTIVE = '---\ntitle: "t"\ndate: 2026-08-12\nstatus: active\ntags: []\n---\n';
  const chainDir = mkdtempSync(path.join(os.tmpdir(), 'plan-row-chain-'));
  try {
    const chainCase = (name, text, expectedStatus) => {
      const file = path.join(chainDir, 'plan.md');
      writeFileSync(file, text);
      const result = runManagedPlanRows(chainDir, [file]);
      if (result.status !== expectedStatus) {
        console.error(
          `✖ self-test: "${name}" — managed validator exited ${result.status}, expected ` +
            `${expectedStatus}${result.error ? ` (${result.error.message})` : ''}`
        );
        failures += 1;
      } else {
        console.log(`✔ self-test: ${name}`);
      }
    };

    chainCase(
      'the chained managed validator refuses a bare ☐ row in an active plan',
      `${ACTIVE}| # | St | Change |\n| --- | --- | --- |\n| 1.1 | ${OPEN_MARK} | do a thing |\n`,
      1
    );
    chainCase(
      'the chained managed validator refuses a bare ✗ row (--strict-stamps is on)',
      `${ACTIVE}| # | St | Change |\n| --- | --- | --- |\n| 1.1 | ${glyphNamed('killed')} | x |\n`,
      1
    );
    chainCase(
      'the chained managed validator passes a stamped plan',
      `${ACTIVE}| # | St | Change |\n| --- | --- | --- |\n| 1.1 | ${OPEN_MARK} (as of 2026-08-12 · flips when the token exists) | do a thing |\n`,
      0
    );
  } finally {
    rmSync(chainDir, { recursive: true, force: true });
  }

  // Synthetic fixture: the live GRANDFATHERED_OPEN_ROWS list is empty in the healthy steady
  // state (2026-08-13: its one entry retired the day its closedBy arrived), so the self-test
  // carries its own entry.
  //
  // The unreachable case below needs a path that EXISTS on disk yet is absent from the scanned
  // map, since that is exactly what "present but untracked" looks like. An earlier version got
  // the on-disk half by naming a real plan — and a routine retirement moved that plan into
  // plans/reference/ the next day, flipping the verdict to subject-missing and failing the
  // suite on a change that had nothing to do with this gate. A self-test must not be
  // load-bearing on where the repository's own documents happen to live.
  //
  // So the fixture creates its own file, which also makes it a truer fixture than the old one:
  // a freshly written temp file IS untracked, which is the condition under test, whereas the
  // real plan it used to name was tracked and merely absent from a hand-built map.
  const FIXTURE_DIR = path.join(REPO, '.plan-row-selftest');
  const SYNTHETIC_GRANDFATHERED = {
    plan: '.plan-row-selftest/untracked-plan.md',
    reason: 'self-test fixture',
    closedBy: 'n/a — synthetic self-test entry',
  };
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(path.join(REPO, SYNTHETIC_GRANDFATHERED.plan), `${ACTIVE}| 1.1 | ☐ | x |\n`);
  try {
    // ---- The satisfied-exception check must itself be able to fail -----------------------------
    const g = SYNTHETIC_GRANDFATHERED.plan;
    const exceptionCase = (name, texts, expectedVerdict) => {
      const { counts } = auditGrandfathered(new Map(texts), [SYNTHETIC_GRANDFATHERED]);
      if ((counts[expectedVerdict] ?? 0) !== 1) {
        console.error(
          `✖ self-test: "${name}" — expected verdict ${expectedVerdict}, got ${JSON.stringify(counts)}`
        );
        failures += 1;
      } else {
        console.log(`✔ self-test: ${name}`);
      }
    };

    exceptionCase(
      'a grandfathered plan that still has bare open rows stays load-bearing',
      [[g, `${ACTIVE}| 1.1 | ☐ | x |`]],
      VERDICT.LOAD_BEARING
    );
    exceptionCase(
      'a grandfathered plan whose rows are ALL stamped is satisfied — delete the entry',
      [[g, `${ACTIVE}| 1.1 | ☐ (as of 2026-08-12 · flips when x) | x |`]],
      VERDICT.SATISFIED
    );
    exceptionCase(
      'a grandfathered plan that left `active` is satisfied',
      [[g, '---\ntitle: "t"\ndate: 2026-08-12\nstatus: reference\ntags: []\n---\n| 1.1 | ☐ | x |']],
      VERDICT.SATISFIED
    );
    // The distinction the hand-rolled version got wrong: absent from the scan is NOT cleanliness.
    // p5 exists on disk here, so an empty map means "untracked", which must never say "delete".
    exceptionCase(
      'a grandfathered plan the scan cannot reach is unreachable, NOT satisfied',
      [],
      VERDICT.UNREACHABLE
    );

    const missing = auditExceptions({
      gate: 'self-test',
      entries: [{ plan: 'plans/does-not-exist.md', closedBy: 'n/a' }],
      describe: (entry) => entry.plan,
      closedBy: (entry) => entry.closedBy,
      classify: (entry) => classifyGrandfathered(entry, new Map()),
    });
    if ((missing.counts[VERDICT.SUBJECT_MISSING] ?? 0) !== 1) {
      console.error('✖ self-test: a vanished plan should be subject-missing');
      failures += 1;
    } else {
      console.log('✔ self-test: a grandfathered plan that vanished is subject-missing');
    }

    const noClosedBy = auditExceptions({
      gate: 'self-test',
      entries: [{ plan: g, closedBy: '' }],
      describe: (entry) => entry.plan,
      closedBy: (entry) => entry.closedBy,
      classify: () => ({ verdict: VERDICT.LOAD_BEARING }),
    });
    if (noClosedBy.problems.length !== 1) {
      console.error('✖ self-test: an entry with no closedBy must be a problem');
      failures += 1;
    } else {
      console.log('✔ self-test: an exception with no closedBy is refused');
    }
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }

  return failures === 0 ? 0 : 1;
}

// Run only when invoked as a command. This file exports its audits so other gates can reuse the
// row vocabulary, and an unguarded `process.exit` made those exports unreachable: importing them
// ran the whole plan audit and terminated the importing process. Same idiom as
// `run-validation-suite.js`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
