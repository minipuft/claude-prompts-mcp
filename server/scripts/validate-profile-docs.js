#!/usr/bin/env node
/**
 * Fails when `MCP_RESOURCES_PATH` appears in user-facing documentation outside its one reference.
 *
 * Usage: `node scripts/validate-profile-docs.js` (from `server/`; registered as
 * `validate:profile-docs` in `validate:all`).
 *
 * Why. A user sets up resource locations through a profile (`cpm workspace`, the workspace
 * folder, `paths.resources`). `MCP_RESOURCES_PATH` is the escape hatch for existing setups, and
 * every guide that names it teaches a second way to do the same thing and re-opens the
 * variable's precedence rules in prose that drifts. The variable is documented once, in
 * `docs/reference/configuration.md`; everywhere else the docs describe the profile model.
 *
 * Scope (git index, as for the sibling gates): `README.md`, `server/README.md`, `cli/README.md`,
 * `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` and every tracked `docs/**\/*.md`.
 * Out of scope, on purpose: `CHANGELOG.md` (history), `plans/**`, `assets/**`, code, tests and
 * hooks, which name the variable because they read it.
 *
 * BLIND SPOT, stated as of 2026-11-16: an untracked doc is not scanned until it is staged, which
 * is when the pre-commit hook runs.
 *
 * Exit 0 when clean; exit 1 with one `file:line` per site and the fix.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNonEmptyScope, trackedFilesUnder } from './lib/tracked-scope.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const VARIABLE = 'MCP_RESOURCES_PATH';
const ALLOWED_FILE = 'docs/reference/configuration.md';
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
for (const file of files) {
  if (file === ALLOWED_FILE) continue;
  readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.includes(VARIABLE)) findings.push(`${file}:${index + 1}: ${line.trim()}`);
    });
}

if (findings.length > 0) {
  console.error(
    `❌ validate:profile-docs: ${findings.length} mention(s) of ${VARIABLE} outside ${ALLOWED_FILE}:\n` +
      findings.map((finding) => `   ${finding}`).join('\n') +
      `\n   Describe the profile model; the variable is documented once, in ${ALLOWED_FILE}.`
  );
  process.exit(1);
}

console.log(
  `✅ validate:profile-docs: ${files.length} documentation files scanned, ${VARIABLE} appears only in ${ALLOWED_FILE}`
);
