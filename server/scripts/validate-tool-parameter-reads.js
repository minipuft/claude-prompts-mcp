#!/usr/bin/env node

/**
 * Fails when an MCP tool command declares a parameter the code it dispatches to never reads, and
 * when that code reads a parameter its command does not declare (the reverse direction).
 *
 * THE CLASS. The undeclared-key refusal stops a key the contract does not name. It cannot see the
 * opposite gap: a key the contract DOES name for a command, which nothing then reads. Every tool
 * copies its arguments by hand at least once on the way in (`this.enable({ reason: args.reason })`,
 * the `resource_manager` router's `gateArgs.severity = args.severity`, `prompt_engine`'s
 * `normalizedArgs` allowlist), so a declared parameter left out of a copy is accepted, validated,
 * and read by nobody — the call answers success for something that never happened. `persist` on
 * `system_control framework enable` was the first instance found (P4.114, #357); P4.124 closed
 * the class for `system_control`, and this check now covers all three tools (P4.153).
 *
 * ONE READ MODEL, THREE ADAPTERS. What counts as a read is the same for every tool; an adapter only
 * says where each command's code starts and where its boundary is:
 *
 *   - system_control: the action's handler class `execute(args)`, restricted to the `case` that
 *     dispatches the command's operation. Boundary: an argument handed to anything that is not a
 *     method of the handler.
 *   - resource_manager: the router's per-type copy (`routeToGateManager` → `gateArgs`, through any
 *     rename), then the per-type handler's `case` for the action, then the processor it hands the
 *     arguments to. `common:<action>` applies to every type whose handler has that `case`, and
 *     declares a type-owned parameter only for its owners (`PARAMETER_OWNERS`). The router's own
 *     guards (`confirm` on a destructive action) are reads.
 *   - prompt_engine: the registration's allowlist copy, then `PromptExecutor.executePromptCommand`,
 *     which either consumes a parameter itself or copies it into the pipeline request; a copied
 *     field must be read as `mcpRequest.<field>` somewhere under `engine/execution`.
 *
 * WHAT COUNTS AS A READ — a property read off the argument object, not a name:
 *
 *   - `args.x`, `args['x']`, `(args as T).x`, and the same through an alias
 *     (`const supplied = args as Record<…>`);
 *   - `const { x } = args` and a destructured parameter `({ x })`, only when the binding `x` is
 *     used — destructuring a key and never touching it reads nothing;
 *   - `args[key]` inside `for (const key of LIST)` or `Object.entries(MAP)`, where LIST/MAP is a
 *     constant in the file or imported from a scanned one: every listed key (a field registry);
 *   - `this.method(args)` and `this.field.method(args)` follow `args` into that method, when the
 *     field holds a class the scan loaded; a method of a base class counts;
 *   - `this.method({ key: args.x })` counts `x` only if `method` reads `key` from that parameter;
 *   - an argument handed to anything else counts as read: that is the boundary.
 *
 * A string literal, a comment, or an error message naming the parameter is NOT a read.
 *
 * THE REVERSE DIRECTION (row 2.8): every parameter the command's own path USES must be declared
 * on a command that resolves to it. The contract's per-command lists are what the per-action
 * refusal reads and what a caller is told; a read they omit is a parameter nobody can learn of
 * (the router required `confirm` on rollback while `common:rollback` never named it). The path is
 * narrower than the forward read model: the operation's or action's own `case` and the processor
 * it hands the arguments to, plus a router guard scoped to the action by a positive
 * `SET.has(action)`. A presence test (`args.x !== undefined`) is not a use — it is how code
 * refuses a key.
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH, as of 2026-10-05:
 *
 *   - In the reverse direction: handler code outside the dispatch `switch` (it runs for every
 *     operation and its own guards are not modelled), an action whose handler has no per-operation
 *     `case` (`skills_sync` hands every argument to one service), a router guard not scoped by a
 *     positive `SET.has(action)`, and a key used only behind a presence test.
 *   - Whether a value that crossed the boundary is honoured beyond it.
 *   - A read through computed access other than a field registry, or through a module function
 *     handed `args` whole. Either reports a false finding, never a false pass.
 *   - A parameter that only DECIDES another copied key (`if (args.x) out.y = …`) counts as copied
 *     under that key — a false pass if `y` is read and `x` meant something else.
 *   - Whether the tool refuses a declared parameter sent to the WRONG action. `resource_manager`
 *     does (P4.134); `system_control` does not.
 *
 * Exceptions: `AWAITING_RULING` names findings whose only fix removes a parameter from the tool
 * entirely, which needs an owner ruling (R4). Each is stamped; an entry that no longer reports is
 * itself a finding.
 *
 * Fails closed below each adapter's `minimumReads`: a green run must have proved that many declared
 * parameters are read, or it is not reaching the code it claims to govern.
 *
 * Run: `npm run validate:tool-parameter-reads` · self-test: `--self-test`
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Node, Project, SyntaxKind } from 'ts-morph';

import {
  destructuredKeys,
  fieldCall,
  fieldClass,
  findClass,
  findMethod,
  guardedActions,
  isParameterRef,
  readsIn,
  readsOfMethod,
  thisMethodName,
  unwrap,
} from './lib/parameter-reads/read-model.js';
import { selfTest } from './lib/parameter-reads/self-test.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(SERVER_ROOT, 'tooling', 'contracts');
const TOOLS_DIR = path.join(SERVER_ROOT, 'src', 'mcp', 'tools');

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
    const values = { cache: new Map(), project, valuesOnly: true };
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
      let pathRoots = [body];
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
        pathRoots = selected;
      }

      const reads = readsIn(context, handler, roots, parameterName, excluded);
      const entry = entryOf(handler, 'execute');
      return {
        ...binding,
        entry,
        qualifier: operation === undefined ? '' : ` for operation '${operation}'`,
        reads,
        // The reverse direction reads only the operation's own case: code outside the switch
        // runs for every operation, and which of them its reads serve is not modelled. An
        // operation with no case of its own (skills_sync hands every argument to one service,
        // which dispatches past the boundary) has nothing to attribute, so it is not checked.
        readKeys:
          operation !== undefined && dispatch === undefined
            ? undefined
            : new Map(
                [...readsIn(values, handler, pathRoots, parameterName)]
                  .filter((key) => !this.exempt.has(key))
                  .map((key) => [key, entry.symbol])
              ),
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
    const initializer = unwrap(declaration.getInitializer() ?? declaration);
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

/**
 * The keys read on dispatch of `action` by a per-type handler whose `handleAction(args)` switches
 * on the action: reads in the handler itself, plus those of each processor it hands `args` to
 * (`this.lifecycle.handleUpdate(args)`). The processor is where the parameter is owned, so the
 * read model continues into it; past the processor, `args` handed on whole is not followed.
 */
