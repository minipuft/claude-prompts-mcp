#!/usr/bin/env node
// validate-readme.js — enforce docs/portfolio/readme-charter.md rules on README.md
// Usage: node server/scripts/validate-readme.js [--mode=block|warn] [--path=README.md]
// Exit: 0 = clean (or warn-only mode), 1 = block-mode violations, 2 = invalid args

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_README = path.join(REPO_ROOT, 'README.md');
const CHARTER_PATH = path.join(REPO_ROOT, 'docs/portfolio/readme-charter.md');

// Budgets — charter §4 (sync manually when charter changes)
const MAX_LINES = 400;

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
    ...checkForbiddenWords(lines),
    ...checkDiataxisMarkers(lines),
    ...checkInternalLinks(lines, readmeDir),
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
