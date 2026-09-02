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
 *   FAIL  · a `___` placeholder survives outside HTML comments — the `pr:body` skeleton seeds
 *           them, so a surviving one means the body was generated and never edited. Without this
 *           rule the generator+gate pair would MINT a new theatre path: a body that passes while
 *           saying nothing (ruled 2026-09-02, blind-spot pass).
 *   FAIL  · a row of the verification table has every cell after the first empty — the skeleton's
 *           unfilled shape, same reasoning as the placeholder rule.
 *   FAIL  · a `Plan:` footer names a plan whose frontmatter `status:` is still non-final
 *           (active / backlog / proposal / draft / loaded / reserved), or names a file that does
 *           not exist at this checkout. Ruled 2026-09-02: the footer is a CONTRACT, not a
 *           pointer — a PR carrying a plan does not merge until that plan is finalized in it.
 *           The footer is also the ONLY sanctioned plan mention; row ids and plan vocabulary in
 *           the body are the session voice this whole file exists to keep out.
 *   WARN  · above-the-fold text over WORD_BUDGET words. Fenced blocks, tables, and everything
 *           inside `<details>` are NOT counted: the body is a two-register document (reader voice
 *           above the fold, collapsed archive appendix below), and the budget bounds only the
 *           part a reader must traverse. The first version counted transcripts and warned
 *           hardest on the most compliant PRs — the advisory-rot path.
 *   WARN  · `How it was verified` carries no table and no fenced block.
 *
 * It does NOT judge prose quality, and it does not read the title beyond its type — the title is
 * commitlint's job (the workflow runs commitlint on it with the repo's own config, so the two
 * cannot drift).
 *
 * ZERO DEPENDENCIES, ON PURPOSE. The workflow runs this before any install so it works on the
 * docs route, and `scripts/pr-body.mjs` imports `checkBody` so the generator and the gate share
 * one definition of "ready".
 *
 * Usage:
 *   node scripts/validate-pr-body.mjs --body-file <path> --title "<pr title>"
 *   PR_BODY="..." PR_TITLE="..." node scripts/validate-pr-body.mjs
 *   node scripts/validate-pr-body.mjs --self-test
 */

import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SECTIONS = ['Summary', 'How it was verified', 'Notes for Reviewers'];
export const DEMONSTRATION_SECTION = 'Demonstration';
export const DEMONSTRATION_TYPES = new Set(['feat', 'fix', 'perf', 'refactor']);
export const WORD_BUDGET = 400;
/** Non-final plan statuses; anything else (reference, done, complete, closed…) is final. */
export const NON_FINAL_STATUSES = new Set([
  'active',
  'backlog',
  'proposal',
  'draft',
  'loaded',
  'reserved',
]);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `type(scope)!: subject` → `type`; null when the title is not conventional. */
export function commitType(title) {
  const match = /^([a-z]+)(?:\([^)]*\))?!?:/.exec(title || '');
  return match ? match[1] : null;
}

function stripComments(text) {
  return (text || '').replace(/<!--[\s\S]*?-->/g, '');
}

/** Section name → body text, HTML comments stripped so an untouched template reads as empty. */
export function splitSections(body) {
  const sections = {};
  let current = null;
  for (const line of stripComments(body).split('\n')) {
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

/** Reader-facing words only: drop <details> archives, fenced blocks, and table rows. */
function aboveTheFoldWords(body) {
  const visible = stripComments(body)
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('|'))
    .join('\n');
  return visible.split(/\s+/).filter((w) => w.length > 0).length;
}

function checkRequiredSections(sections, failures) {
  for (const name of REQUIRED_SECTIONS) {
    if (!(name in sections)) failures.push(`missing section \`## ${name}\``);
    else if (isEmpty(sections[name])) failures.push(`section \`## ${name}\` is present but empty`);
  }
}

function checkDemonstration(sections, title, failures) {
  const type = commitType(title);
  if (type === null || !DEMONSTRATION_TYPES.has(type)) return;
  const section = sections[DEMONSTRATION_SECTION];
  if (section === undefined || isEmpty(section)) {
    failures.push(
      `\`## ${DEMONSTRATION_SECTION}\` is required for a \`${type}\` PR — show the consumer-` +
        `observable delta (transcript, mermaid, before/after table) or write \`n/a: <reason>\``
    );
  }
}

function checkPlaceholders(body, failures) {
  if (/___/.test(stripComments(body))) {
    failures.push(
      'a `___` placeholder survives — the generated skeleton was not filled in. Every `___` is a ' +
        'sentence the reader needed.'
    );
  }
}

function checkVerificationRows(sections, failures) {
  const verified = sections['How it was verified'];
  if (isEmpty(verified)) return;
  for (const line of verified.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || /^\|[\s|:-]+\|$/.test(trimmed)) continue;
    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length >= 2 && !isEmpty(cells[0]) && cells.slice(1).every(isEmpty)) {
      failures.push(
        `verification row \`${cells[0].slice(0, 60)}\` has no probe, baseline, or mutation — an ` +
          'unfilled skeleton row is a claim without evidence'
      );
    }
  }
}

