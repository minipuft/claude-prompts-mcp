#!/usr/bin/env tsx
/**
 * A function that walks a prompts tree must take its skip rules from `prompt-layout.ts`.
 *
 * WHY THIS EXISTS. Several walks decide whether a directory entry is a prompt, and each one used to
 * carry its own copy of the rule. The copies disagreed: the loader recursed into `tools/` while the
 * indexer skipped it, the indexer descended into `_drafts/` while the loader skipped it, and the CI
 * prompt validator applied no skip at all. Every pass that fixed "all of them" worked from a list
 * of sites, and the list was short every time — four misses in one plan (P4-F32, R18–R22, P4.43,
 * P4.48). So this check does not read a list. It finds the walks by their SHAPE.
 *
 * THE SHAPE. A function is a prompts-tree walk when it
 *
 *   1. lists a directory: it calls `readdir` / `readdirSync` (bare, or as a property such as
 *      `fs.readdir` or `fs.promises.readdir`), in its own body or in a function nested inside it.
 *      A call whose result is read only for `.length` is an emptiness probe, not a listing; and
 *   2. references a prompt marker: a string containing `prompt.yaml`, a module-scope constant
 *      initialised to one, or any function `prompt-layout.ts` exports. The marker may sit in the
 *      function, in a function nested inside it, or in a same-file function it calls
 *      (`helper()`, `this.helper()`, followed transitively).
 *
 * The listing is NOT followed into callees, deliberately. A function that reads its own
 * `prompt.yaml` and calls a helper that lists `docs/` for `.md` files is not a prompts walk, and
 * following the listing reported three such functions on the first run.
 *
 * A PARAMETERISED WALK IS A WALK TOO. A lister that takes its entry filename, or its entry filter,
 * as an argument has no marker of its own. Its marker arrives at the call site, as in
 * `discoverResourcePaths(dir, 'prompt.yaml', true)` or `collectResourceDirs(roots, (name) =>
 * !isIgnoredPromptEntryName(name))`. So a call whose argument carries a marker (a literal, a marker
 * constant, or a callback that references one) makes the LISTER a walk. The lister is resolved in
 * the same file by name, or across files through a named import. Relative specifiers and the
 * server's `#alias/*` imports are both resolved. The cli's `@shared/*` alias is not followed for
 * this; the required-import test matches `prompt-layout` under any specifier.
 *
 * Only the innermost walk is reported: a walk whose callees include another walk is a caller of
 * that walk, not a second one.
 *
 * Every module holding a walk must value-import BOTH of `prompt-layout`'s directory predicates:
 * `isReservedPromptDirectoryName` (what a walk skips inside a category) and
 * `isExcludedCategoryDirectoryName` (which directories at the prompts root are categories at all).
 * The marker vocabulary is read from `prompt-layout.ts` itself, so a predicate added there becomes
 * a marker here without anyone editing this file.
 *
 * WHY THE IMPORT, AND NOT A CALL. A walk that imports the reserved-name predicate has adopted the
 * shared rules. A walk that restates them has not. An unused import already fails ESLint, so this
 * check does not repeat that test.
 *
 * WHY THE CATEGORY PREDICATE IS REQUIRED OF EVERY WALK, not only of walks that decide categories
 * (P4.53). The root decision has no single shape: a `depth === 0` branch, a `dir === root`
 * comparison, a nested listing, a callback named `isCategory`, or a function that lists the root
 * and nothing else. Recognising all of those means keying on names, and name-keyed checks have
 * undercounted on every pass of this plan. So every walk module imports the predicate, and a walk
 * that never starts at the prompts root says so with a waiver in EXCEPTIONS, where its reason can
 * go stale and be reported. The reverse holds for a walk that lists only the root: it waives the
 * reserved-name predicate, which applies below the category level.
 *
 * WHAT IT CANNOT SEE. Stated so nobody rediscovers it:
 *
 *   1. A WALK WITH NO MARKER ANYWHERE. A function that treats every directory two levels down as a
 *      prompt, never naming `prompt.yaml` and using no layout predicate, is invisible until it
 *      adopts one. `skills-sync`'s `collectPromptDirs` was exactly that before P4.48. The same
 *      holds for a function that lists only the prompts root: `prompt-watch-setup.ts` and the
 *      resource tool's private category scan restated the category rule inline, and neither was a
 *      walk to this check until P4.53 made them call the predicate. Reverting one to an inline
 *      filter makes it invisible again (as of 2026-09-16; closes when a root-listing function is
 *      recognisable without a marker).
 *   1b. A LISTING REACHED ONLY THROUGH A CALLEE, with the marker only in the caller and not passed
 *      as an argument. That is the price of the false positives described above.
 *   2. OTHER DIRECTORY APIS. `opendir`, `glob`, `fast-glob` and spawned `find` are not listings to
 *      this check. None is used on a prompts tree today (measured 2026-09-16).
 *   3. NAME-KEYED RESOLUTION. The same-file call graph is keyed by name, so two same-named methods
 *      in one file merge. That over-reports, which is the cheap direction. Cross-file resolution
 *      follows named imports only: a namespace import (`ws.discover(...)`) or a re-export is not
 *      followed.
 *   4. MARKERS BUILT AT RUNTIME. `'prompt' + '.yaml'`, or a filename read from a config table
 *      (`config.entryFile`), is invisible. `list.ts` passes its entry file that way, so the cli's
 *      walk is found through the layout predicates it calls, and `init.ts`'s literal call.
 *   5. ADOPTION IS NOT CORRECT USE. The check proves the import exists, not that the walk applies
 *      the predicate at the right depth. `tests/integration/prompts/` pins behaviour.
 *
 * THIS FILE IS NOT SCANNED. It lists source directories and names the marker in order to search
 * for it, which is the shape it detects. It is a scope boundary, not an exception: it walks no
 * prompts tree.
 *
 * DECLARED EXCEPTIONS, one table, each entry waiving named predicates with a reason. The watcher
 * lists only the prompts root, and the loader's per-category walk never stands there. Each entry is anchored by path. It fails closed when the file
 * disappears, and it fails as stale when the file stops being a walk or starts importing a
 * predicate it waives.
 *
 * `--self-test` drives the predicate over fixtures in both directions. Each fixture that must stay
 * silent differs from a reporting one in a single identifier. The run then checks the live tree.
 *
 * MECHANISM: script — relation — joins per-function call graphs to per-module import sets across
 * four source roots. No linter rule can see both halves.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const SELF = fileURLToPath(import.meta.url);

/** Every root where a prompts-tree walk has been found or could reasonably appear. */
const SCAN_ROOTS: readonly string[] = ['server/src', 'server/scripts', 'cli/src', 'scripts'];

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', 'dist', '_generated']);

