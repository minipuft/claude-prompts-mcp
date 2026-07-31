#!/usr/bin/env node

/**
 * Fails when the docs name a CLI flag the parsers do not parse, or an `MCP_*` env var nothing
 * reads.
 *
 * This defect class recurred three times in one session and the first fix for it was itself
 * incomplete — the README tables were corrected while a config example, a command example and a
 * troubleshooting line still told users to use dead options. A fourth instance was then found in
 * the very sentence written to close it: "The full parsed set is ..." listed 13 of 17 flags.
 * Nothing in typecheck, lint or the test suite compares docs against the parser, so the only way
 * this stops recurring is a check that does.
 *
 * Ground truth is read from source at run time, never from a hardcoded list — a guard carrying
 * its own copy of the flag set would drift exactly like the docs did:
 *   - flags: the `options: { ... }` tables in server/src/runtime/cli.ts and cli/src/cli.ts
 *   - env vars: every `process.env['MCP_*']` read anywhere in server/src or cli/src
 *
 * Exit 0 when every documented option is backed by source; exit 1 with the offending lines.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);

/** Docs that describe THIS project's interface. */
const DOC_PATHS = ['docs', 'README.md', 'server/README.md', 'CONTRIBUTING.md', 'cli/README.md'];

/** Parsers whose `options:` table defines the real flag set. */
const PARSER_FILES = ['server/src/runtime/cli.ts', 'cli/src/cli.ts'];

/**
 * Documented tokens that are not this project's options and never will be.
 *
 * Each entry says why. RETIREMENT: an entry stops being needed when the doc line that produced it
 * changes — none of these describe our own surface, so most are permanent by nature.
 */
const NOT_OUR_OPTIONS = new Set([
  // Third-party CLIs quoted in examples.
  '--fix', // eslint --fix
  '--write', // prettier --write
  '--access', // npm publish --access public
  '--tags', // git push --tags
  '--title', // gh release create
  '--notes', // gh release create
  '--plugin-dir', // claude --plugin-dir
  '--print', // claude --print
  '--strict', // npm run validate:identity-backfill -- --strict
  '--mode', // npm run validate:readme --mode=block
  '--test', // truncation of jest's --testPathPattern
  // Generic placeholder in "All flags accept both `--flag=value` and `--flag value`".
  '--flag',
  '--type', // ripgrep's --type, quoted in an ADR's caller-search note
]);

/** Read a file relative to the repo root, empty string when absent. */
function read(relPath) {
  try {
    return readFileSync(path.join(REPO, relPath), 'utf8');
  } catch {
    return '';
  }
}

