#!/usr/bin/env node
// @lifecycle canonical - Prevents unreached public instance methods on src/ classes from increasing (ratchet).
/**
 * Unreached Methods Ratchet
 *
 * THE LAYER KNIP CANNOT SEE. `validate:knip-ratchet` counts unused files, exports, types and
 * dependencies. An instance method nobody calls, on a class that is itself imported and
 * constructed, is none of those — and knip 6 has no `classMembers` issue type at all
 * (`npx knip --include classMembers` exits "Invalid issue type", measured 2026-09-16 on 6.32.2).
 * P4.37 deleted eleven such methods from `ResourceIndexer` and knip's count moved by zero; two
 * more (`getValidStyles`, `getValidFrameworks`) were then found by a human reading the file.
 * This is the "declared, never called" member of the family `validate-state-field-writers.js`
 * lists, at the METHOD layer.
 *
 * WHAT COUNTS AS UNREACHED: a public (not `private`/`protected`, not `#private`) instance method,
 * declared on a class under `src/`, with no reference from `src/` outside its own body. Tests are
 * not in the program (`tsconfig.json` excludes them), so a method only a test calls IS reported —
 * a test caller proves the method works, not that production ever runs it.
 *
 * HOW A REFERENCE IS RESOLVED — three passes, cheapest first, each closing a hole the others have:
 *
 *   1. SYMBOL PASS. One walk over every identifier whose text is a candidate method name,
 *      resolved through the type checker. Resolution, not name matching: a same-named method on
 *      another class is not a caller (the homonym case — `clear`, `getStats` and `has` each have
 *      dozens of textual hits and no real callers on some classes).
 *   2. STRUCTURAL DISPATCH. A call through an interface or type literal resolves to THAT member,
 *      not to the class method. This repo injects most services through structural ports with no
 *      `implements` clause (`ApiRouterPort`, `FrameworkStateAccessor`), which a language-service
 *      reference search cannot see — measured: 12 false findings without this pass. A method is
 *      reached when a referenced same-named member lives on a type the class is assignable to.
 *   3. LANGUAGE-SERVICE REFERENCES, only for what survived 1 and 2. `findReferences` cascades
 *      through explicit `implements`/`extends` including generic ones, which the assignability
 *      check in 2 misses (an uninstantiated `Registry<T>` is not assignable-from). Measured:
 *      running it alone on every candidate costs ~11 s and misses the structural ports; running
 *      pass 1+2 alone misses ~70 explicit-heritage calls.
 *
 * KNOWN BLIND SPOTS — each is a FALSE FINDING, never a false silence, so the ratchet stays safe:
 * a method reached only by computed access (`obj[name]()`), by a string handed to a framework,
 * or through a structural type the class is not wholly assignable to. Measured 2026-09-16: a
 * 25-finding random sample held zero of these; every sampled finding had no production caller.
 *
 * RATCHET, BY NAME. The baseline lists every finding as `Class.method` (a multiset, so two
 * classes sharing a name stay distinct by count). A finding absent from the baseline fails,
 * naming its file and line. A baseline entry no longer found also fails: the method was deleted
 * or gained a caller, and an entry whose condition stopped holding is a stale exception —
 * regenerating to drop it is always free. Regenerating can never ADD an entry unless the caller
 * names it with `--allow-increase <Class.method> "<reason>"`, and the reason is written into the
 * baseline's `overrideLog` — the same ceiling rule `knip-ratchet.js` enforces per category.
 *
 * KEPT ON PURPOSE (R36, `plans/technical-debt/resource-surface-consolidation-2026-08-27.md`).
 * Not every unreached method is dead: one may implement a declared interface member nothing
 * else calls, or be a documented extension point. Such a method stays in `methods` (it IS still
 * unreached) and gets a one-line note in the sibling `reasons` map: `{"Class.method": "why"}`.
 * `reasons` is optional and hand-authored — `update-baseline` only ever carries it forward
 * unchanged, the same posture as `overrideLog`. The check fails when a `reasons` key names an
 * entry no longer in `methods`: the exception's condition stopped holding (method deleted,
 * renamed, or reached), and cleanup-standards.md's satisfied-exception check means that is a
 * finding, not something regeneration silently drops for you.
 *
 * Usage:
 * - Check (default, in validate:all):  `npm run validate:unreached-methods`
 * - Update baseline (intentional):     `npm run unreached-methods:baseline`
 * - Prove the logic:                   `npm run validate:unreached-methods:self-test`
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Node, Project, SyntaxKind, ts } from 'ts-morph';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(SERVER_ROOT, '.unreached-methods-baseline.json');
const TSCONFIG_PATH = path.join(SERVER_ROOT, 'tsconfig.json');
const TAG = '[unreached-methods]';

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

/** Public, identifier-named instance methods of every class in the program. */
function collectCandidates(project) {
  const candidates = [];
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getInstanceMethods()) {
        if (method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
        if (method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
        if (method.getNameNode().getKind() !== SyntaxKind.Identifier) continue;
        candidates.push({
          cls,
          method,
          key: `${cls.getName() ?? '<anonymous>'}.${method.getName()}`,
        });
      }
    }
  }
  return candidates;
}