/** The module that owns the rules, relative to the repo root. */
const LAYOUT_MODULE = 'server/src/shared/utils/prompt-layout.ts';
const RESERVED_PREDICATE = 'isReservedPromptDirectoryName';
const CATEGORY_PREDICATE = 'isExcludedCategoryDirectoryName';
/** Every walk module value-imports each of these from `prompt-layout`, unless waived below. */
const REQUIRED_IMPORTS: readonly string[] = [RESERVED_PREDICATE, CATEGORY_PREDICATE];
const PROMPT_FILE_MARKER = 'prompt.yaml';

/** The directory-listing calls that make a function a walk. */
const READDIR_NAMES: ReadonlySet<string> = new Set(['readdir', 'readdirSync']);

/**
 * Walk modules excused from importing named predicates, each with the reason. Keyed by
 * repo-relative path, then by the predicate waived.
 */
const EXCEPTIONS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    'server/src/modules/prompts/prompt-watch-setup.ts',
    new Map([
      [
        RESERVED_PREDICATE,
        '`discoverPromptDirectories` lists only the prompts root, where `tools` is an ordinary ' +
          'category; the reserved-name rule applies below the category level, which it never lists',
      ],
    ]),
  ],
  [
    'server/src/modules/prompts/yaml-prompt-loader.ts',
    new Map([
      [
        CATEGORY_PREDICATE,
        '`discoverYamlPrompts` walks from one category directory and never stands at the prompts ' +
          'root. `PromptLoader.loadFromDirectories` takes the categories from ' +
          '`discoverCategoryDirectories`, which applies the category predicate',
      ],
    ]),
  ],
]);

