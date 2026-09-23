#!/usr/bin/env node

/**
 * Fails when a `system_control` command declares a parameter its action handler never reads.
 *
 * THE CLASS. The undeclared-key refusal stops a key the contract does not name. It cannot see the
 * opposite gap: a key the contract DOES name for a command, which the handler then ignores. Each
 * action handler copies the arguments it forwards by hand (`this.enable({ reason: args.reason })`),
 * so a declared parameter left out of that copy is accepted, validated, and read by nobody — the
 * call answers success for something that never happened. `persist` on `framework enable` was the
 * instance that was found (P4.114, #357); this check is the enumeration that closes the class
 * (P4.124). `include_history` on `status` and `show_details` on `status`/`analytics` were three
 * more, found by the first run.
 *
 * WHAT COUNTS AS A READ — a property read off the handler's argument object, not a name:
 *
 *   - `args.x`, `args['x']`, `(args as T).x`, and `const { x } = args`;
 *   - inside the `case` clause that dispatches the command's operation (with its fall-through
 *     group, or `default` when no label names it), plus the code of `execute` outside the switch;
 *   - `this.method(args)` follows `args` into that method's parameter, in the handler class or its
 *     base class;
 *   - `this.method({ key: args.x })` counts `x` only if `method` reads `key` from that parameter.
 *     A value copied into an object the callee then ignores is dropped, which is exactly how
 *     `status` accepted `include_history` for as long as it did;
 *   - an argument handed to anything that is not a method of the handler (another service's
 *     `handleAction({...})`) counts as read: that is the handler's boundary, and past it the
 *     parameter belongs to the service.
 *
 * A string literal, a comment, or an error message naming the parameter is NOT a read.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, as of 2026-09-22:
 *
 *   - The reverse: a handler reading a key the command does not declare (`status` dispatches
 *     `health` and `diagnostics`, which its command declares no `operation` for). A different
 *     defect with a different fix.
 *   - Whether a value that crossed the handler's boundary is honoured by the service beyond it.
 *   - A read through an alias (`const a = args; a.x`) or computed access (`args[name]`). None
 *     exists in these handlers; either would report a false finding, never a false pass.
 *   - Whether the tool refuses a declared parameter sent to the WRONG action. It does not: the
 *     undeclared-key refusal is tool-wide, so `analytics` still accepts `session_id` and ignores
 *     it. This check keeps each command's declared list honest; it does not make it enforced.
 *
 * Fails closed below `MINIMUM_VERIFIED_READS`: a green run must have proved that many declared
 * parameters are read, or it is not reaching the handlers it claims to govern.
 *
 * Run: `npm run validate:tool-parameter-reads` · self-test: `--self-test`
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Node, Project, SyntaxKind } from 'ts-morph';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(SERVER_ROOT, 'tooling', 'contracts');
const TOOLS_DIR = path.join(SERVER_ROOT, 'src', 'mcp', 'tools');

/** `(args as T)`, `args!`, `<T>args` → `args`. */
function unwrap(node) {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function isParameterRef(node, parameterName) {
  const inner = unwrap(node);
  return Node.isIdentifier(inner) && inner.getText() === parameterName;
}

function findMethod(classDeclaration, name) {
  let current = classDeclaration;
  while (current !== undefined) {
    const method = current.getMethod(name);
    if (method !== undefined) return method;
    current = current.getBaseClass();
  }
  return undefined;
}

/** `this.name(...)` → `name`; anything else → `undefined`. */
function thisMethodName(call) {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return undefined;
  return callee.getName();
}

/** The keys a method reads from its parameter at `index`. */
function readsOfMethod(context, classDeclaration, methodName, index) {
  const cacheKey = `${classDeclaration.getName()}.${methodName}#${index}`;
  const cached = context.cache.get(cacheKey);
  if (cached !== undefined) return cached;
  // Recursion guard: a cycle reads nothing new on the second visit.
  context.cache.set(cacheKey, new Set());

  const method = findMethod(classDeclaration, methodName);
  const parameter = method?.getParameters()[index];
  const reads = new Set();
  if (parameter !== undefined) {
    const nameNode = parameter.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        reads.add((element.getPropertyNameNode() ?? element.getNameNode()).getText());
      }
    } else {
      const body = method.getBody();
      if (body !== undefined) {
        for (const key of readsIn(context, classDeclaration, [body], parameter.getName())) {
          reads.add(key);
        }
      }
    }
  }
  context.cache.set(cacheKey, reads);
  return reads;
}

/**
 * Whether a read of `key` survives the expression it sits in: a value copied into an object
 * literal handed to one of the handler's own methods survives only if that method reads it back.
 */