function isInside(inner, outer) {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

/** Pass 1: every declaration referenced from outside itself, among the candidate names. */
function collectReferencedDeclarations(project, names, checker) {
  const referenced = new Set();
  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.Identifier || !names.has(node.getText())) return;
      const parent = node.getParent();
      const isOwnName =
        (Node.isMethodDeclaration(parent) ||
          Node.isMethodSignature(parent) ||
          Node.isPropertySignature(parent)) &&
        parent.getNameNode() === node;
      if (isOwnName) return;
      const symbol = checker.getSymbolAtLocation(node.compilerNode);
      for (const declaration of symbol?.declarations ?? []) {
        if (!isInside(node.compilerNode, declaration)) referenced.add(declaration);
      }
    });
  }
  return referenced;
}

function groupByName(declarations) {
  const byName = new Map();
  for (const declaration of declarations) {
    const name = declaration.name;
    if (!name || !ts.isIdentifier(name)) continue;
    const group = byName.get(name.text) ?? [];
    group.push(declaration);
    byName.set(name.text, group);
  }
  return byName;
}

/**
 * Interfaces and type literals only. A same-named method on another CLASS is a homonym unless the
 * class inherits from it, and inheritance is pass 3's job — admitting classes here let any small
 * class a candidate happens to be assignable to stand in as a caller.
 */
function containerType(container, checker) {
  if (ts.isInterfaceDeclaration(container)) {
    const symbol = container.name ? checker.getSymbolAtLocation(container.name) : undefined;
    return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
  }
  if (ts.isTypeLiteralNode(container)) return checker.getTypeAtLocation(container);
  return undefined;
}

/** Pass 2: reached through a referenced member of a type the class is assignable to. */
function isReachedStructurally(candidate, referencedByName, checker) {
  const classNode = candidate.cls.compilerNode;
  if (!classNode.name) return false;
  const instanceType = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(classNode.name));
  for (const declaration of referencedByName.get(candidate.method.getName()) ?? []) {
    if (declaration.parent === classNode) continue;
    const target = containerType(declaration.parent, checker);
    if (target && checker.isTypeAssignableTo(instanceType, target)) return true;
  }
  return false;
}

/** Pass 3: the language service, which follows explicit (and generic) heritage. */
function isReachedByLanguageService(candidate) {
  const { method } = candidate;
  return method
    .getNameNode()
    .findReferencesAsNodes()
    .some(
      (ref) =>
        !(
          ref.getSourceFile() === method.getSourceFile() &&
          isInside(ref.compilerNode, method.compilerNode)
        )
    );
}

/**
 * Every unreached public instance method in `project`, sorted by key.
 * Throws when the program holds no candidate at all — a scan that observed nothing is not green.
 */
