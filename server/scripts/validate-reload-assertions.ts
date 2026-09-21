#!/usr/bin/env tsx
/**
 * A reload test may not rest its verdict on catalog SIZE.
 *
 * WHY THIS EXISTS. `reloadPromptData` once rebuilt the live catalog from the primary root alone,
 * dropping the bundled tree and every overlay, and nothing noticed: the served count did not move,
 * because binding is deduped per shell — entries survive while their content stops tracking the
 * file. Measured 2026-09-11 (plan row P6.4): a reload test written as
 * `expect(after.convertedPrompts.length).toBe(before.convertedPrompts.length)` passed at HEAD AND
 * under the mutation that restores the single-directory load, while the content-reading suite in
 * `tests/integration/runtime/hot-reload-root-parity.integration.test.ts` failed 5 of 6. That suite
 * reads bodies on purpose, but a convention held by one file's comments stops nobody writing the
 * next count-based reload test.
 *
 * WHY A SCRIPT AND NOT A LINT RULE. ESLint ignores `tests/**` by configuration
 * (`eslint.config.js`, which prices un-ignoring it), so a rule would never see the files it exists
 * to police.
 *
 * THE UNIT IS ONE TEST CASE — an `it`/`test` callback, together with the `beforeEach`/`beforeAll`
 * hooks of the describe blocks around it and every same-file function it calls by name
 * (transitively). A case is judged on everything that runs for it, so a reload hidden in a helper
 * called `refresh()` still counts, and so does an assertion hidden in `expectServes()`.
 *
 * WHAT MAKES A CASE A RELOAD CASE — any one of:
 *
 *   1. it CALLS something whose name has `reload` as a word (`reloadPromptData`, `reload`,
 *      `hotReload`, `handleReload`, `triggerAuxiliaryReloads`) and whose leading word is not a
 *      construction or accessor verb ({@link NON_PERFORMING_VERBS}): `buildStyleAuxiliaryReloadConfig`
 *      builds a reload, it does not perform one;
 *   2. it calls a method on a value one of those builders returned — `registration.handler(event)`
 *      after `const registration = buildFrameworkAuxiliaryReloadConfig(...)` IS the reload;
 *   3. its OWN title names a reload. A describe title does not: it labels a scope, not what a case
 *      proves — measured on the first run, where `describe('Config Hot-Reload Behavior')` selected a
 *      case whose version-row count IS the property under test, not a proxy for served content.
 *
 * WHAT MAKES AN ASSERTION SIZE-SHAPED. The matcher is `toHaveLength`; or the subject or the
 * expected value is a `.length`/`.size` read (including arithmetic over one), or a local bound to
 * one — so `const n = list.length; expect(n).toBe(before)` is caught.
 *
 * WHAT CLEARS A CASE. One CONTENT assertion: any other expectation whose expected side carries a
 * value. A STATUS assertion does not clear it — `toBeDefined`, `toBeTruthy`, call-count matchers,
 * or `toBe(true|false|null|undefined)` — because a status reads the same over two catalogs that
 * differ only in content, which is exactly the defect.
 *
 * WHAT IT CANNOT SEE, stated so nobody rediscovers it:
 *
 *   - A content assertion that is still blind to content (`expect(ids).toContain('x')` when the
 *     defect keeps every id) clears the case. Whether an assertion can distinguish two catalogs is
 *     not lexically decidable; the claim here is only that size is never the SOLE evidence.
 *   - A reload triggered only by writing a watched file and polling, from a case whose own title
 *     and callees never say `reload`, is not selected — even inside a describe that does.
 *   - Helpers are followed by identifier call only (`helper()`), not through `this.helper()`, an
 *     imported function, or a method on a local class.
 *   - The scan walks the working tree, so an untracked test file is judged too.
 *
 * `--self-test` drives the predicate over the motivating shape and a twin differing in one
 * assertion, then the live tree. `--report` prints every size assertion found in a reload case
 * with its classification.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(SERVER_ROOT, 'tests');

/** Words that may carry `reload` in a name without performing one: builders, accessors, subscriptions. */
const NON_PERFORMING_VERBS: ReadonlySet<string> = new Set([
  'build',
  'create',
  'make',
  'set',
  'get',
  'is',
  'has',
  'on',
  'register',
]);