/**
 * The loader's walk, which the detector must find, as a positive control.
 *
 * If the detector finds nothing, it has stopped observing the tree. This walk DEFINES the served
 * catalog, so a detector that misses it is broken, whatever else it reports.
 */
const CONTROL_WALK = 'server/src/modules/prompts/yaml-prompt-loader.ts';

export interface PromptWalk {
  /** Repo-relative path. */
  readonly file: string;
  readonly line: number;
  /** The walking function's name, or `<anonymous>` / `<module>`. */
  readonly name: string;
}

/** A call, in this module, whose argument carries a marker, to a function imported by name. */
interface MarkerArgumentCall {
  readonly specifier: string;
  readonly importedName: string;
}

export interface ModuleReport {
  /** Walks decided within this file alone. */
  readonly walks: PromptWalk[];
  /** Functions that list directories, by callable name, for cross-file parameterised walks. */
  readonly listers: ReadonlyMap<string, PromptWalk>;
  readonly markerArgumentCalls: MarkerArgumentCall[];
  /** The required predicates this module value-imports from `prompt-layout`. */
  readonly importedPredicates: ReadonlySet<string>;
}

type FunctionNode = ts.SignatureDeclaration & { body?: ts.Node };
type Scope = FunctionNode | ts.SourceFile;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function parse(fileName: string, source: string): ts.SourceFile {
  const kind = /\.(c|m)?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, kind);
}

/** The names `prompt-layout.ts` exports as functions — the marker vocabulary, read, not restated. */
export function readLayoutPredicateNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const statement of parse('prompt-layout.ts', source).statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
    const exported = ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported === true) names.add(statement.name.text);
  }
  return names;
}

/** True when the call's result is read only for `.length` — an emptiness probe. */
function isEmptinessProbe(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  while (
    ts.isAwaitExpression(current.parent) ||
    ts.isParenthesizedExpression(current.parent) ||
    ts.isNonNullExpression(current.parent)
  ) {
    current = current.parent;
  }
  return ts.isPropertyAccessExpression(current.parent) && current.parent.name.text === 'length';
}

/** True for a directory listing: `readdir(...)`, `x.readdirSync(...)`, not an emptiness probe. */
function isListingCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name !== undefined && READDIR_NAMES.has(name) && !isEmptinessProbe(node);
}

/** The same-file function a call resolves to by name: `helper()` or `this.helper()`. */
function calleeName(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return callee.name.text;
  }
  return undefined;
}

function literalCarriesMarker(node: ts.Node): boolean {
  return (
    (ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)) &&
    node.text.includes(PROMPT_FILE_MARKER)
  );
}

/** The name a function node can be called by within its file, when it has one. */
function functionName(node: FunctionNode): string | undefined {
  if (
    node.name !== undefined &&
    (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))
  ) {
    return node.name.text;
  }
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return undefined;
}

/** Module-scope `const X = '…prompt.yaml…'` — references to `X` are markers too. */
function markerConstants(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init !== undefined && literalCarriesMarker(init)) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

/** Value imports by local name: `import { a as b } from 'x'` → `b → { x, a }`. */
function namedImports(sourceFile: ts.SourceFile): Map<string, MarkerArgumentCall> {
  const imports = new Map<string, MarkerArgumentCall>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      imports.set(element.name.text, {
        specifier,
        importedName: (element.propertyName ?? element.name).text,
      });
    }
  }
  return imports;
}

function isLayoutSpecifier(specifier: string): boolean {
  return /(^|\/)prompt-layout(\.[cm]?[jt]s)?$/.test(specifier);
}

