#!/usr/bin/env node
/**
 * handoff-artifacts check
 *
 * Reads a worker handoff on stdin, finds the `artifacts:` line under the `done`
 * heading, and verifies every path it names exists relative to the process CWD.
 *
 * Exit 0 — every named path exists (one `ok <path>` line each on stdout).
 * Exit 1 — no artifacts line, an empty one, or at least one missing path.
 *
 * Plain Node, ESM, no dependencies: the gate executor spawns this with `node`
 * from the server root, where nothing has been installed for it.
 *
 * Never throws. Every failure is one line on stderr starting `handoff-artifacts:`.
 */
import fs from 'fs';
import path from 'path';

/** A `done` heading: `done`, `**done**`, `## done`, with or without a trailing dash/colon. */
const DONE_INLINE = /^\s*(\*\*)?done(\*\*)?\s*[—:-]?/i;
const DONE_HEADING = /^\s*#{1,6}\s+.*\bdone\b/i;
/** Any of the other four handoff headings — they end the `done` section. */
const OTHER_HEADING =
  /^\s*(#{1,6}\s+)?(\*\*)?(concerns|deviations|findings|feedback)(\*\*)?\s*[—:-]?/i;
/**
 * The `artifacts:` line. The `done` prefix is optional because the handoff puts the list on
 * the heading line itself (`done — artifacts: a.ts`), and on its own line when it is long.
 */
const ARTIFACTS_LINE =
  /^\s*(?:#{1,6}\s+|[-*]\s+)?(?:(?:\*\*)?done(?:\*\*)?\s*[—:-]\s*)?(?:\*\*)?artifacts(?:\*\*)?:\s*(.*)$/i;
const BULLET_LINE = /^\s*[-*]\s+(.*)$/;
/** A `key: value` line that is not a bullet — ends a bullet run. */
const KEY_LINE = /^\s*(?:\*\*)?[A-Za-z][\w -]*(?:\*\*)?:\s/;

function fail(message) {
  process.stderr.write(`handoff-artifacts: ${message}\n`);
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', () => resolve(''));
  });
}

/** Lines of the `done` section: from the `done` heading to the next handoff heading. */
function doneSection(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (DONE_HEADING.test(line) || DONE_INLINE.test(line)) {
      start = i;
      break;
    }
  }
  if (start === -1) return [];

  const section = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (i > start && OTHER_HEADING.test(line)) break;
    section.push(line);
  }
  return section;
}

/** Split an `artifacts:` value on commas and whitespace; strip backticks and trailing punctuation. */
function splitPaths(value) {
  return value
    .split(/[,\s]+/)
    .map((token) => token.replace(/`/g, '').trim())
    .map((token) => token.replace(/[.;]+$/, ''))
    .filter((token) => token.length > 0);
}

/** The `artifacts:` value plus any `- path` bullets that follow it. */
function collectArtifacts(section) {
  for (let i = 0; i < section.length; i += 1) {
    const match = ARTIFACTS_LINE.exec(section[i] ?? '');
    if (match === null) continue;

    const paths = splitPaths(match[1] ?? '');
    for (let j = i + 1; j < section.length; j += 1) {
      const line = section[j] ?? '';
      if (line.trim() === '') break;
      const bullet = BULLET_LINE.exec(line);
      if (bullet === null) {
        if (KEY_LINE.test(line)) break;
        continue;
      }
      if (KEY_LINE.test(bullet[1] ?? '')) break;
      paths.push(...splitPaths(bullet[1] ?? ''));
    }
    return paths;
  }
  return null;
}

function artifactExists(candidate) {
  return fs.existsSync(path.resolve(process.cwd(), candidate));
}

async function main() {
  const input = await readStdin();
  const section = doneSection(input.split(/\r?\n/));
  const paths = collectArtifacts(section);

  if (paths === null || paths.length === 0) {
    fail('no artifacts: line under done');
    return;
  }

  const missing = [];
  for (const candidate of paths) {
    if (artifactExists(candidate)) {
      process.stdout.write(`ok ${candidate}\n`);
    } else {
      process.stdout.write(`missing ${candidate}\n`);
      missing.push(candidate);
    }
  }

  if (missing.length > 0) {
    fail(`not found where the check ran: ${missing.join(', ')}`);
    return;
  }
  process.exit(0);
}

main().catch((error) => {
  fail(`could not read the handoff (${error?.message ?? 'unknown error'})`);
});