function survives(context, classDeclaration, readNode) {
  let valueNode = readNode;
  while (
    Node.isParenthesizedExpression(valueNode.getParent()) ||
    Node.isAsExpression(valueNode.getParent())
  ) {
    valueNode = valueNode.getParent();
  }
  const assignment = valueNode.getParent();
  if (!Node.isPropertyAssignment(assignment) || assignment.getInitializer() !== valueNode) {
    return true;
  }
  const literal = assignment.getParent();
  const call = literal?.getParent();
  if (!Node.isObjectLiteralExpression(literal) || !Node.isCallExpression(call)) return true;
  const methodName = thisMethodName(call);
  if (methodName === undefined) return true;
  const index = call.getArguments().indexOf(literal);
  return readsOfMethod(context, classDeclaration, methodName, index).has(assignment.getName());
}

/** Every key read off `parameterName` within `roots`, skipping any node in `excluded`. */
function readsIn(context, classDeclaration, roots, parameterName, excluded = new Set()) {
  const reads = new Set();
  const visit = (node) => {
    if (excluded.has(node)) return;

    if (
      Node.isPropertyAccessExpression(node) &&
      isParameterRef(node.getExpression(), parameterName)
    ) {
      if (survives(context, classDeclaration, node)) reads.add(node.getName());
    } else if (
      Node.isElementAccessExpression(node) &&
      isParameterRef(node.getExpression(), parameterName)
    ) {
      const argument = node.getArgumentExpression();
      if (Node.isStringLiteral(argument) && survives(context, classDeclaration, node)) {
        reads.add(argument.getLiteralValue());
      }
    } else if (
      Node.isVariableDeclaration(node) &&
      Node.isObjectBindingPattern(node.getNameNode()) &&
      node.getInitializer() !== undefined &&
      isParameterRef(node.getInitializer(), parameterName)
    ) {
      for (const element of node.getNameNode().getElements()) {
        reads.add((element.getPropertyNameNode() ?? element.getNameNode()).getText());
      }
    } else if (Node.isCallExpression(node)) {
      const methodName = thisMethodName(node);
      node.getArguments().forEach((argument, index) => {
        if (!isParameterRef(argument, parameterName)) return;
        // Handed whole to something outside the handler: its boundary, counted by the caller.
        if (methodName === undefined) return;
        for (const key of readsOfMethod(context, classDeclaration, methodName, index)) {
          reads.add(key);
        }
      });
    }

    node.forEachChild(visit);
  };
  for (const root of roots) visit(root);
  return reads;
}

function stringLabel(clause) {
  if (!Node.isCaseClause(clause)) return undefined;
  const expression = clause.getExpression();
  return Node.isStringLiteral(expression) ? expression.getLiteralValue() : undefined;
}

/** The clauses that run for `operation`: its label (or `default`) plus the fall-through run. */
function clausesFor(switchStatement, operation) {
  const clauses = switchStatement.getClauses();
  let start = clauses.findIndex((clause) => stringLabel(clause) === operation);
  if (start === -1) start = clauses.findIndex((clause) => Node.isDefaultClause(clause));
  if (start === -1) return undefined;
  const selected = [];
  for (let index = start; index < clauses.length; index += 1) {
    const clause = clauses[index];
    selected.push(clause);
    if (clause.getStatements().length > 0) break;
  }
  return selected;
}

/** action id → handler class, read off `getActionHandler`'s switch. */
function handlerClassesByAction(project, routerPath) {
  const router = project.getSourceFileOrThrow(routerPath);
  const method = router
    .getDescendantsOfKind(SyntaxKind.MethodDeclaration)
    .find((candidate) => candidate.getName() === 'getActionHandler');
  if (method === undefined) throw new Error(`no getActionHandler in ${routerPath}`);

  const classes = new Map();
  for (const clause of method.getDescendantsOfKind(SyntaxKind.CaseClause)) {
    const action = stringLabel(clause);
    const created = clause.getFirstDescendantByKind(SyntaxKind.NewExpression);
    if (action === undefined || created === undefined) continue;
    const declaration = findClass(project, created.getExpression().getText());
    if (declaration !== undefined) classes.set(action, declaration);
  }
  return classes;
}

function findClass(project, name) {
  return project
    .getSourceFiles()
    .flatMap((file) => file.getClasses())
    .find((candidate) => candidate.getName() === name);
}

function entryOf(classDeclaration, methodName) {
  return {
    file: path.relative(SERVER_ROOT, classDeclaration.getSourceFile().getFilePath()),
    symbol: `${classDeclaration.getName()}.${methodName}`,
  };
}

