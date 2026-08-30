#!/usr/bin/env node
/**
 * Every file that resolves a RESOURCE ROOT and writes to disk must contain its paths.
 *
 * A resource writer builds its destination from values the caller chose — a prompt's `category`,
 * a gate's or framework's `id`, a category id off an HTTP body. `path.join` resolves `..`
 * silently, so an unguarded segment aims a write, or a recursive delete, outside the resources
 * root with caller-controlled content.
 *
 * Measured 2026-08-30 against `dist/`, each with a passing benign control beside it:
 *
 *   prompt    create(category: '../../ESCAPED')  -> wrote outside the root, reported `✅ Prompt Created`
 *   gate      create(id: '../../ESCAPED_GATE')   -> wrote outside the root, reported the write
 *   framework create(id: '../../ESCAPED_FW')     -> wrote outside the root, reported created
 *
 * Fixing those three was NOT fixing the class. Enumerating by this rule found a fourth site the
 * type-by-type pass missed entirely — `handleCreateCategory` in `src/mcp/http/api.ts`, which
 * joined an HTTP body field straight into `mkdir`. That is why this check exists rather than only
 * the e2e regression test: the test enumerates the resource types that exist TODAY, and a new one
 * (styles, P3.1) would ship unguarded and green.
 *
 * The rule is deliberately about the FILE, not the line. A line-level check would have to
 * recognise every way a root reaches a join — direct call, local variable, constructor field, a
 * helper two frames up — and would miss the ones it did not anticipate while reading as thorough.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(SERVER_ROOT, 'src');

/** The accessors that hand back a resources root. A file calling one is handling resource paths. */
const ROOT_ACCESSOR =
  /get(?:Resolved)?(?:Prompts|Gates|Frameworks|Styles)Directory\s*\(|getBundledResourceDir\s*\(|getOverlayResourceDirs\s*\(/;

/** Filesystem mutation. A file that resolves a root and does one of these is a resource writer. */
const WRITES = /\b(?:safeWriteFile|writeFile|mkdir|rmdir|unlink|cp|rename)\s*\(|\.\s*rm\s*\(/;

/** The guard. */
const GUARD = /resolveContainedPath/;

/**
 * Files that resolve a root and write, but whose write cannot take a caller-chosen segment.
 *
 * Each entry states the condition that would make it a finding again — an exception with no
 * falsifier outlives whatever made it true. This list is checked in BOTH directions: an entry
 * that no longer matches the rule at all is itself reported, so a stale exemption cannot sit here
 * quietly claiming to excuse something.
 */
const EXEMPT = new Map();

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Files matching the rule: resolves a resource root AND writes to disk. */
function resourceWriters() {
  const found = [];
  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (!ROOT_ACCESSOR.test(source)) continue;
    if (!WRITES.test(source)) continue;
    found.push({
      relative: path.relative(SERVER_ROOT, file).split(path.sep).join('/'),
      guarded: GUARD.test(source),
    });
  }
  return found;
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const writers = resourceWriters();
  const matched = new Set(writers.map((w) => w.relative));

  const unguarded = writers.filter((w) => !w.guarded && !EXEMPT.has(w.relative));
  // The satisfied-exception check: an exemption for a file the rule no longer selects is a claim
  // about nothing, and reads as coverage.
  const staleExemptions = [...EXEMPT.keys()].filter((f) => !matched.has(f));

  if (unguarded.length === 0 && staleExemptions.length === 0) {
    console.log(
      `[contained-resource-writes] OK: ${writers.length} resource writer(s) resolve paths through ` +
        `resolveContainedPath (${EXEMPT.size} documented exemption(s)).`
    );
    return;
  }

  if (unguarded.length > 0) {
    console.error(
      `[contained-resource-writes] FAIL: ${unguarded.length} file(s) resolve a resources root and ` +
        'write to disk without resolveContainedPath.\n' +
        'A caller-supplied segment joined onto a resources root can escape it — use\n' +
        "  import { resolveContainedPath } from '#shared/utils/contained-path.js';\n" +
        'at every join whose segments come from a payload:\n'
    );
    for (const w of unguarded) console.error(`  ${w.relative}`);
  }

  if (staleExemptions.length > 0) {
    console.error(
      `\n[contained-resource-writes] FAIL: ${staleExemptions.length} exemption(s) no longer match ` +
        'the rule. Delete them — an exemption that excuses nothing still reads as considered:\n'
    );
    for (const f of staleExemptions) console.error(`  ${f}`);
  }

  process.exit(1);
}

/**
 * Prove the check can fail. A validator that has only ever printed OK is unverified, not passing,
 * so run each predicate over input that SHOULD trip it and input that should not.
 */
function runSelfTest() {
  const writerSource = 'const d = this.configManager.getGatesDirectory();\nawait mkdir(d);';
  const guardedSource = `${writerSource}\nresolveContainedPath(d, id);`;
  const readerSource = 'const d = this.configManager.getGatesDirectory();\nreadFileSync(d);';

  const failures = [];
  const isWriter = (s) => ROOT_ACCESSOR.test(s) && WRITES.test(s);

  if (!isWriter(writerSource)) failures.push('rule missed a root-resolving writer');
  if (GUARD.test(writerSource)) failures.push('guard predicate matched an unguarded file');
  if (!GUARD.test(guardedSource)) failures.push('guard predicate missed resolveContainedPath');
  if (isWriter(readerSource)) failures.push('rule selected a file that only reads');
  if (resourceWriters().length === 0) failures.push('rule selects nothing in the real tree');

  if (failures.length > 0) {
    for (const f of failures) console.error(`[contained-resource-writes] SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    '[contained-resource-writes] SELF-TEST OK: selects writers, ignores readers, detects the guard.'
  );
}

main();
