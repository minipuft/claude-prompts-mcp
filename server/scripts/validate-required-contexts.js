#!/usr/bin/env node

/**
 * Guards the branch-protection required-status-check contexts against workflow drift.
 *
 * WHY THIS EXISTS
 * GitHub matches a required context against the check-run **name** — a job's `name:` field —
 * not the job id. Protection on `main` required `["lint","build"]` while CI reported
 * `Lint & Validate` and `Build`, so the required contexts could never be reported by anything
 * and every PR sat at `mergeStateStatus=BLOCKED` with all checks green. Nothing in the repo
 * could notice: the workflow was valid, the jobs passed, and the mismatch lived in an API
 * setting no file tracked.
 *
 * `.github/required-contexts.json` is now that file, and this is the check that keeps it true.
 * Renaming a job's `name:` without updating the list fails CI instead of silently re-breaking
 * merges for every future PR.
 *
 * WHY IT ALSO REJECTS INTERPOLATED NAMES
 * `Test (Node ${{ matrix.node }})` is a check-run name derived from a matrix value, so it
 * changes whenever the matrix changes. Requiring one re-creates the original bug the moment a
 * Node version is added or dropped. Require a literal-named aggregator job instead — that is
 * what `Test Suite` is for.
 *
 * WHAT IT DOES NOT DO
 * It does not read GitHub's live protection settings; that needs a token and would make a
 * local `validate:all` depend on the network. It proves the list is *satisfiable* by the
 * workflows in the tree. Applying it is the documented `gh api` call in the JSON's `$comment`.
 *
 * `--self-test` proves each rule can still fail. A rule that cannot reject a wrong-but-
 * well-formed input is decoration, which is the same defect this guard exists to catch.
 *
 * RETIREMENT CONDITION: delete when branch protection is declared as code (a ruleset file
 * applied by a workflow), at which point the workflow that applies it is the guard.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(REPO, '.github', 'workflows');
const CONTEXTS_FILE = path.join(REPO, '.github', 'required-contexts.json');

/** Every check-run name the workflows in `dir` can produce, mapped to its source file. */
function declaredJobNames(dir) {
  const names = new Map();

  for (const entry of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(entry)) continue;

    let doc;
    try {
      doc = yaml.load(readFileSync(path.join(dir, entry), 'utf8'));
    } catch (error) {
      throw new Error(`${entry}: not parseable as YAML — ${error.message}`);
    }

    for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
      // A job with no `name:` reports under its id, which is a legitimate context too.
      names.set(String(job?.name ?? jobId), entry);
    }
  }

  return names;
}

/**
 * Returns the violations for one required-context list against one set of job names.
 * Pure — the self-test drives it with fabricated inputs.
 */
function findViolations(contexts, jobNames) {
  const violations = [];

  for (const context of contexts) {
    if (!jobNames.has(context)) {
      violations.push(
        `required context ${JSON.stringify(context)} matches no job \`name:\` in .github/workflows/ — ` +
          `a PR can never satisfy it. Known names: ${[...jobNames.keys()].map((n) => JSON.stringify(n)).join(', ')}`
      );
      continue;
    }

    if (context.includes('${{')) {
      violations.push(
        `required context ${JSON.stringify(context)} is interpolated, so its name changes with the ` +
          `matrix. Require a literal-named aggregator job instead.`
      );
    }
  }

  return violations;
}

/** Each case must produce at least one violation, or the rule it exercises is inert. */
const SELF_TEST_CASES = [
  {
    rule: 'missing context is rejected',
    contexts: ['No Such Job'],
    jobNames: new Map([['Build', 'ci.yml']]),
  },
  {
    rule: 'job id is rejected when the job declares a name',
    contexts: ['lint'],
    jobNames: new Map([['Lint & Validate', 'ci.yml']]),
  },
  {
    rule: 'matrix-interpolated context is rejected',
    contexts: ['Test (Node ${{ matrix.node }})'],
    jobNames: new Map([['Test (Node ${{ matrix.node }})', 'ci.yml']]),
  },
];

function runSelfTest() {
  console.log('\nvalidate:required-contexts self-test — every rule must reject a wrong input\n');

  let failures = 0;
  for (const { rule, contexts, jobNames } of SELF_TEST_CASES) {
    const rejected = findViolations(contexts, jobNames).length > 0;
    console.log(`  ${rejected ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!rejected) failures += 1;
  }

  // A passing list must stay passing, or the guard is just always-red.
  const clean = findViolations(['Build'], new Map([['Build', 'ci.yml']]));
  const cleanOk = clean.length === 0;
  console.log(`  ${cleanOk ? 'ok  ' : 'FAIL'}  a satisfiable list is accepted`);
  if (!cleanOk) failures += 1;

  console.log(
    failures === 0
      ? `\nOK: all ${SELF_TEST_CASES.length + 1} rules are falsifiable\n`
      : `\nFAILED: ${failures} rule(s) cannot detect a wrong input\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const declared = JSON.parse(readFileSync(CONTEXTS_FILE, 'utf8'));
  const contexts = declared.contexts ?? [];

  if (contexts.length === 0) {
    console.error(
      `${CONTEXTS_FILE} declares no contexts — an empty required set protects nothing.`
    );
    process.exit(1);
  }

  const violations = findViolations(contexts, declaredJobNames(WORKFLOW_DIR));

  if (violations.length > 0) {
    console.error('Required status check contexts do not match the workflows:\n');
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      '\nUpdate .github/required-contexts.json and re-apply it to branch protection ' +
        '(command in that file), or restore the job name.'
    );
    process.exit(1);
  }

  console.log(
    `Required status check contexts all resolve to a job name (${contexts.length} checked).`
  );
}

main();
