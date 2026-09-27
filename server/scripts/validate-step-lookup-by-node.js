#!/usr/bin/env node

/**
 * Fails any code in `src/` that looks a chain step up by its POSITION instead of by the node it
 * stands for (R77, P6.176).
 *
 * THE CLASS. A run's node list and the parse-time step array stop being the same list the moment
 * the mutation policy inserts a node or a caller contributes a remainder: an inserted node has no
 * parse step, and the step at its ordinal is the NEXT planned one. Every lookup that fell back from
 * a node id to that ordinal handed an inserted node a neighbour's data — measured 2026-09-27: its
 * review quoted the next step's arguments (`getCurrentStepArgs`), its review took the next step's
 * `retries` (`createReviewForStep`), its answer was published under the next step's
 * `outputMapping` (`getStepOutputMapping`), and stage 16 refused its resume with the next step's
 * trailer (P6.157). Each site had its own copy of "node id, else position".
 *
 * ONE RESOLVER. `parseStepForNode` (`shared/utils/node-order.ts`) answers "which parse step does
 * this node address name": by node id whenever the steps carry node ids, by ordinal only when
 * there is no node address to use. `recordedStep` (the renderer's resolution) and every other site
 * call it; it is the one accepted ordinal lookup below.
 *
 * WHAT COUNTS AS A FINDING — two shapes, found through the AST:
 *   - ordinal match : an equality comparison (`===`, `==`, `!==`, `!=`) between the
 *                     `.stepNumber` of a find-family callback's own parameter and a non-literal,
 *                     inside that callback (`find`/`findIndex`/`findLast`/`findLastIndex`/
 *                     `filter`/`some`/`every`). A comparison against a literal or `undefined` is a
 *                     presence check; another object's `stepNumber` (a gate's target ordinal)
 *                     compares a target, not the element being looked up.
 *   - ordinal index : an element access on a step array (the receiver's last name ends in `steps`,
 *                     `Steps` or `stepPrompts`) whose argument — or, for an identifier argument,
 *                     that identifier's initializer — names an ordinal (`currentStep`,
 *                     `stepNumber`, `ordinal`, `currentOrdinal`, `contextStep`, or a recorded
 *                     `.stepIndex`). `steps[0]`, an index found by identity (`findIndex(...
 *                     nodeId ...)`), and a bare index parameter into the node-driven render plan
 *                     (which IS run order) do not count.
 *
 * A finding is accepted only by an entry in ACCEPTED naming its file, its enclosing function and
 * its shape. Every entry carries an as-of date and the observation that flips it, and the
 * satisfied-exception check fails an entry that no longer matches any finding.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH (as of 2026-09-27 · flips when any of these shapes appears):
 *   - a per-step predicate method outside a find-family callback (`GateEnhancementService
 *     .isCurrentStep` compares node ids first over the run-order walk, which carries every node's
 *     id; its ordinal branch is reached only for steps with no node id);
 *   - an ordinal carried under another name, or through more than one assignment;
 *   - gate TARGETS authored by ordinal (`target_step_number`, `apply_to_steps`) — a declared input
 *     surface, validated against the run by stage 11, not a step lookup;
 *   - `tests/`, `scripts/` and `hooks/`.
 *
 * A green run is not a run that reached nothing: the scan fails closed below
 * `MINIMUM_SOURCE_FILES` scanned files, and every accepted entry must match a live finding.
 *
 * `--self-test` plants both shapes in every listed form beside decoys, in an in-memory program, and
 * asserts exactly the planted lines are found.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Node, Project, SyntaxKind } from 'ts-morph';

import { VERDICT, auditExceptions, reportExceptionAudit } from './lib/exception-hygiene.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'validate:step-lookup-by-node';

/** Below this, the scan is not reaching `src/`. */
const MINIMUM_SOURCE_FILES = 200;

const FIND_FAMILY = new Set([
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'filter',
  'some',
  'every',
]);
const EQUALITY = new Set([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
]);
const STEP_ARRAY = /(steps|stepPrompts)$/i;
const ORDINAL_NAME =
  /\b(currentStep|stepNumber|ordinal|currentOrdinal|contextStep)\b|\.stepIndex\b/;

/**
 * Occurrences that stay on purpose. `where` is the enclosing function; `shape` must match too.
 */
