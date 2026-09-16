#!/usr/bin/env tsx
/**
 * Every consumer that re-derives the catalog from disk must be handed a COMPLETE refusal record.
 *
 * WHY THIS EXISTS. `ResourceIndexer` and `ResourceChangeTracker` each run their own filesystem
 * walk and accept any file whose YAML parses. Neither consults the loader, so both used to report
 * resources the catalog had dropped: `resource_index` — which every Python hook reads — pointed at
 * unloadable files, and the change log recorded `added` for a prompt that never entered the
 * catalog (P4.14). The fix hands each of them a live `QuarantineView`.
 *
 * THE PROPERTY THIS PROTECTS IS INVISIBLE TO EVERY OTHER GATE. `quarantine` is an OPTIONAL config
 * field, deliberately — an indexer built without one indexes every parseable file, which is what
 * the existing callers and their tests depend on. The cost of that choice is that DELETING the
 * wiring at either call site typechecks, passes both ratchets, passes `validate:all`, and passes
 * every unit, integration and e2e test, because the consumer suites construct their own indexer
 * and pass their own view. Measured 2026-09-11: the P4.14 tests are thorough about the consumers'
 * BEHAVIOUR and cannot observe whether production reaches it. That is the gap this closes, and it
 * is the `feedback_unwired_validator_launders_absence` shape — a capability with no call site
 * reads as coverage.
 *
 * WHY PRESENCE WAS NOT ENOUGH (P4.26). Until 2026-09-15 this checked only that a `quarantine`
 * PROPERTY appeared at each call site. A property is present whether it carries one loader's view
 * or four, so the gate could not see the defect it was written beside: `application.ts`'s
 * hot-reload re-sync passed `this.promptManager.getQuarantine()` alone, under a comment claiming
 * the gate, framework and style views joined there, and the first hot reload re-indexed every
 * refused gate, framework and style. Presence was green, every quarantine test was green, and
 * deleting one view from the startup merge was equally invisible. The check now resolves the
 * expression BEHIND the property and requires it to cover every loader the consumer's walk
 * reaches.
 *
 * WHAT IT CHECKS. Under `src/`:
 *   - every CALL to `createResourceIndexer(...)` is handed a view covering all four kinds the
 *     indexer walks as directories: prompt, gate, framework, style;
 *   - every CALL to `compareResourceBaseline(...)` is handed a view covering prompt and gate,
 *     which is exactly `TrackedResourceType` — the comparison's whole domain;
 *   - every write of the carrier name `indexQuarantine` — the one channel the complete merge
 *     travels on — is itself complete, or forwards another carrier;
 *   - at least one carrier write is a real merge rather than a forward, so the chain is anchored
 *     in something that reads four loaders instead of in another name.
 *
 * Parsed with the TypeScript AST rather than matched by text. A regex cannot tell a `quarantine`
 * inside the config object from one in a comment beside it or in an unrelated call on the next
 * line — and a false PASS here is exactly the outcome this check exists to prevent.
 *
 * WHY A NAMED CARRIER AND NOT A DATAFLOW TRACE. The complete merge is built at the composition
 * root (`runtime/module-initializer.ts`), returned through `ModuleInitResult`, stored on
 * `Application`, and read by the reload path — four files. Following that by type would need a
 * whole `ts.Program` and a cross-file assignment trace. Naming the channel instead makes every
 * hop decidable in one file: a reference to `indexQuarantine` is trusted BECAUSE every write to
 * `indexQuarantine`, in any file, is checked here. Renaming the field without renaming
 * `CARRIER_NAME` fails loudly (the consumer's expression stops resolving) rather than quietly.
 *
 * `--self-test` proves the predicate reports each unwired and each INCOMPLETE shape — one case per
 * loader dropped from the merge — and stays silent on the wired one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(SERVER_ROOT, 'src');

/** The config property that carries the refusal record into `ResourceIndexer`. */
const QUARANTINE_PROPERTY = 'quarantine';