/** Every prompts-tree walk this module shows on its own, plus what cross-file resolution needs. */
export function analyzeModule(
  fileName: string,
  source: string,
  layoutNames: ReadonlySet<string>
): ModuleReport {
  const sourceFile = parse(fileName, source);
  const constants = markerConstants(sourceFile);
  const imports = namedImports(sourceFile);

  const isDirectMarker = (node: ts.Node): boolean => {
    if (literalCarriesMarker(node)) return true;
    if (!ts.isIdentifier(node)) return false;
    // An import specifier names the predicate without using it; only body references count.
    if (ts.isImportSpecifier(node.parent)) return false;
    return layoutNames.has(node.text) || constants.has(node.text);
  };

  /** Whether any node below `root`, nested functions included, satisfies `test`. */
  const subtreeHas = (root: ts.Node, test: (_node: ts.Node) => boolean): boolean => {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (test(node)) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(root, visit);
    return found;
  };

  const byName = new Map<string, FunctionNode[]>();
  const scopes: Scope[] = [sourceFile];
  const markerArgumentCalls: MarkerArgumentCall[] = [];

  const calls: ts.CallExpression[] = [];
  const index = (node: ts.Node): void => {
    if (isFunctionNode(node)) {
      scopes.push(node);
      const name = functionName(node);
      if (name !== undefined) byName.set(name, [...(byName.get(name) ?? []), node]);
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) calls.push(node);
    ts.forEachChild(node, index);
  };
  index(sourceFile);

  /**
   * A literal or constant naming the marker, or a callback that references one — inline, or passed
   * by the name of a same-file function (`collectResourceDirs(roots, isPromptDir)`).
   */
  const isMarkerArgument = (node: ts.Node): boolean => {
    if (literalCarriesMarker(node)) return true;
    if (isFunctionNode(node)) return subtreeHas(node, isDirectMarker);
    if (!ts.isIdentifier(node)) return false;
    if (constants.has(node.text)) return true;
    return (byName.get(node.text) ?? []).some((fn) => subtreeHas(fn, isDirectMarker));
  };

  const sameFileMarkerTargets: string[] = [];
  for (const call of calls) {
    if (!call.arguments.some(isMarkerArgument)) continue;
    const callee = calleeName(call);
    if (callee === undefined) continue;
    const imported = imports.get(callee);
    if (imported !== undefined && ts.isIdentifier(call.expression)) {
      markerArgumentCalls.push(imported);
    } else {
      sameFileMarkerTargets.push(callee);
    }
  }

  /** Same-file functions a scope calls, and the functions nested inside it. */
  const reachable = (scope: Scope): FunctionNode[] => {
    const out: FunctionNode[] = [];
    const visit = (node: ts.Node): void => {
      if (isFunctionNode(node)) {
        if (scope !== sourceFile) out.push(node);
        return; // a nested function is its own subject; its facts arrive through `out`
      }
      const callee = calleeName(node);
      if (callee !== undefined) {
        for (const target of byName.get(callee) ?? []) if (target !== scope) out.push(target);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(scope, visit);
    return out;
  };

  /** Whether a scope's own body (nested functions excluded) satisfies `test`. */
  const ownBodyHas = (scope: Scope, test: (_node: ts.Node) => boolean): boolean => {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found || isFunctionNode(node)) return;
      if (test(node)) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(scope, visit);
    return found;
  };

  const transitively = (test: (_node: ts.Node) => boolean): ((_scope: Scope) => boolean) => {
    const memo = new Map<Scope, boolean>();
    const has = (scope: Scope): boolean => {
      const known = memo.get(scope);
      if (known !== undefined) return known;
      memo.set(scope, false); // cycle guard: a recursive function does not prove itself
      const result = ownBodyHas(scope, test) || reachable(scope).some(has);
      memo.set(scope, result);
      return result;
    };
    return has;
  };

  /** Own body plus nested functions — never callees (see the header). */
  const lists = (scope: Scope): boolean =>
    scope === sourceFile ? ownBodyHas(scope, isListingCall) : subtreeHas(scope, isListingCall);
  const marks = transitively(isDirectMarker);
  const markedByArgument = new Set<FunctionNode>(
    sameFileMarkerTargets.flatMap((name) => (byName.get(name) ?? []).filter(lists))
  );
  const isWalk = (scope: Scope): boolean =>
    lists(scope) && (marks(scope) || markedByArgument.has(scope as FunctionNode));

  const describe = (scope: Scope): PromptWalk => ({
    file: fileName,
    line: sourceFile.getLineAndCharacterOfPosition(scope.getStart(sourceFile)).line + 1,
    name:
      scope === sourceFile ? '<module>' : (functionName(scope as FunctionNode) ?? '<anonymous>'),
  });

  const walks = scopes
    .filter((scope) => isWalk(scope) && !reachable(scope).some(isWalk))
    .map(describe);

  const listers = new Map<string, PromptWalk>();
  for (const [name, nodes] of byName) {
    const lister = nodes.find(lists);
    if (lister !== undefined) listers.set(name, describe(lister));
  }

  const importedPredicates = new Set(
    [...imports.values()]
      .filter(
        (binding) =>
          REQUIRED_IMPORTS.includes(binding.importedName) && isLayoutSpecifier(binding.specifier)
      )
      .map((binding) => binding.importedName)
  );

  return { walks, listers, markerArgumentCalls, importedPredicates };
}

function sourceFilesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) out.push(...sourceFilesUnder(full));
    } else if (
      SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** `server/package.json#imports`, so `#shared/x.js` resolves the way Node resolves it. */
function readImportAliases(): Array<{ prefix: string; target: string }> {
  const manifest = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
    imports?: Record<string, string>;
  };
  return Object.entries(manifest.imports ?? {})
    .filter(([key, value]) => key.endsWith('/*') && value.endsWith('/*'))
    .map(([key, value]) => ({
      prefix: key.slice(0, -1),
      target: path.relative(REPO_ROOT, path.join(SERVER_ROOT, value.slice(0, -1))),
    }));
}

