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

/**
 * `args[key]` inside `for (const key of LIST)`, `for (const [key] of Object.entries(MAP))` or
 * `Object.keys(MAP)`, where LIST is a module-level array of string literals and MAP an object
 * literal (in this file or imported from one the scan loaded): every listed key is read. How a
 * processor copies a registry of optional fields rather than naming each one.
 */
function iteratedKeys(argument) {
  if (!Node.isIdentifier(argument)) return [];
  const loop = argument.getAncestors().find((ancestor) => {
    if (!Node.isForOfStatement(ancestor)) return false;
    const declaration = ancestor.getInitializer().getDeclarations?.()[0];
    const bound = declaration?.getNameNode();
    if (Node.isIdentifier(bound)) return bound.getText() === argument.getText();
    return (
      Node.isArrayBindingPattern(bound) && bound.getElements()[0]?.getText() === argument.getText()
    );
  });
  if (loop === undefined) return [];
  let source = unwrap(loop.getExpression());
  if (
    Node.isCallExpression(source) &&
    /^Object\.(entries|keys)$/.test(source.getExpression().getText())
  ) {
    source = unwrap(source.getArguments()[0]);
  }
  const literal = Node.isIdentifier(source) ? constantInitializer(source) : undefined;
  if (Node.isArrayLiteralExpression(literal)) {
    return literal
      .getElements()
      .filter((element) => Node.isStringLiteral(element))
      .map((element) => element.getLiteralValue());
  }
  if (Node.isObjectLiteralExpression(literal)) {
    return literal
      .getProperties()
      .filter((property) => Node.isPropertyAssignment(property))
      .map((property) => property.getName().replace(/^['"]|['"]$/g, ''));
  }
  return [];
}

/** A module-level constant's initializer, following one named import into a loaded file. */
function constantInitializer(identifier) {
  const name = identifier.getText();
  const file = identifier.getSourceFile();
  let declaration = file.getVariableDeclaration(name);
  if (declaration === undefined) {
    const imported = file
      .getImportDeclarations()
      .find((candidate) => candidate.getNamedImports().some((named) => named.getName() === name));
    declaration = imported?.getModuleSpecifierSourceFile()?.getVariableDeclaration(name);
  }
  return declaration === undefined ? undefined : unwrap(declaration.getInitializer());
}

/**
 * `this.<field>.<method>(…)` where the field holds another class of the tool being scanned: the
 * call continues into that class. `undefined` when the call is not that shape, or no class the
 * scan loaded answers for the field — the boundary.
 */
function fieldTarget(context, classDeclaration, call) {
  const target = fieldCall(call);
  if (target === undefined || context.project === undefined) return undefined;
  const owner = fieldClass(context.project, classDeclaration, target.field);
  return owner === undefined ? undefined : { owner, method: target.method };
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
      for (const key of iteratedKeys(argument)) reads.add(key);
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
      const field =
        methodName === undefined ? fieldTarget(context, classDeclaration, node) : undefined;
      node.getArguments().forEach((argument, index) => {
        if (!isParameterRef(argument, parameterName)) return;
        // Handed whole to something outside the handler's classes: its boundary.
        if (field !== undefined) {
          for (const key of readsOfMethod(context, field.owner, field.method, index))
            reads.add(key);
          return;
        }
        if (methodName === undefined) return;
        for (const key of readsOfMethod(context, classDeclaration, methodName, index)) {
          reads.add(key);
        }
      });
    }

    node.forEachChild(visit);
  };
  for (const root of roots) visit(root);
  // `const supplied = args as Record<string, unknown>` reads through `supplied` too.
  for (const root of roots) {
    for (const alias of root.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = alias.getInitializer();
      if (!Node.isIdentifier(alias.getNameNode()) || initializer === undefined) continue;
      if (!isParameterRef(initializer, parameterName) || alias.getName() === parameterName)
        continue;
      for (const key of readsIn(context, classDeclaration, [root], alias.getName(), excluded)) {
        reads.add(key);
      }
    }
  }
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
    const context = { cache: new Map(), project };
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

/**
 * The expressions that decide a value: the conditions of every `if`, `?:` and `&&` between
 * `node` and `root`. `if (args.x) out.y = …` forwards `x` as much as `out.y = args.x` does.
 */
function guardsOf(node, root) {
  const guards = [];
  let child = node;
  for (let current = node.getParent(); current !== undefined; current = current.getParent()) {
    if (Node.isIfStatement(current) && current.getThenStatement() === child) {
      guards.push(current.getExpression());
    } else if (Node.isConditionalExpression(current) && current.getCondition() !== child) {
      guards.push(current.getCondition());
    } else if (
      Node.isBinaryExpression(current) &&
      current.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken &&
      current.getRight() === child
    ) {
      guards.push(current.getLeft());
    }
    if (current === root) break;
    child = current;
  }
  return guards;
}

/** The top-level parameters of `sourceName` read anywhere in `nodes`, through local variables. */
function sourcesIn(body, sourceName, nodes, visited = new Set()) {
  const sources = new Set();
  const visit = (node) => {
    if (
      (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) &&
      isParameterRef(node.getExpression(), sourceName)
    ) {
      const argument = Node.isElementAccessExpression(node)
        ? node.getArgumentExpression()
        : undefined;
      if (Node.isPropertyAccessExpression(node)) sources.add(node.getName());
      else if (Node.isStringLiteral(argument)) sources.add(argument.getLiteralValue());
    } else if (Node.isIdentifier(node) && !visited.has(node.getText())) {
      // A local computed from the source (`const trimmed = args.x?.trim()`) carries its sources.
      const name = node.getText();
      visited.add(name);
      for (const key of sourcesIn(body, sourceName, writesOf(body, name), visited)) {
        sources.add(key);
      }
    }
    node.forEachChild(visit);
  };
  for (const node of nodes) visit(node);
  return sources;
}

/** What gives local `name` its value: its initializer (or for-of iterable) and `name.k = …`. */
function writesOf(body, name) {
  const writes = [];
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const bound = declaration.getNameNode();
    const names = Node.isIdentifier(bound)
      ? [bound.getText()]
      : bound.getDescendantsOfKind(SyntaxKind.Identifier).map((id) => id.getText());
    if (!names.includes(name)) continue;
    const loop = declaration.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
    if (declaration.getInitializer() !== undefined) writes.push(declaration.getInitializer());
    else if (loop !== undefined) writes.push(loop.getExpression());
  }
  for (const assignment of assignmentsTo(body, name)) {
    writes.push(assignment.getRight(), ...guardsOf(assignment, body));
  }
  return writes;
}

/** `name.k = …` and `name[k] = …` within `body`. */
function assignmentsTo(body, name) {
  return body.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((binary) => {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
    const left = binary.getLeft();
    return (
      (Node.isPropertyAccessExpression(left) || Node.isElementAccessExpression(left)) &&
      isParameterRef(left.getExpression(), name)
    );
  });
}

/**
 * A forwarding hop: which key of the object `targetName` each parameter of `sourceName` lands
 * under, when a function copies arguments by hand into a new object and hands THAT on. Reads the
 * target's object-literal initializer (through spreads and conditionals) and every
 * `target.key = …` in `body`; a key's sources are the parameters its value and guards read.
 *
 * Returns `Map<parameter, Set<key>>`. A parameter with no entry is dropped at this hop.
 */
function forwardedKeys(body, sourceName, targetName) {
  const forwarded = new Map();
  const record = (key, nodes) => {
    for (const parameter of sourcesIn(body, sourceName, nodes)) {
      forwarded.set(parameter, (forwarded.get(parameter) ?? new Set()).add(key));
    }
  };
  const walkLiteral = (literal) => {
    for (const property of literal.getProperties()) {
      if (Node.isPropertyAssignment(property)) {
        record(property.getName(), [property.getInitializer(), ...guardsOf(property, literal)]);
      } else if (Node.isShorthandPropertyAssignment(property)) {
        record(property.getName(), [property.getNameNode(), ...guardsOf(property, literal)]);
      } else if (Node.isSpreadAssignment(property)) {
        for (const inner of property.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
          if (inner.getParentWhile((parent) => parent !== property) !== undefined) {
            if (inner.getFirstAncestorByKind(SyntaxKind.ObjectLiteralExpression) === literal) {
              walkLiteral(inner);
            }
          }
        }
      }
    }
  };
  for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (declaration.getName() === targetName && Node.isObjectLiteralExpression(initializer)) {
      walkLiteral(initializer);
    }
  }
  for (const assignment of assignmentsTo(body, targetName)) {
    const left = assignment.getLeft();
    if (!Node.isPropertyAccessExpression(left)) continue;
    record(left.getName(), [assignment.getRight(), ...guardsOf(assignment, body)]);
  }
  return forwarded;
}

