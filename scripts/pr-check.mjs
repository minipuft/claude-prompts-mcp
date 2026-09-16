#!/usr/bin/env node
/**
 * Runs, locally, every gating check the `PR Conventions` workflow runs on an authored PR.
 *
 * WHY THIS EXISTS. The repo's stated contract is that "CI is the contract; every other gate is a
 * documented strict subset of it" (CLAUDE.md §Validation Gates). For the PR boundary that was
 * false in the one direction that costs a CI cycle: `CONTRIBUTING.md` documented exactly ONE of
 * the four gating steps — the body check — so a contributor who followed it to the letter still
 * opened a PR with an unchecked title. Measured twice:
 *
 *   · 2026-09-14 (#283) — `validate-pr-body.mjs --body-file … --title …` passed locally and CI
 *     failed on `subject-case`. The squash-merge subject IS the PR title, so commitlint judges it;
 *     this script's header says outright that it "does not read the title beyond its type".
 *   · 2026-09-16 (#312) — a body composed by hand instead of generated passed its author's own
 *     review and CI reported three missing sections and a 488-word fold.
 *
 * Neither is a discipline failure that more prose fixes. The correct local path was four commands
 * across two directories while the incorrect one (`gh pr create --body "…"`) was a single command,
 * and no npm script named the gate — every other gate in this repo has one (`validate:all`,
 * `lint:ratchet`, `verify:mcp`). This is that name.
 *
 * WHAT IT GUARANTEES. `MIRRORED_CI_STEPS` below names each workflow step it stands in for, and
 * `server/tests/unit/scripts/pr-check-ci-parity.test.ts` reads the workflow file and fails when
 * the two sets diverge. So a fifth gating step added to CI breaks this script's test until it is
 * mirrored here — the subset relation is enforced rather than asserted in a comment.
 *
 * Every step RUNS; none short-circuits. A body failure and a title failure are independent
 * defects, and reporting only the first costs a second round trip to find the second.
 *
 * NOT ZERO-DEPENDENCY, unlike its two siblings in this directory, and that is safe: commitlint is
 * a root devDependency and this script is never the pre-install CI path. `validate-pr-body.mjs`
 * and `pr-body.mjs` keep their zero-dependency posture because the workflow runs them before
 * `npm ci`; this one runs only on a developer machine with the tree installed.
 *
 * Usage (from the repo root):
 *   npm run pr:body -- --out /tmp/pr-body.md     # seed it; do not author one from scratch
 *   $EDITOR /tmp/pr-body.md
 *   npm run pr:check -- --body-file /tmp/pr-body.md --title "feat(scope): outcome"
 *   node scripts/pr-check.mjs --self-test        # positive control: both halves can fail
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-pr-body.mjs');

/**
 * One entry per gating step in `.github/workflows/pr-conventions.yml`.
 *
 * `ciStepName` is matched EXACTLY against the workflow's step names by the parity test. It is the
 * join key on purpose: matching command strings instead would be defeated by the title-lint step,
 * whose `run:` also carries an `npm ci` that has no local counterpart.
 *
 * `needsAuthoredInput` marks the two steps that judge THIS pull request rather than the checkout.
 * They are the ones that need a body and a title, and the ones the self-test drives.
 */
export const MIRRORED_CI_STEPS = [
  {
    id: 'self-test',
    ciStepName: 'Prove the body check can fail (positive control)',
    label: 'body rules can fail (positive control)',
    needsAuthoredInput: false,
    run: () => node([VALIDATOR, '--self-test']),
  },
  {
    id: 'base-measurable',
    ciStepName: 'Prove the checkout can measure plan progress (positive control)',
    label: 'plan progress is measurable from this checkout',
    needsAuthoredInput: false,
    run: () => node([VALIDATOR, '--assert-base-measurable']),
  },
  {
    id: 'body',
    ciStepName: 'Check the body against the template (scripts/validate-pr-body.mjs)',
    label: 'body follows .github/pull_request_template.md',
    needsAuthoredInput: true,
    run: ({ bodyFile, title }) => node([VALIDATOR, '--body-file', bodyFile, '--title', title]),
  },
  {
    id: 'title',
    ciStepName: "Lint the title with the repo's commitlint config",
    label: 'title passes commitlint.config.mjs',
    needsAuthoredInput: true,
    run: ({ title }) => {
      // An absent binary and a rejected title both exit non-zero through `npx`, and conflating
      // them would make this step's failure mean two different things — one of which the author
      // cannot act on from the message. CI installs before it lints; a developer tree may not
      // have. Not knowing is reported as a failure, never as a pass: an unchecked title is the
      // exact hole this script exists to close.
      if (!existsSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'commitlint'))) {
        return {
          status: 1,
          stdout:
            'commitlint is not installed at the repo root, so THE TITLE WAS NOT CHECKED.\n' +
            'Install it and re-run:\n  npm install',
          stderr: '',
        };
      }
      return spawnSync('npx', ['--no', '--', 'commitlint', '--verbose'], {
        cwd: REPO_ROOT,
        input: `${title}\n`,
        encoding: 'utf8',
      });
    },
  },
];

