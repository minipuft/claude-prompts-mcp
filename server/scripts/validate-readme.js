#!/usr/bin/env node
// validate-readme.js — enforce docs/portfolio/readme-charter.md rules on README.md
// Usage: node server/scripts/validate-readme.js [--mode=block|warn] [--path=README.md]
// Exit: 0 = clean (or warn-only mode), 1 = block-mode violations, 2 = invalid args

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_README = path.join(REPO_ROOT, 'README.md');
const CHARTER_PATH = path.join(REPO_ROOT, 'docs/portfolio/readme-charter.md');

// Budgets — charter §4 (sync manually when charter changes)
const MAX_LINES = 400;
const MAX_TAGLINE_TO_QUICKSTART = 40;
const MAX_SECTION_LINES = 100;

// Voice — charter §5 (sync manually when charter changes)
const FORBIDDEN_WORDS = [
  'seamlessly',
  'revolutionary',
  'powerful',
  'robust',
  'comprehensive',
  'cutting-edge',
  'delight',
  'unleash',
  'next-generation',
  'simply',
  'just',
  'effortless',
  'magical',
];

const DIATAXIS_MARKER = /<!--\s*diataxis:\s*(tutorial|how-to|reference|explanation)\s*-->/;
const ALLOW_COMMENT = /<!--\s*charter-allow:\s*([^>]+?)\s*-->/g;
const LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;
const HEADING_H2 = /^## /;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const args = { mode: 'block', readme: DEFAULT_README };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--mode=')) args.mode = a.slice(7);
    else if (a.startsWith('--path=')) args.readme = path.resolve(a.slice(7));
  }
  return args;
}

function checkLineBudget(lines) {
  if (lines.length <= MAX_LINES) return [];
  return [
    {
      line: lines.length,
      category: 'budget',
      detail: `README is ${lines.length} lines; charter §4 budget is ${MAX_LINES}`,
    },
  ];
}

function checkFlowBudget(lines) {
  // Tagline = first bold line after the H1; Quick Start = its H2 heading (charter §4)
  const taglineIdx = lines.findIndex((l) => /^\*\*.+\*\*/.test(l));
  const quickStartIdx = lines.findIndex((l) => /^## Quick Start\b/.test(l));
  if (taglineIdx === -1 || quickStartIdx === -1) {
    return [
      {
        line: 1,
        category: 'budget',
        detail: `could not locate ${taglineIdx === -1 ? 'tagline (bold line)' : '"## Quick Start" heading'} — flow budget unmeasurable (charter §4)`,
      },
    ];
  }
  const distance = quickStartIdx - taglineIdx;
  if (distance <= MAX_TAGLINE_TO_QUICKSTART) return [];
  return [
    {
      line: quickStartIdx + 1,
      category: 'budget',
      detail: `tagline → Quick Start is ${distance} lines; charter §4 budget is ${MAX_TAGLINE_TO_QUICKSTART}`,
    },
  ];
}

function checkSectionBudgets(lines) {
  // Section = H2 heading to the next H2, minus trailing blank/separator/comment furniture (charter §4)
  const violations = [];
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_H2.test(lines[i])) headings.push(i);
  }
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h];
    let end = (h + 1 < headings.length ? headings[h + 1] : lines.length) - 1;
    while (end > start && /^(\s*|---|<!--.*-->)$/.test(lines[end])) end--;
    const length = end - start + 1;
    if (length > MAX_SECTION_LINES) {
      violations.push({
        line: start + 1,
        category: 'budget',
        detail: `section "${lines[start].slice(3).trim()}" is ${length} lines; charter §4 per-section budget is ${MAX_SECTION_LINES}`,
      });
    }
  }
  return violations;
}

function collectAllowlist(lines) {
  // <!-- charter-allow: word --> applies to the line it appears on AND the next line
  const allowed = new Set();
  for (let i = 0; i < lines.length; i++) {
    ALLOW_COMMENT.lastIndex = 0;
    let m;
    while ((m = ALLOW_COMMENT.exec(lines[i])) !== null) {
      const word = m[1].trim().toLowerCase();
      allowed.add(`${i}:${word}`);
      allowed.add(`${i + 1}:${word}`);
    }
  }
  return allowed;
}

function checkForbiddenWords(lines) {
  const allowed = collectAllowlist(lines);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    // Skip HTML comments (allowlist meta lives there)
    if (/^\s*<!--/.test(lines[i])) continue;
    for (const word of FORBIDDEN_WORDS) {
      const escaped = word.replace('-', '\\-');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(lines[i]) && !allowed.has(`${i}:${word}`)) {
        violations.push({
          line: i + 1,
          category: 'voice',
          detail: `forbidden word "${word}" (charter §5) — add <!-- charter-allow: ${word} --> on the line above if justified`,
        });
      }
    }
  }
  return violations;
}

function checkDiataxisMarkers(lines) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING_H2.test(lines[i])) continue;
    let hasMarker = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (DIATAXIS_MARKER.test(lines[j])) {
        hasMarker = true;
        break;
      }
    }
    if (!hasMarker) {
      violations.push({
        line: i + 1,
        category: 'quadrant',
        detail: `section "${lines[i].slice(3).trim()}" lacks <!-- diataxis: tutorial|how-to|reference|explanation --> within 3 lines above (charter §6)`,
      });
    }
  }
  return violations;
}

