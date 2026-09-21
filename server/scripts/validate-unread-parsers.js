#!/usr/bin/env node
// @lifecycle canonical - Fails when a gate-layer parser has no production caller.
/**
 * A parse half with no reader is a format written for nobody.
 *
 * The gate layer renders a structured verdict into text and reads it back, so every format has
 * two halves that must stay lossless. Three of them drifted into having only one: as of
 * 2026-09-20, `GateEnforcementAuthority.parseGateVerdicts` had been round-trip tested for months
 * with zero production callers, `parseGateVerdictReminders` likewise, and `llm-review-parser`
 * survived on a re-export whose only consumers were tests. Each read as coverage — the tests were
 * green, the docblocks named the other half by file — while the server acted on none of it.
 *
 * WHY THE EXISTING GATES DID NOT CATCH IT:
 *   - `knip` counts unused exports. `parseLLMReview` was re-exported by `review-utils.ts` and
 *     imported by a test, so it was "used". A re-export is not a consumer, and a test caller
 *     proves the function works, not that production runs it.
 *   - `validate:unreached-methods` covers public instance METHODS on classes. A module-level
 *     exported FUNCTION is not one.
 *
 * WHAT THIS CHECKS: every exported function under `src/engine/gates/**` whose name starts with
 * `parse` must have at least one reference from `src/` that is neither its own declaration nor a
 * re-export. Class methods named `parse*` in the same tree count too, so the rule follows the
 * shape rather than the declaration form.
 *
 * NOT A BASELINE. A parser with no caller is a defect to fix or delete, not debt to hold at a
 * ceiling — there is no legitimate steady state for one, which is exactly what distinguishes this
 * from `validate:unreached-methods` (whose findings include owner APIs kept for dynamic callers).
 * So there is no exception list and no `reasons` map to go stale.
 *
 * KNOWN BLIND SPOT — a parser reached only by computed access (`obj[name]()`) or by a string
 * handed to a framework reads as unread. That is a false FINDING, never a false silence, so the
 * gate stays safe: it can be wrong by failing, not by passing.
 *
 * `--self-test` plants a twin — two identical parsers, one called from production and one not —
 * and proves the check separates them. It also plants the two shapes that fooled the existing
 * gates: a re-export, and a test-only caller.
 *
 * Usage:
 * - Check (default, in validate:all):  `npm run validate:unread-parsers`
 * - Prove the logic:                   `npm run validate:unread-parsers:self-test`
 *
 * MECHANISM: script — relation — resolves references across files through the type checker; no
 * linter sees more than one file
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Node, Project, SyntaxKind } from 'ts-morph';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSCONFIG_PATH = path.join(SERVER_ROOT, 'tsconfig.json');
const TAG = '[unread-parsers]';

/** The tree this rule governs — where render-then-parse pairs live. */
const GOVERNED_DIR = path.join(SERVER_ROOT, 'src', 'engine', 'gates');

/**
 * The authority holds the per-gate block parser while living outside `src/engine/gates/`, and it
 * is a half of exactly the same pair. Governing the rendering module without its reader would
 * leave the shape half-covered — the enumeration failure this file exists to prevent.
 */
const GOVERNED_EXTRA_FILES = [
  path.join(
    SERVER_ROOT,
    'src',
    'engine',
    'execution',
    'pipeline',
    'decisions',
    'gates',
    'gate-enforcement-authority.ts'
  ),
];

/** A declaration this rule governs: an exported `parse*` function, or a public `parse*` method. */
function isGovernedName(name) {
  return /^parse[A-Z]/.test(name);
}

function isGovernedFile(filePath) {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(GOVERNED_DIR + path.sep) || GOVERNED_EXTRA_FILES.includes(resolved);
}

/**
 * A reference that proves production reads this parser.
 *
 * Excluded, each for a measured reason:
 *   - the declaration itself (`llm-review-parser.ts:35` is not a caller of `parseLLMReview`)
 *   - any export/import specifier — a re-export hands the symbol a second path and reads nothing,
 *     which is precisely how `parseLLMReview` looked used for the whole time it was not
 *   - anything outside `src/` — tests are not production
 */
