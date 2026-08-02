#!/usr/bin/env node
/** Enforce immutable external GitHub Action refs with readable release comments. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = join(SERVER_DIR, '..');
const ACTION_ROOTS = ['.github/actions', '.github/workflows'];
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_COMMENT_PATTERN = /^v\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;
const USES_PATTERN =
  /^\s*(?:-\s*)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*(?:#\s*(\S(?:.*\S)?))?\s*$/;

function yamlFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

function validateUsesLine(line) {
  if (!/^\s*(?:-\s*)?uses:/.test(line)) return { external: false, errors: [] };
  const match = line.match(USES_PATTERN);
  if (!match) return { external: true, errors: ['malformed uses reference'] };
  const reference = match[1] ?? match[2] ?? match[3];
  const comment = match[4];
  if (reference.startsWith('./')) return { external: false, errors: [] };

  const separator = reference.lastIndexOf('@');
  const sha = separator === -1 ? '' : reference.slice(separator + 1);
  const errors = [];
  if (!SHA_PATTERN.test(sha)) errors.push('external ref must be a 40-character lowercase SHA');
  if (!comment || !VERSION_COMMENT_PATTERN.test(comment)) {
    errors.push('external ref must have a same-line release comment such as # v4.2.0');
  }
  return { external: true, errors };
}

function validateRepository(rootDir = ROOT_DIR) {
  const files = ACTION_ROOTS.flatMap((directory) => yamlFiles(join(rootDir, directory))).sort();
  const errors = [];
  let externalCount = 0;
  for (const file of files) {
    for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      const result = validateUsesLine(line);
      if (result.external) externalCount += 1;
      for (const error of result.errors) {
        errors.push(`${relative(rootDir, file)}:${index + 1}: ${error}`);
      }
    }
  }
  return { errors, externalCount, fileCount: files.length };
}

function runSelfTest() {
  const sha = 'a'.repeat(40);
  const healthy = [
    `      uses: owner/action@${sha} # v4.2.0`,
    `      uses: owner/action/subpath@${sha} # v1`,
    '      uses: ./.github/actions/local',
  ];
  const unhealthy = [
    '      uses: owner/action@v4',
    `      uses: owner/action@${sha.toUpperCase()} # v4.2.0`,
    `      uses: owner/action@${sha}`,
    `      uses: owner/action@${sha} # latest release`,
    '      uses: "unterminated',
  ];
  if (healthy.some((line) => validateUsesLine(line).errors.length > 0)) {
    throw new Error('healthy Action pin fixture failed');
  }
  if (unhealthy.some((line) => validateUsesLine(line).errors.length === 0)) {
    throw new Error('mutable or malformed Action fixture passed');
  }
  console.log('PASSED: GitHub Action pin validator self-test');
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const result = validateRepository();
  if (result.fileCount === 0) result.errors.push('no GitHub Action YAML files found');
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASSED: ${result.externalCount} external Action references pinned across ${result.fileCount} YAML files`
  );
}

main();