export function findUnreachedMethods(project, rootDir) {
  const checker = project.getTypeChecker().compilerObject;
  const candidates = collectCandidates(project);
  if (candidates.length === 0) {
    throw new Error(
      `${TAG} the program contains no class method at all — refusing to report a clean scan.`
    );
  }
  const names = new Set(candidates.map((c) => c.method.getName()));
  const referenced = collectReferencedDeclarations(project, names, checker);
  const referencedByName = groupByName(referenced);

  const unreached = candidates
    .filter((c) => !referenced.has(c.method.compilerNode))
    .filter((c) => !isReachedStructurally(c, referencedByName, checker))
    .filter((c) => !isReachedByLanguageService(c))
    .map((c) => ({
      key: c.key,
      file: path.relative(rootDir, c.method.getSourceFile().getFilePath()),
      line: c.method.getStartLineNumber(),
    }));
  unreached.sort((a, b) => a.key.localeCompare(b.key) || a.file.localeCompare(b.file));
  return { candidateCount: candidates.length, unreached };
}

// ---------------------------------------------------------------------------------------------
// Ratchet (pure)
// ---------------------------------------------------------------------------------------------

function countKeys(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/** Multiset difference: `added` is in current beyond baseline, `stale` the reverse. */
export function compareToBaseline(baselineKeys, currentKeys) {
  const before = countKeys(baselineKeys);
  const after = countKeys(currentKeys);
  const added = [];
  const stale = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    for (let i = 0; i < delta; i += 1) added.push(key);
    for (let i = 0; i < -delta; i += 1) stale.push(key);
  }
  return { added: added.sort(), stale: stale.sort() };
}

/** Same argv shape as the three sibling ratchets. */
export function parseAllowIncreaseArgs(argv) {
  const overrides = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--allow-increase') continue;
    const key = argv[i + 1];
    const reason = argv[i + 2];
    if (!key || !reason || key.startsWith('--') || reason.startsWith('--')) {
      throw new Error(
        `${TAG} --allow-increase requires two arguments: <Class.method> "<reason>". ` +
          `Got: ${JSON.stringify(argv.slice(i, i + 3))}`
      );
    }
    overrides.set(key, reason);
    i += 2;
  }
  return overrides;
}

/** Added keys the caller did not name. A key named once authorizes every added copy of it. */
export function findUnauthorizedAdditions(added, overrides) {
  return [...new Set(added)].filter((key) => !overrides.has(key)).sort();
}

/**
 * Reasons naming an entry no longer in `methods`. A kept-on-purpose method
 * (R36) is still an unreached method — it stays in the baseline with a
 * `reasons["Class.method"]` note beside it. Once the method is deleted, gains
 * a real caller, or is renamed, its baseline entry drops out of `methods` on
 * the next regeneration, but the `reasons` map is carried forward untouched
 * (same posture as `overrideLog`) — an orphaned reason is a finding, not a
 * silent cleanup, matching `cleanup-standards.md`'s satisfied-exception check.
 */
export function findOrphanedReasons(methodKeys, reasons) {
  const methodSet = new Set(methodKeys);
  return Object.keys(reasons ?? {})
    .filter((key) => !methodSet.has(key))
    .sort();
}

// ---------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------

function scanRepository() {
  const startedAt = Date.now();
  const project = new Project({ tsConfigFilePath: TSCONFIG_PATH });
  const result = findUnreachedMethods(project, SERVER_ROOT);
  return { ...result, elapsedMs: Date.now() - startedAt };
}

async function loadBaselineOrThrow() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  } catch {
    throw new Error(
      `${TAG} Missing baseline at ${path.relative(process.cwd(), BASELINE_PATH)}. ` +
        'Run: npm run unreached-methods:baseline'
    );
  }
}

