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
 *                     `.stepNumber` of a step and a non-literal, where the step is a parameter of
 *                     ANY enclosing function — a find-family callback (`find`/`findIndex`/
 *                     `filter`/...), a `forEach`/`map` callback, or a per-step predicate method
 *                     standing outside any callback (`isCurrentStep(step, key)`) — or the variable
 *                     of a `for…of` over a step array. A comparison against a literal or
 *                     `undefined` is a presence check; another object's `stepNumber` compares
 *                     something else, not the element being looked up.
 *   - ordinal index : an element access on a step array (the receiver's last name ends in `steps`,
 *                     `Steps` or `stepPrompts`) whose argument names an ordinal (`currentStep`,
 *                     `stepNumber`, `ordinal`, `currentOrdinal`, `contextStep`, or a recorded
 *                     `.stepIndex`) — itself, or through what its identifiers were assigned: each
 *                     identifier resolves to its initializer and to every `=` assignment to it,
 *                     and those resolve in turn, so an ordinal renamed (`const i = ordinal;
 *                     const j = i`) or reassigned (`let k; k = currentStep`) is still an
 *                     ordinal. A property's receiver is not resolved (`plan.currentIndex` is not
 *                     `plan`'s initializer). `steps[0]`, an index found by identity (`findIndex(...
 *                     nodeId ...)`), and a bare index parameter into the node-driven render plan
 *                     (which IS run order) do not count.
 *
 * A finding is accepted only by an entry in ACCEPTED naming its file, its enclosing function and
 * its shape. Every entry carries an as-of date and the observation that flips it, and the
 * satisfied-exception check fails an entry that no longer matches any finding.
 *
 * ACCEPTED SHAPES, NOT SCANNED (R91, as of 2026-09-27 · flips when a shape below starts answering
 * "which step is this node" rather than the reason it states):
 *   - gate TARGETS authored by ordinal: a comparison whose other operand is a gate's
 *     `target_step_number` / `targetStepNumber`, or `apply_to_steps` membership. The ordinal there
 *     is what the gate's AUTHOR wrote, a declared input surface validated against the run by stage
 *     11 — comparing a step to it is matching an authored position, not resolving a node;
 *   - `tests/`, `scripts/` and `hooks/`: none of them runs inside the server, so none can hand an
 *     inserted node a neighbour's data. A test that builds steps by ordinal is fixture shape.
 *
 * A green run is not a run that reached nothing: the scan fails closed below
 * `MINIMUM_SOURCE_FILES` scanned files, and every accepted entry must match a live finding.
 *
 * `--self-test` plants both shapes in every listed form beside decoys, in an in-memory program, and
 * asserts exactly the planted lines are found; then switches resolution off, and the match scope
 * back to find-family callbacks, and asserts exactly the plants each widening closed vanish.
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
/** The other operand of an accepted comparison: an ordinal the gate's author wrote (R91). */
const GATE_TARGET = /\b(target_step_number|targetStepNumber)\b/;
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
    subject: 'src/engine/gates/services/gate-enhancement-service.ts',
    where: 'isCurrentStep',
    shape: 'ordinal match',
    reason:
      'A per-step predicate over the run-order walk, node id first: the walk carries every ' +
      "node's id, so the ordinal branch answers only a step with no node id (a legacy parse).",
    asOf: '2026-09-27',
    flipsWhen:
      '`ChainStepPrompt.nodeId` becomes required (P3 D10), or the walk stops carrying node ids — ' +
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

/**
 * Whether `receiver` stands for one step: a parameter of any function enclosing it (a callback, or
 * a per-step predicate outside any callback), or the variable of a `for…of` over a step array.
 * `onlyFindFamily` is the validator mutation the self-test documents: the pre-R91 scope.
 */
function isStepElement(receiver, onlyFindFamily) {
  const declaration = receiver.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined) return false;
  if (Node.isParameterDeclaration(declaration)) {
    // Scoping puts every read of a parameter inside the function declaring it.
    return !onlyFindFamily || findFamilyCallback(receiver) === declaration.getParent();
  }
  if (onlyFindFamily || !Node.isVariableDeclaration(declaration)) return false;
  const loop = declaration.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
  if (loop === undefined || loop.getInitializer() !== declaration.getParent()) return false;
  const iterated = loop.getExpression();
  const name = Node.isPropertyAccessExpression(iterated) ? iterated.getName() : iterated.getText();
  return STEP_ARRAY.test(name);
}

/** `<step>.stepNumber`, where `<step>` is a single step (see `isStepElement`). */
function isElementStepNumber(node, onlyFindFamily) {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== 'stepNumber') return false;
  const receiver = node.getExpression();
  return Node.isIdentifier(receiver) && isStepElement(receiver, onlyFindFamily);
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

/**
 * The text an index expression derives from: itself, then — for every identifier in it that is a
 * value rather than a property's receiver — the variable's initializer and every `=` assignment to
 * it in the file, resolved in turn. `seen`
 * stops a cycle; `resolve: false` is the validator mutation the self-test documents (no
 * resolution at all), under which a renamed or reassigned ordinal reads as nothing.
 */
function indexSourceText(expression, resolve = true, seen = new Set()) {
  const texts = [expression.getText()];
  if (!resolve) return texts[0];
  const identifiers = Node.isIdentifier(expression)
    ? [expression]
    : expression.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const identifier of identifiers) {
    // A property's receiver is not the value: `plan.currentIndex` is not `plan`'s initializer.
    const parent = identifier.getParent();
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === identifier) continue;
    const symbol = identifier.getSymbol();
    const declaration = symbol?.getDeclarations()[0];
    if (declaration === undefined || !Node.isVariableDeclaration(declaration)) continue;
    if (seen.has(declaration)) continue;
    seen.add(declaration);
    const sources = [declaration.getInitializer()];
    for (const assignment of identifier
      .getSourceFile()
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = assignment.getLeft();
      if (
        assignment.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        Node.isIdentifier(left) &&
        left.getSymbol() === symbol
      ) {
        sources.push(assignment.getRight());
      }
    }
    for (const source of sources) {
      if (source !== undefined) texts.push(indexSourceText(source, resolve, seen));
    }
  }
  return texts.join(' ');
}

/**
 * Every finding in one source file. The options exist for the validator mutations the self-test
 * documents: `checkIndex: false` reads no ordinal index at all, `resolve: false` reads an index
 * only as written, and `onlyFindFamily: true` reads a match only inside a find-family callback.
 *
 * @returns {Array<{ line: number, where: string, shape: 'ordinal match'|'ordinal index', text: string }>}
 */
export function scanSourceFile(
  sourceFile,
  { checkIndex = true, resolve = true, onlyFindFamily = false } = {}
) {
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
      const [left, right] = [node.getLeft(), node.getRight()];
      const other = isElementStepNumber(left, onlyFindFamily)
        ? right
        : isElementStepNumber(right, onlyFindFamily)
          ? left
          : undefined;
      if (other !== undefined && !isLiteralLike(other) && !GATE_TARGET.test(other.getText())) {
        record(node, 'ordinal match');
      }
      return;
    }
    if (checkIndex && Node.isElementAccessExpression(node)) {
      const name = receiverName(node);
      const argument = node.getArgumentExpression();
      if (
        name !== undefined &&
        STEP_ARRAY.test(name) &&
        argument !== undefined &&
        ORDINAL_NAME.test(indexSourceText(argument, resolve))
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
function renamed(ordinal: number, currentStep: number) {
  const first = ordinal - 1;
  const second = first;
  const r = steps[second];
  let moved = 0;
  moved = currentStep;
  const s2 = blueprintSteps[moved];
  return [r, s2];
}
function isHere(step: Step, key: { ordinal: number }) {
  return step.stepNumber === key.ordinal;
}
const isAt = (s: Step, ordinal: number) => s.stepNumber === ordinal;
function walk(ordinal: number) {
  for (const s of steps) if (s.stepNumber === ordinal) return s;
  return undefined;
}
declare const gates: Array<{ stepNumber: number }>;
declare function build(n: number): { currentIndex: number };
function renamedDecoys(step: Step, gate: { target_step_number?: number }, ordinal: number) {
  const t = gate.target_step_number === step.stepNumber;
  const u = step.stepNumber === undefined;
  for (const g of gates) if (g.stepNumber === ordinal) return g;
  const matched = steps[0];
  const v = matched.stepNumber === ordinal;
  const plan = build(ordinal);
  const w = stepPrompts[plan.currentIndex];
  const safe = 0;
  const x = steps[safe];
  return [t, u, v, w, x];
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
  '37:ordinal index', // an ordinal renamed through two assignments (R91)
  '40:ordinal index', // an ordinal reassigned with `=` (R91)
  '44:ordinal match', // a per-step predicate method outside any callback (R91)
  '46:ordinal match', // a per-step arrow predicate, named, outside any callback (R91)
  '48:ordinal match', // a `for…of` over a step array (R91)
];

/** The plants that need resolution (the one-hop line 13 and the two R91 ones), and R91's others. */
const SELF_TEST_RESOLVED = ['13:ordinal index', '37:ordinal index', '40:ordinal index'];
const SELF_TEST_OUTSIDE_CALLBACK = ['44:ordinal match', '46:ordinal match', '48:ordinal match'];

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
  // Each resolved or R91 plant is found BECAUSE of that widening: switched off, exactly those vanish.
  for (const [mutation, lost] of [
    [{ resolve: false }, SELF_TEST_RESOLVED],
    [{ onlyFindFamily: true }, SELF_TEST_OUTSIDE_CALLBACK],
  ]) {
    const found = scanSourceFile(file, mutation).map((hit) => `${hit.line}:${hit.shape}`);
    const expected = SELF_TEST_EXPECTED.filter((line) => !lost.includes(line));
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      console.error(`[${GATE}] SELF-TEST FAILED under ${JSON.stringify(mutation)}`);
      console.error(`  expected ${JSON.stringify(expected)}`);
      console.error(`  found    ${JSON.stringify(found)}`);
      process.exit(1);
    }
  }
  console.log(
    `[${GATE}] self-test OK — ${SELF_TEST_EXPECTED.length} planted lookups (find/findIndex/filter ` +
      'and a function expression, both operand orders, `==` and `!==`, a direct, a one-hop, a ' +
      'stepPrompts and a recorded-index access; an ordinal renamed twice and one reassigned; a ' +
      'predicate method, a named arrow predicate and a for-of over steps) found with their shape; ' +
      'a comment, a node-id match, an index found by identity, a literal index, a presence check, ' +
      "a conditional, a non-step find, another object's stepNumber, a bare render-plan index, a " +
      "gate's authored target, a for-of over another array, a local step and a property of a " +
      'value built from an ordinal are not. Without resolution the three resolved plants vanish; ' +
      'scoped to find-family callbacks the three predicate plants do.'
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