function checkReaderFacingTerminology(lines) {
  const violations = [];
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    let remaining = lines[i];
    let visible = '';

    while (remaining.length > 0) {
      if (inComment) {
        const end = remaining.indexOf('-->');
        if (end === -1) {
          remaining = '';
          continue;
        }
        remaining = remaining.slice(end + 3);
        inComment = false;
        continue;
      }

      const start = remaining.indexOf('<!--');
      if (start === -1) {
        visible += remaining;
        remaining = '';
        continue;
      }

      visible += remaining.slice(0, start);
      remaining = remaining.slice(start + 4);
      inComment = true;
    }

    if (/\bdi[aá]taxis\b/i.test(visible)) {
      violations.push({
        line: i + 1,
        category: 'terminology',
        detail:
          'Diátaxis is maintainer metadata, not reader-facing terminology (charter §6) — ' +
          'describe the reader task instead',
      });
    }
  }

  return violations;
}

function checkInternalLinks(lines, readmeDir) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    LINK_PATTERN.lastIndex = 0;
    let m;
    while ((m = LINK_PATTERN.exec(lines[i])) !== null) {
      const target = m[1];
      if (/^(https?:|mailto:|#|tel:)/.test(target)) continue;
      const cleanPath = target.split('#')[0];
      if (!cleanPath) continue;
      const resolved = path.resolve(readmeDir, cleanPath);
      if (!fs.existsSync(resolved)) {
        violations.push({
          line: i + 1,
          category: 'link',
          detail: `internal link "${target}" → ${path.relative(readmeDir, resolved)} not found`,
        });
      }
    }
  }
  return violations;
}

/**
 * Every symbolic construct the README advertises must have at least one conformance scenario.
 *
 * WHY: Tier 3a found 9 overstated README claims by hand — `%guided` threw a parse error for
 * anyone who typed it. The conformance suite makes that class mechanically detectable, but only
 * for constructs someone remembered to add. This closes the loop from the other side: documenting
 * a NEW construct without a scenario fails here, so the corpus cannot silently fall behind the
 * README.
 *
 * Scope is deliberately the CONSTRUCT, not the fenced block. Blocks are prose-shaped and
 * arbitrary — two examples of `-->` are one claim, and a per-block rule would demand duplicate
 * scenarios while still missing a construct mentioned only in a sentence.
 *
 * TWO DEFECTS FIXED 2026-08-11, both of which let advertised constructs ship unexercised:
 *
 * 1. The operator set was a hardcoded `['-->', '==>', '::']` plus `%modifiers`. It never checked
 *    `#` style, `*` repetition, `^`/`@` framework, or `>>` — so `#` (one of the FOUR primitives
 *    in the README's own table) and `*` both had ZERO scenarios while this check passed. The set
 *    now comes from operators.json, the same registry the parser loads, so a symbol cannot be
 *    advertised-and-unchecked unless it is absent from the SSOT too.
 * 2. Matching was `corpus.includes(construct)` against every byte of every corpus file, so a
 *    construct named in a YAML COMMENT satisfied it. Comments are stripped and only the `command:`
 *    values are searched — the strings a scenario actually sends to the server.
 */
