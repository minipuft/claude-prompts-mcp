#!/usr/bin/env node

/**
 * Asserts every npm script CONTRIBUTING.md names actually exists.
 *
 * WHY THIS EXISTS
 * CONTRIBUTING is prose describing an executable system, and it was the only contributor-facing
 * contract here with no gate behind it. Comparable contracts each have one: validate:suite-membership
 * for script membership, validate:standards-pins for version agreement, validate:readme for README
 * structure, validate:documented-options for option coverage. Nothing read CONTRIBUTING, so four dead
 * commands accumulated at four different times and none was caught: `start:sse` (removed with HTTP+SSE
 * in the SDK v2 upgrade), `format`, `format:fix`, and `test:jest`.
 *
 * `start:sse` was not a cosmetic rot. It sat on the Decision Matrix row a contributor reads when
 * changing transport behavior, and PR #204 changed transport behavior. The contributor smoke-tested
 * STDIO only, because the other transport the row named did not exist. The bug was on both.
 *
 * ZERO DEPENDENCIES, ON PURPOSE
 * `CONTRIBUTING.md` classifies as `docs` scope (scripts/classify-validation-scope.js), and ci.yml
 * guards "Setup Node.js" on `scope != 'docs'` and "Install dependencies" on `scope == 'full'`. There
 * is no node_modules on the docs route. A validator that imported anything would be unrunnable on
 * exactly the pull requests that edit CONTRIBUTING, which is the only time it matters. Node builtins
 * only. Keep it that way.
 *
 * DECLARED BLIND SPOT
 * This checks that named commands EXIST. It does not check that a documented gate SEQUENCE matches
 * scripts/run-validation-suite.js. That needs a parse of prose intent and would produce false
 * positives on legitimate phrasing. A sequence drifting while every command still exists is not
 * caught here. Recorded rather than silently absent, per the convention in validate-table-contracts.js.
 *
 * Exit 0 when every named command exists; exit 1 naming each one that does not.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SERVER_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const CONTRIBUTING = path.join(REPO_ROOT, 'CONTRIBUTING.md');
const PACKAGE_JSON = path.join(SERVER_ROOT, 'package.json');

/**
 * Node builtin module specifiers look exactly like `namespace:script`.
 *
 * `node:sqlite` is cited in CONTRIBUTING for the Node floor and is not a command. Matching on shape
 * alone reports it as a dead script, so the prefix is excluded by name rather than by guessing.
 */
const NON_SCRIPT_PREFIXES = ['node:', 'http:', 'https:', 'file:', 'npm:'];

/**
 * A bare backticked token that is a plausible script name.
 *
 * NO PREFIX ALLOWLIST. The first audit pass used one (`start|test|validate|typecheck|lint|build`)
 * and missed `format:fix` outright, because the allowlist encoded the namespaces that happened to be
 * known at the time. Any lowercase colon-joined token qualifies; false positives are removed by the
 * builtin-prefix rule above, not by predicting namespaces.
 */
const SCRIPT_SHAPE = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)+$/;

/** Every `npm run <script>` occurrence, with its 1-indexed line. */
function extractNpmRunRefs(lines) {
  const found = [];
  lines.forEach((text, index) => {
    for (const match of text.matchAll(/npm run ([a-z][a-z0-9:._-]*)/g)) {
      found.push({ command: match[1], line: index + 1, form: 'npm run' });
    }
  });
  return found;
}

/**
 * Bare backticked script names, e.g. the `start:development` in
 * "`npm run start:stdio` / `start:development`".
 *
 * This form is why the check exists in this shape: `start:sse` was written bare, so an `npm run`
 * regex alone does not see the motivating instance.
 */
function extractBareRefs(lines) {
  const found = [];
  lines.forEach((text, index) => {
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim();
      if (NON_SCRIPT_PREFIXES.some((prefix) => token.startsWith(prefix))) continue;
      if (!SCRIPT_SHAPE.test(token)) continue;
      found.push({ command: token, line: index + 1, form: 'bare' });
    }
  });
  return found;
}

function collectReferences(markdown) {
  const lines = markdown.split('\n');
  return [...extractNpmRunRefs(lines), ...extractBareRefs(lines)];
}

/** Referenced commands with no matching entry in package.json scripts. */
function findDeadCommands(markdown, scripts) {
  const known = new Set(Object.keys(scripts));
  const seen = new Set();
  const dead = [];
  for (const ref of collectReferences(markdown)) {
    if (known.has(ref.command)) continue;
    const key = `${ref.command}:${ref.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dead.push(ref);
  }
  return dead;
}

/**
 * Counterexamples, asserted rather than assumed.
 *
 * The first is the exact 4.0.0-era text. A gate that cannot fail on the drift that motivated it is
 * not evidence of anything.
 */
function runSelfTest() {
  const scripts = { 'start:stdio': '', 'start:development': '', test: '', 'validate:format': '' };
  const cases = [
    {
      label: 'rejects the motivating instance (bare start:sse)',
      markdown: '| `npm run start:stdio` / `start:sse` | Launch transports |',
      expectDead: ['start:sse'],
    },
    {
      label: 'rejects an `npm run` form',
      markdown: 'Run `npm run format` before committing.',
      expectDead: ['format'],
    },
    {
      label: 'rejects a namespace no allowlist would have predicted',
      markdown: 'Run `format:fix` to autoformat.',
      expectDead: ['format:fix'],
    },
    {
      label: 'accepts commands that exist, in both forms',
      markdown: '`npm run start:stdio` / `start:development` and `npm run validate:format`',
      expectDead: [],
    },
    {
      label: 'does not report a node builtin as a dead script',
      markdown: 'The floor is where `node:sqlite` needs no flag.',
      expectDead: [],
    },
  ];

  let failures = 0;
  console.log('\nvalidate:contributing self-test\n');
  for (const testCase of cases) {
    const dead = findDeadCommands(testCase.markdown, scripts).map((entry) => entry.command);
    const ok =
      dead.length === testCase.expectDead.length &&
      testCase.expectDead.every((command) => dead.includes(command));
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${testCase.label}${ok ? '' : ` — got [${dead.join(', ')}]`}`
    );
    if (!ok) failures += 1;
  }
  console.log(
    failures === 0
      ? `\nOK: all ${cases.length} self-test cases behave as specified\n`
      : `\nFAILED: ${failures} self-test case(s)\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const markdown = readFileSync(CONTRIBUTING, 'utf8');
  const { scripts } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const dead = findDeadCommands(markdown, scripts);
  const total = collectReferences(markdown).length;

  if (dead.length === 0) {
    console.log(
      `[validate-contributing] OK: ${total} command reference(s) in CONTRIBUTING.md all exist`
    );
    process.exit(0);
  }

  console.error(
    `[validate-contributing] FAIL: ${dead.length} command(s) named by CONTRIBUTING.md do not exist\n`
  );
  for (const entry of dead) {
    console.error(`  CONTRIBUTING.md:${entry.line}  ${entry.command}  (${entry.form} form)`);
  }
  console.error('\nEither add the script to server/package.json or correct CONTRIBUTING.md.');
  process.exit(1);
}

main();