const RELOAD_WORDS: ReadonlySet<string> = new Set(['reload', 'reloads', 'reloaded', 'reloading']);

/** Matchers whose verdict is a status, not a value. */
const STATUS_MATCHERS: ReadonlySet<string> = new Set([
  'toBeDefined',
  'toBeUndefined',
  'toBeTruthy',
  'toBeFalsy',
  'toBeNull',
  'toBeNaN',
  'toBeInstanceOf',
  'toHaveBeenCalled',
  'toHaveBeenCalledTimes',
]);

const EQUALITY_MATCHERS: ReadonlySet<string> = new Set(['toBe', 'toEqual', 'toStrictEqual']);
const MODIFIERS: ReadonlySet<string> = new Set(['not', 'resolves', 'rejects']);

type AssertionKind = 'size' | 'status' | 'content';

interface Assertion {
  readonly line: number;
  readonly kind: AssertionKind;
  readonly text: string;
}

interface CaseVerdict {
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly reload: boolean;
  readonly assertions: readonly Assertion[];
}

type FunctionLike = ts.FunctionLikeDeclaration;

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

function namesReload(name: string): boolean {
  return words(name).some((word) => RELOAD_WORDS.has(word));
}

function performsReload(name: string): boolean {
  const parts = words(name);
  return parts.some((word) => RELOAD_WORDS.has(word)) && !NON_PERFORMING_VERBS.has(parts[0] ?? '');
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The name a call reaches: `f()` → f, `a.b.f()` → f, `a?.f()` → f. */
function calleeName(call: ts.CallExpression): string | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** The identifier a method call is made on: `registration.handler()` → registration. */
function receiverName(call: ts.CallExpression): string | undefined {
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  let receiver = unwrap(callee.expression);
  while (ts.isPropertyAccessExpression(receiver)) receiver = unwrap(receiver.expression);
  return ts.isIdentifier(receiver) ? receiver.text : undefined;
}

function literalTitle(node: ts.Expression | undefined): string {
  if (node === undefined) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => span.literal.text).join(' ');
  }
  return '';
}

/** `it`, `test.only`, `it.each(table)` → 'it' / 'test'; `describe.skip` → 'describe'. */
function blockKind(call: ts.CallExpression): 'case' | 'describe' | 'hook' | undefined {
  let callee: ts.Expression = call.expression;
  if (ts.isCallExpression(callee)) callee = callee.expression;
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  if (!ts.isIdentifier(callee)) return undefined;
  if (callee.text === 'it' || callee.text === 'test') return 'case';
  if (callee.text === 'describe') return 'describe';
  if (callee.text === 'beforeEach' || callee.text === 'beforeAll') return 'hook';
  return undefined;
}

function callbackOf(call: ts.CallExpression): FunctionLike | undefined {
  for (let i = call.arguments.length - 1; i >= 0; i -= 1) {
    const argument = call.arguments[i];
    if (argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
      return argument;
    }
  }
  return undefined;
}