async function handleUpdateBaseline(argv) {
  const overrides = parseAllowIncreaseArgs(argv);
  const scan = scanRepository();
  const currentKeys = scan.unreached.map((f) => f.key);

  let previous = null;
  try {
    previous = await loadBaselineOrThrow();
  } catch {
    // First run: nothing to compare against.
  }

  const generatedAt = new Date().toISOString();
  const overrideLog = [...(previous?.overrideLog ?? [])];
  if (previous) {
    const { added } = compareToBaseline(previous.methods ?? [], currentKeys);
    const unauthorized = findUnauthorizedAdditions(added, overrides);
    if (unauthorized.length > 0) {
      throw new Error(
        [
          `${TAG} Refusing to update baseline: ${unauthorized.length} new unreached method(s) without an override.`,
          '',
          'Dropping an entry is always free. Adding one requires naming it:',
          ...unauthorized.map((key) => `- ${key}`),
          '',
          `  npm run unreached-methods:baseline -- --allow-increase ${unauthorized[0]} "reason"`,
        ].join('\n')
      );
    }
    for (const key of new Set(added)) {
      overrideLog.push({ date: generatedAt, method: key, reason: overrides.get(key) });
    }
  }

  const reasons = previous?.reasons ?? {};

  const baseline = {
    schemaVersion: 1,
    generatedAt,
    total: currentKeys.length,
    methods: currentKeys,
    ...(Object.keys(reasons).length > 0 ? { reasons } : {}),
    ...(overrideLog.length > 0 ? { overrideLog } : {}),
  };
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(
    `${TAG} Baseline updated: ${currentKeys.length} unreached methods (${scan.elapsedMs} ms)`
  );
}

