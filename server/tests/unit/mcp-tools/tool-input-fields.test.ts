/**
 * Every input field a tool handler reads is declared in the schema the tool registers, and every
 * schema a tool registers agrees with the contract that documents it.
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
 *
 * The second half is contract parity, and it covers EVERY registered tool rather than the one that
 * had a defect. `tooling/contracts/*.json` is what a reader — human or model — is told the tool
 * accepts; the registered zod object is what it actually accepts. Nothing tied the two together
 * except `system_control`, so `resource_manager` published five parameters its contract never
 * mentioned and `system_control.action` advertised no values at all while its contract declared a
 * twelve-member enum (measured 2026-09-15). The tool list is read from the `registerTool` calls
 * that publish it, so a fourth tool is in scope the moment it is registered.
 */

import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { z } from 'zod/v4';

import {
  GATE_VERDICT_VALIDATION_MESSAGE,
  isValidGateVerdict,
} from '../../../src/engine/gates/core/gate-verdict-contract.js';
import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import { resourceManagerInputSchema } from '../../../src/mcp/tools/schemas/resource-manager.schema.js';
import { buildSystemControlSchema } from '../../../src/mcp/tools/schemas/system-control.schema.js';
import {
  DECLARED_PARAMETERS,
  PARAMETER_OWNERS,
} from '../../../src/mcp/tools/resource-manager/core/parameter-ownership.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOLS_DIR = path.join(SERVER_ROOT, 'src', 'mcp', 'tools');
const TOOLS_INDEX = path.join(TOOLS_DIR, 'index.ts');
const CONTRACTS_DIR = path.join(SERVER_ROOT, 'tooling', 'contracts');
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

/**
 * The one use the walker cannot follow in `resource_manager`, and what bounds it instead.
 *
 * `describeParameterRefusal` reads the input by a key drawn from `PARAMETER_OWNERS`, so the walker
 * sees a computed access and stops. The property this suite protects — every field read is a field
 * the schema declares — still holds, and is asserted directly below against that table's own keys
 * rather than taken on trust. An exemption without that assertion would be a hole.
 */
const RESOURCE_MANAGER_OWNERSHIP_TABLE_READ = 'sent[parameter]';

/**
 * The second use the walker cannot follow in `resource_manager`, and what bounds it instead.
 *
 * `describeParameterRefusal` enumerates the input's own keys (R46) to refuse one the contract
 * never declared. The walker sees an unkeyed enumeration and stops, but the property this suite
 * protects is untouched: the loop reads NAMES and forwards no value, and the only name it lets
 * through is one in `DECLARED_PARAMETERS`. That set is asserted below to be exactly the schema's
 * key set — which is the bound, and without it this exemption would be the hole it looks like.
 *
 * The scan reads `sent[parameter]` once more, applying the same "was it sent" test the ownership
 * loop does, which is why `RESOURCE_MANAGER_OWNERSHIP_TABLE_READ` appears TWICE in the expectation
 * below: same computed access, same bound, second site.
 */
const RESOURCE_MANAGER_UNDECLARED_KEY_SCAN = 'Object.keys(…)';

// ---------------------------------------------------------------------------
// Contract parity
// ---------------------------------------------------------------------------

interface ContractParameter {
  readonly name: string;
  readonly type: string;
  readonly enum?: readonly string[];
}

/** The subset of JSON Schema `z.toJSONSchema` emits that this comparison reads. */
interface SchemaNode {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly SchemaNode[];
  readonly oneOf?: readonly SchemaNode[];
  readonly items?: SchemaNode;
}

/**
 * The shape vocabulary both sides are reduced to before comparison.
 *
 * Deliberately the OUTER shape plus enum membership, and nothing below that. A contract `type` is
 * a human-readable string — `array<{name,required?,description?}>`, `{version,nodes[],edges?}` —
 * and comparing those element shapes would need a type language the contract format does not
 * have. What is machine-comparable is what a client's JSON Schema validator acts on at the top
 * level of a parameter, which is exactly this set. The element shapes are not silently dropped:
 * `element shapes the comparison does not descend into` below asserts the whole list of them, so
 * a new one is a failure rather than an unnoticed gap.
 */