/** The class a `this.<field>` holds: its declared type, or the class implementing that port. */
function fieldClass(project, classDeclaration, fieldName) {
  const property = classDeclaration.getProperty(fieldName);
  const typeName = property?.getTypeNode()?.getText();
  if (typeName === undefined) return undefined;
  return (
    findClass(project, typeName) ??
    project
      .getSourceFiles()
      .flatMap((file) => file.getClasses())
      .find((candidate) =>
        candidate.getImplements().some((clause) => clause.getText() === typeName)
      )
  );
}

/** `this.<field>.<method>(…)` → `{ field, method }`; anything else → `undefined`. */
function fieldCall(call) {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const owner = callee.getExpression();
  if (!Node.isPropertyAccessExpression(owner)) return undefined;
  if (owner.getExpression().getKind() !== SyntaxKind.ThisKeyword) return undefined;
  return { field: owner.getName(), method: callee.getName() };
}

/**
 * The keys read on dispatch of `action` by a per-type handler whose `handleAction(args)` switches
 * on the action: reads in the handler itself, plus those of each processor it hands `args` to
 * (`this.lifecycle.handleUpdate(args)`). The processor is where the parameter is owned, so the
 * read model continues into it; past the processor, `args` handed on whole is not followed.
 */
function dispatchReads(context, project, handler, action) {
  const handle = findMethod(handler, 'handleAction');
  const parameterName = handle?.getParameters()[0]?.getName();
  const body = handle?.getBody();
  if (parameterName === undefined || body === undefined) {
    return { problem: `${handler.getName()} has no handleAction(args)` };
  }
  const dispatch = body
    .getDescendantsOfKind(SyntaxKind.SwitchStatement)
    .find((candidate) =>
      candidate.getClauses().some((clause) => stringLabel(clause) !== undefined)
    );
  const selected = dispatch?.getClauses().some((clause) => stringLabel(clause) === action)
    ? clausesFor(dispatch, action)
    : undefined;
  if (selected === undefined) return { problem: `${handler.getName()} has no case '${action}'` };

  const reads = readsIn(
    context,
    handler,
    [body, ...selected],
    parameterName,
    new Set([dispatch.getCaseBlock()])
  );
  const entries = [];
  for (const call of selected.flatMap((clause) =>
    clause.getDescendantsOfKind(SyntaxKind.CallExpression)
  )) {
    const target = fieldCall(call);
    const index = call
      .getArguments()
      .findIndex((argument) => isParameterRef(argument, parameterName));
    if (target === undefined || index === -1) continue;
    const processor = fieldClass(project, handler, target.field);
    if (processor === undefined) return { problem: `this.${target.field} resolves to no class` };
    entries.push(entryOf(processor, target.method));
    for (const key of readsOfMethod(context, processor, target.method, index)) reads.add(key);
  }
  return {
    reads,
    entry: entries.length === 1 ? entries[0] : entryOf(handler, 'handleAction'),
  };
}

