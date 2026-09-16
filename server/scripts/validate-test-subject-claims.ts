#!/usr/bin/env tsx
/**
 * A test file's header may not claim a `src/` subject the file provably cannot have run.
 *
 * WHY THIS EXISTS. The 41-file census of P4.29 found the dominant retirable shape is not a FALSE
 * assertion — it is a TRUE assertion under a FALSE header. Every `expect()` passes and is honest
 * about what it read; the docblock is what lies, by naming production modules the file substitutes
 * a stand-in for. A reader auditing coverage reads the docblock, because that is the only part
 * written in prose, so each such file launders an uncovered seam as a covered one. Two motivating
 * instances, both mutation-proven on 2026-09-15 and both reproduced in `--self-test`:
 *
 *   A. `tests/integration/mcp-tools/resource-manager-workflow.test.ts` claimed "real modules:
 *      ResourceManagerRouter / PromptResourceHandler / GateToolHandler / FrameworkToolHandler".
 *      Three of the four were `as unknown as` stand-ins built in the file and imported in TYPE
 *      position only. Throwing at the top of each real `handleAction` left all 14 cases green,
 *      while the files that do drive them reddened 26 cases between them.
 *   B. `tests/integration/database/startup-bootstrap.test.ts` claimed, on its `@lifecycle` line,
 *      to verify the index "is populated during startup wiring". It builds the indexer and calls
 *      `syncAll()` itself and reaches no line of `src/runtime/`. Replacing the `syncAll()` result
 *      at the composition root left it 4/4 green while a server-spawning e2e went 6 cases red.
 *
 * TWO RULES, EACH DECIDABLE FROM THE IMPORT FORM ALONE. Neither asks what the test drives — only
 * whether the named subject could have been loaded at all.
 *
 *   TYPE-ERASED SUBJECT. A leading-comment line that makes a claim (CLAIM_MARKERS) names an
 *   identifier that `src/` exports as a VALUE, and the file's only binding for it is
 *   `import type`. A type import is erased before the test runs, so not one line of that module
 *   is loaded. Catches instance A, all three symbols.
 *
 *   UNREACHABLE STARTUP CLAIM. The `@lifecycle` line — a one-sentence assertion by convention,
 *   and so read literally — says the file covers the server's startup path, while the file
 *   neither value-imports from `src/runtime/` nor spawns a process. Catches instance B.
 *
 * WHY THERE IS NO "NAMED BUT NEVER IMPORTED" RULE — the obvious third rule, measured and
 * REJECTED on 2026-09-15. It reported 8 sites across the tree and every one was a false alarm of
 * two kinds this codebase is built out of: a subject reached through a `create<Subject>()` factory
 * (`createShellVerifyExecutor`, `createParsingSystem`), and a subject reached transitively by a
 * collaborator the file does construct (`ResourceVerificationService` behind `FileOperations`).
 * A ninth was a header saying a unit test of `PathResolver` CANNOT show something — a disclaimer
 * read as a claim. Absence of an import is simply not evidence of absence of reach here, so the
 * rule is not present rather than present-with-an-exception-list.
 *
 * DELIBERATE BLIND SPOTS — a narrow gate with a stated blind spot beats a broad one with silent
 * false negatives. Each line below is a case this check does NOT report:
 *
 *   1. A VALUE IMPORT IS NOT EXERCISE. A file may import `X` as a value, name it in the header,
 *      and never call it. Mutation testing owns that half; this owns only the statically
 *      decidable half.
 *   2. LEADING COMMENTS ONLY. A `describe()` title or a per-case comment is not read. The census
 *      found the laundering happens in the file header, which is what a coverage audit reads.
 *   3. MULTI-CAPITAL IDENTIFIERS ONLY. `ResourceIndexer` is checked; `Gate`, `Prompt`,
 *      `Integration` are not, even where `src/` exports that exact name — a single capitalised
 *      word is indistinguishable from the start of an English sentence, and a gate that fires on
 *      prose gets exceptions written for it until it means nothing.
 *   4. VALUE DECLARATIONS ONLY. A claimed `interface` or `type` alias (`QuarantineView`,
 *      `GatePassCriteria`) is skipped: it has no runtime existence, so naming one and importing
 *      it as a type is the only honest way to write it.
 *   5. A FACTORY SATISFIES ITS CLASS. `createResourceIndexer` imported as a value satisfies a
 *      claim on `ResourceIndexer`. A factory under any other name does not, and that case is
 *      unreported rather than reported, per the rejected rule above.
 *   6. CLAIM MARKERS AND STARTUP PHRASES ARE FIXED LISTS. A header asserting coverage in other
 *      words is not read as a claim. Both lists are deliberately small so a finding is always
 *      legible as a finding; widening either is cheap.
 *
 * WHY NOT ESLINT. The property relates a file's comment text to its own import forms to the export
 * table of a DIFFERENT tree (`src/`). No single-file linter sees the third of those, and it is the
 * one that keeps the check off prose.
 *
 * `--self-test` drives both pre-rewrite headers verbatim — each must be reported, naming the
 * symbol — and their rewritten forms, a correctly-wired file, a factory-satisfied claim, a
 * type-alias claim and a headerless file, where it must stay silent.
 *
 * MECHANISM: script — relation — compares a test file's comment text against its own import forms
 * against the export table of `src/`; no linter sees more than one of those three.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(SERVER_ROOT, 'src');
const TESTS_ROOT = path.join(SERVER_ROOT, 'tests');

/**
 * Words that turn a leading-comment line into an assertion ABOUT a named symbol.
 *
 * Matched case-insensitively at word boundaries, one line at a time.
 */