/**
 * The single name the COMPLETE merged view travels under, across every file that passes it on.
 *
 * Kept in lockstep with `runtime/module-initializer.ts` (`const indexQuarantine`, and the
 * `ModuleInitResult` field of the same name) and `runtime/application.ts` (the field and the
 * narrowed local). See the header for why a name and not a type.
 */
const CARRIER_NAME = 'indexQuarantine';

/** The loaders that own a refusal record, matching `QuarantinedResourceType`. */
type QuarantineOwner = 'prompt' | 'gate' | 'framework' | 'style';

const ALL_OWNERS: readonly QuarantineOwner[] = ['prompt', 'gate', 'framework', 'style'];

/**
 * Receiver name -> which loader's record `<receiver>.getQuarantine()` returns.
 *
 * Matched on the LAST identifier of the receiver, so `this.promptManager.getQuarantine()` and
 * `promptManager.getQuarantine()` classify alike. A receiver that is not listed is reported as
 * unresolvable rather than ignored: a view whose owner cannot be named cannot be counted toward
 * coverage, and silently skipping it is how a merge of four unknowns would read as complete.
 */
const VIEW_RECEIVERS: ReadonlyMap<string, QuarantineOwner> = new Map([
  ['promptManager', 'prompt'],
  ['promptLoader', 'prompt'],
  ['gateManager', 'gate'],
  ['gateLoader', 'gate'],
  ['frameworkManager', 'framework'],
  ['frameworkLoader', 'framework'],
  ['styleManager', 'style'],
  ['styleLoader', 'style'],
]);

const VIEW_ACCESSOR = 'getQuarantine';
const MERGE_FUNCTION = 'mergeQuarantineViews';

/** Guards against a cycle in the local bindings from becoming a stack overflow. */
const MAX_RESOLUTION_DEPTH = 8;

/**
 * Each catalog-re-deriving consumer, where its refusal record has to appear, and how much of the
 * catalog that consumer's own walk reaches.
 *
 * A table rather than hand-written checks: a third consumer is an entry, and an entry cannot be
 * silently omitted the way a third `if` block can — the same argument P4.13 made for
 * `toFrameworkCreationData`, where fifteen hand-written blocks lost two of eleven fields.
 */
interface ConsumerRule {
  /** Function whose call sites must be wired. */
  readonly callee: string;
  /**
   * `config-property` — the view rides a property of an object-literal argument.
   * `positional`    — the view is an argument in its own right.
   */
  readonly carrier: 'config-property' | 'positional';
  /** Argument index holding the config object, or the argument the view must occupy. */
  readonly argIndex: number;
  /** Loaders this consumer's own filesystem walk reaches, and so must be able to refuse. */
  readonly requiredOwners: readonly QuarantineOwner[];
  /** What a reader should do about a finding. */
  readonly remedy: string;
}

const CONSUMERS: readonly ConsumerRule[] = [
  {
    callee: 'createResourceIndexer',
    carrier: 'config-property',
    argIndex: 2,
    // All four directory-form kinds: the indexer walks prompts, gates, frameworks and styles in
    // one pass, so a missing view means `resource_index` publishes that kind's refused files to
    // every Python hook.
    requiredOwners: ALL_OWNERS,
    remedy: `pass \`${QUARANTINE_PROPERTY}\` in the config object — a kind missing from the merge gets a \`resource_index\` row for every file that merely parses, including ones no loader would serve`,
  },
  {
    callee: 'compareResourceBaseline',
    carrier: 'positional',
    argIndex: 3,
    // `TrackedResourceType` is exactly `'prompt' | 'gate'`; requiring more here would demand a
    // view for kinds this comparison never walks.
    requiredOwners: ['prompt', 'gate'],
    remedy:
      'pass a prompt+gate quarantine view as the fourth argument — without it the baseline logs `added` for a file that never entered the catalog',
  },
];

export interface UnwiredConsumer {
  file: string;
  line: number;
  callee: string;
  reason: string;
}