async function handleCheck() {
  const baseline = await loadBaselineOrThrow();
  const scan = scanRepository();
  const { added, stale } = compareToBaseline(
    baseline.methods ?? [],
    scan.unreached.map((f) => f.key)
  );
  const orphanedReasons = findOrphanedReasons(baseline.methods ?? [], baseline.reasons);
  const summary = `${scan.unreached.length} unreached of ${scan.candidateCount} public instance methods, ${scan.elapsedMs} ms`;

  if (added.length === 0 && stale.length === 0 && orphanedReasons.length === 0) {
    console.log(`${TAG} OK: ${summary} (matches baseline)`);
    return;
  }

  const lines = [`${TAG} FAIL: ${summary}`];
  if (added.length > 0) {
    const addedSet = new Set(added);
    lines.push(
      '',
      'Public methods nothing in src/ calls (delete them, call them, or make them private):',
      ...scan.unreached
        .filter((f) => addedSet.has(f.key))
        .map((f) => `- ${f.key}  ${f.file}:${f.line}`)
    );
  }
  if (stale.length > 0) {
    lines.push(
      '',
      'Baseline entries no longer found — deleted or now called. Drop them (always free):',
      ...stale.map((key) => `- ${key}`),
      '',
      '  npm run unreached-methods:baseline'
    );
  }
  if (orphanedReasons.length > 0) {
    lines.push(
      '',
      'reasons[] names an entry no longer in methods[] — drop the stale reason or restore the entry:',
      ...orphanedReasons.map((key) => `- ${key}: ${baseline.reasons[key]}`)
    );
  }
  console.error(lines.join('\n'));
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------------
// Self-test — an in-memory program, so it never depends on the repository's current debt
// ---------------------------------------------------------------------------------------------

const FIXTURE = `
interface StructuralPort { viaPort(): void }
interface DeclaredPort { viaImplements(): void }
interface GenericPort<T> { take(): T }

export class Subject implements DeclaredPort {
  unreached(): void {}
  recursiveOnly(n: number): number { return n > 0 ? this.recursiveOnly(n - 1) : 0; }
  oneCaller(): void {}
  viaPort(): void {}
  viaImplements(): void {}
  private hidden(): void {}
  shadowed(): void {}
}

export class Homonym { shadowed(): void {} }

export class Box<T> implements GenericPort<T> {
  constructor(private readonly value: T) {}
  take(): T { return this.value; }
}

function drive(port: StructuralPort, declared: DeclaredPort, generic: GenericPort<string>): void {
  port.viaPort();
  declared.viaImplements();
  generic.take();
}

const subject = new Subject();
subject.oneCaller();
new Homonym().shadowed();
drive(subject, subject, new Box('x'));
`;

function runSelfTest() {
  console.log(
    `\n${TAG} self-test — detection on an in-memory program, ratchet on synthetic keys\n`
  );
  let failures = 0;
  const check = (label, condition) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}`);
    if (!condition) failures += 1;
  };

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: ts.ScriptTarget.ES2020 },
  });
  project.createSourceFile('/fixture.ts', FIXTURE);
  const { unreached } = findUnreachedMethods(project, '/');
  const keys = new Set(unreached.map((f) => f.key));

  check('a method with no caller is reported', keys.has('Subject.unreached'));
  check('a method called only by itself is reported', keys.has('Subject.recursiveOnly'));
  check('TWIN: a method with exactly one caller is not reported', !keys.has('Subject.oneCaller'));
  check(
    'a method reached through a structural port (no implements) is not reported',
    !keys.has('Subject.viaPort')
  );
  check(
    'a method reached through an implemented interface is not reported',
    !keys.has('Subject.viaImplements')
  );
  check(
    'a method reached through a generic implemented interface is not reported',
    !keys.has('Box.take')
  );
  check('a private method is out of scope', !keys.has('Subject.hidden'));
  check(
    'HOMONYM: a call on another class with the same method name does not reach this one',
    keys.has('Subject.shadowed') && !keys.has('Homonym.shadowed')
  );
  check(
    'a finding names its file and line',
    unreached.some((f) => f.key === 'Subject.unreached' && f.file === 'fixture.ts' && f.line > 0)
  );
  check(
    'an empty program throws instead of reporting clean',
    (() => {
      try {
        findUnreachedMethods(new Project({ useInMemoryFileSystem: true }), '/');
        return false;
      } catch {
        return true;
      }
    })()
  );

  const diff = compareToBaseline(['A.x', 'A.x', 'B.y', 'C.z'], ['A.x', 'B.y', 'D.w', 'D.w']);
  check('a finding absent from the baseline is added', diff.added.join() === 'D.w,D.w');
  check(
    'a baseline entry no longer found is stale, by multiset count',
    diff.stale.join() === 'A.x,C.z'
  );
  check(
    'an identical baseline yields nothing',
    (() => {
      const same = compareToBaseline(['A.x', 'B.y'], ['B.y', 'A.x']);
      return same.added.length === 0 && same.stale.length === 0;
    })()
  );
  check(
    'regenerating cannot add an entry nobody named',
    findUnauthorizedAdditions(['D.w'], new Map()).join() === 'D.w'
  );
  check(
    'a named override authorizes that entry and no other',
    findUnauthorizedAdditions(['D.w', 'E.v'], new Map([['D.w', 'reason']])).join() === 'E.v'
  );
  check(
    'a reason naming an entry no longer in the baseline is orphaned',
    findOrphanedReasons(['A.x', 'B.y'], { 'A.x': 'kept on purpose', 'C.z': 'stale' }).join() ===
      'C.z'
  );
  check(
    'a reason naming a real baseline entry is not orphaned',
    findOrphanedReasons(['A.x'], { 'A.x': 'kept on purpose' }).length === 0
  );
  check(
    'no reasons at all is never orphaned',
    findOrphanedReasons(['A.x'], undefined).length === 0
  );
  check(
    'parseAllowIncreaseArgs reads repeatable pairs and rejects an incomplete one',
    (() => {
      const parsed = parseAllowIncreaseArgs([
        '--allow-increase',
        'A.x',
        'one',
        '--allow-increase',
        'B.y',
        'two',
      ]);
      let threw = false;
      try {
        parseAllowIncreaseArgs(['--allow-increase', 'A.x']);
      } catch {
        threw = true;
      }
      return parsed.size === 2 && parsed.get('B.y') === 'two' && threw;
    })()
  );

  if (failures > 0) {
    console.error(`\n${TAG} self-test: ${failures} case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n${TAG} SELF-TEST OK: detection, twin and homonym controls, and the ratchet all hold\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'check';
  try {
    if (process.argv.includes('--self-test')) {
      runSelfTest();
    } else if (mode === 'update-baseline') {
      await handleUpdateBaseline(process.argv.slice(3));
    } else if (mode === 'check') {
      await handleCheck();
    } else {
      throw new Error(
        `${TAG} Unknown mode "${mode}". Expected: "check", "update-baseline", or "--self-test".`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