const CLAIM_MARKERS: readonly RegExp[] = [
  /\breal\b/i,
  /\btests?\b/i,
  /\btesting\b/i,
  /\bverif(?:ies|ying)\b/i,
  /\bsimulat(?:es|ing)\b/i,
  /\bdriv(?:es|ing)\b/i,
  /\bexercis(?:es|ing)\b/i,
  /\bcovers\b/i,
];

/**
 * Phrases that claim the SERVER'S STARTUP PATH, not merely that something is wired.
 *
 * Tight on purpose: bare `wiring` matches a unit test of a loader's own wiring, which is a true
 * statement about a file that imports no composition root. Measured across 82 `@lifecycle` lines,
 * these phrases select exactly the instance-B header and nothing else.
 */
const STARTUP_CLAIM: readonly RegExp[] = [
  /\b(?:at|during|on|from)\s+startup\b/i,
  /\bstartup\s+(?:wiring|path|bootstrap|sequence)\b/i,
  /\bserver\s+startup\b/i,
];

/** Bindings that mean the file runs production in a CHILD process, where imports say nothing. */
const SPAWN_BINDINGS: ReadonlySet<string> = new Set([
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'exec',
  'execSync',
  'fork',
]);

/** The composition root: value-importing anything under here can reach the startup path. */
const COMPOSITION_ROOT = 'src/runtime/';

/**
 * A candidate subject: PascalCase with at least two capitals.
 *
 * The second capital is blind spot 3 — it separates `SqliteEngine` from `Integration`.
 */
const CANDIDATE_IDENTIFIER = /\b[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g;

export type SubjectClaimRule = 'type-erased-subject' | 'unreachable-startup-claim';

export interface SubjectClaimFinding {
  /** Path relative to `server/`, as given to the predicate. */
  file: string;
  /** 1-based line within the file. */
  line: number;
  rule: SubjectClaimRule;
  /** The claimed symbol, or the `@lifecycle` claim text for a startup finding. */
  subject: string;
  detail: string;
}

/** How a test file binds a name, if it binds it at all. */
type Binding = 'value' | 'type-only';

function listFiles(root: string, suffix: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(suffix)) out.push(full);
    }
  };
  walk(root);
  return out;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Names `src/` exports as VALUES — classes, functions, enums and consts.
 *
 * Interfaces and type aliases are deliberately excluded (blind spot 4): they have no runtime
 * existence, so a type-only import of one is not evidence of anything. Collected by declaration
 * rather than by resolution, because a `ts.Program` over ~480 files costs more than the precision
 * buys for a set used only as a filter that keeps the check off prose.
 */
export function collectSrcValueExports(srcRoot: string): Set<string> {
  const values = new Set<string>();
  const types = new Set<string>();
  const record = (set: Set<string>, name: ts.Node | undefined): void => {
    if (name !== undefined && ts.isIdentifier(name)) set.add(name.text);
  };

  for (const file of listFiles(srcRoot, '.ts')) {
    const source = parse(file, readFileSync(file, 'utf-8'));
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) {
          continue;
        }
        for (const element of statement.exportClause.elements) {
          // A re-export whose kind is unknowable from this file: counted as a value unless the
          // export itself is type-only. An over-count here can only produce a finding an author
          // resolves by naming the symbol they meant.
          record(statement.isTypeOnly || element.isTypeOnly ? types : values, element.name);
        }
        continue;
      }

      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) !== true) continue;

      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        record(types, statement.name);
      } else if (
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)
      ) {
        record(values, statement.name);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          record(values, declaration.name);
        }
      }
    }
  }

  for (const name of types) if (!values.has(name)) types.delete(name);
  return values;
}