/** One write of the carrier name, and what the written expression turned out to be. */
export interface CarrierWrite {
  file: string;
  line: number;
  /** True when the written expression covers all four loaders on its own. */
  anchored: boolean;
  /** True when the written expression just forwards another carrier reference. */
  forwarded: boolean;
  /**
   * Why this write poisons the channel, or undefined when it is an anchor or a forward.
   *
   * This is where a partial merge is caught. A reference to `indexQuarantine` at a call site is
   * trusted for its name, so the name has to be worth trusting: a write that is neither a
   * complete merge nor a forward of one is the finding, reported at the write rather than at
   * every site that reads it.
   */
  problem?: string;
}

/** What an expression was found to carry. */
interface Resolution {
  owners: Set<QuarantineOwner>;
  /** Expressions the reader of this script could not attribute to a loader. */
  unresolved: string[];
  /** The value came through the carrier name, whose writes are checked separately. */
  viaCarrier: boolean;
}

const emptyResolution = (): Resolution => ({
  owners: new Set<QuarantineOwner>(),
  unresolved: [],
  viaCarrier: false,
});

const carrierResolution = (): Resolution => ({
  owners: new Set<QuarantineOwner>(ALL_OWNERS),
  unresolved: [],
  viaCarrier: true,
});

function unionInto(target: Resolution, source: Resolution): void {
  for (const owner of source.owners) target.owners.add(owner);
  target.unresolved.push(...source.unresolved);
  target.viaCarrier = target.viaCarrier || source.viaCarrier;
}

/** Every `.ts` file below a directory, skipping declaration files. */
function typescriptFilesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...typescriptFilesUnder(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** The last identifier of a receiver expression: `this.a.gateManager` -> `gateManager`. */
function receiverName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return undefined;
}

/** Strip the wrappers that do not change which view an expression denotes. */
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
    return unwrap(node.expression);
  if (ts.isAsExpression(node) || ts.isNonNullExpression(node)) return unwrap(node.expression);
  return node;
}

/**
 * The nearest lexical binding of `name` visible from `from`, as an expression to resolve.
 *
 * Walks ancestors rather than scanning the file for the name, so a same-named local in an
 * unrelated function cannot answer for this reference. Returns the initializer for a variable, or
 * a parameter marker for a parameter — the caller resolves a parameter through the enclosing
 * function's call sites.
 */
function findBinding(
  name: string,
  from: ts.Node
):
  | { kind: 'value'; expression: ts.Expression }
  | { kind: 'parameter'; fn: ts.Node; index: number }
  | undefined {
  for (let scope: ts.Node | undefined = from; scope !== undefined; scope = scope.parent) {
    const statements = (scope as { statements?: ts.NodeArray<ts.Statement> }).statements;
    for (const statement of statements ?? []) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer !== undefined
        ) {
          return { kind: 'value', expression: declaration.initializer };
        }
      }
    }
    const parameters = (scope as { parameters?: ts.NodeArray<ts.ParameterDeclaration> }).parameters;
    const index = (parameters ?? []).findIndex(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name
    );
    if (index >= 0) return { kind: 'parameter', fn: scope, index };
  }
  return undefined;
}

/**
 * Resolve a parameter through the calls to its enclosing function, in the same file.
 *
 * Owners are INTERSECTED across callers: coverage has to hold on every path into the function, so
 * one caller supplying a complete view must not cover for another that does not. A function with
 * no visible caller is unresolved, not empty — `compareBaselineAndReport` is the shape this
 * exists for, and a helper called from another file would be a finding worth seeing.
 */