function isProductionRead(node, declarationNode) {
  const sourceFile = node.getSourceFile();
  const filePath = path.resolve(sourceFile.getFilePath());
  if (!filePath.startsWith(path.join(SERVER_ROOT, 'src') + path.sep)) return false;
  if (node === declarationNode) return false;

  for (let current = node.getParent(); current !== undefined; current = current.getParent()) {
    const kind = current.getKind();
    // A `{@link parseX}` in a docblock resolves like a real reference. It is the sharpest false
    // consumer this rule can have, because prose naming the other half by name is exactly what
    // these modules write — measured 2026-09-20: `parseGateVerdictReminders` scored 2 reads with
    // only 1 call site, and the positive control (deleting the call) still passed.
    if (
      kind === SyntaxKind.JSDoc ||
      kind === SyntaxKind.JSDocLink ||
      kind === SyntaxKind.JSDocLinkCode ||
      kind === SyntaxKind.JSDocLinkPlain ||
      kind === SyntaxKind.JSDocText ||
      kind === SyntaxKind.JSDocTag ||
      kind === SyntaxKind.JSDocSeeTag
    ) {
      return false;
    }
    if (
      kind === SyntaxKind.ExportSpecifier ||
      kind === SyntaxKind.ImportSpecifier ||
      kind === SyntaxKind.ExportDeclaration ||
      kind === SyntaxKind.ImportDeclaration ||
      kind === SyntaxKind.ExportAssignment
    ) {
      return false;
    }
    // Its own body is not a caller of itself.
    if (
      (Node.isFunctionDeclaration(current) ||
        Node.isMethodDeclaration(current) ||
        Node.isFunctionExpression(current)) &&
      current.getNameNode?.() === declarationNode
    ) {
      return false;
    }
  }
  return true;
}

/** Every governed declaration, with its production-read count. */
export function findParserDeclarations(project) {
  const findings = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (!isGovernedFile(sourceFile.getFilePath())) continue;

    /** @type {Array<{ nameNode: import('ts-morph').Node, name: string }>} */
    const declarations = [];

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (name === undefined || !isGovernedName(name) || !fn.isExported()) continue;
      const nameNode = fn.getNameNode();
      if (nameNode !== undefined) declarations.push({ nameNode, name });
    }

    // `export const parseX = (raw) => ...` is the same declaration in a second spelling. Matching
    // only `function` would let the rule be evaded by an arrow, which is a hole in the shape
    // rather than in the enumeration of files.
    for (const statement of sourceFile.getVariableStatements()) {
      if (!statement.isExported()) continue;
      for (const declaration of statement.getDeclarations()) {
        const name = declaration.getName();
        if (!isGovernedName(name)) continue;
        const initializer = declaration.getInitializer();
        if (
          initializer === undefined ||
          !(Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
        ) {
          continue;
        }
        declarations.push({ nameNode: declaration.getNameNode(), name });
      }
    }

    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const name = method.getName();
        if (!isGovernedName(name)) continue;
        if (method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
        if (method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
        declarations.push({ nameNode: method.getNameNode(), name: `${cls.getName()}.${name}` });
      }
    }

    for (const { nameNode, name } of declarations) {
      let reads = 0;
      for (const referencedSymbol of project.getLanguageService().findReferences(nameNode)) {
        for (const reference of referencedSymbol.getReferences()) {
          if (isProductionRead(reference.getNode(), nameNode)) reads += 1;
        }
      }
      findings.push({
        name,
        reads,
        file: path.relative(SERVER_ROOT, sourceFile.getFilePath()),
        line: nameNode.getStartLineNumber(),
      });
    }
  }

  return findings;
}

function loadProject() {
  return new Project({ tsConfigFilePath: TSCONFIG_PATH, skipAddingFilesFromTsConfig: false });
}

