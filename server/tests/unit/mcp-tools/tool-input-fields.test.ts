/**
 * Every input field a tool handler reads is declared in the schema the tool registers.
 *
 * Zod strips undeclared keys before a registered tool callback runs. A handler that reads a field
 * its schema does not declare therefore gets `undefined` over MCP whatever the caller sent, and
 * falls back to its default — while a unit test calling the handler directly still passes,
 * because it never goes through the schema. On `system_control` this made a skills_sync export
 * with `preview: true` write every client's skills, and a config restore with `confirm: true`
 * answer "Restore cancelled".
 *
 * Schema keys come from the runtime zod shape, not from source text. Handler reads come from the
 * TypeScript AST: property reads on the parameter carrying the tool input (`args.x`, `args['x']`,
 * destructuring), followed into same-class methods and imported functions that receive the whole
 * object. A use the walker cannot follow is reported rather than skipped, so a read cannot hide
 * behind an unresolved call.
 */

import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { system_controlParameters } from '../../../src/mcp/contracts/schemas/_generated/system_control.generated.js';
import { resourceManagerInputSchema } from '../../../src/mcp/tools/schemas/resource-manager.schema.js';
import { buildSystemControlSchema } from '../../../src/mcp/tools/schemas/system-control.schema.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOLS_DIR = path.join(SERVER_ROOT, 'src', 'mcp', 'tools');
const SYSTEM_CONTROL_ROUTER = path.join(TOOLS_DIR, 'system-control', 'system-control-router.ts');
const SYSTEM_CONTROL_HANDLERS = path.join(TOOLS_DIR, 'system-control', 'handlers');
const RESOURCE_MANAGER_ROUTER = path.join(TOOLS_DIR, 'resource-manager', 'core', 'router.ts');

/** A method whose first parameter is the tool input as the registered callback received it. */
interface Entry {
  readonly file: string;
  readonly className: string;
  readonly method: string;
}

interface Reads {
  /** Field name → the sites that read it. */
  readonly fields: Map<string, string[]>;
  /** Uses of the input object the walker could not follow, as `file: code`. */
  readonly unfollowed: string[];
}

const sourceCache = new Map<string, ts.SourceFile>();

function parse(file: string): ts.SourceFile {
  let source = sourceCache.get(file);
  if (source === undefined) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
    sourceCache.set(file, source);
  }
  return source;
}

function site(node: ts.Node): string {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart());
  return `${path.relative(SERVER_ROOT, source.fileName)}:${line + 1}`;
}

function findClass(source: ts.SourceFile, name: string): ts.ClassDeclaration | undefined {
  return source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === name
  );
}

function findMethod(owner: ts.ClassDeclaration, name: string): ts.MethodDeclaration | undefined {
  return owner.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === name
  );
}

/** A top-level function (declaration or `const f = (...) =>`) by name. */
function findFunction(source: ts.SourceFile, name: string): ts.FunctionLikeDeclaration | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          return init;
        }
      }
    }
  }
  return undefined;
}

/** The file a relative import of `name` resolves to, or undefined for a package or alias import. */
function resolveImport(source: ts.SourceFile, name: string): string | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    if (!bindings.elements.some((element) => element.name.text === name)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) return undefined;
    return path.resolve(path.dirname(source.fileName), specifier.replace(/\.js$/, '.ts'));
  }
  return undefined;
}

/** Climb through wrappers that do not change the value: `(args as X)`, `args!`. */
function climb(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    ts.isTypeAssertionExpression(current.parent) ||
    ts.isSatisfiesExpression(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
  );
}

class InputReadCollector {
  private readonly fields = new Map<string, string[]>();
  private readonly unfollowed: string[] = [];
  private readonly visited = new Set<string>();

  collect(entries: readonly Entry[]): Reads {
    for (const entry of entries) {
      const owner = findClass(parse(entry.file), entry.className);
      const method = owner === undefined ? undefined : findMethod(owner, entry.method);
      if (method === undefined) {
        throw new Error(`entry ${entry.className}.${entry.method} not found in ${entry.file}`);
      }
      this.walkFunction(method, 0);
    }
    return { fields: this.fields, unfollowed: this.unfollowed };
  }