/** The repo-relative source file an import specifier names, or `undefined` for a package. */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  aliases: ReadonlyArray<{ prefix: string; target: string }>,
  known: ReadonlySet<string>
): string | undefined {
  let base: string | undefined;
  if (specifier.startsWith('.')) {
    base = path.posix.join(path.posix.dirname(fromFile), specifier);
  } else if (fromFile.startsWith('server/')) {
    const alias = aliases.find((candidate) => specifier.startsWith(candidate.prefix));
    if (alias !== undefined) {
      base = path.posix.join(
        alias.target.split(path.sep).join('/'),
        specifier.slice(alias.prefix.length)
      );
    }
  }
  if (base === undefined) return undefined;
  const stem = base.replace(/\.[cm]?[jt]s$/, '');
  return [base, ...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`)].find((candidate) =>
    known.has(candidate)
  );
}

interface TreeResult {
  readonly walks: PromptWalk[];
  readonly problems: string[];
  readonly filesScanned: number;
}

/** The required predicates a module neither imports nor has waived. */
function missingPredicates(file: string, report: ModuleReport | undefined): string[] {
  const waived = EXCEPTIONS.get(file);
  return REQUIRED_IMPORTS.filter(
    (name) => report?.importedPredicates.has(name) !== true && waived?.has(name) !== true
  );
}

/** Exception entries whose file is gone, no longer walks, or now imports what it waives. */
function staleExceptions(
  reports: ReadonlyMap<string, ModuleReport>,
  walksByFile: ReadonlyMap<string, PromptWalk[]>
): string[] {
  const problems: string[] = [];
  for (const [file, waivers] of EXCEPTIONS) {
    const report = reports.get(file);
    if (report === undefined) {
      const reasons = [...waivers.values()].join('; ');
      problems.push(
        `exception \`${file}\` names no scanned file. Delete the entry, or update the path if the ` +
          `file moved (reasons on record: ${reasons})`
      );
    } else if (!walksByFile.has(file)) {
      problems.push(`exception \`${file}\` is stale: the file no longer walks a prompts tree`);
    } else {
      for (const name of waivers.keys()) {
        if (report.importedPredicates.has(name)) {
          problems.push(`exception \`${file}\` is stale: the file now imports \`${name}\``);
        }
      }
    }
  }
  return problems;
}

