#!/usr/bin/env node

/**
 * Fails any code that reads or writes a gate review through the retired per-run slots
 * `pendingGateReview` / `detachedGateReviews` instead of by node through `ChainSession.reviews`.
 *
 * THE CLASS. A run's reviews live in ONE store, `reviews`, keyed by the node each grades (rows
 * 3.1–3.5 of the primitive rework). Before that, a run carried a current-step slot
 * (`pendingGateReview`) and a detached map (`detachedGateReviews`); rows 3.1–3.5 turned both into
 * read-only projections and moved every reader onto `reviews`, and row 3.6 deleted them. A new
 * reader or writer of either name re-opens a second review store: a write lands in a field nothing
 * persists (the verdict is lost), and a read answers "the one review of the run" when a run can
 * hold several (the wrong node is graded).
 *
 * WHAT COUNTS AS A FINDING — every occurrence of either name in `src/` as code, classified:
 *   - write       : an assignment / compound assignment / `delete` / `++`/`--` target, or an
 *                   object-literal key (a value built to carry the field)
 *   - declaration : a property signature / declaration / accessor on a type or class
 *   - read        : any other property or element access, a destructuring binding, or a string
 *                   literal or template text naming it (a SQL `json_extract` path, a
 *                   `defineProperty` name, an `in` check)
 * An element access is resolved through the TYPE CHECKER: `session[KEY]` counts when `KEY`'s type
 * is the string-literal type of either name, however it was built. Comments do not count. A
 * method whose name merely contains the word (`setPendingGateReview`) is a different identifier
 * and does not count.
 *
 * A finding is accepted only by an entry in ACCEPTED naming its file, its enclosing function or
 * type, and its kind. Every entry carries an as-of date and the observation that flips it, and
 * the satisfied-exception check fails an entry that no longer matches any occurrence — an
 * exception outlives what it described unless something says so.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH (as of 2026-09-23 · flips when any of these shapes appears):
 *   - a name assembled at runtime from parts (`'pending' + 'GateReview'`) or read from data.
 *   - `tests/`, `scripts/` and `hooks/` (Python reads the `chain_sessions` projection key by
 *     contract; that key's writer is an accepted exception below).
 *
 * A green run is not a run that reached nothing: the scan fails closed below
 * `MINIMUM_SOURCE_FILES` scanned files, and every accepted entry must match a live occurrence.
 *
 * `--self-test` plants every form above, plus the decoys, in an in-memory program and asserts
 * exactly the planted occurrences are found with the right kind.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Node, Project, SyntaxKind } from 'ts-morph';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'validate:review-by-node';

const NAMES = new Set(['pendingGateReview', 'detachedGateReviews']);
const NAME_IN_TEXT = /\b(pendingGateReview|detachedGateReviews)\b/;

/** Below this, the scan is not reaching `src/`. */
const MINIMUM_SOURCE_FILES = 200;

/**
 * Occurrences that stay on purpose. `where` is the enclosing function, or the type/class a
 * declaration sits on; `kind` must match too, so an accepted read never covers a new write.
 */
