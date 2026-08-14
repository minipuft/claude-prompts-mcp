#!/usr/bin/env node

/**
 * Plan rows must be checkable in BOTH polarities: a ✓ must not name an untracked file, and a ☐
 * must carry the stamp that makes it re-checkable.
 *
 * WHY THE SECOND RULE EXISTS
 * The first rule shipped 2026-08-12 and was measured one day later against the same plan. Five
 * rows read ☐ while their deliverables were at HEAD, and this gate was green across all five —
 * correctly, because each lie pointed the way it does not look.
 *
 * `✓` and `☐` are not symmetric. `✓` is the MARKED form: it asserts, so it carries a date and
 * evidence, and a gate can read it. `☐` is UNMARKED — what a row looks like when nobody has
 * spoken — so it means "measured, still open" AND "never re-checked" with nothing separating
 * them. Every gate reads the asserting half because only the asserting half contains a claim.
 *
 * The tempting fix is an inverse gate that re-derives whether each ☐ is still open. That costs
 * what the original determination cost and yields circumstantial evidence (a file can change for
 * unrelated reasons). So this checks NOTATION, not world state: an open row must name its own
 * falsifier, which is nearly free to write and expensive to reconstruct a week later.
 *
 * Rule scope is `status: active` plans only. A reference or archived plan is a record, and a
 * backlog plan is speculative; stamping either is work with no reader.
 *
 * WHY NOT DIFF-SCOPED: the motivating case went stale precisely BECAUSE nobody touched it — five
 * hold points sat satisfied for nine days. A gate firing only on changed files could not have
 * caught it, so this re-reads every graded plan on every run.
 *
 * "Graded" is narrower than "every plan", in two ways worth stating rather than discovering:
 * `planFiles()` lists TRACKED files, so a plan that is not yet committed is invisible here — the
 * same HEAD-orientation the rest of this gate family has, and the reason an in-flight plan owned
 * by another session cannot be reddened by it. And `status: active` excludes reference, archived
 * and backlog plans by design.
 *
 * WHY THIS EXISTS (rule 1)
 * A 2026-08 audit of the Agent Plugins migration plan found SEVEN rows marked ✓ whose deliverables
 * had never been committed. `validate:all` measured 32/34 in the working tree and 7/34 at
 * HEAD for three days, because every gate read the working tree while CI checks out the commit.
 * One row asserted that `skills/` "is committed" when it was 0 tracked, 2 present.
 *
 * A ✓ had come to mean "I made the edit", not "the edit is in the repository", and nothing could
 * tell the two apart. `typecheck:committed` closes the compile half — a commit whose
 * consumers outran their providers no longer passes. It cannot close this half: an untracked
 * SCRIPT, YAML, or doc breaks nothing at compile time and still leaves the row's claim false.
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
 * WHAT IT DOES NOT CLAIM
 * This does not verify that a ✓ row's work is correct, complete, or that the tracked file contains
 * what the row says. It answers one question — is the named artifact in the repository — which is
 * the question that went unasked for three days.
 *
 * `--self-test` proves each rule can still fail.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditExceptions, reportExceptionAudit, VERDICT } from './lib/exception-hygiene.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');

/** Rows are markdown table rows; ✓ may sit in any cell, usually the status column. */
const DONE_MARK = '✓';

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

/** The unmarked status. Rule 2 makes it carry a proposition. */
const OPEN_MARK = '☐';

/**
 * The stamp that turns an open marker into something re-checkable.
 *
 * Both halves are required and both are structural. The date alone answers "how old is this
 * belief" but not "what would change it", and the falsifier alone cannot be aged. Requiring an
 * exact phrasing is the point of a NOTATION gate: it is checkable without knowing the domain.
 */
const OPEN_STAMP = /as of (\d{4}-\d{2}-\d{2})\s*[·|-]\s*flips when\s+\S/;