/**
 * `resource_manager`: one flat schema, four resource types. The router copies each type's
 * arguments by hand into a new object (`routeToGateManager` → `gateArgs`), sometimes under another
 * key (`enforcement_mode` → `enforcementMode`); the per-type handler's `handleAction` switches on
 * the action and hands the object to a processor. Commands are `<type>:<action>`, and
 * `common:<action>` for every type whose handler has a `case` for that action.
 */
const resourceManagerAdapter = {
  tool: 'resource_manager',
  contract: 'resource-manager.json',
  sources: [
    'resource-manager/**/*.ts',
    'gate-manager/**/*.ts',
    'framework-manager/**/*.ts',
    'category-manager/**/*.ts',
    'shared/**/*.ts',
  ],
  router: 'resource-manager/core/router.ts',
  /** Read by the router to choose the handler and the action, never forwarded as data. */
  exempt: new Set(['resource_type', 'action']),
  minimumReads: 150,
  boundary:
    'the processor a handler hands the arguments to — inside it the read model continues; an ' +
    'argument it hands on whole to anything else is not followed',

  bind({ project, routerPath, commands }) {
    const context = { cache: new Map(), project };
    const router = project
      .getSourceFileOrThrow(routerPath)
      .getClasses()
      .find((candidate) => candidate.getMethod('routeToResource') !== undefined);
    if (router === undefined) throw new Error(`no routeToResource in ${routerPath}`);
    const routes = this.routes(project, router);
    const owners = this.owners(project);
    // Reads the router itself decides on — the destructive-action `confirm` guard, the
    // `source_workspace` refusal — ahead of any route. A read in a message or a log is not one.
    const routerBody = router.getMethodOrThrow('handleAction').getBody();
    const decided = sourcesIn(
      routerBody,
      router.getMethodOrThrow('handleAction').getParameters()[0].getName(),
      routerBody.getDescendantsOfKind(SyntaxKind.IfStatement).map((guard) => guard.getExpression())
    );

    const bindings = [];
    for (const command of commands) {
      const [scope, action] = command.id.split(':');
      const parameters = command.parameters.filter((name) => !this.exempt.has(name));
      const types =
        scope === 'common'
          ? [...routes.keys()].filter(
              (type) =>
                routes.get(type).handler !== undefined &&
                dispatchReads(context, project, routes.get(type).handler, action).problem ===
                  undefined
            )
          : [scope];
      for (const type of types) {
        // A `common:` command declares a type-owned parameter only for its owners, exactly as
        // `PARAMETER_ACTIONS` reads it: `full_restart` on `common:reload` is prompt's alone.
        const declared = parameters.filter(
          (name) => scope !== 'common' || owners.get(name)?.includes(type) !== false
        );
        const binding = {
          command: `${type}:${action}`,
          declaredBy: command.id,
          parameters: declared,
        };
        const route = routes.get(type);
        if (route === undefined || route.handler === undefined) {
          bindings.push({
            ...binding,
            problem: { parameter: '*', reason: `no route forwards resource_type '${type}'` },
          });
          continue;
        }
        const dispatched = dispatchReads(context, project, route.handler, action);
        if (dispatched.problem !== undefined) {
          bindings.push({
            ...binding,
            problem: { parameter: 'action', reason: dispatched.problem },
          });
          continue;
        }
        const reads = new Set();
        const dropped = new Set();
        for (const parameter of declared) {
          const keys = route.forwarded.get(parameter);
          if (decided.has(parameter)) reads.add(parameter);
          else if (keys === undefined) dropped.add(parameter);
          else if ([...keys].some((key) => dispatched.reads.has(key))) reads.add(parameter);
        }
        bindings.push({
          ...binding,
          entry: dispatched.entry,
          reads,
          dropped: { symbol: route.symbol, parameters: dropped },
        });
      }
    }
    return bindings;
  },

  /** `PARAMETER_OWNERS` (parameter-ownership.ts) — parameter → the types that own it. */
  owners(project) {
    const file = project
      .getSourceFiles()
      .find((candidate) => candidate.getVariableDeclaration('PARAMETER_OWNERS') !== undefined);
    const table = unwrap(file?.getVariableDeclaration('PARAMETER_OWNERS').getInitializer());
    if (!Node.isObjectLiteralExpression(table)) throw new Error('PARAMETER_OWNERS not found');
    const owners = new Map();
    for (const property of table.getProperties()) {
      const list = Node.isPropertyAssignment(property)
        ? unwrap(property.getInitializer())
        : undefined;
      if (!Node.isArrayLiteralExpression(list)) continue;
      owners.set(
        property.getName(),
        list.getElements().map((element) => element.getText().slice(1, -1))
      );
    }
    return owners;
  },

  /** resource_type → { handler class, the router method's forwarding map }. */
  routes(project, router) {
    const routes = new Map();
    const method = router.getMethodOrThrow('routeToResource');
    for (const clause of method.getDescendantsOfKind(SyntaxKind.CaseClause)) {
      const type = stringLabel(clause);
      const call = clause.getFirstDescendantByKind(SyntaxKind.CallExpression);
      const routeName = call === undefined ? undefined : thisMethodName(call);
      if (type === undefined || routeName === undefined) continue;
      const route = router.getMethodOrThrow(routeName);
      const sourceName = route.getParameters()[0].getName();
      const handoff = route
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find((candidate) => fieldCall(candidate)?.method === 'handleAction');
      const target = handoff === undefined ? undefined : unwrap(handoff.getArguments()[0]);
      routes.set(type, {
        symbol: `${router.getName()}.${routeName}`,
        handler:
          handoff === undefined ? undefined : fieldClass(project, router, fieldCall(handoff).field),
        forwarded: Node.isIdentifier(target)
          ? forwardedKeys(route.getBody(), sourceName, target.getText())
          : new Map(),
      });
    }
    return routes;
  },
};

