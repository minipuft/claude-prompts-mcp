// @lifecycle canonical - Finds wording that describes a spelling as old but still accepted, or promises a change.
/**
 * Check 6 of `validate:retirements`: the product has two states for a spelling, accepted or
 * refused. This finds the wording of the third one ("still works", "legacy", "deprecated") in
 * the text a user reads and in the strings the product shows. It also finds wording that
 * promises a change ("in the next release", "will be removed"): a doc describes what the product
 * does today, and a planned change lives in a plan.
 *
 * Three scopes, and which phrases read each:
 *   - user-facing text: the set `user-facing-scope.ts` defines, read line by line. Every phrase.
 *   - strings in code: string and template literals under `server/src` and `cli/src`, read from
 *     the TypeScript syntax tree, and string constants in `hooks/**\/*.py`, read by Python's
 *     `ast` module. Comments, docstrings, identifiers, import specifiers, property names and
 *     literal types are not strings a user is shown, so they are not read. Test files are not
 *     read. Every phrase: a refusal or notice the product shows describes what it does today.
 *   - architecture docs (`docs/architecture/**`), contributor text outside the user-facing set.
 *     Promise phrases only: those pages name old rows and old schemas on purpose, but they
 *     describe the system as built and a promise there decays the same way.
 *
 * The phrases and the exemptions are data (`scripts/retirement-wording.json`). An exemption names
 * the phrase, the files and the exact number of matching lines per file; a count that differs
 * from what the tree holds fails, so the list can only shrink truthfully.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { trackedFilesUnder } from './tracked-scope.js';

import type { UserFacingLine } from './user-facing-scope.js';

/** What a phrase describes, which decides the scopes it reads and the message it fails with. */
type WordingKind = 'third-state' | 'promise';

/** One phrase, with the line that says what it catches. */
export interface WordingPhrase {
  readonly id: string;
  readonly pattern: string;
  readonly catches: string;
  /** Absent means `third-state`. */
  readonly kind?: WordingKind;
}

/** Lines a still-accepted form (or a word naming something outside the product) may keep. */
export interface WordingExemption {
  readonly id: string;
  readonly phrase: string;
  /** Each file and the exact number of its lines the phrase matches. */
  readonly sites: readonly { readonly file: string; readonly lines: number }[];
  readonly reason: string;
  readonly asOf: string;
  readonly removeWhen: string;
}

export interface WordingRules {
  readonly phrases: readonly WordingPhrase[];
  readonly exemptions: readonly WordingExemption[];
}

/** A file's lines in one scope; `code` lines are string-literal text, `text` lines are prose. */
export interface WordingSource {
  readonly file: string;
  readonly lines: readonly UserFacingLine[];
}

/** One line a phrase matched. */
export interface WordingHit {
  readonly file: string;
  readonly line: number;
  readonly phrase: string;
  readonly matched: string;
  readonly kind: WordingKind;
}

/** The text check 6 reads, one entry per scope. */
export interface WordingScopes {
  readonly texts: readonly WordingSource[];
  readonly codeStrings: readonly WordingSource[];
  readonly architecture: readonly WordingSource[];
}

export interface WordingFinding {
  readonly subject: string;
  readonly message: string;
}

const WORDING_FILE = 'server/scripts/retirement-wording.json';

/** Where strings in code are read from, relative to the repository root. */
const CODE_ROOTS = ['server/src', 'cli/src', 'hooks'] as const;

const TWO_STATES =
  'The product has two states for a spelling, accepted or refused; describe the current form, or retire the spelling through the ledger (CONTRIBUTING.md, Retiring a Spelling)';

const DESCRIBE_TODAY =
  'Describe what the product does today; a planned change lives in a plan, not in a doc';

export function loadWordingRules(repoRoot: string): WordingRules {
  return JSON.parse(readFileSync(path.join(repoRoot, WORDING_FILE), 'utf8')) as WordingRules;
}

/** Every phrase match, one per file, line and phrase. */
function findWordingHits(
  sources: readonly WordingSource[],
  phrases: readonly WordingPhrase[]
): WordingHit[] {
  const compiled = phrases.map((phrase) => ({
    id: phrase.id,
    kind: phrase.kind ?? 'third-state',
    re: new RegExp(phrase.pattern, 'i'),
  }));
  const hits = new Map<string, WordingHit>();
  for (const { file, lines } of sources) {
    for (const { line, text } of lines) {
      for (const { id, kind, re } of compiled) {
        const match = re.exec(text);
        const key = `${file}\u0000${line}\u0000${id}`;
        if (match !== null && !hits.has(key)) {
          hits.set(key, { file, line, phrase: id, matched: match[0], kind });
        }
      }
    }
  }
  return [...hits.values()];
}

/** Every phrase match over the scopes each kind reads (see the module header). */
export function findScopedWordingHits(
  scopes: WordingScopes,
  phrases: readonly WordingPhrase[]
): WordingHit[] {
  const promises = phrases.filter((phrase) => phrase.kind === 'promise');
  const thirdState = phrases.filter((phrase) => phrase.kind !== 'promise');
  const shown = [...scopes.texts, ...scopes.codeStrings];
  return [
    ...findWordingHits(shown, thirdState),
    ...findWordingHits([...shown, ...scopes.architecture], promises),
  ];
}

function hitMessage(hit: WordingHit): string {
  const at = `${hit.file}:${hit.line}: "${hit.matched}" (${hit.phrase})`;
  return hit.kind === 'promise'
    ? `${at} promises a change instead of describing the product. ${DESCRIBE_TODAY}.`
    : `${at} describes a form as old but still accepted. ${TWO_STATES}.`;
}