/** Every named function in the file, by the name a case would call it with. */
function indexLocalFunctions(sourceFile: ts.SourceFile): Map<string, FunctionLike[]> {
  const index = new Map<string, FunctionLike[]>();
  const add = (name: string, fn: FunctionLike): void => {
    index.set(name, [...(index.get(name) ?? []), fn]);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      add(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return index;
}

/** The case callback, its hooks, and every same-file function they reach by identifier call. */
function expandScope(roots: readonly ts.Node[], locals: Map<string, FunctionLike[]>): ts.Node[] {
  const seen = new Set<ts.Node>();
  const queue = [...roots];
  const out: ts.Node[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    out.push(node);
    const visit = (child: ts.Node): void => {
      if (ts.isCallExpression(child) && ts.isIdentifier(unwrap(child.expression))) {
        for (const fn of locals.get((unwrap(child.expression) as ts.Identifier).text) ?? []) {
          queue.push(fn);
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  }
  return out;
}

function forEachDescendant(roots: readonly ts.Node[], fn: (_node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    fn(node);
    ts.forEachChild(node, visit);
  };
  for (const root of roots) visit(root);
}

function reachesReload(scope: readonly ts.Node[]): boolean {
  // Pass 1: locals bound to the result of any reload-named call, including builders.
  const reloadBindings = new Set<string>();
  forEachDescendant(scope, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const init = unwrap(node.initializer);
      const name = ts.isCallExpression(init) ? calleeName(init) : undefined;
      if (name !== undefined && namesReload(name)) reloadBindings.add(node.name.text);
    }
  });
  // Pass 2: a performing call, or a method call on one of those bindings.
  let found = false;
  forEachDescendant(scope, (node) => {
    if (found || !ts.isCallExpression(node)) return;
    const name = calleeName(node);
    const receiver = receiverName(node);
    if (
      (name !== undefined && performsReload(name)) ||
      (receiver !== undefined && reloadBindings.has(receiver))
    ) {
      found = true;
    }
  });
  return found;
}

function isSizeExpression(node: ts.Expression, sizeLocals: ReadonlySet<string>): boolean {
  const expr = unwrap(node);
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text === 'length' || expr.name.text === 'size';
  }
  if (ts.isIdentifier(expr)) return sizeLocals.has(expr.text);
  if (ts.isBinaryExpression(expr)) {
    return isSizeExpression(expr.left, sizeLocals) || isSizeExpression(expr.right, sizeLocals);
  }
  return false;
}

function isStatusLiteral(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  const expr = unwrap(node);
  return (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) && expr.text === 'undefined')
  );
}

/** `expect(subject)[.not|.resolves]*.matcher(args)` → its parts, or undefined. */
function expectationParts(
  call: ts.CallExpression
): { subject: ts.Expression | undefined; matcher: string } | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const matcher = call.expression.name.text;
  let receiver = call.expression.expression;
  while (ts.isPropertyAccessExpression(receiver) && MODIFIERS.has(receiver.name.text)) {
    receiver = receiver.expression;
  }
  if (
    !ts.isCallExpression(receiver) ||
    !ts.isIdentifier(receiver.expression) ||
    receiver.expression.text !== 'expect'
  ) {
    return undefined;
  }
  return { subject: receiver.arguments[0], matcher };
}

function collectAssertions(scope: readonly ts.Node[], sourceFile: ts.SourceFile): Assertion[] {
  const sizeLocals = new Set<string>();
  forEachDescendant(scope, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isSizeExpression(node.initializer, sizeLocals)
    ) {
      sizeLocals.add(node.name.text);
    }
  });

  const assertions: Assertion[] = [];
  forEachDescendant(scope, (node) => {
    if (!ts.isCallExpression(node)) return;
    const parts = expectationParts(node);
    if (parts === undefined) return;
    const expected = node.arguments[0];
    let kind: AssertionKind;
    if (
      parts.matcher === 'toHaveLength' ||
      (parts.subject !== undefined && isSizeExpression(parts.subject, sizeLocals)) ||
      (expected !== undefined && isSizeExpression(expected, sizeLocals))
    ) {
      kind = 'size';
    } else if (
      STATUS_MATCHERS.has(parts.matcher) ||
      (EQUALITY_MATCHERS.has(parts.matcher) && isStatusLiteral(expected))
    ) {
      kind = 'status';
    } else {
      kind = 'content';
    }
    assertions.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      kind,
      text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120),
    });
  });
  return assertions;
}

/** Every test case in one file, with whether it reloads and what it asserts. */
function judgeFile(fileName: string, source: string): CaseVerdict[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const locals = indexLocalFunctions(sourceFile);
  const verdicts: CaseVerdict[] = [];

  const visit = (node: ts.Node, hooks: readonly ts.Node[]): void => {
    if (ts.isCallExpression(node)) {
      const kind = blockKind(node);
      const callback = callbackOf(node);
      if (kind === 'case' && callback !== undefined) {
        const title = literalTitle(node.arguments[0]);
        const scope = expandScope([callback, ...hooks], locals);
        verdicts.push({
          file: fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          title,
          reload: namesReload(title) || reachesReload(scope),
          assertions: collectAssertions(scope, sourceFile),
        });
        return;
      }
      if (kind === 'describe' && callback !== undefined && callback.body !== undefined) {
        const ownHooks: ts.Node[] = [];
        if (ts.isBlock(callback.body)) {
          for (const statement of callback.body.statements) {
            if (
              ts.isExpressionStatement(statement) &&
              ts.isCallExpression(statement.expression) &&
              blockKind(statement.expression) === 'hook'
            ) {
              const hook = callbackOf(statement.expression);
              if (hook !== undefined) ownHooks.push(hook);
            }
          }
        }
        ts.forEachChild(callback.body, (child) => visit(child, [...hooks, ...ownHooks]));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, hooks));
  };

  visit(sourceFile, []);
  return verdicts;
}