const ADAPTERS = [systemControlAdapter, resourceManagerAdapter];

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
        reason: binding.dropped?.parameters.has(parameter)
          ? `declared by ${binding.declaredBy} and dropped by ${binding.dropped.symbol} before ` +
            `${binding.entry.symbol} is reached`
          : `declared by ${binding.declaredBy} and never read by ${binding.entry.symbol}${
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

/** `helperReads`: whether the helper reads `severity`. `routerCopies`: whether `reason` is copied. */
function resourceManagerFixture({ helperReads, routerCopies }) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    '/ownership.ts',
    `export const PARAMETER_OWNERS = { severity: ['demo'], detail: ['other'] };`
  );
  project.createSourceFile(
    '/router.ts',
    `
export class Router {
  private readonly demoHandler: DemoHandler;
  async handleAction(args: any) {
    if (args.confirm !== true) throw new Error('confirm');
    this.log({ id: args.id, note: "'reason' is logged by name here" });
    return this.routeToResource(args.resource_type, args);
  }
  private routeToResource(type: string, args: any) {
    switch (type) {
      case 'demo':
        return this.routeToDemo(args);
      default:
        throw new Error('unknown');
    }
  }
  private routeToDemo(args: any) {
    const demoArgs: any = { action: args.action, id: args.id };
    if (args.enforcement_mode) demoArgs.enforcementMode = args.enforcement_mode;
    if (args.severity) demoArgs.severity = args.severity;
    ${routerCopies ? 'if (args.reason) demoArgs.reason = args.reason;' : ''}
    return this.demoHandler.handleAction(demoArgs, {});
  }
  private log(entry: unknown) { return entry; }
}
`
  );
  project.createSourceFile(
    '/handler.ts',
    `