function dispatchReads(context, project, handler, action, values = context) {
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
  // What this action's own path reads — its case and the processor — for the reverse direction.
  const pathReads = readsIn(values, handler, selected, parameterName);
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
    for (const key of readsOfMethod(values, processor, target.method, index)) pathReads.add(key);
  }
  return {
    reads,
    pathReads,
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
    const values = { cache: new Map(), project, valuesOnly: true };
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
    const routerArgs = router.getMethodOrThrow('handleAction').getParameters()[0].getName();
    const guards = routerBody
      .getDescendantsOfKind(SyntaxKind.IfStatement)
      .map((guard) => guard.getExpression());
    const decided = sourcesIn(routerBody, routerArgs, guards);
    // The reverse direction needs the narrower fact: which actions a guard REQUIRES a parameter
    // on (`DESTRUCTIVE_ACTIONS.has(action) && args.confirm !== true`). A guard that reads a key to
    // refuse it (`source_workspace` outside the read actions) requires nothing.
    const required = new Map();
    for (const guard of guards) {
      for (const action of guardedActions(guard)) {
        const keys = required.get(action) ?? new Set();
        for (const key of sourcesIn(routerBody, routerArgs, [guard])) keys.add(key);
        required.set(action, keys);
      }
    }
    const guardSymbol = `${router.getName()}.handleAction`;

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
        const dispatched = dispatchReads(context, project, route.handler, action, values);
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
        const readKeys = new Map();
        for (const [parameter, keys] of route.forwarded) {
          if ([...keys].some((key) => dispatched.pathReads.has(key))) {
            readKeys.set(parameter, dispatched.entry.symbol);
          }
        }
        for (const parameter of required.get(action) ?? []) readKeys.set(parameter, guardSymbol);
        for (const parameter of this.exempt) readKeys.delete(parameter);
        bindings.push({
          ...binding,
          entry: dispatched.entry,
          reads,
          readKeys,
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

/** Every request field the pipeline reads: `….mcpRequest.<field>` and `const { f } = ….mcpRequest`. */
function pipelineRequestReads(project, directory) {
  const reads = new Set();
  const isRequest = (node) =>
    (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) &&
    /(^|\.)mcpRequest$/.test(unwrap(node).getText());
  for (const file of project.getSourceFiles()) {
    if (!file.getFilePath().startsWith(directory)) continue;
    for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (isRequest(unwrap(access.getExpression()))) reads.add(access.getName());
    }
    for (const declaration of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const bound = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isObjectBindingPattern(bound) || initializer === undefined) continue;
      if (!isRequest(unwrap(initializer))) continue;
      for (const key of destructuredKeys(bound)) reads.add(key);
    }
  }
  return reads;
}

/**
 * `prompt_engine`: three hops, each a hand-written copy. The tool registration copies the
 * validated arguments into an allowlist (`normalizedArgs`) — the hop where `remainder`,
 * `handoff`, `claim_token`, `version_description` and `dry_run` were each dropped before; the
 * executor either consumes a parameter itself (`cancel`, `handoff`, `claim_token`) or copies it
 * into the `request` it hands the pipeline; and past that, a copied field must have a reader in
 * `engine/execution` — its context or any stage. OQ2 measured 2026-09-23: stage 01 alone reads
 * none of `gate_verdict`, `gate_action`, `observations`, `remainder` (execution-context.ts,
 * stages 16 and 17 do), so a boundary drawn at stage 01 would report four false findings.
 */
const promptEngineAdapter = {
  tool: 'prompt_engine',
  contract: 'prompt-engine.json',
  sources: ['index.ts', 'prompt-engine/**/*.ts', '../../engine/execution/**/*.ts'],
  router: 'index.ts',
  pipeline: '../../engine/execution',
  exempt: new Set(),
  minimumReads: 20,
  boundary:
    'the request the executor hands the pipeline — a field copied into it must be read by the ' +
    'execution context or some stage',

  bind({ project, routerPath, commands, contract, pipelinePath }) {
    const context = { cache: new Map(), project };
    const handoff = project
      .getSourceFileOrThrow(routerPath)
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => fieldCall(call)?.method === 'executePromptCommand');
    if (handoff === undefined) throw new Error(`no executePromptCommand call in ${routerPath}`);
    const registration = handoff.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
    const host = handoff.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const allowlist = unwrap(handoff.getArguments()[0]);
    const forwarded = forwardedKeys(
      registration.getBody(),
      registration.getParameters()[0].getName(),
      allowlist.getText()
    );

    const executor = fieldClass(project, host, fieldCall(handoff).field);
    const method = findMethod(executor, 'executePromptCommand');
    const argsName = method.getParameters()[0].getName();
    const consumed = readsIn(context, executor, [method.getBody()], argsName);
    const request = forwardedKeys(method.getBody(), argsName, 'request');
    const pipeline = pipelineRequestReads(project, pipelinePath);

    const readsOf = (key) => {
      const fields = request.get(key);
      if (fields === undefined) return consumed.has(key);
      return [...fields].some((field) => pipeline.has(field));
    };
    const reads = new Set();
    const dropped = new Set();
    const all = contract.parameters.map((parameter) => parameter.name);
    for (const parameter of all) {
      const keys = forwarded.get(parameter);
      if (keys === undefined) dropped.add(parameter);
      else if ([...keys].some(readsOf)) reads.add(parameter);
    }
    const registrationSymbol = `${host.getName()} (prompt_engine registration)`;
    const binding = {
      entry: entryOf(executor, 'executePromptCommand'),
      qualifier: ' or, once copied into its pipeline request, by engine/execution',
      reads,
      dropped: { symbol: registrationSymbol, parameters: dropped },
    };
    return [
      {
        ...binding,
        command: 'call',
        declaredBy: 'the contract',
        parameters: all,
        // What the registration copies on: anything it copies is read, declared or not.
        readKeys: new Map([...forwarded.keys()].map((key) => [key, registrationSymbol])),
      },
      ...commands.map((command) => ({
        ...binding,
        command: command.id,
        declaredBy: command.id,
        parameters: command.parameters.filter((name) => !this.exempt.has(name)),
      })),
    ];
  },
};