function countsBySite(hits: readonly WordingHit[]): Map<string, WordingHit[]> {
  const bySite = new Map<string, WordingHit[]>();
  for (const hit of hits) {
    const key = `${hit.file}\u0000${hit.phrase}`;
    bySite.set(key, [...(bySite.get(key) ?? []), hit]);
  }
  return bySite;
}

/** An exemption site whose count differs from the tree; it never shrinks quietly or grows. */
function staleSiteFinding(
  exemption: WordingExemption,
  site: WordingExemption['sites'][number],
  found: readonly WordingHit[]
): WordingFinding {
  const at = found.map((hit) => hit.line).join(', ');
  const actual = found.length === 0 ? 'no line matches any more' : `lines ${at} match`;
  return {
    subject: exemption.id,
    message: `${WORDING_FILE}: exemption ${exemption.id} covers ${site.lines} line(s) of ${site.file} matching "${exemption.phrase}", but ${actual}. Set its count to what the file holds, or delete the site once nothing matches.`,
  };
}

/**
 * Check 6 over planted or scanned hits: every hit an exemption does not cover fails, and every
 * exemption site whose count is not exactly what the tree holds fails.
 */
export function checkWording(
  hits: readonly WordingHit[],
  exemptions: readonly WordingExemption[]
): WordingFinding[] {
  const bySite = countsBySite(hits);
  const covered = new Set<string>();
  const findings: WordingFinding[] = [];
  for (const exemption of exemptions) {
    for (const site of exemption.sites) {
      const key = `${site.file}\u0000${exemption.phrase}`;
      const found = bySite.get(key) ?? [];
      covered.add(key);
      if (found.length !== site.lines) findings.push(staleSiteFinding(exemption, site, found));
    }
  }
  for (const hit of hits) {
    if (!covered.has(`${hit.file}\u0000${hit.phrase}`)) {
      findings.push({ subject: `${hit.file}:${hit.line}`, message: hitMessage(hit) });
    }
  }
  return findings;
}

/** A literal whose text reaches no user: a module specifier, a property name, a literal type. */
function isNonDisplayPosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent)) return true;
  if (parent.parent !== undefined && ts.isImportTypeNode(parent.parent)) return true;
  return 'name' in parent && (parent as { name?: ts.Node }).name === node;
}

function literalPieces(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return null;
}

/** Every displayable string literal in one TypeScript file, one entry per line of its text. */
export function findTypeScriptStrings(file: string, text: string): UserFacingLine[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines: UserFacingLine[] = [];
  const visit = (node: ts.Node): void => {
    const value = literalPieces(node);
    if (value !== null && !isNonDisplayPosition(node)) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const multiline = !ts.isStringLiteral(node);
      value.split('\n').forEach((piece, offset) => {
        lines.push({ line: multiline ? start + offset : start, text: piece });
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

/**
 * Python's own parser, so a comment is never read and a docstring is recognised by position.
 * `ast` rather than `tokenize`: an f-string is one STRING token before Python 3.12 and three
 * token kinds from 3.12, while `ast` hands back each literal part as a str constant on both.
 */
const PYTHON_STRINGS = `
import ast, json, sys
out = []
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), filename=path)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            first = node.body[0] if node.body else None
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                docstrings.add(id(first.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            for offset, text in enumerate(node.value.split("\\n")):
                out.append([path, node.lineno + offset, text])
json.dump(out, sys.stdout)
`;

/** String constants of the given Python files (paths relative to `repoRoot`), grouped by file. */
function readPythonStrings(repoRoot: string, files: readonly string[]): WordingSource[] {
  if (files.length === 0) return [];
  const result = spawnSync('python3', ['-I', '-c', PYTHON_STRINGS, ...files], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `python3 could not read the hook strings (exit ${String(result.status)}): ${result.error?.message ?? result.stderr}`
    );
  }
  const byFile = new Map<string, UserFacingLine[]>(files.map((file) => [file, []]));
  for (const [file, line, text] of JSON.parse(result.stdout) as [string, number, string][]) {
    byFile.get(file)?.push({ line, text });
  }
  return [...byFile].map(([file, lines]) => ({ file, lines }));
}

const TEST_PATH =
  /(?:^|\/)(?:tests?|__tests__)\/|\.test\.ts$|(?:^|\/)(?:test_[^/]*|[^/]*_test|conftest)\.py$/;

/** Tracked source files in the code scope, tests and declaration files left out. */
function listCodeFiles(repoRoot: string): { typescript: string[]; python: string[] } {
  const files = trackedFilesUnder([...CODE_ROOTS], { cwd: repoRoot }).filter(
    (file) => !TEST_PATH.test(file)
  );
  return {
    typescript: files.filter(
      (file) => !file.startsWith('hooks/') && file.endsWith('.ts') && !file.endsWith('.d.ts')
    ),
    python: files.filter((file) => file.startsWith('hooks/') && file.endsWith('.py')),
  };
}

/** Every displayable string in the code scope, as lines per file. */
export function scanCodeStrings(repoRoot: string): WordingSource[] {
  const { typescript, python } = listCodeFiles(repoRoot);
  const typed = typescript.map((file) => ({
    file,
    lines: findTypeScriptStrings(file, readFileSync(path.join(repoRoot, file), 'utf8')),
  }));
  return [...typed, ...readPythonStrings(repoRoot, python)];
}