  private record(field: string, node: ts.Node): void {
    const sites = this.fields.get(field) ?? [];
    sites.push(site(node));
    this.fields.set(field, sites);
  }

  private recordBinding(pattern: ts.ObjectBindingPattern): void {
    for (const element of pattern.elements) {
      if (element.dotDotDotToken !== undefined) {
        this.unfollowed.push(`${site(element)}: ${element.getText()}`);
        continue;
      }
      const key = element.propertyName ?? element.name;
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) this.record(key.text, element);
    }
  }

  private walkFunction(fn: ts.FunctionLikeDeclaration, parameterIndex: number): void {
    const key = `${fn.getSourceFile().fileName}#${fn.getStart()}#${parameterIndex}`;
    if (this.visited.has(key)) return;
    this.visited.add(key);

    const parameter = fn.parameters[parameterIndex];
    if (parameter === undefined || fn.body === undefined) return;
    if (ts.isObjectBindingPattern(parameter.name)) {
      this.recordBinding(parameter.name);
      return;
    }
    if (!ts.isIdentifier(parameter.name)) return;
    this.visit(fn.body, new Set([parameter.name.text]), fn);
  }

  /**
   * `tracked` holds the names bound to the input in the function being walked. An alias
   * (`const input = args`) is added to it, so later statements see the alias; a nested function
   * whose own parameter shadows a tracked name walks a copy without that name.
   */
  private visit(node: ts.Node, tracked: Set<string>, root: ts.FunctionLikeDeclaration): void {
    let scope = tracked;
    if (ts.isFunctionLike(node) && node !== root) {
      const shadowed = new Set(
        node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''))
      );
      if ([...tracked].some((name) => shadowed.has(name))) {
        scope = new Set([...tracked].filter((name) => !shadowed.has(name)));
      }
    }

    if (ts.isIdentifier(node) && scope.has(node.text) && !isDeclarationName(node)) {
      const alias = this.classifyUse(node, root);
      if (alias !== undefined) scope.add(alias);
    }

    ts.forEachChild(node, (child) => this.visit(child, scope, root));
  }

  /** Records what one use of the input reads. Returns a new alias name when the use declares one. */
  private classifyUse(
    identifier: ts.Identifier,
    root: ts.FunctionLikeDeclaration
  ): string | undefined {
    const value = climb(identifier);
    const parent = value.parent;

    if (ts.isPropertyAccessExpression(parent) && parent.expression === value) {
      this.record(parent.name.text, parent);
      return undefined;
    }
    if (ts.isElementAccessExpression(parent) && parent.expression === value) {
      const argument = parent.argumentExpression;
      if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
        this.record(argument.text, parent);
      } else {
        this.unfollowed.push(`${site(parent)}: ${parent.getText()}`);
      }
      return undefined;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === value) {
      if (ts.isObjectBindingPattern(parent.name)) {
        this.recordBinding(parent.name);
        return undefined;
      }
      if (ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
    }
    if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === value)) {
      const index = parent.arguments.findIndex((argument) => argument === value);
      const callee = this.resolveCallee(parent, root);
      if (callee !== undefined) {
        this.walkFunction(callee, index);
      } else {
        this.unfollowed.push(`${site(parent)}: ${parent.expression.getText()}(…)`);
      }
      return undefined;
    }
    this.unfollowed.push(`${site(value)}: ${parent.getText().slice(0, 80)}`);
    return undefined;
  }

  private resolveCallee(
    call: ts.CallExpression,
    root: ts.FunctionLikeDeclaration
  ): ts.FunctionLikeDeclaration | undefined {
    const expression = call.expression;
    if (
      ts.isPropertyAccessExpression(expression) &&
      expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      let owner: ts.Node = root;
      while (!ts.isClassDeclaration(owner) && owner.parent !== undefined) owner = owner.parent;
      return ts.isClassDeclaration(owner) ? findMethod(owner, expression.name.text) : undefined;
    }
    if (ts.isIdentifier(expression)) {
      const source = root.getSourceFile();
      const local = findFunction(source, expression.text);
      if (local !== undefined) return local;
      const imported = resolveImport(source, expression.text);
      return imported === undefined ? undefined : findFunction(parse(imported), expression.text);
    }
    return undefined;
  }
}