/**
 * `system_control`: one handler class per action (the router's `getActionHandler` switch), whose
 * `execute(args)` dispatches the operation in a `switch`. Commands are `action[:operation]`.
 */
const systemControlAdapter = {
  tool: 'system_control',
  contract: 'system-control.json',
  sources: ['system-control/**/*.ts'],
  router: 'system-control/system-control-router.ts',
  /** Read by the router to choose the handler, never by a handler. */
  exempt: new Set(['action']),
  minimumReads: 40,
  boundary:
    'an argument handed to anything that is not a method of the handler class — past it the ' +
    'parameter belongs to that service',

  bind({ project, routerPath, commands }) {
    const context = { cache: new Map() };
    const classes = handlerClassesByAction(project, routerPath);
    return commands.map((command) => {
      const [action, operation] = command.id.split(':');
      const binding = {
        command: command.id,
        declaredBy: 'the contract',
        parameters: command.parameters.filter((name) => !this.exempt.has(name)),
      };
      const handler = classes.get(action);
      if (handler === undefined) {
        return {
          ...binding,
          problem: { parameter: '*', reason: 'no handler dispatches this action' },
        };
      }
      const execute = findMethod(handler, 'execute');
      const parameterName = execute?.getParameters()[0]?.getName();
      const body = execute?.getBody();
      if (parameterName === undefined || body === undefined) {
        return {
          ...binding,
          problem: { parameter: '*', reason: `${handler.getName()} has no execute(args)` },
        };
      }

      let roots = [body];
      const excluded = new Set();
      const dispatch = body
        .getDescendantsOfKind(SyntaxKind.SwitchStatement)
        .find((candidate) =>
          candidate.getClauses().some((clause) => stringLabel(clause) !== undefined)
        );
      if (operation !== undefined && dispatch !== undefined) {
        const selected = clausesFor(dispatch, operation);
        if (selected === undefined) {
          return {
            ...binding,
            problem: { parameter: 'operation', reason: `no case '${operation}' and no default` },
          };
        }
        excluded.add(dispatch.getCaseBlock());
        roots = [body, ...selected];
      }

      return {
        ...binding,
        entry: entryOf(handler, 'execute'),
        qualifier: operation === undefined ? '' : ` for operation '${operation}'`,
        reads: readsIn(context, handler, roots, parameterName, excluded),
      };
    });
  },
};

const ADAPTERS = [systemControlAdapter];

/**
 * Every (command, parameter) a binding declares and its entry does not read.
 *
 * A binding is one contract command resolved to the code that must read its parameters:
 * `{ command, declaredBy, parameters, entry: {file, symbol}, qualifier, reads }`, or
 * `{ command, problem }` when the command resolves to no code at all — a finding, not a skip.
 */
export function checkBindings(bindings) {
  const findings = [];
  let verified = 0;
  for (const binding of bindings) {
    if (binding.problem !== undefined) {
      findings.push({ command: binding.command, ...binding.problem });
      continue;
    }
    for (const parameter of binding.parameters) {
      if (binding.reads.has(parameter)) {
        verified += 1;
        continue;
      }
      findings.push({
        command: binding.command,
        parameter,
        reason: `declared by ${binding.declaredBy} and never read by ${binding.entry.symbol}${
          binding.qualifier ?? ''
        }`,
      });
    }
  }
  return { findings, verified };
}

function report(adapter, findings, verified) {
  for (const finding of findings) {
    console.error(
      `❌ ${adapter.tool} ${finding.command}: '${finding.parameter}' — ${finding.reason}`
    );
  }
  if (findings.length > 0) {
    console.error(
      `   A declared parameter the handler ignores is accepted and answers success for something ` +
        `that never ran. Read it where the operation dispatches, or drop it from the command's ` +
        `\`parameters\` in tooling/contracts/${adapter.contract}.`
    );
  }
  console.log(
    `[validate-tool-parameter-reads] ${adapter.tool}: ${findings.length} unread declared ` +
      `parameter(s), ${verified} proven read(s)`
  );
}

function checkTool(adapter) {
  const contract = JSON.parse(readFileSync(path.join(CONTRACTS_DIR, adapter.contract), 'utf8'));
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  for (const glob of adapter.sources) {
    project.addSourceFilesAtPaths(path.resolve(TOOLS_DIR, glob));
  }

  const { findings, verified } = checkBindings(
    adapter.bind({
      project,
      routerPath: path.join(TOOLS_DIR, adapter.router),
      commands: contract.commands,
    })
  );
  report(adapter, findings, verified);

  if (verified < adapter.minimumReads) {
    console.error(
      `❌ ${adapter.tool}: only ${verified} declared parameter(s) proven read; expected at least ` +
        `${adapter.minimumReads}. The scan is not reaching the handlers — check the adapter's ` +
        `router and entry resolution.`
    );
    return 1;
  }
  return findings.length > 0 ? 1 : 0;
}

