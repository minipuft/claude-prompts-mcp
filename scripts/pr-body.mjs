#!/usr/bin/env node
/**
 * Assembles a PR body skeleton from the branch, so the session that did the work EDITS the
 * reader's artifact instead of authoring it from inside its own reasoning.
 *
 * WHY THIS EXISTS. Measured 2026-09-01 on #254 and #255: every downstream artifact — PR body,
 * commit bodies, CHANGELOG entry, and the 4,615-word squash-merge message GitHub concatenated
 * from 27 commit bodies — was written by the implementing session at the register of its own
 * plan notes. The template was followed; the voice was wrong. The plan and its
 * implementation-notes are already the committed home for that voice, so the fix is structural:
 * derive what is derivable (commit subjects, the plan link, open rows, the largest diffs, the
 * verify drives that changed), leave a hole where a human sentence is needed, and let the
 * validator say when the holes are still holes.
 *
 * WHAT IT DERIVES, and from where:
 *   Summary            commit subjects on the branch (one bullet each — trim, do not expand)
 *                      + a link to the plan file the diff touches, if any
 *   Demonstration      the `verify-*.mjs` drives the diff touched — capture their output
 *   How it was verified table header + one row per changed test file as a candidate claim
 *   Notes for Reviewers the three largest diffs on the branch, as distrust candidates
 *   Still open         the plan's `☐` rows, one line each
 *   README Charter     "Not applicable" unless README.md is in the diff
 *
 * The template file is the SSOT for headings and guidance: this script reads it and inserts
 * under each heading, so it cannot disagree with what the validator checks.
 *
 * ZERO DEPENDENCIES. Node builtins and git only.
 *
 * Usage (inside server/):
 *   npm run pr:body -- [--base origin/main] [--plan plans/x.md] [--out /tmp/pr-body.md]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBody } from './validate-pr-body.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(REPO_ROOT, '.github', 'pull_request_template.md');

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** Ranges are `base...HEAD` so a stale local base still measures only this branch. */
function branchFacts(base) {
  const range = `${base}...HEAD`;
  const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);
  const files = git('diff', '--name-only', range).split('\n').filter(Boolean);
  const numstat = git('diff', '--numstat', range)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, file] = line.split('\t');
      return { file, churn: Number(added) + Number(deleted) || 0 };
    })
    .sort((a, b) => b.churn - a.churn);
  return { subjects, files, numstat };
}

/** The plan is the first changed `plans/**` file that is not implementation notes. */
function detectPlan(files, explicit) {
  if (explicit) return explicit;
  return files.find((f) => f.startsWith('plans/') && f.endsWith('.md') && !f.includes('implementation-notes'));
}

/** `☐` rows of a plan's markdown tables → `id — first words`. */
function openRows(planPath) {
  if (!planPath || !existsSync(path.join(REPO_ROOT, planPath))) return [];
  const text = readFileSync(path.join(REPO_ROOT, planPath), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes('☐'))
    .map((line) => {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      return `${cells[0]} — ${(cells[1] || '').slice(0, 80)}`;
    });
}

function summary({ subjects }) {
  const lines = ['After this merges, ___.', ''];
  for (const s of subjects) lines.push(`- ${s}`);
  return lines;
}

function demonstration({ files }) {
  const drives = files.filter((f) => /verify-.*\.mjs$/.test(f));
  const lines = ['**Before**', '', '```', '___', '```', '', '**After**', '', '```', '___', '```'];
  if (drives.length > 0) {
    lines.push('', 'Capture from:', ...drives.map((d) => `- \`node ${d.replace(/^server\//, '')}\``));
  }
  return lines;
}

function verified({ files }) {
  const tests = files.filter((f) => /\.(test|spec)\.[cm]?[jt]s$/.test(f) || /^server\/scripts\/validate-/.test(f));
  const rows = tests.length > 0 ? tests : ['<claim>'];
  return [
    '| Claim | Probe | Baseline → measured | Mutation that fails it |',
    '| --- | --- | --- | --- |',
    ...rows.map((t) => `| \`${t}\` | | | |`),
  ];
}

function notes({ numstat }) {
  return numstat.slice(0, 3).map((n) => `- \`${n.file}\` (${n.churn} lines changed) — distrust because ___`);
}

function stillOpen(plan) {
  const rows = openRows(plan);
  if (rows.length === 0) return ['None'];
  return [
    '___',
    '',
    '<!-- open rows at generation time — the Plan footer gate refuses to merge until the plan is',
    '     finalized, so close or kill these in this PR:',
    ...rows.map((r) => `       ${r}`),
    '-->',
  ];
}

function readme({ files }) {
  return files.includes('README.md') ? [] : ['Not applicable'];
}

/** The collapsed archive register: Deviations excerpts from any implementation-notes in the diff. */
function appendix({ files }) {
  const notes = files.filter((f) => f.endsWith('implementation-notes.md'));
  const parts = ['<details>', '<summary>Appendix — session archive (not review material)</summary>', ''];
  for (const n of notes) {
    const notePath = path.join(REPO_ROOT, n);
    if (!existsSync(notePath)) continue;
    const deviations = /## Deviations[\s\S]*?(?=\n## |$)/.exec(readFileSync(notePath, 'utf8'));
    if (deviations) parts.push(`From \`${n}\`:`, '', deviations[0].trim(), '');
  }
  parts.push(
    '<!-- captured drive transcripts, extended verification, deviation detail — collapsed content',
    '     is exempt from the word budget and lands greppable on main via the squash body -->',
    '',
    '</details>'
  );
  return parts;
}

/** Insert derived lines under each heading, after the template's own comment block. */
function fill(template, sections) {
  const out = [];
  const lines = template.split('\n');
  let pending = null;
  let inComment = false;
  for (const line of lines) {
    out.push(line);
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading) {
      pending = sections[heading[1]] ?? null;
      continue;
    }
    if (line.includes('<!--')) inComment = !line.includes('-->');
    else if (inComment && line.includes('-->')) inComment = false;
    else continue;
    if (!inComment && pending) {
      out.push('', ...pending);
      pending = null;
    }
  }
  return out.join('\n');
}

function main() {
  const base = readArg('--base', 'origin/main');
  const facts = branchFacts(base);
  const plan = detectPlan(facts.files, readArg('--plan'));
  const body = fill(readFileSync(TEMPLATE, 'utf8'), {
    Summary: summary(facts),
    Demonstration: demonstration(facts),
    'How it was verified': verified(facts),
    'Notes for Reviewers': notes(facts),
    'Still open': stillOpen(plan),
    'README Charter Compliance': readme(facts),
  });
  const tail = [''];
  if (plan) tail.push(`Plan: \`${plan}\``, '');
  tail.push(...appendix(facts), '');
  tail.push(`<!-- derived: ${facts.subjects.length} commits · ${facts.files.length} files · base ${base} -->`);
  const result = `${body.trimEnd()}\n${tail.join('\n')}\n`;

  const out = readArg('--out');
  if (out) {
    writeFileSync(out, result);
    console.error(`wrote ${out}`);
  } else {
    process.stdout.write(result);
  }
  const { warnings } = checkBody(result, facts.subjects[0] ?? '');
  for (const w of warnings) console.error(`note: ${w}`);
  console.error('Fill every ___ and empty table cell; then: node scripts/validate-pr-body.mjs --body-file <file> --title "<title>"');
}

main();