/** Extract the long-flag names declared in a `parseArgs` options table. */
function parsedFlagsFrom(relPath) {
  const source = read(relPath);
  const flags = new Set();
  for (const match of source.matchAll(/^\s*'?([a-zA-Z][a-zA-Z0-9-]*)'?\s*:\s*\{\s*type:/gm)) {
    flags.add(`--${match[1]}`);
  }
  return flags;
}

/** Every `MCP_*` env var actually read by the shipped code. */
function readEnvVars() {
  const output = runRg([
    '-o',
    '--no-filename',
    'process\\.env\\[?[\'"]?(MCP_[A-Z_]+)',
    '-r',
    '$1',
    'server/src',
    'cli/src',
  ]);
  return new Set(output.split('\n').filter(Boolean));
}

/**
 * Run ripgrep from the repo root; empty string when nothing matched.
 *
 * Uses execFileSync rather than a shell string: the patterns contain quote characters, which a
 * shell would mangle (this check's first run died on exactly that).
 */
function runRg(args) {
  try {
    return execFileSync('rg', args, {
      encoding: 'utf8',
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
}

/**
 * Documented mentions as `file:line:text` rows.
 *
 * Markdown link anchors (`](#some--anchor`) are excluded at the source: a heading containing an
 * en-dash renders as `--` inside its anchor, which looks exactly like a flag.
 */
function documentedMentions(pattern) {
  // `-e` is required: a pattern starting with `--` is otherwise read as a ripgrep flag.
  return runRg(['-n', '--no-heading', '-e', pattern, ...DOC_PATHS])
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/** Split `file:line:text` without cutting colons inside the text. */
function textOf(hitLine) {
  const firstColon = hitLine.indexOf(':');
  const secondColon = hitLine.indexOf(':', firstColon + 1);
  return hitLine.slice(secondColon + 1);
}

/**
 * Every distinct token on the line, not just the first.
 *
 * A single line often names several options ("`--prompts`, `--gates`, `--frameworks`"); checking
 * only the first would let the rest through, which is the same partial-fix shape this guard
 * exists to catch.
 */
function tokensOf(text, pattern) {
  return [...new Set(text.match(pattern) ?? [])];
}

/**
 * Phrases that mark a line as documenting an option's REMOVAL rather than offering it.
 *
 * Tier 6 policy is to name each removed option in place so a user who copied it from an older
 * revision can tell what happened. Those mentions are the fix, not the defect.
 */
const REMOVAL_NOTE =
  /\b(not read|read nowhere|parsed nowhere|were documented|there is no|former|no longer|removed)\b/i;

/**
 * True when the mention sits inside a removal note.
 *
 * Checks a +/-1 line window because these notes wrap: in server/README.md the tokens are on one
 * line and "were documented here but are not read" lands on the next. A single-line test passed
 * the first draft of this guard and flagged six correct lines.
 */
function isRemovalNote(fileLines, lineNumber) {
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidate = fileLines[lineNumber - 1 + offset];
    if (candidate !== undefined && REMOVAL_NOTE.test(candidate)) return true;
  }
  return false;
}

/** Cache of doc file contents, split into lines, keyed by repo-relative path. */
const fileLineCache = new Map();
function linesOf(relPath) {
  if (!fileLineCache.has(relPath)) fileLineCache.set(relPath, read(relPath).split('\n'));
  return fileLineCache.get(relPath);
}

/** Split `file:line:text` into its parts. */
function locationOf(hitLine) {
  const firstColon = hitLine.indexOf(':');
  const secondColon = hitLine.indexOf(':', firstColon + 1);
  return {
    file: hitLine.slice(0, firstColon),
    lineNumber: Number(hitLine.slice(firstColon + 1, secondColon)),
  };
}

function isAnchorMention(text, token) {
  // `](#mcp-resources--token-efficient-discovery)` and `(#prompt--chain-contributions)`
  return new RegExp(`#[a-z0-9-]*${token.replace(/^--/, '')}`, 'i').test(text);
}

const parsedFlags = new Set(PARSER_FILES.flatMap((file) => [...parsedFlagsFrom(file)]));
const envVars = readEnvVars();

if (parsedFlags.size === 0 || envVars.size === 0) {
  console.error('Could not read ground truth from source — parser table or env reads not found.');
  console.error('This check is only meaningful against real source; refusing to pass vacuously.');
  process.exit(1);
}

const violations = [];

for (const line of documentedMentions('--[a-z][a-z0-9-]{1,}')) {
  const text = textOf(line);
  const { file, lineNumber } = locationOf(line);
  for (const token of tokensOf(text, /--[a-z][a-z0-9-]{1,}/g)) {
    if (parsedFlags.has(token) || NOT_OUR_OPTIONS.has(token)) continue;
    if (isAnchorMention(text, token)) continue;
    if (isRemovalNote(linesOf(file), lineNumber)) continue;
    violations.push({ kind: 'flag', token, line });
  }
}

for (const line of documentedMentions('MCP_[A-Z_]+')) {
  const text = textOf(line);
  const { file, lineNumber } = locationOf(line);
  for (const token of tokensOf(text, /MCP_[A-Z_]+/g)) {
    if (envVars.has(token)) continue;
    if (isRemovalNote(linesOf(file), lineNumber)) continue;
    violations.push({ kind: 'env var', token, line });
  }
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} documented option(s) with no backing in source.`);
  console.error('Either implement the option, or remove it from the docs and say so in place so a');
  console.error('user who copied it from an older revision can tell what happened. If the token');
  console.error("belongs to another tool's CLI, add it to NOT_OUR_OPTIONS with a reason.\n");
  for (const { kind, token, line } of violations.slice(0, 40)) {
    console.error(`  [${kind}] ${token}\n    ${line.trim()}`);
  }
  if (violations.length > 40) console.error(`  ... and ${violations.length - 40} more`);
  process.exit(1);
}

console.log(
  `Documented options all backed by source (${parsedFlags.size} flags, ${envVars.size} env vars).`
);