function checkTree(): TreeResult {
  const problems: string[] = [];
  const layoutPath = path.join(REPO_ROOT, LAYOUT_MODULE);
  if (!existsSync(layoutPath)) {
    return {
      walks: [],
      problems: [`${LAYOUT_MODULE} is missing — the rules this check enforces have no owner`],
      filesScanned: 0,
    };
  }
  const layoutNames = readLayoutPredicateNames(readFileSync(layoutPath, 'utf8'));
  for (const required of REQUIRED_IMPORTS) {
    if (!layoutNames.has(required)) {
      problems.push(`${LAYOUT_MODULE} no longer exports \`${required}\``);
    }
  }

  const reports = new Map<string, ModuleReport>();
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFilesUnder(path.join(REPO_ROOT, root))) {
      if (file === SELF) continue;
      const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      reports.set(relative, analyzeModule(relative, readFileSync(file, 'utf8'), layoutNames));
    }
  }

  // Parameterised walks: a marker passed to an imported lister makes the lister a walk.
  const aliases = readImportAliases();
  const known = new Set(reports.keys());
  const walksByFile = new Map<string, PromptWalk[]>();
  const addWalk = (walk: PromptWalk): void => {
    const list = walksByFile.get(walk.file) ?? [];
    if (!list.some((existing) => existing.line === walk.line)) list.push(walk);
    walksByFile.set(walk.file, list);
  };
  for (const [file, report] of reports) {
    report.walks.forEach(addWalk);
    for (const call of report.markerArgumentCalls) {
      const target = resolveSpecifier(file, call.specifier, aliases, known);
      const lister =
        target === undefined ? undefined : reports.get(target)?.listers.get(call.importedName);
      if (lister !== undefined) addWalk(lister);
    }
  }

  const walks = [...walksByFile.values()]
    .flat()
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  for (const walk of walks) {
    const missing = missingPredicates(walk.file, reports.get(walk.file));
    if (missing.length === 0) continue;
    problems.push(
      `${walk.file}:${walk.line} \`${walk.name}\` walks a prompts tree, but the module does not ` +
        `import ${missing.map((name) => `\`${name}\``).join(' or ')} from prompt-layout`
    );
  }

  problems.push(...staleExceptions(reports, walksByFile));

  if (!walksByFile.has(CONTROL_WALK)) {
    problems.push(
      `the detector did not find the loader's walk in ${CONTROL_WALK}, so it is not observing ` +
        `what it claims. Fix the detector, or update CONTROL_WALK if the loader moved`
    );
  }

  return { walks, problems, filesScanned: reports.size };
}

function run(): number {
  const { walks, problems, filesScanned } = checkTree();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    console.error(
      `\nEvery prompts-tree walk must skip what the loader skips. Take the rules from ` +
        `\`${LAYOUT_MODULE}\` (\`isIgnoredPromptEntryName\`, \`${RESERVED_PREDICATE}\`, ` +
        `\`${CATEGORY_PREDICATE}\`, \`isSingleFilePromptName\`). Do not restate them. A walk ` +
        `that cannot import one needs a waiver in EXCEPTIONS with its reason.`
    );
    return 1;
  }
  console.log(
    `✅ Prompt walks: ${filesScanned} files scanned, ${walks.length} prompts-tree walks found, ` +
      `each in a module that imports ${REQUIRED_IMPORTS.map((name) => `\`${name}\``).join(' and ')} ` +
      `or waives one in a declared exception:`
  );
  for (const walk of walks) {
    const waived = [...(EXCEPTIONS.get(walk.file)?.keys() ?? [])];
    const note = waived.length > 0 ? ` (waives ${waived.join(', ')})` : '';
    console.log(`   ${walk.file}:${walk.line} ${walk.name}${note}`);
  }
  return 0;
}

// ============================================================================
// Self-test — both directions, each silent case one identifier from a reporting one
// ============================================================================

interface SelfTestCase {
  readonly name: string;
  readonly source: string;
  readonly reports: boolean;
  readonly fileName?: string;
}

const LAYOUT_IMPORT = `import { isExcludedCategoryDirectoryName, isReservedPromptDirectoryName } from '#shared/utils/prompt-layout.js';\n`;

const LITERAL_WALK = `import { readdirSync } from 'node:fs';
export function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'prompt.yaml') return e;
  }
}
`;

const CLASS_WALK = `import * as fs from 'node:fs/promises';
export class Indexer {
  async scan(dir: string) {
    for (const e of await fs.readdir(dir)) this.consider(e);
  }
  private consider(name: string) { return this.fileFor() === name; }
  private fileFor() { return 'prompt.yaml'; }
}
`;

const CALLBACK_LISTER = `import { readdir } from 'node:fs/promises';
import { isIgnoredPromptEntryName } from '#shared/utils/prompt-layout.js';
async function listDirs(root: string, keep: (name: string) => boolean) {
  return (await readdir(root)).filter(keep);
}
export const collectPrompts = (root: string) =>
  listDirs(root, (name) => !isIgnoredPromptEntryName(name));
