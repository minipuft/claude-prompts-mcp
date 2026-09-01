#!/usr/bin/env node
/**
 * Checks that a pull-request body was written FOR A READER, not just written.
 *
 * WHY THIS EXISTS. The template has been enforced since #250 (2026-08-28): three sections must
 * exist and be non-empty. Both #254 and #255 complied, and both were still unreadable at a glance —
 * 651 and 866 words, Summary bullets packing four facts each in plan-internal vocabulary, a
 * verification section that was a wall of test counts with no baseline, and no demonstration of a
 * feature that shipped a state machine. Presence is not the property; the property is that a
 * reader who was not in the session can see what changed. This script measures the parts of that
 * a machine can measure, and no more.
 *
 * WHAT IT MEASURES, stated exactly:
 *   FAIL  · `Summary`, `How it was verified`, `Notes for Reviewers` exist and are non-empty once
 *           HTML comments are stripped (unchanged from the workflow's inline check it replaces).
 *   FAIL  · `Demonstration` exists and is non-empty when the title's conventional-commit type is
 *           feat / fix / perf / refactor. `n/a: <reason>` satisfies it — the point is that the
 *           author DECIDED, not that every PR carries a diagram.
 *   WARN  · body over WORD_BUDGET words. Length is a signal, not the test; a long body that is
 *           all tables and transcripts is fine, and the warning says so.
 *   WARN  · `How it was verified` carries no table and no fenced block — prose counts are the
 *           shape the template forbids, but a probe listed as prose can still be a real probe.
 *
 * It does NOT judge prose quality, and it does not read the title beyond its type — the title is
 * commitlint's job (the workflow runs commitlint on it with the repo's own config, so the two
 * cannot drift).
 *
 * ZERO DEPENDENCIES, ON PURPOSE. The workflow runs this before any install so it works on the
 * docs route, and `scripts/pr-body.mjs` imports `checkBody` so the generator and the gate share one
 * definition of "ready".
 *
 * Usage:
 *   node scripts/validate-pr-body.mjs --body-file <path> --title "<pr title>"
 *   PR_BODY="..." PR_TITLE="..." node scripts/validate-pr-body.mjs
 *   node scripts/validate-pr-body.mjs --self-test
 */

import { readFileSync } from 'node:fs';

export const REQUIRED_SECTIONS = ['Summary', 'How it was verified', 'Notes for Reviewers'];
export const DEMONSTRATION_SECTION = 'Demonstration';
export const DEMONSTRATION_TYPES = new Set(['feat', 'fix', 'perf', 'refactor']);
export const WORD_BUDGET = 400;

/** `type(scope)!: subject` → `type`; null when the title is not conventional. */
export function commitType(title) {
  const match = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(title || '');
  return match ? match[1] : null;
}

/** Section name → body text, HTML comments stripped so an untouched template reads as empty. */
export function splitSections(body) {
  const stripped = (body || '').replace(/<!--[\s\S]*?-->/g, '');
  const sections = {};
  let current = null;
  for (const line of stripped.split('\n')) {
    const heading = /^#{2,3}\s+(.*?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sections[current] = '';
    } else if (current !== null) {
      sections[current] += `${line}\n`;
    }
  }
  return sections;
}

function isEmpty(text) {
  return text === undefined || text.trim().length === 0;
}

/**
 * @returns {{ failures: string[], warnings: string[] }}
 */