function resolveParameter(
  fn: ts.Node,
  index: number,
  sourceFile: ts.SourceFile,
  depth: number
): Resolution {
  const name = (fn as { name?: ts.Identifier }).name?.text;
  if (name === undefined)
    return { ...emptyResolution(), unresolved: ['parameter of an anonymous function'] };

  const perCaller: Resolution[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      const argument = node.arguments[index];
      perCaller.push(
        argument === undefined
          ? {
              ...emptyResolution(),
              unresolved: [`\`${name}(...)\` called without argument ${index}`],
            }
          : resolveView(argument, sourceFile, depth + 1)
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (perCaller.length === 0) {
    return {
      ...emptyResolution(),
      unresolved: [`no call to \`${name}(...)\` in this file to read the view from`],
    };
  }

  const intersected: Resolution = {
    owners: new Set(ALL_OWNERS.filter((owner) => perCaller.every((one) => one.owners.has(owner)))),
    unresolved: perCaller.flatMap((one) => one.unresolved),
    viaCarrier: perCaller.every((one) => one.viaCarrier),
  };
  return intersected;
}

/** Which loaders' records an expression carries. */
export function resolveView(node: ts.Expression, sourceFile: ts.SourceFile, depth = 0): Resolution {
  if (depth > MAX_RESOLUTION_DEPTH) {
    return { ...emptyResolution(), unresolved: ['binding chain too deep to resolve'] };
  }
  const expression = unwrap(node);

  if (ts.isPropertyAccessExpression(expression) && expression.name.text === CARRIER_NAME) {
    return carrierResolution();
  }

  if (ts.isIdentifier(expression)) {
    if (expression.text === CARRIER_NAME) return carrierResolution();
    const binding = findBinding(expression.text, expression);
    if (binding === undefined) {
      return {
        ...emptyResolution(),
        unresolved: [`\`${expression.text}\` has no visible binding here`],
      };
    }
    return binding.kind === 'value'
      ? resolveView(binding.expression, sourceFile, depth + 1)
      : resolveParameter(binding.fn, binding.index, sourceFile, depth);
  }

  if (ts.isCallExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && expression.expression.text === MERGE_FUNCTION) {
      const merged = emptyResolution();
      for (const argument of expression.arguments) {
        unionInto(merged, resolveView(argument, sourceFile, depth + 1));
      }
      return merged;
    }
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === VIEW_ACCESSOR
    ) {
      const receiver = receiverName(expression.expression.expression);
      const owner = receiver === undefined ? undefined : VIEW_RECEIVERS.get(receiver);
      if (owner === undefined) {
        return {
          ...emptyResolution(),
          unresolved: [
            `\`${receiver ?? '?'}.${VIEW_ACCESSOR}()\` — no loader is declared for that receiver`,
          ],
        };
      }
      return { owners: new Set([owner]), unresolved: [], viaCarrier: false };
    }
  }

  return {
    ...emptyResolution(),
    unresolved: ['expression is not a view, a merge, or a local binding'],
  };
}

/** The finding text for a resolution that does not cover what a consumer needs. */
function coverageReason(
  resolution: Resolution,
  required: readonly QuarantineOwner[]
): string | undefined {
  const missing = required.filter((owner) => !resolution.owners.has(owner));
  if (missing.length > 0) {
    const seen = [...resolution.owners].sort().join(', ') || 'nothing';
    return `the view behind it covers ${seen}, missing ${missing.join(', ')}`;
  }
  if (resolution.unresolved.length > 0) {
    return `the view behind it cannot be read: ${resolution.unresolved.join('; ')}`;
  }
  return undefined;
}

/** True when an object literal assigns or shorthands `quarantine`; returns the expression if so. */
function quarantineArgument(node: ts.Expression): ts.Expression | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === QUARANTINE_PROPERTY) {
      return property.name;
    }
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === QUARANTINE_PROPERTY
    ) {
      return property.initializer;
    }
    // A spread could supply it, and this check cannot see through one. Reported rather than
    // assumed either way — see `run()`, where an unresolvable shape is a finding, not a pass.
  }
  return undefined;
}