`;

const CALLEE_ONLY_LISTS = `import { readdir, readFile } from 'node:fs/promises';
async function loadDocs(dir: string) { return readdir(dir + '/docs'); }
export async function loadPrompt(dir: string) {
  await readFile(dir + '/prompt.yaml');
  return loadDocs(dir);
}
`;

const EMPTINESS_PROBE = `import { readdirSync, writeFileSync } from 'node:fs';
export function init(dir: string) {
  if (readdirSync(dir).length > 0) return;
  writeFileSync(dir + '/prompt.yaml', '');
}
`;

function selfTestCases(): SelfTestCase[] {
  return [
    { name: "readdirSync + 'prompt.yaml', no import", source: LITERAL_WALK, reports: true },
    {
      name: 'TWIN — the same walk importing the predicate',
      source: LAYOUT_IMPORT + LITERAL_WALK,
      reports: false,
    },
    {
      name: 'TWIN — the same walk importing only the reserved-name predicate',
      source: LAYOUT_IMPORT.replace('isExcludedCategoryDirectoryName, ', '') + LITERAL_WALK,
      reports: true,
    },
    {
      name: 'TWIN — the same walk importing only the category predicate',
      source: LAYOUT_IMPORT.replace(', isReservedPromptDirectoryName', '') + LITERAL_WALK,
      reports: true,
    },
    {
      name: 'a function listing only the root, with the category predicate as its marker',
      source: `import { readdirSync } from 'node:fs';
export const categories = (root: string) =>
  readdirSync(root).filter((name) => !isExcludedCategoryDirectoryName(name));
`,
      reports: true,
    },
    {
      name: "TWIN — the same walk looking for 'gate.yaml' is not a prompts walk",
      source: LITERAL_WALK.replace('prompt.yaml', 'gate.yaml'),
      reports: false,
    },
    {
      name: 'TWIN — the predicate imported from a homonym module does not count',
      source: LAYOUT_IMPORT.replace('prompt-layout', 'other-layout') + LITERAL_WALK,
      reports: true,
    },
    {
      name: 'TWIN — a type-only import does not count',
      source: LAYOUT_IMPORT.replace('import {', 'import type {') + LITERAL_WALK,
      reports: true,
    },
    {
      name: 'a layout predicate as the marker (fs.promises.readdir form)',
      source: `import { isSingleFilePromptName } from '#shared/utils/prompt-layout.js';
import * as fs from 'node:fs';
export async function walk(dir: string) {
  const entries = await fs.promises.readdir(dir);
  return entries.filter((name) => isSingleFilePromptName(name));
}
`,
      reports: true,
    },
    { name: 'the marker reached through `this.helper()`', source: CLASS_WALK, reports: true },
    {
      name: 'TWIN — the same class whose helper names a gate file',
      source: CLASS_WALK.replace('prompt.yaml', 'gate.yaml'),
      reports: false,
    },
    {
      name: 'a same-file lister handed a callback that names a layout predicate',
      source: CALLBACK_LISTER,
      reports: true,
    },
    {
      name: 'the same callback passed by the name of a same-file function',
      source: CALLBACK_LISTER.replace(
        'listDirs(root, (name) => !isIgnoredPromptEntryName(name));',
        'listDirs(root, keepPrompt);\nconst keepPrompt = (name: string) => !isIgnoredPromptEntryName(name);'
      ),
      reports: true,
    },
    {
      name: 'TWIN — the same callback naming no marker',
      source: CALLBACK_LISTER.replace('!isIgnoredPromptEntryName(name)', "!name.startsWith('_')"),
      reports: false,
    },
    {
      name: 'a callee that lists docs/ does not make its prompt-reading caller a walk',
      source: CALLEE_ONLY_LISTS,
      reports: false,
    },
    {
      name: 'a readdir read for `.length` only is a probe',
      source: EMPTINESS_PROBE,
      reports: false,
    },
    {
      name: 'TWIN — the same readdir read for its entries is a listing',
      source: EMPTINESS_PROBE.replace(
        'readdirSync(dir).length > 0',
        'readdirSync(dir).some(Boolean)'
      ),
      reports: true,
    },
    {
      name: 'a module-scope constant as the marker',
      source: `import { readdirSync } from 'node:fs';