/** What a test file binds, and how. Local declarations count as value bindings. */
function collectBindings(source: ts.SourceFile): {
  bindings: Map<string, Binding>;
  reachesCompositionRoot: boolean;
  spawns: boolean;
} {
  const bindings = new Map<string, Binding>();
  let reachesCompositionRoot = false;
  let spawns = false;

  const note = (name: string, binding: Binding): void => {
    // A value binding anywhere wins: one real import is enough for the claim to be possible.
    if (binding === 'value' || !bindings.has(name)) bindings.set(name, binding);
    if (binding === 'value' && SPAWN_BINDINGS.has(name)) spawns = true;
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause === undefined) continue;
      const clauseIsType = clause.isTypeOnly;
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      const normalized = specifier.replace(/\\/g, '/');
      if (
        !clauseIsType &&
        (normalized.includes(COMPOSITION_ROOT) ||
          normalized.includes('/runtime/') ||
          normalized.startsWith('#runtime/'))
      ) {
        reachesCompositionRoot = true;
      }

      if (clause.name !== undefined) note(clause.name.text, clauseIsType ? 'type-only' : 'value');
      const named = clause.namedBindings;
      if (named === undefined) continue;
      if (ts.isNamespaceImport(named)) {
        note(named.name.text, clauseIsType ? 'type-only' : 'value');
        continue;
      }
      for (const element of named.elements) {
        const isType = clauseIsType || element.isTypeOnly;
        // Keyed by the original export name as well as the local alias, so a header naming
        // either side of an `X as Y` import resolves.
        note(element.name.text, isType ? 'type-only' : 'value');
        if (element.propertyName !== undefined) {
          note(element.propertyName.text, isType ? 'type-only' : 'value');
        }
      }
      continue;
    }

    if (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
      if (statement.name !== undefined) note(statement.name.text, 'value');
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) note(declaration.name.text, 'value');
      }
    } else if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      note(statement.name.text, 'type-only');
    }
  }

  return { bindings, reachesCompositionRoot, spawns };
}

/** The comment text at the very top of the file, before the first statement. */
function leadingComments(text: string): { text: string; startLine: number } | undefined {
  const ranges = ts.getLeadingCommentRanges(text, 0);
  if (ranges === undefined || ranges.length === 0) return undefined;
  const start = ranges[0]!.pos;
  const end = ranges[ranges.length - 1]!.end;
  return { text: text.slice(start, end), startLine: text.slice(0, start).split('\n').length };
}

/**
 * The predicate, exported so `--self-test` drives the same code the live run does.
 */