function checkPlanFooter(body, failures, repoRoot) {
  const match = /^Plan:\s*`?(plans\/\S+?)`?\s*$/m.exec(stripComments(body));
  if (!match) return;
  const planPath = path.join(repoRoot, match[1]);
  if (!existsSync(planPath)) {
    failures.push(`\`Plan:\` footer names \`${match[1]}\`, which does not exist at this checkout`);
    return;
  }
  const status = /^status:\s*(\S+)/m.exec(readFileSync(planPath, 'utf8'))?.[1]?.toLowerCase();
  if (status === undefined) {
    failures.push(`\`Plan:\` footer names \`${match[1]}\`, which declares no \`status:\``);
  } else if (NON_FINAL_STATUSES.has(status)) {
    failures.push(
      `\`Plan:\` footer names \`${match[1]}\` with status \`${status}\` — a PR carrying a plan ` +
        'merges only once that plan is finalized (retired with every row terminal) in this same PR'
    );
  }
}

function collectWarnings(body, sections) {
  const warnings = [];
  const words = aboveTheFoldWords(body);
  if (words > WORD_BUDGET) {
    warnings.push(
      `above-the-fold text is ${words} words (budget ${WORD_BUDGET}; transcripts, tables and ` +
        '<details> are not counted). Move prose into the collapsed appendix or the implementation-notes.'
    );
  }
  const verified = sections['How it was verified'];
  if (!isEmpty(verified) && !/^\s*\|/m.test(verified) && !/```/.test(verified)) {
    warnings.push(
      '`## How it was verified` has no table and no fenced block — the template asks for one row ' +
        'per claim (claim · probe · baseline → measured · mutation that fails it).'
    );
  }
  return warnings;
}

/**
 * @returns {{ failures: string[], warnings: string[] }}
 */
export function checkBody(body, title, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const sections = splitSections(body);
  const failures = [];
  checkRequiredSections(sections, failures);
  checkDemonstration(sections, title, failures);
  checkPlaceholders(body, failures);
  checkVerificationRows(sections, failures);
  checkPlanFooter(body, failures, repoRoot);
  return { failures, warnings: collectWarnings(body, sections) };
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function selfTestFixtures() {
  const root = mkdtempSync(path.join(tmpdir(), 'pr-body-selftest-'));
  mkdirSync(path.join(root, 'plans'), { recursive: true });
  writeFileSync(path.join(root, 'plans', 'active.md'), '---\nstatus: active\n---\n');
  writeFileSync(path.join(root, 'plans', 'retired.md'), '---\nstatus: reference\n---\n');
  return root;
}

function selfTest() {
  const root = selfTestFixtures();
  const filled = [
    '## Summary\n\nAfter this merges, x.\n',
    '## Demonstration\n\n```\nbefore\n```\n',
    '## How it was verified\n\n| Claim | Probe |\n|---|---|\n| a | b |\n',
    '## Notes for Reviewers\n\nDistrust commit abc.\n',
  ].join('\n');
  const noFail = (r) => r.failures.length === 0;
  const cases = [
    { name: 'filled feat body passes', body: filled, title: 'feat(chains): x', expect: noFail },
    {
      name: 'untouched template reads as empty',
      body: readFileSync(path.join(REPO_ROOT, '.github', 'pull_request_template.md'), 'utf8'),
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
      expect: noFail,
    },
    {
      name: 'n/a satisfies Demonstration',
      body: filled.replace(/```\nbefore\n```/, 'n/a: config-only change'),
      title: 'fix(ci): x',
      expect: noFail,
    },
    {
      name: 'surviving ___ placeholder fails',
      body: filled.replace('After this merges, x.', 'After this merges, ___.'),
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('placeholder')),
    },
    {
      name: 'placeholder inside a comment is fine',
      body: filled.replace('After this merges, x.', 'After this merges, x. <!-- fill ___ -->'),
      title: 'feat(chains): x',
      expect: noFail,
    },
    {
      name: 'unfilled verification row fails',
      body: filled.replace('| a | b |', '| `tests/x.test.ts` |  |'),
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('verification row')),
    },
    {
      name: 'active plan footer fails',
      body: `${filled}\nPlan: \`plans/active.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('finalized')),
    },
    {
      name: 'retired plan footer passes',
      body: `${filled}\nPlan: \`plans/retired.md\`\n`,
      title: 'feat(chains): x',
      expect: noFail,
    },
    {
      name: 'dangling plan footer fails',
      body: `${filled}\nPlan: \`plans/gone.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('does not exist')),
    },
    {
      name: 'prose over budget warns, transcripts and details do not count',
      body:
        filled.replace('After this merges, x.', `${'word '.repeat(WORD_BUDGET + 1)}`) +
        `\n<details><summary>appendix</summary>\n\n${'archive '.repeat(2000)}\n</details>\n`,
      title: 'feat(chains): x',
      expect: (r) =>
        noFail(r) && r.warnings.filter((w) => w.includes('budget')).length === 1,
    },
    {
      name: 'details-only bulk stays under budget',
      body: `${filled}\n<details><summary>appendix</summary>\n\n${'archive '.repeat(2000)}\n</details>\n`,
      title: 'feat(chains): x',
      expect: (r) => noFail(r) && !r.warnings.some((w) => w.includes('budget')),
    },
    {
      name: 'prose verification warns',
      body: filled.replace(
        /\| Claim \| Probe \|\n\|---\|---\|\n\| a \| b \|/,
        'ran the suite, 2823 passed'
      ),
      title: 'feat(chains): x',
      expect: (r) => r.warnings.some((w) => w.includes('no table')),
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const result = checkBody(c.body, c.title, { repoRoot: root });
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
