/**
 * The read model shared by every `validate-tool-parameter-reads` adapter: what counts as a read of
 * a parameter off an argument object, and how a read is followed through the handler's own methods
 * and the classes it holds. The adapters in `../../validate-tool-parameter-reads.js` say where each
 * command's code starts and where its boundary is; the rules for a read live here, once.
 */

import { Node, SyntaxKind } from 'ts-morph';

/** `(args as T)`, `args!`, `<T>args` → `args`. */
export function unwrap(node) {
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

export function isParameterRef(node, parameterName) {
  const inner = unwrap(node);
  return Node.isIdentifier(inner) && inner.getText() === parameterName;
}

export function findMethod(classDeclaration, name) {
  let current = classDeclaration;
  while (current !== undefined) {
    const method = current.getMethod(name);
    if (method !== undefined) return method;
    current = current.getBaseClass();
  }
  return undefined;
}

/** `this.name(...)` → `name`; anything else → `undefined`. */
export function thisMethodName(call) {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  if (callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return undefined;
  return callee.getName();
}

/**
 * The keys an object binding pattern reads: an element counts only when the name it binds is used
 * somewhere — `const { id } = args` with `id` never referenced reads nothing. A nested pattern
 * counts when any name inside it is used. A shorthand property (`{ id }`) is a use.
 */
export function destructuredKeys(pattern) {
  return pattern
    .getElements()
    .filter((element) => bindingUsed(element.getNameNode()))
    .map((element) => (element.getPropertyNameNode() ?? element.getNameNode()).getText());
}

function bindingUsed(nameNode) {
  if (Node.isIdentifier(nameNode)) return nameNode.findReferencesAsNodes().length > 0;
  return nameNode
    .getElements()
    .some((element) => !Node.isOmittedExpression(element) && bindingUsed(element.getNameNode()));
}

/** The keys a method reads from its parameter at `index`. */
export function readsOfMethod(context, classDeclaration, methodName, index) {
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
      for (const key of destructuredKeys(nameNode)) reads.add(key);
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
export function readsIn(context, classDeclaration, roots, parameterName, excluded = new Set()) {
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
      for (const key of destructuredKeys(node.getNameNode())) reads.add(key);
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

export function findClass(project, name) {
  return project
    .getSourceFiles()
    .flatMap((file) => file.getClasses())
    .find((candidate) => candidate.getName() === name);
}

/** The class a `this.<field>` holds: its declared type, or the class implementing that port. */
export function fieldClass(project, classDeclaration, fieldName) {
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
export function fieldCall(call) {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const owner = callee.getExpression();
  if (!Node.isPropertyAccessExpression(owner)) return undefined;
  if (owner.getExpression().getKind() !== SyntaxKind.ThisKeyword) return undefined;
  return { field: owner.getName(), method: callee.getName() };
}