type Kind =
  | { readonly kind: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unconstrained' }
  | { readonly kind: 'enum'; readonly members: readonly string[] }
  | { readonly kind: 'union'; readonly members: readonly Kind[] };

function renderKind(kind: Kind): string {
  if (kind.kind === 'enum') return `enum[${[...kind.members].sort().join('|')}]`;
  if (kind.kind === 'union') return `union[${kind.members.map(renderKind).sort().join('|')}]`;
  return kind.kind;
}

/** A contract `type` string reduced to a `Kind`, or undefined when the string names no shape. */
function contractKind(type: string, members?: readonly string[]): Kind | undefined {
  if (members !== undefined && members.length > 0) return { kind: 'enum', members };

  const asEnum = /^enum\[(.+)\]$/.exec(type);
  if (asEnum?.[1] !== undefined) return { kind: 'enum', members: asEnum[1].split('|') };

  const asUnion = /^union\[(.+)\]$/.exec(type);
  if (asUnion?.[1] !== undefined) {
    const parts = asUnion[1].split('|').map((part) => contractKind(part));
    return parts.every((part): part is Kind => part !== undefined)
      ? { kind: 'union', members: parts }
      : undefined;
  }

  if (type === 'string' || type === 'number' || type === 'boolean') return { kind: type };
  // `record` is the contract's spelling of "object with free keys"; a JSON Schema validator sees
  // no difference, so both reduce to `object`.
  if (type === 'object' || type === 'record') return { kind: 'object' };
  if (/^object<.+>$/.test(type) || /^\{.*\}$/.test(type)) return { kind: 'object' };
  if (type === 'array' || /^array<.+>$/.test(type)) return { kind: 'array' };
  // `unknown` is the contract's spelling of a zod element with no shape constraint at all
  // (`z.unknown()`/`z.any()`) — the same "no constraint" fact `publishedKind` reports as
  // `unconstrained` for a schema node with no usable `type`. Only meaningful as an ARRAY
  // ELEMENT (a top-level `unknown` parameter would be indistinguishable from an undeclared
  // type), which is the only place this is used today (`resource_manager.tools`, `.phases`).
  if (type === 'unknown') return { kind: 'unconstrained' };
  return undefined;
}

/** The element string of an `array<…>` contract type, or undefined for anything else. */
function contractElement(type: string): string | undefined {
  return /^array<(.+)>$/.exec(type)?.[1];
}

function publishedKind(node: SchemaNode): Kind {
  const variants = node.anyOf ?? node.oneOf;
  if (variants !== undefined) return { kind: 'union', members: variants.map(publishedKind) };
  if (node.enum !== undefined && node.enum.length > 0) {
    return { kind: 'enum', members: node.enum.map((value) => String(value)) };
  }
  if (node.const !== undefined) return { kind: 'enum', members: [String(node.const)] };

  const declared = Array.isArray(node.type)
    ? node.type
    : node.type === undefined
      ? []
      : [node.type];
  switch (declared.find((entry) => entry !== 'null')) {
    case 'string':
      return { kind: 'string' };
    case 'number':
    case 'integer':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return { kind: 'array' };
    case 'object':
      return { kind: 'object' };
    default:
      // `z.unknown()` and `z.any()` emit `{}` — no constraint at all.
      return { kind: 'unconstrained' };
  }
}

/** Tool names this server publishes, read from the `registerTool` calls that publish them. */
function registeredToolNames(): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'registerTool'
    ) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) names.add(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(TOOLS_INDEX));
  return [...names].sort();
}

/**
 * Tool contracts on disk, keyed the way `generate-contracts.ts` keys them.
 *
 * Read from `tooling/contracts/*.json` rather than from `_generated/*.ts` so the comparison is
 * against the SSOT an author edits. `validate:contracts` already fails when the two disagree.
 */
function toolContracts(): Map<string, ContractParameter[]> {
  const contracts = new Map<string, ContractParameter[]>();
  for (const fileName of readdirSync(CONTRACTS_DIR).filter((name) => name.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(path.join(CONTRACTS_DIR, fileName), 'utf-8')) as {
      tool?: string;
      toolDescription?: unknown;
      parameters?: ContractParameter[];
    };
    if (parsed.tool === undefined || parsed.toolDescription === undefined) continue;
    contracts.set(parsed.tool.replace(/-/g, '_'), parsed.parameters ?? []);
  }
  return contracts;
}