function node(args) {
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Both channels, because commitlint reports on stderr and the body validator on stdout. */
function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
}

/**
 * Runs every step and returns one verdict per step — never short-circuits.
 *
 * `steps` is injectable so the self-test can drive the authored-input pair against fixtures
 * without reaching for the real branch state.
 */
export function runSteps({ bodyFile, title, steps = MIRRORED_CI_STEPS }) {
  return steps.map((step) => {
    const result = step.run({ bodyFile, title });
    return {
      id: step.id,
      label: step.label,
      passed: result.status === 0,
      output: output(result),
    };
  });
}

/**
 * Proves the two authored-input steps can each FAIL, independently.
 *
 * A wrapper that reported "4 passed" while observing nothing is the exact shape this repo's own
 * workflow guards against with its two positive-control steps; a wrapper around them needs its
 * own. Asserts failure, not just a non-zero exit somewhere: each half is driven to red while the
 * other is held green, so a wrapper that ran only one check cannot pass this.
 */
function selfTest() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'pr-check-'));
  const goodBody = [
    '## Summary',
    '',
    'After this merges, the local PR check runs every gate CI runs.',
    '',
    '## Demonstration',
    '',
    'n/a: tooling only, no consumer-observable surface.',
    '',
    '## How it was verified',
    '',
    '| Claim | Probe | Baseline → measured | Mutation that fails it |',
    '| --- | --- | --- | --- |',
    '| It runs | `node scripts/pr-check.mjs --self-test` | 0 → 4 steps | drop a step |',
    '',
    '## Notes for Reviewers',
    '',
    'Distrust the parity test first.',
    '',
  ].join('\n');
  const goodFile = path.join(scratch, 'good.md');
  const badFile = path.join(scratch, 'bad.md');
  writeFileSync(goodFile, goodBody);
  writeFileSync(badFile, '## Summary\n\nNo other sections.\n');

  const authored = MIRRORED_CI_STEPS.filter((step) => step.needsAuthoredInput);
  const goodTitle = 'ci(scripts): mirror every pr-conventions gate locally';
  const badTitle = 'CI: Mirror Every Gate';

  const cases = [
    { name: 'a filled body and a conventional title pass', bodyFile: goodFile, title: goodTitle, expect: true },
    { name: 'a body missing required sections fails', bodyFile: badFile, title: goodTitle, expect: false },
    { name: 'a non-conventional title fails', bodyFile: goodFile, title: badTitle, expect: false },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const results = runSteps({ bodyFile: testCase.bodyFile, title: testCase.title, steps: authored });
    const allPassed = results.every((result) => result.passed);
    const ok = allPassed === testCase.expect;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
    if (!ok) {
      failed += 1;
      for (const result of results) {
        console.log(`      ${result.id}: ${result.passed ? 'passed' : 'failed'} — ${result.output}`);
      }
    }
  }

  const covered = MIRRORED_CI_STEPS.length;
  console.log(`\n${covered} CI steps mirrored; ${authored.length} driven by this self-test.`);
  return failed === 0;
}

function main() {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest() ? 0 : 1);
  }

  const bodyFile = readArg('--body-file');
  const title = readArg('--title') ?? process.env.PR_TITLE;

  if (!bodyFile || !title) {
    console.error(
      'usage: npm run pr:check -- --body-file <path> --title "<pr title>"\n\n' +
        'Seed the body rather than authoring one:\n' +
        '  npm run pr:body -- --out /tmp/pr-body.md\n\n' +
        'Both arguments are required: the body and the title are judged by different gates, and\n' +
        'passing one of them is what made #283 and #312 each cost a CI cycle.'
    );
    process.exit(2);
  }

  const results = runSteps({ bodyFile, title });

  for (const result of results) {
    console.log(`${result.passed ? 'ok  ' : 'FAIL'}  ${result.label}`);
    if (!result.passed && result.output) {
      console.log(result.output.replace(/^/gm, '      '));
    }
  }

  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    console.log(
      `\n${failures.length} of ${results.length} checks failed. CI runs these same steps on the ` +
        'same body and title, so fix them before `gh pr create`.'
    );
    process.exit(1);
  }

  console.log(
    `\nAll ${results.length} PR Conventions checks pass locally. Open with:\n` +
      `  gh pr create --title ${JSON.stringify(title)} --body-file ${bodyFile}`
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