/** Every write of the carrier name in one file, paired with what was written. */
function collectCarrierWrites(file: string, sourceFile: ts.SourceFile): CarrierWrite[] {
  const writes: CarrierWrite[] = [];
  const record = (node: ts.Node, expression: ts.Expression): void => {
    const resolution = resolveView(expression, sourceFile);
    const forwarded = resolution.viaCarrier;
    const complete = ALL_OWNERS.every((owner) => resolution.owners.has(owner));
    const problem = forwarded ? undefined : coverageReason(resolution, ALL_OWNERS);
    writes.push({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      anchored: complete && !forwarded,
      forwarded,
      ...(problem !== undefined ? { problem } : {}),
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === CARRIER_NAME &&
      node.initializer !== undefined
    ) {
      record(node, node.initializer);
    } else if (
      (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === CARRIER_NAME &&
      node.initializer !== undefined
    ) {
      record(node, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === CARRIER_NAME
    ) {
      record(node, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return writes;
}

/**
 * Findings for one source file, how many wired call sites it held, and its carrier writes.
 *
 * The count travels with the findings because silence from a scan that saw no call site at all is
 * not evidence — see the `sitesSeen` guard in `run()`.
 */
export function findUnwiredConsumers(
  file: string,
  source: string
): { findings: UnwiredConsumer[]; sitesSeen: number; carrierWrites: CarrierWrite[] } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const findings: UnwiredConsumer[] = [];
  let sitesSeen = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const rule = CONSUMERS.find((candidate) => candidate.callee === node.expression.getText());
      if (rule !== undefined) {
        sitesSeen += 1;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const argument = node.arguments[rule.argIndex];
        const reason = callSiteReason(rule, argument, sourceFile);
        if (reason !== undefined) findings.push({ file, line, callee: rule.callee, reason });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { findings, sitesSeen, carrierWrites: collectCarrierWrites(file, sourceFile) };
}

/** Why one call site is a finding, or undefined when it is wired and complete. */
function callSiteReason(
  rule: ConsumerRule,
  argument: ts.Expression | undefined,
  sourceFile: ts.SourceFile
): string | undefined {
  if (argument === undefined) {
    return rule.carrier === 'positional'
      ? 'no quarantine argument'
      : 'no config argument to carry the quarantine view';
  }
  if (rule.carrier === 'positional') {
    return coverageReason(resolveView(argument, sourceFile), rule.requiredOwners);
  }
  if (!ts.isObjectLiteralExpression(argument)) {
    return 'config is not an object literal here, so the wiring cannot be read';
  }
  const view = quarantineArgument(argument);
  if (view === undefined) return `config object omits \`${QUARANTINE_PROPERTY}\``;
  return coverageReason(resolveView(view, sourceFile), rule.requiredOwners);
}

const COMPLETE_MERGE = `
const tracked = mergeQuarantineViews(promptManager.getQuarantine(), gateManager.getQuarantine());
const indexQuarantine = mergeQuarantineViews(
  tracked,
  frameworkLoader.getQuarantine(),
  styleLoader.getQuarantine()
);
`;

const wiredShape = (merge = COMPLETE_MERGE): string => `${merge}
const indexer = createResourceIndexer(dbManager, logger, {
  resourcesDir,
  resourceRoots: indexerResourceRoots(pathResolver),
  quarantine: indexQuarantine,
});
await compareResourceBaseline(tracker, configManager, logger, tracked);
`;

/** The same shape with one loader's view dropped — one case per loader. */
function mergeMissing(owner: QuarantineOwner): string {
  const leaves: Record<QuarantineOwner, string> = {
    prompt: 'promptManager.getQuarantine()',
    gate: 'gateManager.getQuarantine()',
    framework: 'frameworkLoader.getQuarantine()',
    style: 'styleLoader.getQuarantine()',
  };
  const tracked = (['prompt', 'gate'] as QuarantineOwner[])
    .filter((each) => each !== owner)
    .map((each) => leaves[each]);
  const extra = (['framework', 'style'] as QuarantineOwner[])
    .filter((each) => each !== owner)
    .map((each) => leaves[each]);
  return `
const tracked = mergeQuarantineViews(${tracked.join(', ')});
const indexQuarantine = mergeQuarantineViews(tracked${extra.length > 0 ? `, ${extra.join(', ')}` : ''});
`;
}

const UNWIRED_INDEXER_SHAPE = `${COMPLETE_MERGE}
const indexer = createResourceIndexer(dbManager, logger, { resourcesDir });
await compareResourceBaseline(tracker, configManager, logger, tracked);
`;

const UNWIRED_BASELINE_SHAPE = `${COMPLETE_MERGE}
const indexer = createResourceIndexer(dbManager, logger, { resourcesDir, quarantine: indexQuarantine });
await compareResourceBaseline(tracker, configManager, logger);
`;

/**
 * The laundering case: `quarantine` is in scope, named on the line above, and passed to something
 * else. A text search for the identifier near the call would call this wired.
 */
const NEARBY_QUARANTINE_SHAPE = `
const quarantine = promptManager.getQuarantine();
logger.debug(\`quarantine holds \${quarantine.size}\`);
const indexer = createResourceIndexer(dbManager, logger, { resourcesDir });
`;

/** P4.25's motivating instance: the reload path handed the prompt view alone. */
const PROMPTS_ONLY_SHAPE = `
const indexer = createResourceIndexer(dbManager, this.logger, {
  resourcesDir,
  quarantine: this.promptManager.getQuarantine(),
});
`;

/** The reload path after P4.25: it consumes the carrier the composition root built. */
const CARRIER_CONSUMER_SHAPE = `
const indexQuarantine = this.indexQuarantine;
const indexer = createResourceIndexer(dbManager, this.logger, {
  resourcesDir,
  quarantine: indexQuarantine,
});
`;

/** A carrier written from one loader — the channel itself being poisoned. */
const CARRIER_WRITTEN_PARTIAL = `
const indexQuarantine = promptManager.getQuarantine();
const indexer = createResourceIndexer(dbManager, logger, { resourcesDir, quarantine: indexQuarantine });
`;

interface SelfTestCase {
  name: string;
  source: string;
  expect: (_findings: UnwiredConsumer[], _writes: CarrierWrite[]) => boolean;
}

const reportsIndexerFinding = (findings: UnwiredConsumer[]): boolean =>
  findings.length === 1 && findings[0]?.callee === 'createResourceIndexer';

function selfTestCases(): SelfTestCase[] {
  const cases: SelfTestCase[] = [
    {
      name: 'both consumers wired and complete reports nothing',
      source: wiredShape(),
      expect: (f) => f.length === 0,
    },
    {
      name: 'an indexer built without a quarantine is reported',
      source: UNWIRED_INDEXER_SHAPE,
      expect: reportsIndexerFinding,
    },
    {
      name: 'a baseline comparison missing its fourth argument is reported',
      source: UNWIRED_BASELINE_SHAPE,
      expect: (f) => f.length === 1 && f[0]?.callee === 'compareResourceBaseline',
    },
    {
      name: 'a quarantine named beside the call does not launder an unwired config',
      source: NEARBY_QUARANTINE_SHAPE,
      expect: reportsIndexerFinding,
    },
    {
      name: 'the prompt view alone is reported (P4.25, the motivating instance)',
      source: PROMPTS_ONLY_SHAPE,
      expect: (f) =>
        reportsIndexerFinding(f) &&
        (f[0]?.reason.includes('missing gate, framework, style') ?? false),
    },
    {
      name: 'a consumer reading the carrier the composition root built reports nothing',
      source: CARRIER_CONSUMER_SHAPE,
      expect: (f) => f.length === 0,
    },
    {
      name: 'a carrier written from one loader is reported, not trusted for its name',
      source: CARRIER_WRITTEN_PARTIAL,
      expect: (f, writes) =>
        f.length === 0 &&
        writes.length === 1 &&
        (writes[0]?.problem?.includes('missing gate, framework, style') ?? false),
    },
    {
      name: 'a carrier chain of nothing but forwards has no anchor',
      source: CARRIER_CONSUMER_SHAPE,
      expect: (_f, writes) => writes.length === 1 && !writes[0]!.anchored && writes[0]!.forwarded,
    },
    {
      name: 'the complete merge anchors the carrier',
      source: COMPLETE_MERGE,
      expect: (_f, writes) => writes.length === 1 && (writes[0]?.anchored ?? false),
    },
  ];

  // One case per loader: dropping ANY single view from the merge has to be reported. Written as a
  // loop rather than four literals so a fifth `QuarantinedResourceType` cannot be added to
  // `ALL_OWNERS` while its removal case is quietly left unwritten.
  for (const owner of ALL_OWNERS) {
    cases.push({
      name: `dropping the ${owner} view from the merge is reported`,
      source: wiredShape(mergeMissing(owner)),
      // Reported at the call site when the view arrives as an expression, or at the carrier write
      // when it arrives under the trusted name — both are this gate's findings, and the case
      // asserts the loader is named either way.
      expect: (f, writes) =>
        f.some((finding) => finding.reason.includes(`missing ${owner}`)) ||
        writes.some((write) => write.problem?.includes(`missing ${owner}`) === true),
    });
  }
  return cases;
}

function selfTest(): number {
  let failed = 0;
  for (const testCase of selfTestCases()) {
    const result = findUnwiredConsumers('probe.ts', testCase.source);
    const ok = testCase.expect(result.findings, result.carrierWrites);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
    if (!ok) failed += 1;
  }

  // The real tree must be clean — the check the gate exists to make.
  const live = run(true);
  console.log(`${live === 0 ? 'PASS' : 'FAIL'}  this checkout wires every catalog consumer`);
  if (live !== 0) failed += 1;

  return failed === 0 ? 0 : 1;
}

function run(quiet = false): number {
  const files = typescriptFilesUnder(SCAN_ROOT);
  const findings: UnwiredConsumer[] = [];
  const carrierWrites: CarrierWrite[] = [];
  let sitesSeen = 0;

  for (const file of files) {
    const relative = path.relative(SERVER_ROOT, file);
    const result = findUnwiredConsumers(relative, readFileSync(file, 'utf8'));
    sitesSeen += result.sitesSeen;
    findings.push(...result.findings);
    carrierWrites.push(...result.carrierWrites);
  }

  // A null result needs a positive control. If either function were renamed or the scan root
  // moved, every file would read clean and this gate would pass having observed nothing at all.
  if (sitesSeen === 0) {
    console.error(
      `✖ No call to ${CONSUMERS.map((consumer) => consumer.callee).join(' or ')} found under ` +
        `${path.relative(SERVER_ROOT, SCAN_ROOT)} — the probe cannot observe, so its silence is ` +
        `not evidence.`
    );
    return 1;
  }

  // The same requirement one level up: a reference to `indexQuarantine` is trusted because its
  // writes are checked, so a tree whose carrier writes are ALL forwards is a chain anchored in
  // nothing. Reported as a finding rather than a pass.
  const poisoned = carrierWrites.filter((write) => write.problem !== undefined);
  for (const write of poisoned) {
    console.error(
      `✖ ${write.file}:${write.line} writes \`${CARRIER_NAME}\` — ${write.problem}; ` +
        `every site that reads that name is trusted because this write was checked, so it has to ` +
        `merge all four loaders or forward another \`${CARRIER_NAME}\``
    );
  }

  const unanchored = carrierWrites.length > 0 && !carrierWrites.some((write) => write.anchored);
  if (unanchored) {
    console.error(
      `✖ Every write of \`${CARRIER_NAME}\` forwards another one — no site in ${path.relative(SERVER_ROOT, SCAN_ROOT)} ` +
        `builds the merge from all four loaders, so the carrier carries nothing.`
    );
  }

  if (findings.length > 0 || unanchored || poisoned.length > 0) {
    for (const finding of findings) {
      const rule = CONSUMERS.find((consumer) => consumer.callee === finding.callee);
      console.error(
        `✖ ${finding.file}:${finding.line} calls ${finding.callee}() — ${finding.reason}; ` +
          `${rule?.remedy ?? 'wire the quarantine view'}`
      );
    }
    console.error(
      `\n\`quarantine\` is optional by design and a PRESENT one may still be partial, so an ` +
        `unwired or incomplete call site typechecks and every suite stays green: the consumer ` +
        `tests build their own view and never observe production's wiring. This gate is the only ` +
        `thing that does.`
    );
    return 1;
  }

  if (!quiet) {
    console.log(
      `✅ Refusal-aware consumers: ${sitesSeen} catalog-re-deriving call site(s) across ` +
        `${files.length} files, each handed a refusal record covering every kind it walks ` +
        `(${carrierWrites.length} \`${CARRIER_NAME}\` write(s) checked).`
    );
  }
  return 0;
}

// Guarded: `findUnwiredConsumers` is exported, and a module-scope exit would terminate any
// process that imported it rather than running it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