function isVacuous(verdict: CaseVerdict): boolean {
  return (
    verdict.reload &&
    verdict.assertions.some((a) => a.kind === 'size') &&
    !verdict.assertions.some((a) => a.kind === 'content')
  );
}

function testFilesUnder(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...testFilesUnder(full));
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ============================================================================
// Self-test — the motivating shape, and twins that each differ in one thing
// ============================================================================

interface SelfTestCase {
  readonly name: string;
  readonly source: string;
  readonly reports: boolean;
}

const SIZE_ONLY_BODY = [
  '  const before = await reloadPromptData(deps);',
  '  await writePrompt(bundled, "bundled_only", "EDITED");',
  '  const after = await reloadPromptData(deps);',
  '  expect(after.convertedPrompts.length).toBe(before.convertedPrompts.length);',
];
const CONTENT_LINE =
  '  expect(after.convertedPrompts.find((p) => p.id === "bundled_only")?.userMessageTemplate).toContain("EDITED");';

const inCase = (lines: readonly string[], title = 'keeps the catalog after an edit'): string =>
  `it('${title}', async () => {\n${lines.join('\n')}\n});\n`;

function selfTestCases(): SelfTestCase[] {
  return [
    {
      name: 'MOTIVATING — a reload case whose only evidence is a before/after size comparison',
      source: inCase(SIZE_ONLY_BODY),
      reports: true,
    },
    {
      name: 'TWIN + one content assertion — size beside a body read on the same reload',
      source: inCase([...SIZE_ONLY_BODY, CONTENT_LINE]),
      reports: false,
    },
    {
      name: 'TWIN, not a reload — `loadPromptData` for `reloadPromptData`, same size assertion',
      source: inCase(
        SIZE_ONLY_BODY.map((line) => line.replace('reloadPromptData', 'loadPromptData'))
      ),
      reports: false,
    },
    {
      name: 'TWIN + a status assertion — `toBe(true)` does not read content, so it still reports',
      source: inCase([...SIZE_ONLY_BODY, '  expect(after.success).toBe(true);']),
      reports: true,
    },
    {
      name: 'TWIN via a local — `const n = list.length; expect(n).toBe(before)`',
      source: inCase([
        ...SIZE_ONLY_BODY.slice(0, 3),
        '  const count = after.convertedPrompts.length;',
        '  expect(count).toBe(3);',
      ]),
      reports: true,
    },
    {
      name: 'TWIN via a helper — the reload sits in `refresh()`, a same-file function',
      source:
        'const refresh = async () => reloadPromptData(deps);\n' +
        inCase([
          '  const before = await refresh();',
          '  const after = await refresh();',
          '  expect(after.ids).toHaveLength(before.ids.length);',
        ]),
      reports: true,
    },
    {
      name: 'TWIN in a hook — the reload runs in the describe’s beforeEach',
      source:
        "describe('catalog', () => {\n  let list: string[];\n" +
        '  beforeEach(async () => { list = (await reloadPromptData(deps)).ids; });\n' +
        inCase(['  expect(list).toHaveLength(3);']) +
        '});\n',
      reports: true,
    },
    {
      name: 'REGISTRATION HANDLER — a method on a reload builder’s result performs the reload',
      source: inCase([
        '  const registration = buildStyleAuxiliaryReloadConfig(logger, router);',
        '  await registration.handler(event);',
        '  expect(manager.listStyles()).toHaveLength(2);',
      ]),
      reports: true,
    },
    {
      name: 'BUILDER ONLY — building a reload config performs nothing, so its size is fine',
      source: inCase([
        '  const config = buildStyleAuxiliaryReloadConfig(logger, router);',
        '  expect(config.directories).toHaveLength(2);',
      ]),
      reports: false,
    },
    {
      name: 'TITLE — a case whose own title names a reload is a reload case',
      source: inCase(
        ['  const list = await client.listPrompts();', '  expect(list.length).toBe(2);'],
        'lists both prompts after a hot reload'
      ),
      reports: true,
    },
    {
      name: 'BLIND SPOT, asserted — the same case under a describe naming the reload is NOT selected',
      source:
        "describe('a prompt hot reload recomputes the set', () => {\n" +
        inCase(['  const list = await client.listPrompts();', '  expect(list.length).toBe(2);']) +
        '});\n',
      reports: false,
    },
  ];
}

