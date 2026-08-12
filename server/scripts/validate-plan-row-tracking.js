#!/usr/bin/env node

/**
 * A plan row marked ✓ must not name a file that exists on disk but is absent from git.
 *
 * WHY THIS EXISTS
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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function run() {
  const tracked = trackedFiles();
  const violations = [];
  let skipped = 0;
  let checked = 0;

  for (const plan of planFiles()) {
    const result = auditPlanText(plan, readFileSync(path.join(REPO, plan), 'utf8'), tracked);
    violations.push(...result.violations);
    skipped += result.skipped;
    checked += result.checked;
  }

  if (violations.length > 0) {
    console.error(`✖ Plan rows marked ${DONE_MARK} name untracked files (${violations.length}):`);
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      `\nEither commit the file, or correct the row — a ${DONE_MARK} that means "I made the edit" ` +
        'is what let seven rows diverge from HEAD for three days.'
    );
    return 1;
  }

  // Report the skip count rather than printing a bare success. A gate that checked nothing and a
  // gate that checked everything print the same "OK" otherwise, which is how a scope regression
  // hides — the same silent-pass shape this whole gate exists to catch.
  console.log(
    `✔ Plan rows: ${checked} path(s) named by ${DONE_MARK} rows are tracked ` +
      `(${skipped} not on disk — renamed, deleted, or external; not decidable here).`
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

  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
