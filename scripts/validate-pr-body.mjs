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

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planRowStates } from '../server/scripts/validate-plan-row-tracking.js';

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

/**
 * The plan as it stood at the merge base, or `null` when that cannot be read.
 *
 * Merge base rather than the base branch tip: rows closed on `main` after this branch forked are
 * not this PR's progress, and counting them would let a stale branch pass on someone else's work.
 *
 * `null` is NOT "no change" — it is "cannot measure", and the caller fails on it. A shallow
 * checkout (`actions/checkout` defaults to `fetch-depth: 1`) reaches this path, and a gate that
 * read an unreadable base as a silent pass would report green for exactly the configuration that
 * blinded it.
 */
function planAtMergeBase(repoRoot, relPath) {
  const baseRef = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/HEAD';
  const git = (args) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    return git(['show', `${git(['merge-base', baseRef, 'HEAD']).trim()}:${relPath}`]);
  } catch {
    return null;
  }
}

/**
 * A `Plan:` footer asserts that this PR advances the plan it names. This checks that assertion.
 *
 * WHY IT IS NO LONGER "the plan must be finalized in this PR". That was the original rule, and it
 * is satisfiable only by a plan short enough to finish in one PR. Measured 2026-09-06 on #262: the
 * plan it names is a six-phase umbrella whose open rows span a whole unbuilt resource type and a
 * four-repository rename arc, so no PR in this repo could ever retire it — the gate was red with
 * no reachable green, which `cleanup-standards.md` prices as a bug rather than a standard. The
 * defect the plan `status:` field exists for is narrower, and that plan's own preamble states it:
 * "`status:`, so "is it done" had no answer — Arc 1 was complete while 29 rows were open."
 *
 * So the guarantee splits into the two halves that are separately checkable, and BOTH are derived
 * from the diff rather than asserted by the author. There is deliberately no opt-out flag: a
 * footer marker that suppressed this check would be author-set and unfalsifiable, which retires
 * the gate instead of satisfying it.
 *
 *   PROGRESS — the PR must move at least one row from ☐ to a terminal mark. A footer on a PR that
 *   closes nothing is either pointed at the wrong plan or decorating.
 *
 *   CLOSURE — when no row is left unfinished, the plan must carry a final `status:`. This is the
 *   original guarantee, enforced at the one moment it is both meaningful and reachable: the last
 *   PR of a plan still cannot leave it open.
 *
 * WHERE IT DECLINES TO MEASURE, and why that falls back to the OLD rule rather than to a pass:
 * plans are graded through the ☐/✓/✗/⊘ vocabulary, and some tables use words instead (`RULED`,
 * `REVISED`) or carry no status column at all. When the plan has no ☐ row at the merge base there
 * is no progress to measure, so the original strict rule applies unchanged. The relaxation reaches
 * exactly the plans this vocabulary can grade, and nothing else.
 */