function selfTest(): number {
  let failed = 0;
  for (const testCase of selfTestCases()) {
    const vacuous = judgeFile('probe.test.ts', testCase.source).some(isVacuous);
    const ok = vacuous === testCase.reports;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
    if (!ok) failed += 1;
  }
  const live = run({ quiet: true, report: false });
  console.log(
    `${live === 0 ? 'PASS' : 'FAIL'}  this checkout has no reload case resting on size alone`
  );
  if (live !== 0) failed += 1;
  return failed === 0 ? 0 : 1;
}

function run(options: { quiet: boolean; report: boolean }): number {
  const files = testFilesUnder(SCAN_ROOT);
  const verdicts = files.flatMap((file) =>
    judgeFile(path.relative(SERVER_ROOT, file), readFileSync(file, 'utf8'))
  );
  const reloadCases = verdicts.filter((verdict) => verdict.reload);
  const sized = reloadCases.filter((verdict) => verdict.assertions.some((a) => a.kind === 'size'));

  if (options.report) {
    for (const verdict of sized) {
      const shape = isVacuous(verdict) ? 'VACUOUS' : 'paired';
      console.log(`${shape}  ${verdict.file}:${verdict.line}  ${verdict.title}`);
      for (const assertion of verdict.assertions) {
        console.log(`    ${assertion.kind.padEnd(7)} :${assertion.line}  ${assertion.text}`);
      }
    }
  }

  // A null result needs a positive control: a scan that selects no reload case, or sees no size
  // assertion in any of them, would pass while observing nothing.
  if (reloadCases.length === 0 || sized.length === 0) {
    console.error(
      `✖ The scan selected ${reloadCases.length} reload case(s) and ${sized.length} with a size ` +
        `assertion under ${path.relative(SERVER_ROOT, SCAN_ROOT)}/. The live tree is known to ` +
        `hold both (hot-reload-root-parity.integration.test.ts pairs a size check with a body ` +
        `read on purpose), so zero means the predicate stopped observing, not that the tree is clean.`
    );
    return 1;
  }

  const vacuous = verdicts.filter(isVacuous);
  if (vacuous.length > 0) {
    for (const verdict of vacuous) {
      const sizes = verdict.assertions.filter((a) => a.kind === 'size');
      console.error(
        `✖ ${verdict.file}:${verdict.line} "${verdict.title}" reloads and asserts only size:\n` +
          sizes.map((a) => `    :${a.line}  ${a.text}`).join('\n')
      );
    }
    console.error(
      `\nA reload keeps every entry while its content can stop tracking the file, so a count is ` +
        `the same with and without the defect. Assert what the reload SERVES — a body, a field ` +
        `read from the reloaded entry — beside or instead of the size ` +
        `(see tests/integration/runtime/hot-reload-root-parity.integration.test.ts).`
    );
    return 1;
  }

  if (!options.quiet) {
    console.log(
      `✅ Reload assertions: ${files.length} test files, ${reloadCases.length} reload cases, ` +
        `${sized.length} with a size assertion — each beside a content assertion.`
    );
  }
  return 0;
}

const argv = process.argv.slice(2);
process.exit(
  argv.includes('--self-test')
    ? selfTest()
    : run({ quiet: false, report: argv.includes('--report') })
);