const PROMPT_FILE = 'prompt.yaml';
export const walk = (dir: string) => readdirSync(dir).filter((n) => n === PROMPT_FILE);
`,
      reports: true,
    },
    {
      name: 'a readdir with the marker only in an UNRELATED function is not a walk',
      source: `import { readdirSync, existsSync } from 'node:fs';
export const list = (dir: string) => readdirSync(dir);
export const hasPrompt = (dir: string) => existsSync(dir + '/prompt.yaml');
`,
      reports: false,
    },
    {
      name: 'a plain JavaScript script is parsed too',
      fileName: 'probe.js',
      source: `const fs = require('node:fs');
function walk(dir) { return fs.readdirSync(dir).includes('prompt.yaml'); }
`,
      reports: true,
    },
  ];
}

/** A parameterised lister and its caller, the cross-file half, analysed as a two-module tree. */
function crossFileCase(markerLiteral: string): boolean {
  const layoutNames = new Set(REQUIRED_IMPORTS);
  const lister = analyzeModule(
    'cli/src/lib/walk.ts',
    `import { readdirSync, existsSync } from 'node:fs';
export function discover(dir: string, entryFile: string) {
  return readdirSync(dir).filter((name) => existsSync(dir + '/' + name + '/' + entryFile));
}
`,
    layoutNames
  );
  const caller = analyzeModule(
    'cli/src/commands/init.ts',
    `import { discover } from '../lib/walk.js';\nexport const run = () => discover('.', '${markerLiteral}');\n`,
    layoutNames
  );
  const target = resolveSpecifier(
    'cli/src/commands/init.ts',
    caller.markerArgumentCalls[0]?.specifier ?? '',
    [],
    new Set(['cli/src/lib/walk.ts'])
  );
  const importedName = caller.markerArgumentCalls[0]?.importedName ?? '';
  return (
    lister.walks.length === 0 &&
    target === 'cli/src/lib/walk.ts' &&
    lister.listers.has(importedName)
  );
}

function selfTest(): number {
  let failed = 0;
  const record = (ok: boolean, name: string): void => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  };

  const layoutNames = readLayoutPredicateNames(
    readFileSync(path.join(REPO_ROOT, LAYOUT_MODULE), 'utf8')
  );
  record(
    REQUIRED_IMPORTS.every((name) => layoutNames.has(name)) &&
      layoutNames.has('isSingleFilePromptName'),
    `the marker vocabulary is read from ${LAYOUT_MODULE}`
  );

  for (const testCase of selfTestCases()) {
    const report = analyzeModule(testCase.fileName ?? 'probe.ts', testCase.source, layoutNames);
    const reports =
      report.walks.length > 0 &&
      REQUIRED_IMPORTS.some((name) => !report.importedPredicates.has(name));
    record(reports === testCase.reports, testCase.name);
  }

  record(
    crossFileCase('prompt.yaml'),
    "a lister called with 'prompt.yaml' from another module is a walk"
  );
  record(!crossFileCase('gate.yaml'), "TWIN — the same lister called with 'gate.yaml' is not");

  const live = checkTree();
  record(live.problems.length === 0, "this checkout's prompts-tree walks all adopt the rules");
  for (const problem of live.problems) console.log(`      ${problem}`);
  return failed === 0 ? 0 : 1;
}

// Guarded: `analyzeModule` is exported, and a module-scope exit would end any importing process.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