function runLive() {
  // Every tool runs even after one fails, so one run reports the whole surface.
  return ADAPTERS.map(checkTool).some((status) => status !== 0) ? 1 : 0;
}

const FIXTURE_ROUTER = `
export class Router {
  getActionHandler(action: string) {
    switch (action) {
      case 'demo':
        return new DemoHandler(this);
      default:
        throw new Error('unknown');
    }
  }
}
`;

/** `persistOnEnable`: whether `enable` forwards `persist`. `offReads`: whether `off` reads it back. */
function fixtureHandler({ persistOnEnable, offReads }) {
  return `
class Base {
  protected note(message: string) { return message; }
}
export class DemoHandler extends Base {
  async execute(args: any) {
    const operation = args.operation;
    switch (operation) {
      case 'enable':
        this.note("'persist' is named here, in the enable case, and read nowhere");
        return this.enable({ reason: args.reason${persistOnEnable ? ', persist: args.persist' : ''} });
      case 'disable':
        return this.disable({ reason: args.reason, persist: (args as { persist?: boolean }).persist });
      case 'list':
      case 'default':
        return this.list(args);
      default:
        throw new Error("Unknown operation. 'persist' is spelled like this.");
    }
  }
  private enable(options: { reason?: string; persist?: boolean }) {
    return this.note(String(options.reason) + String(options.persist));
  }
  private disable(options: { reason?: string; persist?: boolean }) {
    return ${offReads ? 'String(options.reason) + String(options.persist)' : "this.note(String(options.reason)) // 'persist' dropped"};
  }
  private list(input: any) {
    const { show_details } = input;
    return show_details;
  }
}
`;
}

const FIXTURE_COMMANDS = [
  { id: 'demo:enable', parameters: ['action', 'operation', 'reason', 'persist'] },
  { id: 'demo:disable', parameters: ['action', 'operation', 'reason', 'persist'] },
  { id: 'demo:list', parameters: ['action', 'operation', 'show_details'] },
];

function runSystemControl(project, commands) {
  return checkBindings(systemControlAdapter.bind({ project, routerPath: '/router.ts', commands }));
}

function runFixture(options) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/router.ts', FIXTURE_ROUTER);
  project.createSourceFile('/handler.ts', fixtureHandler(options));
  return runSystemControl(project, FIXTURE_COMMANDS);
}

const keys = (result) => result.findings.map((f) => `${f.command}/${f.parameter}`).sort();

function selfTestSystemControl() {
  const failures = [];

  // Planted: `enable` never copies `persist` (the #357 shape) and `disable` copies it into an
  // object its callee ignores (the `status` include_history shape). The error message and the
  // comment name `persist` — a name-based check would count those as reads.
  const planted = runFixture({ persistOnEnable: false, offReads: false });
  const expected = ['demo:disable/persist', 'demo:enable/persist'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(
      `planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ') || 'none'}`
    );
  }

  // Twin, differing only in those two reads: must be clean, and prove every read it found —
  // operation + reason + persist for enable and disable, operation + show_details for list.
  const fixed = runFixture({ persistOnEnable: true, offReads: true });
  if (fixed.findings.length !== 0)
    failures.push(`fixed twin: expected none, got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 8)
    failures.push(`fixed twin: expected 8 proven reads, got ${fixed.verified}`);

  // A command whose operation has no case and no default is a finding, not a skip.
  const orphan = runSystemControl(
    (() => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('/router.ts', FIXTURE_ROUTER);
      project.createSourceFile(
        '/handler.ts',
        fixtureHandler({ persistOnEnable: true, offReads: true }).replace(
          /default:\n\s*throw new Error\([^)]*\);/,
          ''
        )
      );
      return project;
    })(),
    [{ id: 'demo:missing', parameters: ['action', 'operation'] }]
  );
  if (orphan.findings.length !== 1 || orphan.findings[0].parameter !== 'operation') {
    failures.push(
      `orphan operation: expected one 'operation' finding, got ${keys(orphan).join(', ') || 'none'}`
    );
  }

  return failures.map((failure) => `system_control: ${failure}`);
}

function selfTest() {
  const failures = [...selfTestSystemControl()];
  for (const failure of failures) console.error(`❌ self-test: ${failure}`);
  if (failures.length === 0) console.log('[validate-tool-parameter-reads] self-test OK');
  return failures.length > 0 ? 1 : 0;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : runLive());
