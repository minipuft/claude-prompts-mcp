#!/usr/bin/env node

/**
 * Every `validate:*`/`verify:*` script must be run by something, or say why it is not.
 *
 * Row 0.3 governs which MECHANISM a new check uses. Row 3.1 added a test that every step declared
 * in `SUITE` exists as an npm script. The converse was unguarded: a check could be written,
 * reviewed, merged and never wired to anything, and its `:self-test` would keep passing forever —
 * proof that the checker CAN fail, from a checker nothing ever runs. That is the shape row 1.5
 * found in `no-prompt-gates-alias` (vacuous by pattern drift) reached by a second route.
 *
 * THE PROBE IS THE POINT. "Is this check run by anything" must be answered against the property,
 * not against a token that usually accompanies it. Measured 2026-08-11: searching CI for the npm
 * script name `validate:renovate-extraction` reports NOTHING, because
 * `.github/workflows/renovate-config-validator.yml` invokes it as
 * `node server/scripts/validate-renovate-extraction.js`. The plan row that commissioned this
 * checker had concluded, from exactly that search, that the script was dead — it is not, it is one
 * of the more load-bearing checks in the repo. So a consumer here is a reference to the npm name
 * OR to the script file the npm name resolves to.
 *
 * The same search also has to reach `.github/**` and `.husky/**`, which are dot-paths that
 * ripgrep skips without `--hidden`. This walks the git-tracked set instead, for the reason
 * `validate-no-methodology-vocab.js` documents at length.
 *
 * TWO FAILURE MODES, deliberately distinct:
 *
 *   1. UNWIRED — a check that is neither in `SUITE` nor declared below. Someone wrote a gate and
 *      never connected it.
 *   2. FALSE REASON — a declared exception whose named consumers no longer reference it. The
 *      check silently stopped running and the exception is now a lie. This is the case that
 *      motivates the whole file; a membership list that only checked FORM would pass while every
 *      exception rotted.
 *
 * Stale-exception hygiene (entry names a script now in `SUITE`, or a script that no longer
 * exists) is delegated to `lib/exception-hygiene.js` — one definition of "still true" across all
 * six Class-B surfaces, per row 4.1.
 *
 * `--self-test` proves each rule can still fail. Exit 0 when every check is wired or honestly
 * excused; exit 1 otherwise.
 *
 * MECHANISM: script — relation — compares package.json against a JS module against CI workflow files; no linter sees more than one file
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';
import { auditSubstrate } from './lib/substrate.js';
import { SUITE } from './run-validation-suite.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

/** Where a check may legitimately be run from, other than the suite. */
const CONSUMER_GLOBS = ['.github/', '.husky/'];

/**
 * Checks that are deliberately outside `SUITE`, each naming the files that DO run it.
 *
 * `runBy` is not documentation — it is asserted on every run. An entry whose consumers stop
 * referencing the check fails this gate, because at that moment the check stopped running and the
 * reason stopped being true.
 */
const ALLOWED_OUTSIDE = [
  {
    script: 'validate:all',
    reason: 'the suite runner itself — it cannot be a member of the suite it runs',
    closedBy: 'never, while `validate:all` is the CI-whole wrapper',
    runBy: ['.github/workflows/ci.yml'],
  },
  {
    script: 'verify:mcp',
    reason: 'spawns a server from dist/, so it cannot sit in a suite that runs before the build',
    closedBy: 'a post-build suite existing for build-dependent checks to join',
    runBy: ['.github/workflows/ci.yml'],
  },
  {
    script: 'validate:tool-schemas',
    reason: 'captures schemas from a built server; build-dependent for the same reason',
    closedBy: 'a post-build suite existing for build-dependent checks to join',
    runBy: ['.github/workflows/ci.yml'],
  },
  {
    script: 'verify:package-artifact',
    reason: 'inspects a packed tarball, which only exists after `npm pack`',
    closedBy: 'a post-build suite existing for build-dependent checks to join',
    runBy: ['.github/workflows/ci.yml', '.github/workflows/npm-publish.yml'],
  },
  {
    script: 'verify:claims',
    reason: 'e2e conformance suite against a built server; too slow for the pre-commit suite',
    closedBy: 'a post-build suite existing for build-dependent checks to join',
    runBy: ['.github/workflows/npm-publish.yml'],
  },
  {
    script: 'validate:renovate-extraction',
    reason:
      'reads Renovate dry-run JSONL on stdin; a SUITE step runs with stdin ignored, so it is structurally ineligible',
    closedBy: 'the suite gaining a way to declare a step that supplies input',
    runBy: ['.github/workflows/renovate-config-validator.yml'],
  },
];