const ACCEPTED = [
  {
    subject: 'src/modules/chains/run-registry.ts',
    where: 'ResidualRunState',
    kind: 'declaration',
    reason:
      'Legacy load: the pre-3.1 residual document carried both fields, and a run persisted then ' +
      'is still read into `reviews`. Typed `unknown`; nothing writes them.',
    asOf: '2026-09-23',
    flipsWhen:
      'a SCHEMA_VERSION bump drops every pre-3.1 chain_runs row — delete both fields with readLegacyReviews',
  },
  {
    subject: 'src/modules/chains/run-registry.ts',
    where: 'readLegacyReviews',
    kind: 'read',
    reason:
      'Legacy load: reads the two pre-3.1 fields of a residual document into `reviews`, one way.',
    asOf: '2026-09-23',
    flipsWhen:
      'a SCHEMA_VERSION bump drops every pre-3.1 chain_runs row — delete readLegacyReviews',
  },
  {
    subject: 'src/modules/chains/manager.ts',
    where: 'collectActiveSessionRows',
    kind: 'write',
    reason:
      'The `chain_sessions` hook projection: `pendingGateReview` is the JSON key the Python hooks ' +
      'read (`hooks/lib/db_reader.py`, `hooks/lib/session_state.py`); its value is read by node.',
    asOf: '2026-09-23',
    flipsWhen: 'the Python readers move to a by-node key in the same PR as this writer',
  },
  {
    subject: 'src/infra/database/sqlite-engine.ts',
    where: 'applyViews',
    kind: 'read',
    reason:
      'The `v_active_chain_sessions` view projects the same hook key (`$.pendingGateReview`) out ' +
      'of the `chain_sessions` state document.',
    asOf: '2026-09-23',
    flipsWhen:
      'the hook projection key is renamed (the manager.ts collectActiveSessionRows entry flips)',
  },
];

// ─── Scan ────────────────────────────────────────────────────────────────────

const ASSIGNMENT_OPERATORS = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/** True when `access` (a property/element access) is the target of a write. */
function isWriteTarget(access) {
  const parent = access.getParent();
  if (parent === undefined) return false;
  if (Node.isBinaryExpression(parent)) {
    return (
      parent.getLeft() === access && ASSIGNMENT_OPERATORS.has(parent.getOperatorToken().getKind())
    );
  }
  if (Node.isDeleteExpression(parent)) return true;
  if (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) {
    const op = parent.getOperatorToken();
    return op === SyntaxKind.PlusPlusToken || op === SyntaxKind.MinusMinusToken;
  }
  return false;
}

/** The function, or the type/class a member sits on, that encloses `node`. */
function enclosingName(node) {
  const owner = node.getFirstAncestor(
    (a) =>
      Node.isMethodDeclaration(a) ||
      Node.isFunctionDeclaration(a) ||
      Node.isConstructorDeclaration(a) ||
      Node.isGetAccessorDeclaration(a) ||
      Node.isSetAccessorDeclaration(a) ||
      Node.isInterfaceDeclaration(a) ||
      Node.isClassDeclaration(a) ||
      Node.isTypeAliasDeclaration(a) ||
      (Node.isVariableDeclaration(a) &&
        (Node.isArrowFunction(a.getInitializer()) || Node.isFunctionExpression(a.getInitializer())))
  );
  if (owner === undefined) return '<module scope>';
  if (Node.isConstructorDeclaration(owner)) return 'constructor';
  return owner.getName?.() ?? '<anonymous>';
}

/** Where the name that `nameNode` resolves to is declared, for the message. */
function declaredOn(nameNode) {
  const declaration = nameNode.getSymbol()?.getDeclarations()[0];
  const owner = declaration?.getFirstAncestor(
    (a) => Node.isInterfaceDeclaration(a) || Node.isClassDeclaration(a)
  );
  return owner?.getName?.();
}

/** The string-literal value of an element-access argument's TYPE, when it is one of NAMES. */
function literalNameOf(argument) {
  if (argument === undefined) return undefined;
  const type = argument.getType();
  const value = type.isStringLiteral() ? type.getLiteralValue() : undefined;
  return typeof value === 'string' && NAMES.has(value) ? value : undefined;
}

/**
 * Every occurrence in one source file. `checkWrites` exists for the validator mutation the
 * self-test documents: with it off, a write reads as nothing at all.
 *
 * @returns {Array<{ line: number, where: string, kind: 'write'|'declaration'|'read', form: string, name: string, owner?: string }>}
 */