/** Frontmatter status; only `active` plans are graded by rule 2. */
function planStatus(content) {
  const match = content.match(/^---\r?\n[\s\S]*?^status:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

/**
 * Open rows that predate rule 2, kept passing so the gate could land without editing plans owned
 * by concurrent work. Each entry is itself a marker and therefore carries what retires it.
 *
 * `auditGrandfathered()` below FAILS when an entry stops being necessary — the exception list is
 * the exact structure this gate's own rule warns about, and a list that only grows is how a green
 * run stops meaning anything. It delegates to the shared `exception-hygiene` vocabulary rather
 * than hand-rolling the verdicts, because that module already separates `satisfied` (delete) from
 * `unreachable` (do NOT delete — widen the scan first).
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
 * Rule 2 — an open row in an ACTIVE plan must carry `as of <date> · flips when <observation>`.
 *
 * Pure, like rule 1, so the self-test feeds it fabricated plans.
 *
 * @returns {{violations: string[], stamped: number, graded: boolean}}
 */
export function auditOpenRows(planPath, content, grandfathered = GRANDFATHERED_OPEN_ROWS) {
  const violations = [];
  let stamped = 0;

  if (planStatus(content) !== 'active') return { violations, stamped, graded: false };
  if (grandfathered.some((entry) => entry.plan === planPath)) {
    return { violations, stamped, graded: false };
  }

  for (const [index, line] of content.split('\n').entries()) {
    if (!line.startsWith('|') || !line.includes(OPEN_MARK)) continue;

    if (OPEN_STAMP.test(line)) {
      stamped += 1;
      continue;
    }
    violations.push(
      `${planPath}:${index + 1}: a row marked ${OPEN_MARK} carries no stamp. An unmarked status ` +
        'means "still open" and "never re-checked" at the same time — add ' +
        '`(as of YYYY-MM-DD · flips when <observation>)`.'
    );
  }

  return { violations, stamped, graded: true };
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
    return { verdict: VERDICT.SATISFIED, detail: `plan is now \`${status}\`, which rule 2 skips` };
  }

  const bare = content
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes(OPEN_MARK))
    .filter((line) => !OPEN_STAMP.test(line));

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

function run() {
  const tracked = trackedFiles();
  const doneViolations = [];
  const openViolations = [];
  const planTexts = new Map();
  let skipped = 0;
  let checked = 0;
  let stamped = 0;
  let gradedPlans = 0;

  for (const plan of planFiles()) {
    const content = readFileSync(path.join(REPO, plan), 'utf8');
    planTexts.set(plan, content);

    const done = auditPlanText(plan, content, tracked);
    doneViolations.push(...done.violations);
    skipped += done.skipped;
    checked += done.checked;

    const open = auditOpenRows(plan, content);
    openViolations.push(...open.violations);
    stamped += open.stamped;
    if (open.graded) gradedPlans += 1;
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

  if (openViolations.length > 0) {
    console.error(`\n✖ Open rows in active plans carry no stamp (${openViolations.length}):`);
    for (const violation of openViolations) console.error(`  - ${violation}`);
    console.error(
      `\nA ${OPEN_MARK} asserts nothing, so nothing can re-check it. Five rows here read ` +
        `${OPEN_MARK} while their work sat at HEAD, and this gate was green on all five.`
    );
  }

  const exceptionProblems = reportExceptionAudit('plan-row-tracking', exceptionAudit);

  if (doneViolations.length + openViolations.length + exceptionProblems > 0) return 1;

  // Report counts rather than a bare success. A gate that checked nothing and a gate that checked
  // everything print the same "OK" otherwise, which is how a scope regression hides — the same
  // silent-pass shape this whole gate exists to catch.
  console.log(
    `✔ Plan rows: ${checked} path(s) named by ${DONE_MARK} rows are tracked ` +
      `(${skipped} not on disk — renamed, deleted, or external; not decidable here); ` +
      `${stamped} ${OPEN_MARK} row(s) stamped across ${gradedPlans} active plan(s) ` +
      `(${GRANDFATHERED_OPEN_ROWS.length} grandfathered).`
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

  // ---- Rule 2: the open row must carry its own falsifier -------------------------------------
  const ACTIVE = '---\ntitle: "t"\ndate: 2026-08-12\nstatus: active\ntags: []\n---\n';
  const openCase = (name, text, expectFail, planPath = 'plans/fake.md') => {
    const { violations } = auditOpenRows(planPath, text);
    const failed = violations.length > 0;
    if (failed !== expectFail) {
      console.error(
        `✖ self-test: "${name}" — expected ${expectFail ? 'a finding' : 'clean'}, got the opposite`
      );
      failures += 1;
    } else {
      console.log(`✔ self-test: ${name}`);
    }
  };

  openCase('a bare ☐ row in an active plan is caught', `${ACTIVE}| 1.1 | ☐ | do a thing |`, true);
  openCase(
    'a stamped ☐ row passes',
    `${ACTIVE}| 1.1 | ☐ (as of 2026-08-12 · flips when the token exists) | do a thing |`,
    false
  );
  openCase(
    'a date with no falsifier is still a finding — half a stamp is not a stamp',
    `${ACTIVE}| 1.1 | ☐ (as of 2026-08-12) | do a thing |`,
    true
  );
  openCase(
    'a falsifier with no date is still a finding — an unaged belief cannot be triaged',
    `${ACTIVE}| 1.1 | ☐ (flips when the token exists) | do a thing |`,
    true
  );
  openCase(
    'a reference plan is not graded',
    '---\ntitle: "t"\ndate: 2026-08-12\nstatus: reference\ntags: []\n---\n| 1.1 | ☐ | x |',
    false
  );
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
    {
      const { graded } = auditOpenRows(SYNTHETIC_GRANDFATHERED.plan, `${ACTIVE}| 1.1 | ☐ | x |`, [
        SYNTHETIC_GRANDFATHERED,
      ]);
      if (graded !== false) {
        console.error('✖ self-test: a grandfathered plan should not be graded');
        failures += 1;
      } else {
        console.log('✔ self-test: a grandfathered plan is not graded');
      }
    }

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

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