/**
 * The registered zod object per tool, in the WIDEST shape it can be registered in.
 *
 * `prompt_engine` narrows its surface when the gate system is disabled, and CLAUDE.md §Public API
 * Contract defines the contract as the union of every reachable shape — so the widest one (the
 * builder's default) is the one a contract has to describe.
 */
const TOOL_SCHEMAS: Readonly<Record<string, z.ZodObject<z.ZodRawShape>>> = {
  prompt_engine: buildPromptEngineSchema(isValidGateVerdict, GATE_VERDICT_VALIDATION_MESSAGE),
  resource_manager: resourceManagerInputSchema,
  system_control: buildSystemControlSchema(),
};

function publishedProperties(tool: string): Record<string, SchemaNode> {
  const schema = TOOL_SCHEMAS[tool];
  if (schema === undefined) throw new Error(`no schema bound for registered tool ${tool}`);
  const emitted = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, SchemaNode>;
  };
  return emitted.properties ?? {};
}

/**
 * Element shapes the comparison could not read as of 2026-09-15 — six entries, one per row of
 * `resource_manager.pass_criteria/tools/phases/chain_steps` and `prompt_engine.gates/observations`
 * (closed the same day the grammar grew `union[...]` and `unknown` to express them).
 *
 * Kept as a live list rather than deleted with the six: the comparison still stops at ONE array
 * element deep (`Kind` above descends no further), so a future parameter whose contract element
 * string cannot yet be expressed lands here rather than silently passing. Each entry is
 * `tool.parameter: <contract element> → <published element>`; the list shrinks only by making a
 * contract element string and its zod element agree, and grows only when a genuinely new element
 * shape needs a grammar addition first.
 */
const UNCOMPARED_ELEMENT_SHAPES: readonly string[] = [];

/** Parameters whose published outer shape is not the one the contract declares. */
function typeDisagreements(
  tool: string,
  parameters: readonly ContractParameter[],
  published: Readonly<Record<string, SchemaNode>>
): string[] {
  const findings: string[] = [];
  for (const parameter of parameters) {
    const node = published[parameter.name];
    // Both gaps are reported by assertions of their own; reporting them twice would make one
    // fix look like two.
    if (node === undefined) continue;
    const declared = contractKind(parameter.type, parameter.enum);
    if (declared === undefined) continue;

    const actual = publishedKind(node);
    if (renderKind(declared) !== renderKind(actual)) {
      findings.push(
        `${tool}.${parameter.name}: contract ${renderKind(declared)} ≠ published ${renderKind(actual)}`
      );
    }
  }
  return findings.sort();
}

/** Array parameters whose contract element string does not read as the published element shape. */
function elementDivergences(
  tool: string,
  parameters: readonly ContractParameter[],
  published: Readonly<Record<string, SchemaNode>>
): string[] {
  const findings: string[] = [];
  for (const parameter of parameters) {
    const element = contractElement(parameter.type);
    const items = published[parameter.name]?.items;
    if (element === undefined || items === undefined) continue;

    const declared = contractKind(element);
    const actual = publishedKind(items);
    if (declared === undefined || renderKind(declared) !== renderKind(actual)) {
      findings.push(`${tool}.${parameter.name}: ${element} → ${renderKind(actual)}`);
    }
  }
  return findings.sort();
}

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

    it('follows every use of the input except the two enumerations in the refusal', () => {
      expect(reads.unfollowed.map((use) => use.replace(/^[^ ]+ /, ''))).toEqual([
        RESOURCE_MANAGER_OWNERSHIP_TABLE_READ,
        RESOURCE_MANAGER_UNDECLARED_KEY_SCAN,
        RESOURCE_MANAGER_OWNERSHIP_TABLE_READ,
      ]);
    });

    it('bounds the undeclared-key scan: what it accepts IS the schema', () => {
      // Both directions. A `DECLARED_PARAMETERS` wider than the schema would wave through a key
      // nothing reads — the defect R46 closes — and one narrower would refuse a published
      // parameter, which is the same defect pointed the other way.
      expect([...DECLARED_PARAMETERS].filter((name) => !declared.has(name)).sort()).toEqual([]);
      expect([...declared].filter((name) => !DECLARED_PARAMETERS.has(name)).sort()).toEqual([]);
    });

    it('declares every field the ownership table can look up', () => {
      // What the exempted computed access above is allowed to read. Every key it can produce must
      // be declared, or the exemption would hide exactly the undeclared read this suite exists to
      // catch.
      expect(Object.keys(PARAMETER_OWNERS).filter((field) => !declared.has(field))).toEqual([]);
    });

    it('observes reads in the router and in the imported preview check', () => {
      expect(reads.fields.get('resource_type')?.length).toBeGreaterThan(0);
      expect(
        reads.fields.get('preview_action')?.some((use) => use.includes('preview-action.ts'))
      ).toBe(true);
    });
  });
});

