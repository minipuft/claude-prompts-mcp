// @lifecycle canonical - P6.88 / R168: every call that opens a gate review passes a resolved, non-empty gate set.
/**
 * A review opened with an empty gate set grades nothing: before R38 a FAIL on a gateless step
 * opened one, held the step as blocking and exhausted it naming no gate ("failed after 2 attempts:
 * ****", P6.76 / P6.90). The creation sites are where that defect would live, so this test reads
 * every call of the three review openers on `GateEnforcementAuthority` — `createReview`,
 * `createReviewForStep`, `openDetachedReview` — out of `server/src` and `cli/src` by parsing the
 * source, and compares the whole set, with the gate-set expression each site passes and why that
 * expression is never empty there, as ONE value. A new caller, or a changed gate-set expression,
 * fails until it is added below and reviewed.
 *
 * What a site's gate-set expression may be:
 * - an identifier the enclosing function refuses when empty (`if (x.length === 0) return …`)
 *   before the call — `guarded here`;
 * - anything but an empty literal, when the opener it calls refuses an empty set itself
 *   (`createReviewForStep`, `openDetachedReview`: their first statement) — `opener guards`;
 * - a call whose result the same file asks `.length === 0` of — `emptiness asked in file`. The
 *   verdict path's `stepReviewGateIds(context)` is the one: `gatelessStepOrdinal` refuses a FAIL
 *   when it is empty (R38), and the P6.90 e2e pin drives that refusal.
 *
 * Not seen by this scan (as of 2026-09-29 · closed by the P6.90 driven pin): a set that is built
 * empty at RUNTIME behind a guard the scan accepts (the scan reads the guard's presence, not every
 * path to it); a review written without an opener (`setReview`/`setPendingGateReview` with a review
 * built literally — stage 19's structural review, stage 16's capture hold); and a caller that
 * reaches an opener through a variable holding the method rather than a property call.
 */
import { describe, expect, test } from '@jest/globals';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROOTS = [path.join(SERVER, 'src'), path.join(SERVER, '..', 'cli', 'src')];
const AUTHORITY = 'src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts';

/** The opener and the index of the argument carrying its gate set. */
const OPENERS: Readonly<Record<string, number>> = {
  createReview: 3,
  createReviewForStep: 2,
  openDetachedReview: 3,
};
/** The openers that refuse an empty set themselves, as their first statement. */
const SELF_GUARDING = new Set(['createReviewForStep', 'openDetachedReview']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** The nearest enclosing named function or method: the unit a guard must sit in. */
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isMethodDeclaration(at) || ts.isFunctionDeclaration(at)) && at.body !== undefined) {
      return at;
    }
  }
  return undefined;
}

/** Whether `statement` leaves the function (a return or a throw, bare or in a block). */
function exits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  return ts.isBlock(statement) && statement.statements.some(exits);
}

/** An `if (<name>.length === 0 …) return|throw` in `fn` that starts before `before`. */
function guardsEmpty(fn: ts.FunctionLikeDeclaration, name: string, before: number): boolean {
  let found = false;
  const emptyTest = new RegExp(`(^|[^\\w.])${name}\\.length === 0`);
  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node) &&
      node.getStart() < before &&
      emptyTest.test(node.expression.getText()) &&
      exits(node.thenStatement)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return found;
}

/** The gate-set expression an opener call passes, or undefined when the site does not say. */
function gateSetArgument(call: ts.CallExpression, opener: string): ts.Expression | undefined {
  const argument = call.arguments[OPENERS[opener]!];
  if (opener !== 'createReview') return argument;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) return undefined;
  for (const property of argument.properties) {
    if (property.name?.getText() !== 'gateIds') continue;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
    if (ts.isPropertyAssignment(property)) return property.initializer;
  }
  return undefined;
}

/** Why `expression` is never an empty set at the call, or the defect when nothing says so. */
function classify(
  file: ts.SourceFile,
  call: ts.CallExpression,
  opener: string,
  expression: ts.Expression | undefined
): string {
  if (expression === undefined) return 'DEFECT: the gate set is not readable at the site';
  if (ts.isArrayLiteralExpression(expression) && expression.elements.length === 0) {
    return 'DEFECT: an empty gate set';
  }
  const fn = enclosingFunction(call);
  if (ts.isIdentifier(expression) && fn && guardsEmpty(fn, expression.text, call.getStart())) {
    return 'guarded here';
  }
  if (SELF_GUARDING.has(opener)) return 'opener guards';
  if (
    ts.isCallExpression(expression) &&
    file.getFullText().includes(`${expression.getText()}.length === 0`)
  ) {
    return 'emptiness asked in file';
  }
  return 'DEFECT: nothing refuses an empty gate set here';
}