export function scanSourceFile(sourceFile, { checkWrites = true } = {}) {
  const hits = [];
  const record = (node, kind, form, name, owner) => {
    hits.push({
      line: node.getStartLineNumber(),
      where: enclosingName(node),
      kind,
      form,
      name,
      ...(owner ? { owner } : {}),
    });
  };
  const access = (node, form, name, nameNode) => {
    if (isWriteTarget(node)) {
      if (checkWrites) record(node, 'write', form, name, nameNode && declaredOn(nameNode));
      return;
    }
    record(node, 'read', form, name, nameNode && declaredOn(nameNode));
  };
  const coveredLiterals = new Set();

  sourceFile.forEachDescendant((node) => {
    if (Node.isElementAccessExpression(node)) {
      const argument = node.getArgumentExpression();
      const name = literalNameOf(argument);
      if (name !== undefined) {
        coveredLiterals.add(argument);
        access(node, 'element access', name);
      }
      return;
    }
    if (!Node.isIdentifier(node) && !Node.isStringLiteral(node)) {
      if (
        Node.isNoSubstitutionTemplateLiteral(node) ||
        Node.isTemplateHead(node) ||
        Node.isTemplateMiddle(node) ||
        Node.isTemplateTail(node)
      ) {
        const match = NAME_IN_TEXT.exec(node.getText());
        if (match) record(node, 'read', 'template text', match[1]);
      }
      return;
    }

    const text = Node.isIdentifier(node) ? node.getText() : node.getLiteralValue();
    const parent = node.getParent();

    if (Node.isStringLiteral(node)) {
      if (coveredLiterals.has(node)) return;
      if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) {
        if (NAMES.has(text) && checkWrites) record(node, 'write', 'object-literal key', text);
        return;
      }
      const match = NAME_IN_TEXT.exec(text);
      if (match) record(node, 'read', 'string literal', match[1]);
      return;
    }

    if (!NAMES.has(text)) return;
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
      access(parent, 'property access', text, node);
    } else if (
      (Node.isPropertyAssignment(parent) || Node.isShorthandPropertyAssignment(parent)) &&
      parent.getNameNode() === node
    ) {
      if (checkWrites) record(node, 'write', 'object-literal key', text);
    } else if (
      Node.isPropertySignature(parent) ||
      Node.isPropertyDeclaration(parent) ||
      Node.isGetAccessorDeclaration(parent) ||
      Node.isSetAccessorDeclaration(parent)
    ) {
      record(node, 'declaration', 'member', text);
    } else if (Node.isBindingElement(parent)) {
      record(node, 'read', 'destructuring', text);
    } else {
      record(node, 'read', 'identifier', text);
    }
  });
  return hits;
}

function collect() {
  const project = new Project({
    tsConfigFilePath: path.join(SERVER_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });
  const findings = [];
  let scanned = 0;
  for (const sourceFile of project.getSourceFiles()) {
    const rel = path.relative(SERVER_ROOT, sourceFile.getFilePath()).split(path.sep).join('/');
    if (!rel.startsWith('src/')) continue;
    scanned += 1;
    for (const hit of scanSourceFile(sourceFile)) findings.push({ file: rel, ...hit });
  }
  return { findings, scanned };
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const SELF_TEST_SOURCE = `
interface Session { reviews?: Record<string, unknown>; pendingGateReview?: unknown }
declare const s: Session;
declare const t: Record<string, unknown>;
const KEY = 'detachedGateReviews' as const;
function writes() {
  s.pendingGateReview = undefined;
  delete (t as { detachedGateReviews?: unknown }).detachedGateReviews;
  t['pendingGateReview'] ??= 1;
  return { detachedGateReviews: {} };
}
function reads() {
  const a = s.pendingGateReview;
  const { detachedGateReviews } = t as { detachedGateReviews?: unknown };
  const b = t[KEY];
  const sql = \`json_extract(state, '$.pendingGateReview')\`;
  return [a, detachedGateReviews, b, sql];
}
function decoys() {
  // pendingGateReview in a comment is not code
  const setPendingGateReview = (): void => undefined;
  const c = t['pendingGateReviewCount'];
  return [setPendingGateReview, c, s.reviews];
}
`;

/** `line:kind` for each planted occurrence, in source order. */
const SELF_TEST_EXPECTED = [
  '1:declaration', // Session.pendingGateReview
  '4:read', // the KEY initializer names it as a string literal
  '6:write', // assignment
  '7:declaration', // the cast's type-literal member
  '7:write', // delete
  '8:write', // ??= through a literal element key
  '9:write', // object-literal key
  '12:read', // property access
  '13:declaration', // the cast's type-literal member
  '13:read', // destructuring
  '14:read', // element access through a const-typed key (type checker)
  '15:read', // SQL json path in template text
  '16:read', // the destructured local, read again
];

function runSelfTest() {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('planted.ts', SELF_TEST_SOURCE.trimStart());
  const actual = scanSourceFile(file)
    .map((hit) => `${hit.line}:${hit.kind}`)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  const expected = [...SELF_TEST_EXPECTED].sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b)
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`[${GATE}] SELF-TEST FAILED`);
    console.error(`  expected ${JSON.stringify(expected)}`);
    console.error(`  found    ${JSON.stringify(actual)}`);
    process.exit(1);
  }
  const blind = scanSourceFile(file, { checkWrites: false }).filter((hit) => hit.kind === 'write');
  if (blind.length !== 0) {
    console.error(`[${GATE}] SELF-TEST FAILED: checkWrites:false still reported writes`);
    process.exit(1);
  }
  console.log(
    `[${GATE}] self-test OK — ${expected.length} planted occurrences (assignment, delete, ` +
      '??= through a literal key, object-literal key, member, property/element/destructured ' +
      'read, a const-typed key, a SQL path) found with their kind; a comment, a longer name and ' +
      'a method containing the word are not.'
  );
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) runSelfTest();