describe('every registered tool publishes the surface its contract describes', () => {
  const registered = registeredToolNames();
  const contracts = toolContracts();

  it('finds the tools this server registers', () => {
    // A guard on the enumeration itself: an AST walk that matched nothing would make every
    // assertion below vacuously pass.
    expect(registered.length).toBeGreaterThan(0);
    expect(registered).toContain('prompt_engine');
  });

  it('binds a schema to every registered tool', () => {
    expect(Object.keys(TOOL_SCHEMAS).sort()).toEqual(registered);
  });

  it('has a contract for every registered tool', () => {
    expect(registered.filter((tool) => !contracts.has(tool))).toEqual([]);
  });

  describe.each(registeredToolNames())('%s', (tool) => {
    const parameters = contracts.get(tool) ?? [];
    const published = publishedProperties(tool);

    it('declares exactly the parameters the contract describes', () => {
      expect(Object.keys(published).sort()).toEqual(
        parameters.map((parameter) => parameter.name).sort()
      );
    });

    it('states a shape this comparison can read for every contract parameter', () => {
      expect(
        parameters
          .filter((parameter) => contractKind(parameter.type, parameter.enum) === undefined)
          .map((parameter) => `${parameter.name}: ${parameter.type}`)
          .sort()
      ).toEqual([]);
    });

    it('publishes the type and the enum members the contract declares', () => {
      expect(typeDisagreements(tool, parameters, published)).toEqual([]);
    });
  });

  it('lists every element shape the comparison does not descend into', () => {
    expect(
      registered.flatMap((tool) =>
        elementDivergences(tool, contracts.get(tool) ?? [], publishedProperties(tool))
      )
    ).toEqual(UNCOMPARED_ELEMENT_SHAPES);
  });

  describe('fails on the mutations it exists to catch', () => {
    const tool = 'resource_manager';
    const parameters = contracts.get(tool) ?? [];
    const published = publishedProperties(tool);

    it('reports a schema key the contract does not declare', () => {
      const withoutSubject = parameters.filter((parameter) => parameter.name !== 'subject');

      expect(Object.keys(published).sort()).not.toEqual(
        withoutSubject.map((parameter) => parameter.name).sort()
      );
    });

    it('reports a published enum the contract disagrees with', () => {
      const narrowed = parameters.map((parameter) =>
        parameter.name === 'action' ? { ...parameter, type: 'string' } : parameter
      );

      expect(typeDisagreements(tool, narrowed, published)).toEqual([
        expect.stringContaining('resource_manager.action: contract string ≠ published enum['),
      ]);
    });

    it('reports a published type the contract disagrees with', () => {
      const retyped = { ...published, confirm: { type: 'string' } as SchemaNode };

      expect(typeDisagreements(tool, parameters, retyped)).toEqual([
        'resource_manager.confirm: contract boolean ≠ published string',
      ]);
    });

    it('reports an array element type the contract disagrees with', () => {
      const narrowed = parameters.map((parameter) =>
        parameter.name === 'pass_criteria' ? { ...parameter, type: 'array<string>' } : parameter
      );

      expect(elementDivergences(tool, narrowed, published)).toEqual([
        'resource_manager.pass_criteria: string → object',
      ]);
    });
  });
});