function checkPlanFooter(body, failures, repoRoot, readPlanAtMergeBase) {
  const match = /^Plan:\s*`?(plans\/\S+?)`?\s*$/m.exec(stripComments(body));
  if (!match) return;
  const relPath = match[1];
  const planPath = path.join(repoRoot, relPath);
  if (!existsSync(planPath)) {
    failures.push(`\`Plan:\` footer names \`${relPath}\`, which does not exist at this checkout`);
    return;
  }

  const head = readFileSync(planPath, 'utf8');
  const status = /^status:\s*(\S+)/m.exec(head)?.[1]?.toLowerCase();
  if (status === undefined) {
    failures.push(`\`Plan:\` footer names \`${relPath}\`, which declares no \`status:\``);
    return;
  }

  const mustFinalize = () =>
    failures.push(
      `\`Plan:\` footer names \`${relPath}\` with status \`${status}\` — a PR carrying a plan ` +
        'merges only once that plan is finalized (retired with every row terminal) in this same PR'
    );

  const rows = planRowStates(head);
  const unfinished = rows.filter((row) => row.state !== 'terminal');

  // No gradable row at all: nothing to measure, so the original rule stands.
  if (rows.length === 0) {
    if (NON_FINAL_STATUSES.has(status)) mustFinalize();
    return;
  }

  // CLOSURE. `unmarked` counts as unfinished on purpose — a row nobody has spoken for cannot
  // certify that a plan is complete, and reading it as terminal would demand the retirement of a
  // plan with live work in it.
  if (unfinished.length === 0) {
    if (NON_FINAL_STATUSES.has(status)) {
      failures.push(
        `\`Plan:\` footer names \`${relPath}\`, whose ${rows.length} rows are all terminal while ` +
          `\`status:\` is still \`${status}\` — the PR that closes a plan's last row retires the ` +
          'plan. Set a final `status:` in this PR.'
      );
    }
    return;
  }

  // A plan already carrying a final status has nothing left to prove here.
  if (!NON_FINAL_STATUSES.has(status)) return;

  const base = readPlanAtMergeBase(relPath);
  if (base === null) {
    failures.push(
      `\`Plan:\` footer names \`${relPath}\`, but the plan as it stood at the merge base could ` +
        'not be read, so the rows this PR closes cannot be measured. The checkout needs full ' +
        'history (`fetch-depth: 0`) and a fetched base ref.'
    );
    return;
  }

  const baseState = new Map(planRowStates(base).map((row) => [row.id, row.state]));
  if (![...baseState.values()].includes('open')) {
    mustFinalize();
    return;
  }

  // PROGRESS.
  const closed = rows.filter((row) => row.state === 'terminal' && baseState.get(row.id) === 'open');
  if (closed.length === 0) {
    failures.push(
      `\`Plan:\` footer names \`${relPath}\` with status \`${status}\` and ${unfinished.length} ` +
        'unfinished row(s), and this PR closes none of them. A plan footer asserts that this PR ' +
        'advances that plan — mark the rows it finishes terminal (✓, ✗ or ⊘), or drop the footer.'
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
  // Injected so the self-test drives the plan rules off fixtures rather than a real git history,
  // which keeps every rule in this file pure and replayable.
  const readPlanAtMergeBase =
    options.readPlanAtMergeBase ?? ((relPath) => planAtMergeBase(repoRoot, relPath));
  const sections = splitSections(body);
  const failures = [];
  checkRequiredSections(sections, failures);
  checkDemonstration(sections, title, failures);
  checkPlaceholders(body, failures);
  checkVerificationRows(sections, failures);
  checkPlanFooter(body, failures, repoRoot, readPlanAtMergeBase);
  return { failures, warnings: collectWarnings(body, sections) };
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** A minimal plan whose table carries the `St` column `planRowStates` grades. */
function fixturePlan(status, rows) {
  const body = rows.map(([id, mark]) => `| ${id} | ${mark} | change |`).join('\n');
  return `---\nstatus: ${status}\n---\n\n| Id | St | Change |\n|---|---|---|\n${body}\n`;
}

const OPEN_PAIR = [
  ['R1', '☐'],
  ['R2', '☐'],
];

/**
 * Plan fixtures as `{ [relPath]: [headText, baseText] }`; a `null` base models one that cannot be
 * read.
 *
 * Every plan rule is exercised in BOTH directions — a case where it must fire and a case where it
 * must stay silent — because a rule that only ever fires is indistinguishable from one that always
 * fires.
 */
const PLAN_FIXTURES = {
  // Rowless plans: the original rule, unchanged.
  'plans/active.md': ['---\nstatus: active\n---\n', null],
  'plans/retired.md': ['---\nstatus: reference\n---\n', null],
  // PROGRESS, in each of the three terminal marks.
  'plans/progress.md': [
    fixturePlan('active', [['R1', '✓'], ['R2', '☐']]),
    fixturePlan('active', OPEN_PAIR),
  ],
  'plans/killed.md': [
    fixturePlan('active', [['R1', '✗'], ['R2', '☐']]),
    fixturePlan('active', OPEN_PAIR),
  ],
  'plans/no-change-needed.md': [
    fixturePlan('active', [['R1', '⊘'], ['R2', '☐']]),
    fixturePlan('active', OPEN_PAIR),
  ],
  // PROGRESS, converse: nothing moved.
  'plans/stalled.md': [fixturePlan('active', OPEN_PAIR), fixturePlan('active', OPEN_PAIR)],
  // CLOSURE, both directions.
  'plans/all-terminal-active.md': [
    fixturePlan('active', [['R1', '✓'], ['R2', '⊘']]),
    fixturePlan('active', OPEN_PAIR),
  ],
  'plans/all-terminal-retired.md': [
    fixturePlan('reference', [['R1', '✓'], ['R2', '⊘']]),
    fixturePlan('active', OPEN_PAIR),
  ],
  // An unmarked row is not terminal: closure must NOT demand retirement while one survives.
  'plans/unmarked-row.md': [
    fixturePlan('active', [['R1', '✓'], ['R2', 'RULED']]),
    fixturePlan('active', [['R1', '☐'], ['R2', 'RULED']]),
  ],
  // Graded by words rather than glyphs: no ☐ at base, so the original rule applies.
  'plans/word-vocabulary.md': [
    fixturePlan('active', [['R1', 'RULED'], ['R2', 'REVISED']]),
    fixturePlan('active', [['R1', 'RULED'], ['R2', 'REVISED']]),
  ],
  // A merge base that cannot be read (a shallow checkout): must fail, never silently pass.
  'plans/unreadable-base.md': [fixturePlan('active', [['R1', '✓'], ['R2', '☐']]), null],
};

function selfTestFixtures() {
  const root = mkdtempSync(path.join(tmpdir(), 'pr-body-selftest-'));
  mkdirSync(path.join(root, 'plans'), { recursive: true });
  for (const [relPath, [head]] of Object.entries(PLAN_FIXTURES)) {
    writeFileSync(path.join(root, relPath), head);
  }
  return root;
}

/** Serves the fixture base texts; `null` models a base that cannot be read. */
function fixtureBaseReader(relPath) {
  return PLAN_FIXTURES[relPath]?.[1] ?? null;
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
      name: 'a PR that closes an open row passes though the plan stays active',
      body: `${filled}\nPlan: \`plans/progress.md\`\n`,
      title: 'feat(chains): x',
      expect: noFail,
    },
    {
      name: 'a ✗ kill closes a row',
      body: `${filled}\nPlan: \`plans/killed.md\`\n`,
      title: 'feat(chains): x',
      expect: noFail,
    },
    {
      name: 'a ⊘ no-change-required closes a row',
      body: `${filled}\nPlan: \`plans/no-change-needed.md\`\n`,
      title: 'feat(chains): x',
      expect: noFail,
    },
    {
      name: 'a footer on a plan this PR does not advance fails',
      body: `${filled}\nPlan: \`plans/stalled.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('closes none of them')),
    },
    {
      name: 'closing the last row without retiring the plan fails',
      body: `${filled}\nPlan: \`plans/all-terminal-active.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('retires the')),
    },
    {
      name: 'closing the last row and retiring the plan passes',
      body: `${filled}\nPlan: \`plans/all-terminal-retired.md\`\n`,
      title: 'feat(chains): x',
      expect: noFail,
    },
    {
      name: 'an unmarked row is unfinished, so closure does not demand retirement',
      body: `${filled}\nPlan: \`plans/unmarked-row.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => noFail(r) && !r.failures.some((f) => f.includes('retires the')),
    },
    {
      name: 'a plan graded by words keeps the original finalize-in-this-PR rule',
      body: `${filled}\nPlan: \`plans/word-vocabulary.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('finalized')),
    },
    {
      name: 'an unreadable merge base fails rather than passing silently',
      body: `${filled}\nPlan: \`plans/unreadable-base.md\`\n`,
      title: 'feat(chains): x',
      expect: (r) => r.failures.some((f) => f.includes('merge base')),
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
    const result = checkBody(c.body, c.title, {
      repoRoot: root,
      readPlanAtMergeBase: fixtureBaseReader,
    });
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