export function findSubjectClaimViolations(
  relativePath: string,
  fileText: string,
  srcValueExports: ReadonlySet<string>
): SubjectClaimFinding[] {
  const leading = leadingComments(fileText);
  if (leading === undefined) return [];

  const { bindings, reachesCompositionRoot, spawns } = collectBindings(
    parse(relativePath, fileText)
  );
  const findings: SubjectClaimFinding[] = [];
  const seen = new Set<string>();
  const lines = leading.text.split('\n');

  for (const [offset, rawLine] of lines.entries()) {
    const line = leading.startLine + offset;

    if (rawLine.includes('@lifecycle') && STARTUP_CLAIM.some((phrase) => phrase.test(rawLine))) {
      if (!reachesCompositionRoot && !spawns) {
        findings.push({
          file: relativePath,
          line,
          rule: 'unreachable-startup-claim',
          subject: rawLine.trim().replace(/^[/*\s]+/, ''),
          detail:
            'the @lifecycle line claims the startup path, but this file value-imports nothing ' +
            'under src/runtime/ and spawns no process, so it cannot have run it',
        });
      }
    }

    if (!CLAIM_MARKERS.some((marker) => marker.test(rawLine))) continue;
    for (const match of rawLine.matchAll(CANDIDATE_IDENTIFIER)) {
      const symbol = match[0];
      if (!srcValueExports.has(symbol) || seen.has(symbol)) continue;
      if (bindings.get(symbol) !== 'type-only') continue;
      // Blind spot 5: the canonical factory for the class counts as reaching it.
      if (bindings.get(`create${symbol}`) === 'value') continue;
      seen.add(symbol);
      findings.push({
        file: relativePath,
        line,
        rule: 'type-erased-subject',
        subject: symbol,
        detail:
          'named as a subject but bound only by `import type`, which is erased before the test ' +
          'runs — no line of it is loaded here',
      });
    }
  }
  return findings;
}

function report(findings: readonly SubjectClaimFinding[]): void {
  for (const finding of findings) {
    console.error(`✖ ${finding.file}:${finding.line} — \`${finding.subject}\`: ${finding.detail}.`);
  }
  console.error(
    `\nA header naming a subject the file cannot load is the P4.29 shape: every assertion below ` +
      `it is true, and the prose is what a coverage audit reads. Name the module this file ` +
      `actually drives, name the stand-ins as stand-ins, and point at the file that does own the ` +
      `claim you are giving up.`
  );
}

function run(quiet = false): number {
  const srcValueExports = collectSrcValueExports(SRC_ROOT);
  if (srcValueExports.size === 0) {
    console.error(`✖ No value exports found under ${SRC_ROOT} — the filter would pass everything.`);
    return 1;
  }

  const testFiles = listFiles(TESTS_ROOT, '.test.ts');
  if (testFiles.length === 0) {
    console.error(`✖ No *.test.ts found under ${TESTS_ROOT} — this probe observed nothing.`);
    return 1;
  }

  const findings: SubjectClaimFinding[] = [];
  for (const file of testFiles) {
    findings.push(
      ...findSubjectClaimViolations(
        path.relative(SERVER_ROOT, file),
        readFileSync(file, 'utf-8'),
        srcValueExports
      )
    );
  }

  if (findings.length > 0) {
    report(findings);
    return 1;
  }
  if (!quiet) {
    console.log(
      `✅ Test subject claims: ${testFiles.length} test file header(s) checked against ` +
        `${srcValueExports.size} \`src/\` value export(s); no type-erased subject claim and no ` +
        `unreachable startup claim.`
    );
  }
  return 0;
}

/**
 * The two motivating headers, verbatim as they stood before P4.36 rewrote them, each with the
 * imports that made the claim false. Kept as literals rather than read from git so the proof
 * survives a rebase, a squash, and the files being deleted outright.
 */
const PRE_REWRITE_RESOURCE_MANAGER = `/**
 * Resource Manager Integration Test
 *
 * Tests the complete resource_manager workflow with real modules:
 * - ResourceManagerRouter (real routing logic)
 * - PromptResourceHandler (real action handling)
 * - GateToolHandler (real action handling)
 * - FrameworkToolHandler (real action handling)
 *
 * Classification: Integration (multiple real modules, mock I/O only)
 */
import { ResourceManagerRouter } from '../../../src/mcp/tools/resource-manager/core/router.js';
import type { PromptResourceHandler } from '../../../src/mcp/tools/resource-manager/prompt/index.js';
import type { GateToolHandler } from '../../../src/mcp/tools/gate-manager/index.js';
import type { FrameworkToolHandler } from '../../../src/mcp/tools/framework-manager/index.js';
const router: ResourceManagerRouter | undefined = undefined;
`;

const PRE_REWRITE_STARTUP_BOOTSTRAP = `// @lifecycle test - Verifies ResourceIndexer is populated during startup wiring
/**
 * Startup Bootstrap Integration Test
 *
 * Simulates the server startup path: SqliteEngine.getInstance() → ResourceIndexer.syncAll()
 * → data readable from a fresh SqliteEngine instance (node:sqlite writes directly to disk).
 */
import { SqliteEngine, createResourceIndexer } from '../../../src/infra/database/index.js';
const engine = SqliteEngine;
const make = createResourceIndexer;
`;

/** After the rewrite: the router is the subject, and it IS value-imported. */
const REWRITTEN_RESOURCE_MANAGER = `/**
 * Resource Manager Router Integration Test
 *
 * ONE real module, and the header used to name four. \`ResourceManagerRouter\` is the subject.
 * Everything it routes to is a stand-in built in this file.
 *
 * Classification: Integration (one real module, stand-in collaborators, no I/O)
 */
import { ResourceManagerRouter } from '../../../src/mcp/tools/resource-manager/core/router.js';
import type { PromptResourceHandler } from '../../../src/mcp/tools/resource-manager/prompt/index.js';
const router: ResourceManagerRouter | undefined = undefined;
const handler: PromptResourceHandler | undefined = undefined;
`;

/** After the rewrite: no startup language on the `@lifecycle` line. */
const REWRITTEN_STARTUP_BOOTSTRAP = `// @lifecycle test - Verifies a syncAll over the bundled tree indexes every kind and survives a reopen
/**
 * Drives \`SqliteEngine.getInstance()\` then the real indexer over the bundled tree.
 */
import { SqliteEngine, createResourceIndexer } from '../../../src/infra/database/index.js';
const engine = SqliteEngine;
const make = createResourceIndexer;
`;

/** Blind spot 5, asserted: the factory reaches the class the header names. */
const FACTORY_SATISFIES = `/**
 * Tests the real ResourceIndexer over a temp tree.
 */
import { createResourceIndexer } from '../../../src/infra/database/index.js';
import type { ResourceIndexer } from '../../../src/infra/database/index.js';
const indexer: ResourceIndexer | undefined = createResourceIndexer;
`;

/** Blind spot 4, asserted: a pure type has no runtime existence to claim. */
const TYPE_ALIAS_CLAIM = `/**
 * Tests the merge against a real QuarantineView.
 */
import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';
const view: QuarantineView | undefined = undefined;
`;

/** A startup claim backed by a spawned server is honest, and must stay silent. */
const SPAWNED_STARTUP = `// @lifecycle test - Verifies the catalog is indexed at startup
/**
 * Drives dist/index.js.
 */
import { spawn } from 'node:child_process';
const child = spawn;
`;

/** No leading comment at all: nothing is claimed, so nothing is checked. */
const NO_HEADER = `import type { SqliteEngine } from '../../../src/infra/database/index.js';
const engine: SqliteEngine | undefined = undefined;
`;

interface SelfTestCase {
  name: string;
  text: string;
  /** Subjects the predicate must report, exactly. */
  expect: string[];
}

function selfTest(): number {
  const srcValueExports = collectSrcValueExports(SRC_ROOT);
  const cases: SelfTestCase[] = [
    {
      name: 'MOTIVATING A — three handlers claimed "real", bound only by `import type`',
      text: PRE_REWRITE_RESOURCE_MANAGER,
      expect: ['FrameworkToolHandler', 'GateToolHandler', 'PromptResourceHandler'],
    },
    {
      name: 'MOTIVATING B — an @lifecycle line claiming startup wiring, with no composition root',
      text: PRE_REWRITE_STARTUP_BOOTSTRAP,
      expect: ['@lifecycle test - Verifies ResourceIndexer is populated during startup wiring'],
    },
    {
      name: 'REWRITTEN A — the subject is value-imported; an unclaimed type import is fine',
      text: REWRITTEN_RESOURCE_MANAGER,
      expect: [],
    },
    {
      name: 'REWRITTEN B — the @lifecycle line no longer claims the startup path',
      text: REWRITTEN_STARTUP_BOOTSTRAP,
      expect: [],
    },
    {
      name: 'BLIND SPOT 5, asserted — a `create<Subject>` value import satisfies the claim',
      text: FACTORY_SATISFIES,
      expect: [],
    },
    {
      name: 'BLIND SPOT 4, asserted — a claimed interface has no runtime existence to load',
      text: TYPE_ALIAS_CLAIM,
      expect: [],
    },
    {
      name: 'SPAWN — a startup claim backed by a child process is honest',
      text: SPAWNED_STARTUP,
      expect: [],
    },
    { name: 'NO HEADER — nothing claimed, nothing checked', text: NO_HEADER, expect: [] },
    {
      name: 'BLIND SPOT 3, asserted — a single-capital export name in prose is not a claim',
      text: `/**\n * Tests the Logger wiring.\n */\nconst x = 1;\n`,
      expect: [],
    },
  ];

  console.log('\nvalidate:test-subject-claims self-test — the predicate, both directions\n');
  let failures = 0;
  for (const testCase of cases) {
    const actual = findSubjectClaimViolations('fixture.test.ts', testCase.text, srcValueExports)
      .map((finding) => finding.subject)
      .sort();
    const wanted = [...testCase.expect].sort();
    const ok = actual.length === wanted.length && actual.every((s, i) => s === wanted[i]);
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? '✅' : '✖'} ${testCase.name}\n` +
        `     expected [${wanted.join(' | ')}] · got [${actual.join(' | ')}]`
    );
  }

  // Fixtures whose expectations are met by an export table that never loaded would prove nothing:
  // the filter is what keeps this check off prose, so assert it is populated.
  if (srcValueExports.size === 0) {
    console.log('  ✖ src value-export table is empty — every case above passed vacuously');
    failures += 1;
  }

  console.log(failures === 0 ? '\nAll cases behaved.\n' : `\n${failures} case(s) misbehaved.\n`);
  return failures === 0 ? 0 : 1;
}

// Guarded: the predicate is exported, and a module-scope exit would terminate any process that
// imported it rather than running it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