const ACCEPTED = [
  {
    subject: 'src/shared/utils/node-order.ts',
    where: 'parseStepForNode',
    shape: 'ordinal match',
    reason:
      'The one resolver: by ordinal only when the steps carry no node ids or no node id is given.',
    asOf: '2026-09-27',
    flipsWhen:
      'every parse path mints node ids and `ChainStepPrompt.nodeId` becomes required (P3 D10) — ' +
      'delete the ordinal branch',
  },
  {
    subject: 'src/engine/execution/operators/chain-operator-executor.ts',
    where: 'resolveReviewStep',
    shape: 'ordinal index',
    reason:
      "The review render's steps are the node-driven plan (stage 20, `planNodeDrivenRender`), so " +
      "the review's node id matches first; the recorded step index answers only a plan with no " +
      'run nodes (legacy steps parsed before node-id minting).',
    asOf: '2026-09-27',
    flipsWhen:
      'the review render is reached with a plan that is not node-driven, or `nodeId` becomes ' +
      'required on `ChainStepPrompt` — delete both index fallbacks',
  },
];

// ─── Scan ────────────────────────────────────────────────────────────────────

/** The function that encloses `node`, by name. */
function enclosingName(node) {
  const owner = node.getFirstAncestor(
    (a) =>
      Node.isMethodDeclaration(a) ||
      Node.isFunctionDeclaration(a) ||
      Node.isConstructorDeclaration(a) ||
      Node.isGetAccessorDeclaration(a) ||
      Node.isSetAccessorDeclaration(a) ||
      (Node.isVariableDeclaration(a) &&
        (Node.isArrowFunction(a.getInitializer()) || Node.isFunctionExpression(a.getInitializer())))
  );
  if (owner === undefined) return '<module scope>';
  if (Node.isConstructorDeclaration(owner)) return 'constructor';
  return owner.getName?.() ?? '<anonymous>';
}

/** The find-family callback enclosing `node`, or undefined. */
function findFamilyCallback(node) {
  const fn = node.getFirstAncestor((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a));
  if (fn === undefined) return undefined;
  const call = fn.getParent();
  if (!Node.isCallExpression(call) || !call.getArguments().includes(fn)) return undefined;
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) && FIND_FAMILY.has(callee.getName())
    ? fn
    : undefined;
}

/** `<param>.stepNumber`, where `<param>` is a parameter of `callback`. */
function isElementStepNumber(node, callback) {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== 'stepNumber') return false;
  const receiver = node.getExpression();
  if (!Node.isIdentifier(receiver)) return false;
  return callback.getParameters().some((param) => param.getName() === receiver.getText());
}

/** A literal, `undefined`, or `null`: comparing against one is a presence check. */
function isLiteralLike(node) {
  return (
    Node.isLiteralExpression(node) ||
    Node.isNullLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    (Node.isIdentifier(node) && node.getText() === 'undefined')
  );
}

/** The last name of an element access's receiver (`a.b.steps` -> `steps`). */
function receiverName(access) {
  const receiver = access.getExpression();
  if (Node.isIdentifier(receiver)) return receiver.getText();
  if (Node.isPropertyAccessExpression(receiver)) return receiver.getName();
  return undefined;
}

/** The text an index argument derives from: itself, and one hop through a local initializer. */
function indexSourceText(argument) {
  if (!Node.isIdentifier(argument)) return argument.getText();
  const declaration = argument.getSymbol()?.getDeclarations()[0];
  const initializer =
    declaration !== undefined && Node.isVariableDeclaration(declaration)
      ? declaration.getInitializer()
      : undefined;
  return `${argument.getText()} ${initializer?.getText() ?? ''}`;
}

/**
 * Every finding in one source file. `checkIndex` exists for the validator mutation the self-test
 * documents: with it off, an ordinal index reads as nothing at all.
 *
 * @returns {Array<{ line: number, where: string, shape: 'ordinal match'|'ordinal index', text: string }>}
 */