/** Every opener call in `source`, as `file · function · opener(gate set) · why`. */
function scanOpeners(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      Object.hasOwn(OPENERS, node.expression.name.text)
    ) {
      const opener = node.expression.name.text;
      const expression = gateSetArgument(node, opener);
      const fn = enclosingFunction(node)?.name?.getText() ?? '(top level)';
      sites.push(
        `${fileName} · ${fn} · ${opener}(${expression?.getText() ?? '?'}) · ${classify(file, node, opener, expression)}`
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

function scanTree(): string[] {
  return ROOTS.flatMap((root) =>
    sourceFiles(root).flatMap((full) =>
      scanOpeners(path.relative(SERVER, full), readFileSync(full, 'utf8'))
    )
  ).sort();
}

/** The first statement of each self-guarding opener's definition. */
function openerGuards(): string[] {
  const source = readFileSync(path.join(SERVER, AUTHORITY), 'utf8');
  const file = ts.createSourceFile(AUTHORITY, source, ts.ScriptTarget.Latest, true);
  const guards: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      SELF_GUARDING.has(node.name.getText()) &&
      node.body !== undefined
    ) {
      const first = node.body.statements[0];
      guards.push(`${node.name.getText()}: ${first?.getText().replace(/\s+/g, ' ') ?? '(empty)'}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return guards.sort();
}

describe('every review opener call passes a resolved, non-empty gate set (P6.88, R168)', () => {
  test('the opener calls in server/src and cli/src are exactly these, each with its reason', () => {
    expect(scanTree()).toEqual([
      'src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts · createReviewForStep · createReview(gateIds) · guarded here',
      'src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.ts · openDetachedReview · createReview(gateIds) · guarded here',
      'src/engine/execution/pipeline/stages/13-session-stage.ts · createPendingGateReviewIfNeeded · createReviewForStep(gateIds) · guarded here',
      'src/engine/execution/pipeline/stages/16-response-capture-stage.ts · landDetachedReport · openDetachedReview(gateIds) · opener guards',
      'src/engine/execution/pipeline/stages/16-response-capture-stage.ts · reviewInsertedNodeAfterRemainder · createReviewForStep(gateIds) · opener guards',
      'src/engine/gates/services/gate-enhancement-service.ts · ensurePostAdvanceReview · createReviewForStep(gateIds) · guarded here',
      'src/engine/gates/services/gate-verdict-processor.ts · answerVerdict · createReview(stepReviewGateIds(context)) · emptiness asked in file',
    ]);
  });

  test('each self-guarding opener refuses an empty set as its first statement', () => {
    expect(openerGuards()).toEqual([
      'createReviewForStep: if (gateIds.length === 0) { return null; }',
      'openDetachedReview: if (gateIds.length === 0) { return null; }',
    ]);
  });

  test('control: the scan names a planted caller passing an empty or unguarded set', () => {
    const planted = [
      'class Planted {',
      '  async emptyLiteral(authority: any) {',
      "    await authority.createReview('s', 'gate', 'n', { gateIds: [], instructions: '' });",
      '  }',
      '  async emptyToStep(authority: any, context: any, session: any) {',
      '    await authority.createReviewForStep(context, session, []);',
      '  }',
      '  async unguarded(authority: any, gateIds: string[]) {',
      "    await authority.createReview('s', 'gate', 'n', { gateIds, instructions: '' });",
      '  }',
      '  async guardedAfter(authority: any, gateIds: string[]) {',
      "    await authority.createReview('s', 'gate', 'n', { gateIds });",
      '    if (gateIds.length === 0) return;',
      '  }',
      '  async guarded(authority: any, gateIds: string[]) {',
      '    if (gateIds.length === 0) return;',
      "    await authority.createReview('s', 'gate', 'n', { gateIds });",
      '  }',
      '}',
    ].join('\n');
    expect(scanOpeners('planted.ts', planted)).toEqual([
      'planted.ts · emptyLiteral · createReview([]) · DEFECT: an empty gate set',
      'planted.ts · emptyToStep · createReviewForStep([]) · DEFECT: an empty gate set',
      'planted.ts · unguarded · createReview(gateIds) · DEFECT: nothing refuses an empty gate set here',
      'planted.ts · guardedAfter · createReview(gateIds) · DEFECT: nothing refuses an empty gate set here',
      'planted.ts · guarded · createReview(gateIds) · guarded here',
    ]);
  });
});