const ADAPTERS = [systemControlAdapter, resourceManagerAdapter, promptEngineAdapter];

/**
 * Every (command, parameter) a binding declares and its entry does not read — and, the reverse,
 * every parameter its code reads that no command for it declares.
 *
 * A binding is one contract command resolved to the code that must read its parameters:
 * `{ command, declaredBy, parameters, entry: {file, symbol}, qualifier, reads, readKeys }`, or
 * `{ command, problem }` when the command resolves to no code at all — a finding, not a skip.
 * `readKeys` (parameter → the symbol that reads it) is what the code reads, declared or not;
 * several contract commands can resolve to one `command` (`prompt:delete` from `common:delete`),
 * so the reverse half compares it against the union of their declarations.
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

  const declaredFor = new Map();
  for (const binding of bindings) {
    if (binding.problem !== undefined) continue;
    const declared = declaredFor.get(binding.command) ?? new Set();
    for (const parameter of binding.parameters) declared.add(parameter);
    declaredFor.set(binding.command, declared);
  }
  const reported = new Set();
  for (const binding of bindings) {
    if (binding.problem !== undefined || binding.readKeys === undefined) continue;
    for (const [parameter, symbol] of binding.readKeys) {
      const key = `${binding.command}/${parameter}`;
      if (declaredFor.get(binding.command).has(parameter) || reported.has(key)) continue;
      reported.add(key);
      findings.push({
        command: binding.command,
        parameter,
        reverse: true,
        reason: `read by ${symbol} and declared by no command for ${binding.command}`,
      });
    }
  }
  return { findings, verified };
}

/**
 * Findings whose only fix is a contract change the owner decides, each stamped with the date it
 * was measured and the observation that retires it. Forward: the fix removes the parameter from
 * the tool entirely (R4, 2026-09-23). Reverse: declaring the read changes what the tool refuses
 * for a caller who sends it elsewhere. An entry that no longer reports is itself a finding —
 * delete it in the commit that fixed it.
 */