function checkClaimCoverage(lines) {
  const corpusDir = path.join(__dirname, '..', 'tests', 'e2e', 'conformance');
  if (!fs.existsSync(corpusDir)) return [];

  // Only what scenarios SEND. A comment mentioning a symbol is not coverage of it.
  const commands = fs
    .readdirSync(corpusDir)
    .filter((f) => f.endsWith('.yaml'))
    .flatMap((f) =>
      fs
        .readFileSync(path.join(corpusDir, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .flatMap((l) => [...l.matchAll(/command:\s*'([^']*)'/g)].map((m) => m[1]))
    )
    .join('\n');

  // Symbols come from the registry the parser itself loads, not a list maintained here.
  const registryPath = path.join(
    __dirname,
    '..',
    'tooling',
    'contracts',
    'registries',
    'operators.json'
  );
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  // Detection runs on CODE SPANS only, and prefix operators require a following identifier.
  // `#` and `*` are also markdown heading and emphasis syntax, so bare presence matched every
  // heading in the file — the first run of this rewrite flagged `#` on the README's own H1.
  // A symbol advertised in prose but never shown in code is not a syntax claim a user can type.
  const detector = (symbol) => {
    if (/^[A-Za-z]*[-=]|:/.test(symbol) || symbol.length > 1) {
      return new RegExp(escapeRegExp(symbol));
    }
    if (symbol === '*') return /\*\s*\d/; // repetition takes a count
    return new RegExp(`${escapeRegExp(symbol)}[A-Za-z_]`); // #style, ^Framework
  };

  const symbols = registry.operators
    .filter((op) => op.status === 'implemented')
    .map((op) => op.symbol)
    .filter(Boolean);

  const codeSpans = lines.map((line) =>
    [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).join(' ')
  );
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) codeSpans[i] = lines[i];
  }

  const advertised = new Set();
  for (const code of codeSpans) {
    if (!code) continue;
    for (const m of code.matchAll(/%[a-z]+/g)) advertised.add(m[0]);
    for (const op of symbols) if (detector(op).test(code)) advertised.add(op);
  }

  const violations = [];
  for (const construct of [...advertised].sort()) {
    if (commands.includes(construct)) continue;
    // Report where the construct is ADVERTISED (a code span), not the first line containing the
    // character — `#` would otherwise always point at the README's H1.
    const detect = construct.startsWith('%')
      ? new RegExp(escapeRegExp(construct))
      : detector(construct);
    const line = Math.max(1, codeSpans.findIndex((c) => c && detect.test(c)) + 1);
    violations.push({
      line,
      category: 'claim-coverage',
      detail:
        `README advertises "${construct}" but no conformance scenario exercises it — ` +
        'add one to server/tests/e2e/conformance/ so the claim is mechanically checked ' +
        '(plan Tier 0.5)',
    });
  }
  return violations;
}

/**
 * The README's "ships N prompts across M categories" must match what npm actually packages.
 *
 * WHY: it read "120+ prompts across 17 categories" until 2026-08-11, when the tarball held 27
 * across 4. Both numbers were real — 117/17 is what sits on the AUTHOR's machine, and
 * `resources/prompts/.gitignore` whitelists four directories while no `.npmignore` exists, so npm
 * falls back to it and ships only the whitelist. A hand-maintained count cannot survive that split,
 * because the author's own checkout is the one place the inflated number looks correct.
 *
 * `git ls-files --cached --others --exclude-standard` is the same set npm resolves: tracked files
 * plus untracked ones that .gitignore does not exclude. Verified equal to `npm pack --dry-run`
 * (27 / 4) rather than assumed, and it costs a git call instead of a pack.
 */
function checkShippedPromptCount(lines) {
  const claim = lines.findIndex((l) => /ships \d+ prompts across \d+ categor/.test(l));
  if (claim === -1) return [];

  const match = lines[claim].match(/ships (\d+) prompts across (\d+) categor/);
  const claimedPrompts = Number(match[1]);
  const claimedCategories = Number(match[2]);

  let shipped;
  try {
    shipped = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'server/resources/prompts/'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );
  } catch {
    // Outside a git checkout (a published tarball, say) there is nothing to compare against, and
    // a lint that fails for lack of git would block work it cannot inform.
    return [];
  }

  const paths = shipped.split('\n').filter(Boolean);
  const actualPrompts = paths.filter((p) => p.endsWith('/prompt.yaml')).length;
  const actualCategories = new Set(
    paths
      .map((p) => p.replace('server/resources/prompts/', '').split('/')[0])
      .filter((c) => c && !c.startsWith('.'))
  ).size;

  if (actualPrompts === claimedPrompts && actualCategories === claimedCategories) return [];

  return [
    {
      line: claim + 1,
      category: 'claim-coverage',
      detail:
        `README claims ${claimedPrompts} prompts across ${claimedCategories} categories; ` +
        `the package ships ${actualPrompts} across ${actualCategories}. Update the sentence, or ` +
        'widen resources/prompts/.gitignore so the claim becomes true (plan row 0.5.20)',
    },
  ];
}

function main() {
  const { mode, readme } = parseArgs(process.argv);
  if (!['block', 'warn'].includes(mode)) {
    process.stderr.write(`Unknown mode "${mode}". Use --mode=block or --mode=warn.\n`);
    process.exit(2);
  }
  if (!fs.existsSync(readme)) {
    process.stderr.write(`README not found at ${readme}\n`);
    process.exit(1);
  }
  if (!fs.existsSync(CHARTER_PATH)) {
    process.stderr.write(`Charter not found at ${CHARTER_PATH} — required for rule definitions\n`);
    process.exit(1);
  }

  const lines = fs.readFileSync(readme, 'utf8').split('\n');
  const readmeDir = path.dirname(readme);

  const violations = [
    ...checkLineBudget(lines),
    ...checkFlowBudget(lines),
    ...checkSectionBudgets(lines),
    ...checkForbiddenWords(lines),
    ...checkDiataxisMarkers(lines),
    ...checkReaderFacingTerminology(lines),
    ...checkInternalLinks(lines, readmeDir),
    ...checkClaimCoverage(lines),
    ...checkShippedPromptCount(lines),
  ];

  if (violations.length === 0) {
    process.stdout.write(`README.md: charter checks passed (${lines.length} lines)\n`);
    process.exit(0);
  }

  for (const v of violations) {
    process.stderr.write(`README.md:${v.line}: ${v.category}: ${v.detail}\n`);
  }
  process.stderr.write(`\n${violations.length} charter violation(s) found (mode=${mode})\n`);
  process.stderr.write(`Charter: docs/portfolio/readme-charter.md\n`);

  if (mode === 'warn') {
    process.stderr.write('Warn-only mode — exit 0\n');
    process.exit(0);
  }
  process.exit(1);
}

main();