export class DemoHandler {
  private readonly lifecycle: DemoProcessor;
  async handleAction(args: any, _context: unknown) {
    const action = args.action;
    switch (action) {
      case 'update':
        return this.lifecycle.handleUpdate(args);
      case 'inspect':
        return this.lifecycle.handleInspect(args);
      default:
        throw new Error("Unknown action. 'severity' is spelled like this.");
    }
  }
}
export class DemoProcessor {
  private readonly helper: DemoHelper;
  handleUpdate(args: any) {
    const { id } = args;
    this.note("'severity' is named here, on update, and read nowhere");
    return this.helper.apply(id, args);
  }
  handleInspect(args: any) {
    return args.id;
  }
  private note(message: string) { return message; }
}
export class DemoHelper {
  apply(id: string, input: any) {
    return [id, input.enforcementMode${helperReads ? ', input.severity, input.reason' : ''}];
  }
}
`
  );
  return checkBindings(
    resourceManagerAdapter.bind({
      project,
      routerPath: '/router.ts',
      commands: [
        {
          id: 'demo:update',
          parameters: ['resource_type', 'action', 'id', 'severity', 'enforcement_mode', 'reason'],
        },
        {
          id: 'common:inspect',
          parameters: ['resource_type', 'action', 'id', 'detail', 'confirm'],
        },
      ],
    })
  );
}

function selfTestResourceManager() {
  const failures = [];
  // Planted: the helper the processor hands `args` to never reads `severity` (named only in a
  // string, twice), and the router never copies `reason` (named only in a log line). `detail` is
  // owned by another type, so `common:inspect` does not declare it for `demo`; `confirm` is the
  // router's own guard; `enforcement_mode` reaches the helper renamed as `enforcementMode`.
  const planted = resourceManagerFixture({ helperReads: false, routerCopies: false });
  const expected = ['demo:update/reason', 'demo:update/severity'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(`planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ')}`);
  }
  const dropped = planted.findings.find((finding) => finding.parameter === 'reason');
  if (dropped !== undefined && !dropped.reason.includes('dropped by Router.routeToDemo')) {
    failures.push(
      `planted: 'reason' should be reported as dropped by the router: ${dropped.reason}`
    );
  }
  // Twin, differing only in those two reads: clean, with every read proven — id, severity,
  // enforcement_mode, reason on update; id and confirm on inspect.
  const fixed = resourceManagerFixture({ helperReads: true, routerCopies: true });
  if (fixed.findings.length !== 0) failures.push(`fixed twin: got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 6)
    failures.push(`fixed twin: expected 6 proven reads, got ${fixed.verified}`);
  return failures.map((failure) => `resource_manager: ${failure}`);
}

function selfTest() {
  const failures = [...selfTestSystemControl(), ...selfTestResourceManager()];
  for (const failure of failures) console.error(`❌ self-test: ${failure}`);
  if (failures.length === 0) console.log('[validate-tool-parameter-reads] self-test OK');
  return failures.length > 0 ? 1 : 0;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : runLive());