const { findings, scanned } = collect();
const accepts = (entry, finding) =>
  finding.file === entry.subject && finding.where === entry.where && finding.kind === entry.kind;

const audit = auditExceptions({
  gate: GATE,
  entries: ACCEPTED,
  describe: (entry) => `${entry.subject} ${entry.where} (${entry.kind})`,
  closedBy: (entry) =>
    entry.asOf && entry.flipsWhen ? `as of ${entry.asOf} · flips when ${entry.flipsWhen}` : '',
  classify: (entry) => {
    if (!fs.existsSync(path.join(SERVER_ROOT, entry.subject))) {
      return { verdict: VERDICT.SUBJECT_MISSING };
    }
    return findings.some((finding) => accepts(entry, finding))
      ? { verdict: VERDICT.LOAD_BEARING }
      : {
          verdict: VERDICT.SATISFIED,
          detail: `no ${entry.kind} of the retired review slots is left in ${entry.where}`,
        };
  },
});

const unaccepted = findings.filter((finding) => !ACCEPTED.some((entry) => accepts(entry, finding)));
for (const finding of unaccepted) {
  const on = finding.owner ? ` (declared on ${finding.owner})` : '';
  console.error(
    `❌ ${finding.file}:${finding.line} — ${finding.where}: ${finding.kind} of ` +
      `\`${finding.name}\`${on} via ${finding.form}`
  );
}
if (unaccepted.length > 0) {
  console.error(
    '     Reviews live in `ChainSession.reviews`, keyed by the node each grades. Read ' +
      "`reviews[nodeId]` (or the store's `getReview(sessionId, nodeId)`), write through the " +
      "store's `setReview` / `clearReview`, each naming its node."
  );
}

const auditProblems = reportExceptionAudit(GATE, audit);

if (scanned < MINIMUM_SOURCE_FILES) {
  console.error(
    `❌ [${GATE}] scanned only ${scanned} src file(s); expected at least ${MINIMUM_SOURCE_FILES}. ` +
      'The scan is not reaching the code it governs — check tsconfig.json.'
  );
  process.exit(1);
}

if (unaccepted.length > 0 || auditProblems > 0) process.exit(1);

console.log(
  `[${GATE}] OK: ${scanned} src file(s) scanned; ${findings.length} occurrence(s) of the retired ` +
    `review slots, all inside ${ACCEPTED.length} accepted exception(s)`
);
process.exit(0);