async function handleCheck() {
  const started = Date.now();
  const findings = findParserDeclarations(loadProject());
  const unread = findings.filter((finding) => finding.reads === 0);

  if (findings.length === 0) {
    // A rule that governs nothing passes vacuously. Say so rather than print OK.
    console.error(
      `${TAG} FAIL: no \`parse*\` declaration found under ${path.relative(SERVER_ROOT, GOVERNED_DIR)} — ` +
        'the rule matched nothing, so its green means nothing. Fix the enumeration.'
    );
    process.exitCode = 1;
    return;
  }

  if (unread.length > 0) {
    console.error(`\n${TAG} FAIL: ${unread.length} parser(s) with no production caller\n`);
    for (const finding of unread) {
      console.error(`  ${finding.name}  ${finding.file}:${finding.line}`);
    }
    console.error(
      '\nA parse half nobody reads is a format written for nobody. Wire it to a consumer, or\n' +
        'delete it together with the render half that feeds it. A re-export is not a consumer and\n' +
        'a test caller is not production.\n'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${TAG} OK: ${findings.length} gate-layer parser(s), every one read by production, ${Date.now() - started} ms`
  );
}

// ---------------------------------------------------------------------------------------------
// Self-test — a planted twin, plus the two shapes that fooled knip
// ---------------------------------------------------------------------------------------------

function runSelfTest() {
  let failures = 0;
  const check = (label, passed) => {
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}`);
    if (!passed) failures += 1;
  };

  console.log(`\n${TAG} self-test — a called parser and its uncalled twin, in one program\n`);

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, module: 199 },
  });

  const gatesDir = path.join(SERVER_ROOT, 'src', 'engine', 'gates', 'core');
  project.createSourceFile(
    path.join(gatesDir, 'twins.ts'),
    `export function parseCalledTwin(raw: string): string { return raw.trim(); }
     export function parseUncalledTwin(raw: string): string { return raw.trim(); }
     export function parseSelfReferential(raw: string): string {
       return raw.length > 1 ? parseSelfReferential(raw.slice(1)) : raw;
     }
     export const parseArrowTwin = (raw: string): string => raw.trim();
     /** Prose half of the pair, read back by {@link parseDocMentionedTwin}. */
     export function parseDocMentionedTwin(raw: string): string { return raw.trim(); }
     export class Reader {
       parseMethodTwin(raw: string): string { return raw; }
       private parsePrivate(raw: string): string { return raw; }
     }`
  );

  // The re-export shape: gives `parseUncalledTwin` a second import path and reads nothing.
  project.createSourceFile(
    path.join(gatesDir, 'barrel.ts'),
    `export { parseUncalledTwin } from './twins.js';`
  );

  // The production consumer — calls exactly one of the twins.
  project.createSourceFile(
    path.join(SERVER_ROOT, 'src', 'engine', 'gates', 'consumer.ts'),
    `import { parseCalledTwin } from './core/twins.js';
     export const run = (raw: string): string => parseCalledTwin(raw);`
  );

  // The test-only caller: calls the other twin and the method, from outside src/.
  project.createSourceFile(
    path.join(SERVER_ROOT, 'tests', 'unit', 'twins.test.ts'),
    `import { parseUncalledTwin, Reader } from '../../src/engine/gates/core/twins.js';
     parseUncalledTwin('x');
     new Reader().parseMethodTwin('x');`
  );

  const byName = new Map(findParserDeclarations(project).map((f) => [f.name, f]));

  check('the called twin is read', (byName.get('parseCalledTwin')?.reads ?? 0) > 0);
  check('its uncalled twin is not', byName.get('parseUncalledTwin')?.reads === 0);
  check(
    'a re-export does not count as a consumer',
    // The ONLY difference between the twins is the call site; the re-export sits on the
    // uncalled one, so if a re-export counted, the two would be indistinguishable here.
    byName.get('parseUncalledTwin')?.reads === 0 && byName.has('parseUncalledTwin')
  );
  check('a test-only caller does not count', byName.get('Reader.parseMethodTwin')?.reads === 0);
  check('a public method IS governed, in its qualified form', byName.has('Reader.parseMethodTwin'));
  check('an arrow-function export is governed too', byName.get('parseArrowTwin')?.reads === 0);
  check(
    'a {@link} in a docblock is not a consumer',
    // The shape that made the first version of this check pass its own positive control:
    // `parseGateVerdictReminders` scored 2 reads against 1 call site because its sibling's
    // docblock named it.
    byName.get('parseDocMentionedTwin')?.reads === 0
  );
  check(
    'a recursive call inside the declaration is not a caller of itself',
    byName.get('parseSelfReferential')?.reads === 0
  );
  check('a private method is not governed', !byName.has('parsePrivate'));
  check(
    'a non-parse export is not governed',
    !Array.from(byName.keys()).some((name) => name === 'run')
  );

  if (failures > 0) {
    console.error(`\n${TAG} self-test: ${failures} case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${TAG} SELF-TEST OK: the twin, the re-export and the test-only caller all hold\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) {
      runSelfTest();
    } else {
      await handleCheck();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
