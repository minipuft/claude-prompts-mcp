#!/usr/bin/env node
/**
 * Fails when `MCP_RESOURCES_PATH` appears in user-facing documentation outside its one refusal row.
 *
 * Usage: `node scripts/validate-profile-docs.js` (from `server/`; registered as
 * `validate:profile-docs` in `validate:all`).
 *
 * Why. A user sets up resource locations through a profile (`cpm workspace`, `MCP_WORKSPACE`,
 * `paths.resources`). The server no longer reads `MCP_RESOURCES_PATH`: a set value refuses startup
 * naming the replacement. Every other page that names it would teach a second way to do the same
 * thing, so the variable survives in the docs as exactly one LINE, not a file: the refusal-table
 * row in `docs/reference/configuration.md`. The same file may carry no other mention.
 *
 * The allowed line is matched by content, not position: it must name the variable together with
 * "no longer read" or "Refuses to start". A second such row, or any other line naming the variable
 * (a `converse`-style aside, an example, a table cell elsewhere), is a finding.
 *
 * Scope (git index, as for the sibling gates): `README.md`, `server/README.md`, `cli/README.md`,
 * `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` and every tracked `docs/**\/*.md`.
 * Out of scope, on purpose: `CHANGELOG.md` (history), `plans/**`, `assets/**`, code, tests and
 * hooks, which name the variable because they refuse it.
 *
 * BLIND SPOT, stated as of 2026-11-16: an untracked doc is not scanned until it is staged, which
 * is when the pre-commit hook runs.
 *
 * Exit 0 when exactly one allowed row exists and nothing else names the variable; exit 1 with one
 * `file:line` per site and the fix.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNonEmptyScope, trackedFilesUnder } from './lib/tracked-scope.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const VARIABLE = 'MCP_RESOURCES_PATH';
const ALLOWED_FILE = 'docs/reference/configuration.md';
const ALLOWED_ROW = /no longer read|Refuses to start/;
const ROOT_FILES = [
  'README.md',
  'server/README.md',
  'cli/README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
];
const SCOPE = [...ROOT_FILES, 'docs'];

const files = trackedFilesUnder(SCOPE, { cwd: REPO_ROOT }).filter(
  (file) => ROOT_FILES.includes(file) || (file.startsWith('docs/') && file.endsWith('.md'))
);
assertNonEmptyScope(files, SCOPE, 'validate:profile-docs');

const findings = [];
const allowedRows = [];
for (const file of files) {
  readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (!line.includes(VARIABLE)) return;
      const site = `${file}:${index + 1}`;
      if (file === ALLOWED_FILE && line.trimStart().startsWith('|') && ALLOWED_ROW.test(line)) {
        allowedRows.push(site);
      } else {
        findings.push(`${site}: ${line.trim()}`);
      }
    });
}
if (allowedRows.length !== 1) {
  findings.push(
    `${ALLOWED_FILE}: expected exactly one refusal-table row naming ${VARIABLE} ("no longer read" or "Refuses to start"), found ${allowedRows.length}`
  );
}

if (findings.length > 0) {
  console.error(
    `❌ validate:profile-docs: ${findings.length} problem(s) with ${VARIABLE} in the documentation:\n` +
      findings.map((finding) => `   ${finding}`).join('\n') +
      `\n   The variable is refused at startup and appears once: the refusal-table row in ${ALLOWED_FILE}. Describe the profile model everywhere else.`
  );
  process.exit(1);
}

console.log(
  `✅ validate:profile-docs: ${files.length} documentation files scanned, ${VARIABLE} appears only in the one refusal row (${allowedRows[0]})`
);
