#!/usr/bin/env node
// validate-conformance-coverage.js — every bundled framework must have a claims-conformance scenario
// Usage: node server/scripts/validate-conformance-coverage.js [--self-test]
// Exit: 0 = every declared framework is exercised, 1 = one or more are not, 2 = invalid args
//
// WHY THIS EXISTS
// Plan row 0.5.14 found all 8 bundled frameworks already had scenarios — and that coverage was
// held entirely by hand. Nothing failed when a framework shipped without one, so a 9th directory
// under `resources/frameworks/` would have gone out unexercised and silently. The corpus can only
// ever see the BUNDLED set: a user's own frameworks live in the operator-local tree that CI never
// checks out, so "declared" here means the git-tracked directories and nothing else.
//
// This is the same shape as validate-readme.js's claim-coverage check — a declared surface
// cross-checked against the corpus that is supposed to exercise it — and it is deliberately narrow:
// it asserts a scenario EXISTS naming the framework, not that the scenario is any good. Falsifying
// what each scenario observes is the corpus's own job (`known_divergence`, error_contains).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const FRAMEWORKS_DIR = path.join(SERVER_ROOT, 'resources', 'frameworks');
const CORPUS_DIR = path.join(SERVER_ROOT, 'tests', 'e2e', 'conformance');

/** Framework ids the server ships, taken from the directory names it loads them from. */
function declaredFrameworks(dir = FRAMEWORKS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Corpus text with COMMENTS STRIPPED.
 *
 * A framework named only in a `#` comment is documentation, not coverage. validate-readme.js hit
 * exactly this: matching raw file text let a symbol mentioned in a YAML comment count as an
 * exercised claim, so the check passed while the claim went untested.
 */
function corpusCommandText(dir = CORPUS_DIR) {
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
}

/**
 * Is this framework exercised anywhere in the corpus?
 *
 * Matched case-insensitively because the symbolic form is `^cageerf` while the directory is
 * `cageerf` and prose uses `CAGEERF`. Word-bounded so `react` does not match `reactivity`.
 */
function isExercised(framework, text) {
  return new RegExp(`\\b${framework.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function findUncovered(frameworks, text) {
  return frameworks.filter((f) => !isExercised(f, text));
}

function selfTest() {
  const cases = [
    { name: 'covered framework passes', fw: ['cageerf'], text: 'command: ^cageerf >>x', want: 0 },
    { name: 'missing framework fails', fw: ['newthing'], text: 'command: ^cageerf >>x', want: 1 },
    {
      name: 'comment-only mention does NOT count',
      fw: ['newthing'],
      text: '# newthing is planned\ncommand: ^cageerf >>x',
      want: 1,
    },
    {
      name: 'substring does not count as coverage',
      fw: ['react'],
      text: 'command: >>x reactivity:true',
      want: 1,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const stripped = c.text
      .split('\n')
      .map((l) => l.replace(/#.*$/, ''))
      .join('\n');
    const got = findUncovered(c.fw, stripped).length;
    const ok = got === c.want;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${c.name} (expected ${c.want} uncovered, got ${got})`);
  }
  if (failed > 0) {
    console.error(`\n✗ self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ self-test: all cases passed');
  process.exit(0);
}

const argv = process.argv.slice(2);
for (const a of argv) {
  if (a !== '--self-test') {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}
if (argv.includes('--self-test')) selfTest();

const frameworks = declaredFrameworks();
if (frameworks.length === 0) {
  console.error(`✗ no frameworks found under ${path.relative(SERVER_ROOT, FRAMEWORKS_DIR)}`);
  process.exit(1);
}

const uncovered = findUncovered(frameworks, corpusCommandText());

if (uncovered.length > 0) {
  console.error('✗ bundled frameworks with no claims-conformance scenario:\n');
  for (const f of uncovered) {
    console.error(`  ${f}  — add a scenario to ${path.relative(SERVER_ROOT, CORPUS_DIR)}/`);
  }
  console.error(
    `\n${uncovered.length} of ${frameworks.length} bundled frameworks ship unexercised.\n` +
      'A framework users receive but no scenario runs is a claim nothing verifies.'
  );
  process.exit(1);
}

console.log(
  `✓ conformance coverage: all ${frameworks.length} bundled frameworks exercised ` +
    `(${frameworks.join(', ')})`
);
