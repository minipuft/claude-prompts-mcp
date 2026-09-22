#!/usr/bin/env node

/**
 * Fails any `cli-shared/` SQL that names a schema-v29 table or column outside an object-store guard.
 *
 * THE CLASS. `cpm` opens whatever `state.db` it finds. A database written by a server older than
 * schema v29 has neither the `objects`/`version_entries` tables nor `version_history.tree_hash` /
 * `tree_origin`, and SQLite THROWS on a statement naming a column or table that does not exist —
 * it does not return nothing. So every such statement must be preceded, in its own function, by
 * `hasObjectStore()` / `objectStoreExists()`, which answers for the tables and the columns at once
 * (they arrived in the same bump).
 *
 * FOUR defects of exactly this shape landed and were caught on the #345–#347 arc, three of them by
 * a CLI fixture that hand-creates `version_history` alone — incidental coverage that a fixture
 * cleanup could remove without anyone noticing what it protected — and the fourth only because a
 * handoff happened to say so. Prose in three handoffs did not close the class; this does. The four:
 *
 *   1. `recordTree` (object-store.ts) — INSERT into `objects` / `version_entries`, UPDATE tree_hash
 *   2. `sweepUnreferencedObjects` (object-store.ts) — SELECT/DELETE over `objects`
 *   3. `resolveCliByteRestore` (version-history.ts) — SELECT `tree_hash, tree_origin` (#346)
 *   4. `readRecordedConfigFile` (config-restore.ts) — SELECT `tree_hash` (#347)
 *
 * WHAT COUNTS AS A FINDING: a string literal under `src/cli-shared/**` that contains SQL naming
 * `tree_hash`, `tree_origin`, `objects` or `version_entries`, whose enclosing function does not
 * call a guard BEFORE it. Position matters — a guard after the statement is not a guard — so the
 * call has to start earlier in the file than the literal.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, stated with an as-of date because a documented blind spot
 * is worth more than a discovered one (as of 2026-09-21):
 *
 *   - SQL assembled from pieces that individually name none of the four tokens
 *     (`'SELECT ' + column + ' FROM version_history'`). The predicate is lexical; a composed
 *     statement answers a different question and no such shape exists here today.
 *   - A guard called in the CALLER rather than in the function holding the statement. That is a
 *     real and safe arrangement, and it reports as a finding — deliberately, because "some caller
 *     checks" is the reasoning that produced defects 1 and 2. Move the guard or restructure.
 *   - Anything outside `src/cli-shared/**`. The server owns this DDL and asserts it at startup, so
 *     only the CLI can meet a database it did not create. A future second CLI-side directory would
 *     need adding to `SCANNED_DIRECTORIES` — the location is part of the enumeration.
 *   - A statement reached through a helper that takes SQL as a parameter. None exists here.
 *
 * A green run is not a run that reached nothing: the scan fails closed unless it examined at least
 * `MINIMUM_GUARDED_STATEMENTS` statements that ARE guarded, which is the four defects' own sites.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where a `state.db` of unknown vintage can be opened. */
const SCANNED_DIRECTORIES = [path.join('src', 'cli-shared')];

/** The v29 names. A statement mentioning any of them fails on an older schema. */
const V29_TOKENS = ['tree_hash', 'tree_origin', 'objects', 'version_entries'];

/** The one question a guard asks, under either of its two names. */
const GUARD_CALLS = ['hasObjectStore(', 'objectStoreExists('];

/**
 * The guard's own definition and its `sqlite_master` lookup, which necessarily name `objects`.
 *
 * Keyed by function name rather than by file, so moving the module does not silently widen the
 * exemption to everything that moved with it.
 */
const GUARD_FUNCTIONS = new Set(['hasObjectStore', 'objectStoreExists']);

/** Below this, the scan is not reaching the code it claims to govern. */
const MINIMUM_GUARDED_STATEMENTS = 4;

function namesV29(text) {
  return V29_TOKENS.some((token) => text.includes(token));
}

/** SQL, not prose: a literal that also reads as a statement. */
function looksLikeStatement(text) {
  return /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(text);
}

function enclosingFunction(node) {
  return node.getFirstAncestor(
    (ancestor) =>
      ancestor.getKind() === SyntaxKind.FunctionDeclaration ||
      ancestor.getKind() === SyntaxKind.MethodDeclaration ||
      ancestor.getKind() === SyntaxKind.ArrowFunction ||
      ancestor.getKind() === SyntaxKind.FunctionExpression
  );
}

function functionName(fn) {
  const named = fn.getName?.();
  if (named) return named;
  const declaration = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  return declaration?.getName() ?? '<anonymous>';
}

/** The earliest position in `fn` at which a guard is called, or `null`. */
function guardPosition(fn) {
  let earliest = null;
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const text = call.getText();
    if (!GUARD_CALLS.some((guard) => text.startsWith(guard))) continue;
    const start = call.getStart();
    if (earliest === null || start < earliest) earliest = start;
  }
  return earliest;
}

function collect() {
  const project = new Project({
    tsConfigFilePath: path.join(SERVER_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const findings = [];
  let guarded = 0;
  let filesScanned = 0;

  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath());
    if (!SCANNED_DIRECTORIES.some((dir) => rel.startsWith(dir + path.sep))) continue;
    filesScanned += 1;

    const literals = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression),
    ];

    for (const literal of literals) {
      const text = literal.getText();
      if (!namesV29(text) || !looksLikeStatement(text)) continue;

      const fn = enclosingFunction(literal);
      if (fn !== undefined && GUARD_FUNCTIONS.has(functionName(fn))) continue;

      const guardAt = fn === undefined ? null : guardPosition(fn);
      if (guardAt !== null && guardAt < literal.getStart()) {
        guarded += 1;
        continue;
      }
      findings.push({
        file: rel,
        line: literal.getStartLineNumber(),
        fn: fn === undefined ? '<module scope>' : functionName(fn),
        reason:
          guardAt === null
            ? 'no object-store guard in this function'
            : 'the guard runs AFTER this statement',
        text: text.replace(/\s+/g, ' ').slice(0, 110),
      });
    }
  }

  return { findings, guarded, filesScanned };
}

const { findings, guarded, filesScanned } = collect();

for (const finding of findings) {
  console.error(
    `❌ ${finding.file}:${finding.line} — ${finding.fn}() runs v29-only SQL: ${finding.reason}`
  );
  console.error(`     ${finding.text}`);
  console.error(
    `     Ask hasObjectStore(asObjectStoreDatabase(db)) BEFORE it — a pre-v29 state.db has ` +
      `neither the tables nor the columns, and the statement throws rather than returning nothing.`
  );
}

if (guarded < MINIMUM_GUARDED_STATEMENTS) {
  console.error(
    `❌ [validate-cli-shared-store-guards] examined only ${guarded} guarded statement(s) across ` +
      `${filesScanned} file(s); expected at least ${MINIMUM_GUARDED_STATEMENTS}. The scan is not ` +
      `reaching the code it governs — check SCANNED_DIRECTORIES and V29_TOKENS.`
  );
  process.exit(1);
}

if (findings.length > 0) {
  process.exit(1);
}

console.log(
  `[validate-cli-shared-store-guards] OK: 0 unguarded v29 statements, ${guarded} guarded ` +
    `statement(s) across ${filesScanned} file(s)`
);
process.exit(0);