const AWAITING_RULING = [
  {
    tool: 'resource_manager',
    command: 'prompt:update',
    parameter: 'confirm',
    asOf: '2026-10-05',
    why:
      'PromptLifecycleProcessor.updatePrompt requires confirm: true for tool_operation "remove", ' +
      'which deletes tools/{id}/ directories. Declaring it on prompt:update makes the per-action refusal refuse confirm ' +
      'on gate, framework and category update, where it is accepted and ignored today (64 unit ' +
      'tests send confirm: true on every action, measured).',
    flipsWhen:
      'the owner rules whether confirm on a non-prompt update is refused; declare it on ' +
      'prompt:update and delete this entry in that commit',
  },
];

/** Splits `findings` into real ones and those an entry excuses; an unmatched entry is stale. */
export function applyExceptions(tool, findings, entries) {
  const own = entries.filter((entry) => entry.tool === tool);
  const matches = (entry, finding) =>
    entry.command === finding.command && entry.parameter === finding.parameter;
  return {
    findings: findings.filter((finding) => !own.some((entry) => matches(entry, finding))),
    excused: findings.filter((finding) => own.some((entry) => matches(entry, finding))),
    stale: own.filter((entry) => !findings.some((finding) => matches(entry, finding))),
  };
}

function report(adapter, findings, verified) {
  for (const finding of findings) {
    console.error(
      `❌ ${adapter.tool} ${finding.command}: '${finding.parameter}' — ${finding.reason}`
    );
  }
  if (findings.some((finding) => finding.reverse !== true)) {
    console.error(
      `   A declared parameter the handler ignores is accepted and answers success for something ` +
        `that never ran. Read it where the operation dispatches, or drop it from the command's ` +
        `\`parameters\` in tooling/contracts/${adapter.contract}.`
    );
  }
  if (findings.some((finding) => finding.reverse === true)) {
    console.error(
      `   A parameter the handler uses but its command never declares is one no caller can learn ` +
        `of, and the per-action refusal reads the same lists. Declare it on the command in ` +
        `tooling/contracts/${adapter.contract}, or stop reading it.`
    );
  }
  console.log(
    `[validate-tool-parameter-reads] ${adapter.tool}: ${findings.length} unread declared or ` +
      `undeclared read parameter(s), ${verified} proven read(s)`
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

  const { findings: all, verified } = checkBindings(
    adapter.bind({
      project,
      routerPath: path.join(TOOLS_DIR, adapter.router),
      commands: contract.commands,
      contract,
      pipelinePath:
        adapter.pipeline === undefined ? undefined : path.resolve(TOOLS_DIR, adapter.pipeline),
    })
  );
  const { findings, excused, stale } = applyExceptions(adapter.tool, all, AWAITING_RULING);
  report(adapter, findings, verified);
  for (const finding of excused) {
    console.log(
      `⏸ ${adapter.tool} ${finding.command}: '${finding.parameter}' — awaiting an owner ruling ` +
        `(AWAITING_RULING)`
    );
  }
  for (const entry of stale) {
    console.error(
      `❌ ${adapter.tool} ${entry.command}: '${entry.parameter}' — AWAITING_RULING entry no longer ` +
        `reports (as of ${entry.asOf}); delete it in the commit that fixed it`
    );
  }

  if (verified < adapter.minimumReads) {
    console.error(
      `❌ ${adapter.tool}: only ${verified} declared parameter(s) proven read; expected at least ` +
        `${adapter.minimumReads}. The scan is not reaching the handlers — check the adapter's ` +
        `router and entry resolution.`
    );
    return 1;
  }
  return findings.length > 0 || stale.length > 0 ? 1 : 0;
}

function runLive() {
  // Every tool runs even after one fails, so one run reports the whole surface.
  return ADAPTERS.map(checkTool).some((status) => status !== 0) ? 1 : 0;
}

function runSelfTest() {
  return selfTest({
    checkBindings,
    applyExceptions,
    adapters: {
      systemControl: systemControlAdapter,
      resourceManager: resourceManagerAdapter,
      promptEngine: promptEngineAdapter,
    },
  });
}

process.exit(process.argv.includes('--self-test') ? runSelfTest() : runLive());