export function checkBody(body, title) {
  const sections = splitSections(body);
  const failures = [];
  const warnings = [];

  for (const name of REQUIRED_SECTIONS) {
    if (!(name in sections)) failures.push(`missing section \`## ${name}\``);
    else if (isEmpty(sections[name])) failures.push(`section \`## ${name}\` is present but empty`);
  }

  const type = commitType(title);
  if (type !== null && DEMONSTRATION_TYPES.has(type)) {
    if (!(DEMONSTRATION_SECTION in sections)) {
      failures.push(
        `\`## ${DEMONSTRATION_SECTION}\` is required for a \`${type}\` PR — show the change ` +
          `(transcript, mermaid, before/after table) or write \`n/a: <reason>\``
      );
    } else if (isEmpty(sections[DEMONSTRATION_SECTION])) {
      failures.push(
        `\`## ${DEMONSTRATION_SECTION}\` is empty on a \`${type}\` PR — show the change or write \`n/a: <reason>\``
      );
    }
  }

  const words = Object.values(sections)
    .join('\n')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  if (words > WORD_BUDGET) {
    warnings.push(
      `body is ${words} words (budget ${WORD_BUDGET}). Fine if it is tables and transcripts; ` +
        `if it is prose, the session-voice parts belong in the plan's implementation-notes, linked.`
    );
  }

  const verified = sections['How it was verified'];
  if (!isEmpty(verified) && !/^\s*\|/m.test(verified) && !/```/.test(verified)) {
    warnings.push(
      '`## How it was verified` has no table and no fenced block — the template asks for one row ' +
        'per claim (claim · probe · baseline → measured · mutation that fails it).'
    );
  }

  return { failures, warnings };
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function selfTest() {
  const filled = [
    '## Summary\n\nAfter this merges, x.\n',
    '## Demonstration\n\n```\nbefore\n```\n',
    '## How it was verified\n\n| Claim | Probe |\n|---|---|\n| a | b |\n',
    '## Notes for Reviewers\n\nDistrust commit abc.\n',
  ].join('\n');
  const cases = [
    {
      name: 'filled feat body passes',
      body: filled,
      title: 'feat(chains): x',
      expect: (r) => r.failures.length === 0,
    },
    {
      name: 'untouched template reads as empty',
      body: readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8'),
      title: 'feat(chains): x',
      expect: (r) => r.failures.length >= REQUIRED_SECTIONS.length,
    },
    {
      name: 'feat without Demonstration fails',
      body: filled.replace(/## Demonstration[\s\S]*?(?=## How)/, ''),
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('Demonstration')),
    },
    {
      name: 'docs without Demonstration passes',
      body: filled.replace(/## Demonstration[\s\S]*?(?=## How)/, ''),
      title: 'docs(docs): x',
      expect: (r) => r.failures.length === 0,
    },
    {
      name: 'n/a satisfies Demonstration',
      body: filled.replace(/```\nbefore\n```/, 'n/a: config-only change'),
      title: 'fix(ci): x',
      expect: (r) => r.failures.length === 0,
    },
    {
      name: 'over-budget body warns, does not fail',
      body: filled.replace('After this merges, x.', 'word '.repeat(WORD_BUDGET + 1)),
      title: 'feat(chains): x',
      expect: (r) => r.failures.length === 0 && r.warnings.some((w) => w.includes('budget')),
    },
    {
      name: 'prose verification warns',
      body: filled.replace(/\| Claim \| Probe \|\n\|---\|---\|\n\| a \| b \|/, 'ran the suite, 2823 passed'),
      title: 'feat(chains): x',
      expect: (r) => r.warnings.some((w) => w.includes('no table')),
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const result = checkBody(c.body, c.title);
    const ok = c.expect(result);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!ok) {
      failed += 1;
      console.log(`      ${JSON.stringify(result)}`);
    }
  }
  return failed === 0;
}

function main() {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest() ? 0 : 1);
  }
  const bodyFile = readArg('--body-file');
  const body = bodyFile ? readFileSync(bodyFile, 'utf8') : (process.env.PR_BODY ?? '');
  const title = readArg('--title') ?? process.env.PR_TITLE ?? '';
  const { failures, warnings } = checkBody(body, title);
  const ci = process.env.GITHUB_ACTIONS === 'true';

  for (const w of warnings) console.log(ci ? `::warning::${w}` : `warning: ${w}`);
  for (const f of failures) console.log(ci ? `::error::${f}` : `error: ${f}`);

  if (failures.length > 0) {
    console.log(
      `\nPR body does not follow .github/pull_request_template.md.` +
        `\nNote: \`gh pr create --body\` bypasses the template. Generate one: npm run pr:body -- --out /tmp/pr-body.md`
    );
    process.exit(1);
  }
  console.log(
    `PR body: ${REQUIRED_SECTIONS.length} required sections present, ` +
      `${warnings.length === 0 ? 'no warnings' : `${warnings.length} warning(s)`}.`
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