function undeclared(reads: Reads, declared: ReadonlySet<string>): string[] {
  return [...reads.fields.entries()]
    .filter(([field]) => !declared.has(field))
    .map(([field, sites]) => `${field} ← ${sites.join(', ')}`)
    .sort();
}

function systemControlEntries(): Entry[] {
  const handlers = readdirSync(SYSTEM_CONTROL_HANDLERS)
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) => {
      const file = path.join(SYSTEM_CONTROL_HANDLERS, name);
      return parse(file)
        .statements.filter(
          (statement): statement is ts.ClassDeclaration =>
            ts.isClassDeclaration(statement) &&
            (statement.heritageClauses ?? []).some((clause) =>
              clause.types.some((type) => type.expression.getText() === 'ActionHandler')
            )
        )
        .map((owner) => ({ file, className: owner.name?.text ?? '', method: 'execute' }));
    });
  return [
    { file: SYSTEM_CONTROL_ROUTER, className: 'ConsolidatedSystemControl', method: 'handleAction' },
    ...handlers,
  ];
}

/** Handler classes the router constructs — the dispatch table the entries must match. */
function routerConstructedHandlers(): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && /ActionHandler$/.test(node.expression.getText())) {
      names.add(node.expression.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(SYSTEM_CONTROL_ROUTER));
  return [...names].sort();
}

/**
 * The one use the walker cannot follow in `system_control`, and why it needs no following: the
 * router hands the input to whichever handler the action selects, and every handler's `execute`
 * is walked as an entry of its own.
 */
const SYSTEM_CONTROL_DISPATCH = 'actionHandler.execute(…)';

describe('tool handlers read only fields their registered schema declares', () => {
  describe('system_control', () => {
    const declared = new Set(Object.keys(buildSystemControlSchema().shape));
    const entries = systemControlEntries();
    const reads = new InputReadCollector().collect(entries);

    it('walks every handler the router dispatches to', () => {
      expect(
        entries
          .slice(1)
          .map((entry) => entry.className)
          .sort()
      ).toEqual(routerConstructedHandlers());
    });

    it('declares every field a handler reads', () => {
      expect(undeclared(reads, declared)).toEqual([]);
    });

    it('follows every use of the input except the dispatch to the selected handler', () => {
      expect(reads.unfollowed.map((use) => use.replace(/^[^ ]+ /, ''))).toEqual([
        SYSTEM_CONTROL_DISPATCH,
      ]);
    });

    it('declares exactly the parameters the contract describes', () => {
      expect([...declared].sort()).toEqual(
        system_controlParameters.map((parameter) => parameter.name).sort()
      );
    });

    it('observes reads of each shape it claims to follow', () => {
      // Property access, bracket access, a method the whole input is passed to, destructuring.
      expect(reads.fields.has('preview')).toBe(true);
      expect(reads.fields.has('source')).toBe(true);
      expect(reads.fields.has('expires_in_ms')).toBe(true);
      expect(reads.fields.has('action')).toBe(true);
    });

    it('reports a read field once its declaration is removed', () => {
      const withoutPreview = new Set([...declared].filter((field) => field !== 'preview'));

      expect(undeclared(reads, withoutPreview)).toEqual([
        expect.stringMatching(/^preview ← .*skills-sync-action-handler\.ts:\d+$/),
      ]);
    });
  });

  describe('resource_manager', () => {
    const declared = new Set(Object.keys(resourceManagerInputSchema.shape));
    const reads = new InputReadCollector().collect([
      { file: RESOURCE_MANAGER_ROUTER, className: 'ResourceManagerRouter', method: 'handleAction' },
    ]);

    it('declares every field the router reads or forwards', () => {
      expect(undeclared(reads, declared)).toEqual([]);
    });

    it('follows every use of the input', () => {
      expect(reads.unfollowed).toEqual([]);
    });

    it('observes reads in the router and in the imported preview check', () => {
      expect(reads.fields.get('resource_type')?.length).toBeGreaterThan(0);
      expect(
        reads.fields.get('preview_action')?.some((use) => use.includes('preview-action.ts'))
      ).toBe(true);
    });
  });
});