function definedChecks() {
  const { scripts } = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'));
  return Object.keys(scripts)
    .filter((name) => /^(validate|verify):/.test(name))
    .filter((name) => !name.endsWith(':self-test'))
    .map((name) => ({ name, file: scripts[name].match(/scripts\/([\w.-]+\.[cm]?[jt]s)/)?.[1] }));
}

/**
 * Files that may run a check. The git-tracked set, not a ripgrep walk: `.github/` and `.husky/`
 * are dot-paths, and ripgrep skips those by default.
 */
function consumerFiles() {
  return execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\n')
    .filter((file) => CONSUMER_GLOBS.some((prefix) => file.startsWith(prefix)));
}

/**
 * True when `file` references the check by npm name or by the script file it resolves to.
 *
 * Both spellings count because both are real invocations. Accepting only the npm name is the
 * measurement error documented in the header.
 */
function references(text, check) {
  return text.includes(check.name) || (check.file !== undefined && text.includes(check.file));
}

function findConsumers(check, files, readFile) {
  return files.filter((file) => {
    const text = readFile(file);
    return text !== null && references(text, check);
  });
}

function readOrNull(file) {
  try {
    return readFileSync(path.join(REPO_ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Classifies one exception entry. `unreachable` cannot occur: entries are looked up by npm script
 * name in a package.json that is always read, so there is no scan for one to fall outside of.
 */
function classifyEntry(entry, suiteNames, defined) {
  if (suiteNames.has(entry.script)) {
    return { verdict: VERDICT.SATISFIED, detail: 'now a SUITE member; the exception is spent' };
  }
  if (!defined.some((check) => check.name === entry.script)) {
    return { verdict: VERDICT.SUBJECT_MISSING, detail: 'no such npm script' };
  }
  return { verdict: VERDICT.LOAD_BEARING };
}

export function analyse({ suite, defined, files, readFile }) {
  const suiteNames = new Set(suite.map((step) => step.script));
  const declared = new Map(ALLOWED_OUTSIDE.map((entry) => [entry.script, entry]));

  const unwired = [];
  const falseReasons = [];

  for (const check of defined) {
    if (suiteNames.has(check.name)) continue;
    const entry = declared.get(check.name);
    if (entry === undefined) {
      const consumers = findConsumers(check, files, readFile);
      unwired.push({ check, consumers });
      continue;
    }
    const consumers = findConsumers(check, files, readFile);
    if (consumers.length === 0) {
      falseReasons.push({ entry, claimed: entry.runBy, found: [] });
      continue;
    }
    const missing = entry.runBy.filter((file) => !consumers.includes(file));
    if (missing.length > 0) falseReasons.push({ entry, claimed: missing, found: consumers });
  }

  return { unwired, falseReasons, suiteNames, defined };
}

const SELF_TEST_FILES = ['.github/workflows/ci.yml'];

function selfTestCases() {
  const suite = [{ script: 'validate:format' }];
  const entry = ALLOWED_OUTSIDE.find((candidate) => candidate.script === 'verify:mcp');
  const wired = { name: 'verify:mcp', file: 'verify-mcp-surface.mjs' };

  return [
    {
      rule: 'a check that is neither in SUITE nor declared is reported',
      input: {
        suite,
        defined: [{ name: 'validate:orphan', file: 'validate-orphan.js' }],
        files: SELF_TEST_FILES,
        readFile: () => 'nothing here',
      },
      expect: (result) => result.unwired.length === 1,
    },
    {
      rule: 'a SUITE member is not reported',
      input: {
        suite,
        defined: [{ name: 'validate:format', file: undefined }],
        files: SELF_TEST_FILES,
        readFile: () => '',
      },
      expect: (result) => result.unwired.length === 0 && result.falseReasons.length === 0,
    },
    {
      rule: 'a declared exception whose consumer still runs it passes',
      input: {
        suite,
        defined: [wired],
        files: SELF_TEST_FILES,
        readFile: () => 'run: npm run verify:mcp',
      },
      expect: (result) => result.falseReasons.length === 0,
    },
    {
      rule: 'a declared exception whose consumer stopped running it is reported',
      input: {
        suite,
        defined: [wired],
        files: SELF_TEST_FILES,
        readFile: () => 'this workflow no longer mentions it',
      },
      expect: (result) => result.falseReasons.length === 1,
    },
    {
      rule: 'a consumer that invokes by SCRIPT FILE, not npm name, still counts',
      input: {
        suite,
        defined: [wired],
        files: SELF_TEST_FILES,
        readFile: () => 'run: node server/scripts/verify-mcp-surface.mjs',
      },
      expect: (result) => result.falseReasons.length === 0,
    },
    {
      rule: 'an exception naming a script that no longer exists is stale',
      input: { suite, defined: [], entryUnderTest: entry },
      expect: () => classifyEntry(entry, new Set(), []).verdict === VERDICT.SUBJECT_MISSING,
    },
    {
      rule: 'an exception for a script that joined SUITE is stale',
      input: { suite, defined: [wired], entryUnderTest: entry },
      expect: () =>
        classifyEntry(entry, new Set(['verify:mcp']), [wired]).verdict === VERDICT.SATISFIED,
    },
    // ---- substrate rule. Each case names a DIFFERENT way a declaration can be wrong, because a
    // single "it fails on bad input" case cannot tell an over-claim from an omission, and the two
    // have opposite fixes: one edits the declaration, the other edits the gate.
    {
      rule: 'a declaration matching the derived substrate passes',
      input: {
        suite,
        entryUnderTest: entry,
        substrate: [{ script: 'x', reads: ['file'] }],
        command: () => 'node -e "readFileSync(\'a\')"',
      },
      expect: () =>
        auditSubstrate([{ script: 'x', reads: ['file', 'spawn'] }], () => "readFileSync('a')")
          .length === 0,
    },
    {
      rule: 'a declaration OMITTING a substrate the source contains fails',
      input: { suite, entryUnderTest: entry },
      expect: () =>
        auditSubstrate(
          [{ script: 'x', reads: ['file'] }],
          () => "readFileSync('a'); execFileSync('git',['ls-files'])"
        ).length === 1,
    },
    {
      rule: 'a declaration CLAIMING a substrate the source lacks fails',
      input: { suite, entryUnderTest: entry },
      expect: () =>
        auditSubstrate([{ script: 'x', reads: ['file', 'head'] }], () => "readFileSync('a')")
          .length === 1,
    },
    {
      rule: 'a step declaring no reads at all fails',
      input: { suite, entryUnderTest: entry },
      expect: () => auditSubstrate([{ script: 'x', reads: [] }], () => 'x').length === 1,
    },
    {
      rule: 'a substrate value outside the vocabulary fails',
      input: { suite, entryUnderTest: entry },
      expect: () => auditSubstrate([{ script: 'x', reads: ['worktree'] }], () => 'x').length === 1,
    },
    // A token in a comment or a regex is not an operation. Without this the module trips its own
    // pattern table — measured, not hypothetical: it reported that the membership gate reads HEAD
    // and walks directories, on the strength of this file's prose describing those very signals.
    {
      rule: 'a signal token appearing only in a comment is not a substrate',
      input: { suite, entryUnderTest: entry },
      expect: () =>
        auditSubstrate(
          [{ script: 'x', reads: ['file', 'spawn'] }],
          () => "readFileSync('a') // also uses ls-files somewhere\n"
        ).length === 0,
    },
    {
      rule: 'a real call is still detected when a comment mentions another signal',
      input: { suite, entryUnderTest: entry },
      expect: () =>
        auditSubstrate(
          [{ script: 'x', reads: ['file', 'spawn', 'tracked'] }],
          () => "// walks nothing\nreadFileSync('a'); execFileSync('git',['ls-files'])"
        ).length === 0,
    },
  ];
}

function runSelfTest() {
  console.log('\nvalidate:suite-membership self-test — every rule must behave\n');
  let failures = 0;
  for (const { rule, input, expect } of selfTestCases()) {
    let ok;
    try {
      ok = expect(input.entryUnderTest ? null : analyse(input));
    } catch (error) {
      ok = false;
      console.log(`        ${error.message}`);
    }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!ok) failures += 1;
  }
  console.log(
    failures === 0
      ? `\nOK: all ${selfTestCases().length} rules are falsifiable\n`
      : `\nFAILED: ${failures} rule(s) behaved wrongly\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const defined = definedChecks();
  const files = consumerFiles();
  const { unwired, falseReasons, suiteNames } = analyse({
    suite: SUITE,
    defined,
    files,
    readFile: readOrNull,
  });

  for (const { check, consumers } of unwired) {
    console.error(`UNWIRED: ${check.name} is not in SUITE and has no declared reason.`);
    console.error(
      consumers.length > 0
        ? `  (it IS referenced by ${consumers.join(', ')} — declare that in ALLOWED_OUTSIDE)\n`
        : '  Nothing runs it. Add it to SUITE, or delete it, or declare why it is outside.\n'
    );
  }

  for (const { entry, claimed, found } of falseReasons) {
    console.error(`FALSE REASON: ${entry.script} claims to be run by ${claimed.join(', ')}.`);
    console.error(
      found.length > 0
        ? `  Found instead: ${found.join(', ')}. Update runBy.\n`
        : '  Nothing references it. The check has stopped running — wire it or delete it.\n'
    );
  }

  const audit = auditExceptions({
    gate: 'suite-membership',
    entries: ALLOWED_OUTSIDE,
    describe: (entry) => entry.script,
    closedBy: (entry) => entry.closedBy,
    classify: (entry) => classifyEntry(entry, suiteNames, defined),
  });

  const exceptionProblems = reportExceptionAudit('suite-membership', audit);

  // THIRD RULE — every step declares what it READS, and the declaration is re-derived rather
  // than trusted. A hand-maintained annotation is the same artifact as the ✓ that E11 found:
  // true when written, unchecked afterwards. Deriving it means the only way to change what a
  // gate reads is to change the declaration with it.
  const commands = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')).scripts;
  const substrateFindings = auditSubstrate(SUITE, (script) => commands[script]);
  for (const { step, problem } of substrateFindings) {
    console.error(`SUBSTRATE: ${step} ${problem}.`);
  }
  if (substrateFindings.length > 0) console.error('');

  // The converse ledger is REPORTED, never enforced. Requiring a real analysis for all 36 would
  // buy thirty-one fabricated ones; requiring nothing makes the gap invisible. Counting it keeps
  // it an honest backlog — the same reason a bounded workflow logs what it dropped.
  const missingConverse = SUITE.filter(
    (step) => typeof step.converse !== 'string' || step.converse.length === 0
  );
  for (const step of missingConverse) {
    console.error(`CONVERSE: ${step.script} declares no converse field.`);
  }
  const unexamined = SUITE.filter((step) => step.converse === 'unexamined');

  if (
    unwired.length > 0 ||
    falseReasons.length > 0 ||
    exceptionProblems > 0 ||
    substrateFindings.length > 0 ||
    missingConverse.length > 0
  ) {
    process.exit(1);
  }

  console.log(
    `suite-membership: ${SUITE.length} step(s) declare a re-derived substrate; ` +
      `converse examined for ${SUITE.length - unexamined.length}, unexamined for ${unexamined.length}.`
  );

  console.log(
    `Every validate:*/verify: script is wired: ${suiteNames.size} in SUITE, ` +
      `${ALLOWED_OUTSIDE.length} declared outside with a verified consumer.`
  );
}

if (process.argv[1] === SCRIPT_PATH) main();