export function scanSourceFile(sourceFile, { checkIndex = true } = {}) {
  const hits = [];
  const record = (node, shape) =>
    hits.push({
      line: node.getStartLineNumber(),
      where: enclosingName(node),
      shape,
      text: node.getText().replace(/\s+/g, ' ').slice(0, 100),
    });

  sourceFile.forEachDescendant((node) => {
    if (Node.isBinaryExpression(node) && EQUALITY.has(node.getOperatorToken().getKind())) {
      const callback = findFamilyCallback(node);
      if (callback === undefined) return;
      const [left, right] = [node.getLeft(), node.getRight()];
      const other = isElementStepNumber(left, callback)
        ? right
        : isElementStepNumber(right, callback)
          ? left
          : undefined;
      if (other !== undefined && !isLiteralLike(other)) record(node, 'ordinal match');
      return;
    }
    if (checkIndex && Node.isElementAccessExpression(node)) {
      const name = receiverName(node);
      const argument = node.getArgumentExpression();
      if (
        name !== undefined &&
        STEP_ARRAY.test(name) &&
        argument !== undefined &&
        ORDINAL_NAME.test(indexSourceText(argument))
      ) {
        record(node, 'ordinal index');
      }
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
interface Step { stepNumber: number; nodeId?: string }
declare const steps: Step[];
declare const ctx: { parsedCommand?: { steps?: Step[] }; currentStep: number };
declare const blueprintSteps: Step[];
declare const stepPrompts: Step[];
function lookups(ordinal: number, currentStep: number) {
  const a = steps.find((s) => s.stepNumber === ordinal);
  const b = steps.findIndex((s) => currentStep === s.stepNumber);
  const c = ctx.parsedCommand?.steps?.find(function (s) { return s.stepNumber == ctx.currentStep; });
  const d = steps.filter((s) => s.stepNumber !== ordinal);
  const e = steps[currentStep - 1];
  const resolvedIndex = Math.min(Math.max(currentStep - 1, 0), 3);
  const f = blueprintSteps[resolvedIndex];
  const g = stepPrompts[ordinal];
  return [a, b, c, d, e, f, g];
}
function decoys(nodeId: string, ordinal: number) {
  // steps.find((s) => s.stepNumber === ordinal) in a comment is not code
  const h = steps.find((s) => s.nodeId === nodeId);
  const i = steps.findIndex((s) => s.nodeId === nodeId);
  const j = steps[i];
  const k = steps[0];
  const l = steps.filter((s) => s.stepNumber !== undefined);
  const m = steps[0].stepNumber === ordinal ? 1 : 2;
  const n = [1, 2].find((x) => x === ordinal);
  const o = steps.filter((gate) => ordinal === steps[0].stepNumber);
  return [h, j, k, l, m, n, o];
}
function planIndex(stepIndex: number, review: { stepIndex: number }) {
  const p = stepPrompts[stepIndex];
  const q = stepPrompts[review.stepIndex];
  return [p, q];
}
`;

/** `line:shape` for each planted finding, in source order. */
const SELF_TEST_EXPECTED = [
  '7:ordinal match', // find, property on the left
  '8:ordinal match', // findIndex, property on the right
  '9:ordinal match', // a function expression, `==`, an optional-chained receiver
  '10:ordinal match', // filter, `!==`
  '11:ordinal index', // steps[currentStep - 1]
  '13:ordinal index', // one hop through a clamped initializer
  '14:ordinal index', // a stepPrompts receiver
  '31:ordinal index', // a recorded `.stepIndex`
];

function runSelfTest() {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('planted.ts', SELF_TEST_SOURCE.trimStart());
  const actual = scanSourceFile(file).map((hit) => `${hit.line}:${hit.shape}`);
  if (JSON.stringify(actual) !== JSON.stringify(SELF_TEST_EXPECTED)) {
    console.error(`[${GATE}] SELF-TEST FAILED`);
    console.error(`  expected ${JSON.stringify(SELF_TEST_EXPECTED)}`);
    console.error(`  found    ${JSON.stringify(actual)}`);
    process.exit(1);
  }
  const blind = scanSourceFile(file, { checkIndex: false }).filter(
    (hit) => hit.shape === 'ordinal index'
  );
  if (blind.length !== 0) {
    console.error(`[${GATE}] SELF-TEST FAILED: checkIndex:false still reported an ordinal index`);
    process.exit(1);
  }
  console.log(
    `[${GATE}] self-test OK — ${SELF_TEST_EXPECTED.length} planted lookups (find/findIndex/filter ` +
      'and a function expression, both operand orders, `==` and `!==`, a direct, a one-hop, a ' +
      'stepPrompts and a recorded-index access) found with their shape; a comment, a node-id match, an index found by ' +
      'identity, a literal index, a presence check, a conditional, a non-step find, another ' +
      "object's stepNumber and a bare render-plan index are not."
  );
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) runSelfTest();

const { findings, scanned } = collect();
const accepts = (entry, finding) =>
  finding.file === entry.subject && finding.where === entry.where && finding.shape === entry.shape;

const audit = auditExceptions({
  gate: GATE,
  entries: ACCEPTED,
  describe: (entry) => `${entry.subject} ${entry.where} (${entry.shape})`,
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
          detail: `no ${entry.shape} is left in ${entry.where}`,
        };
  },
});

const unaccepted = findings.filter((finding) => !ACCEPTED.some((entry) => accepts(entry, finding)));
for (const finding of unaccepted) {
  console.error(
    `❌ ${finding.file}:${finding.line} — ${finding.where}: ${finding.shape} \`${finding.text}\``
  );
}
if (unaccepted.length > 0) {
  console.error(
    '     A step is looked up by the node it stands for. Resolve it with `parseStepForNode` ' +
      "(`#shared/utils/node-order.js`) over the parse steps, or `recordedStep` for the renderer's " +
      'node-driven step — an inserted node has no parse step, and the one at its ordinal is not it.'
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
  `[${GATE}] OK: ${scanned} src file(s) scanned; ${findings.length} step lookup(s) by position, ` +
    `all inside ${ACCEPTED.length} accepted exception(s)`
);
process.exit(0);
