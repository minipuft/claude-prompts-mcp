/**
 * The Domain Ownership Matrix as a checked contract rather than prose.
 *
 * The matrix in the root CLAUDE.md tells a stage which service owns a domain. Nothing read it, so
 * it drifted: `CommandParser` had not been an exported name since the class became
 * `UnifiedCommandParser`, and `StyleManager` was listed under `styles/` after it moved to
 * `modules/formatting/`. Both rows still read as authoritative.
 *
 * Each owning module now declares its rows in its own `module.yaml` (`owns:`), and this module
 * compares the two artifacts in BOTH directions — a row with no declaration and a declaration with
 * no row are equally failures, because the one-directional check is how a matrix keeps a row for a
 * symbol that no longer exists.
 *
 * Parsing and matching here are pure functions over text; the only filesystem work is the
 * definition scan and `auditOwnership`, which the catalog generator reuses rather than writing a
 * second scan of its own. The script that owns the CLI stays thin.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  loadSemanticModuleTree,
  type SemanticModuleDescriptor,
} from './semantic-module-descriptors.js';

/** One `owns` entry, carried with the descriptor that declared it. */
export interface OwnershipRecord {
  readonly capability: string;
  readonly symbol: string;
  readonly moduleId: string;
  /** Descriptor directory relative to `server/src` (`.` for the root descriptor). */
  readonly modulePath: string;
  /** Descriptor path relative to the repository root, for problem messages. */
  readonly descriptorPath: string;
}

/** One parsed row of the markdown matrix. */
interface MatrixRow {
  readonly capability: string;
  readonly ownerCell: string;
  readonly text: string;
}

export interface OwnershipProblem {
  readonly path: string;
  readonly message: string;
}

export interface AuditOwnershipOptions {
  readonly repoRoot: string;
  readonly sourceRoot: string;
  readonly claudeMdPath: string;
}

export interface OwnershipAudit {
  readonly records: readonly OwnershipRecord[];
  /** Symbol -> every file under `server/src` that exports it, relative to `server/src`. */
  readonly definitions: ReadonlyMap<string, readonly string[]>;
  readonly problems: readonly OwnershipProblem[];
}

const MATRIX_HEADING = '## Domain Ownership Matrix';
const IDENTIFIER_BOUNDARY = '[^A-Za-z0-9_$]';

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

function displayPath(repoRoot: string, absolutePath: string): string {
  return normalizeSlashes(path.relative(repoRoot, absolutePath));
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function normalizeCapability(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export function collectOwnershipRecords(
  descriptors: readonly SemanticModuleDescriptor[],
  repoRoot: string
): OwnershipRecord[] {
  const records: OwnershipRecord[] = [];
  for (const descriptor of descriptors) {
    for (const entry of descriptor.owns ?? []) {
      records.push({
        capability: entry.capability,
        symbol: entry.symbol,
        moduleId: descriptor.id,
        modulePath: descriptor.sourcePath,
        descriptorPath: displayPath(repoRoot, descriptor.descriptorPath),
      });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Definition scan
// ---------------------------------------------------------------------------

/**
 * Test files and ambient declarations are excluded: a `.d.ts` re-declares a symbol it does not
 * define, and a fixture in `tests/` can export the same name without owning anything.
 */
function isScannableSource(relativePath: string): boolean {
  if (!relativePath.endsWith('.ts')) return false;
  if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.d.ts')) return false;
  return !relativePath.split('/').includes('tests');
}

function collectSourceFiles(sourceRoot: string, directory: string, into: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) collectSourceFiles(sourceRoot, absolute, into);
      continue;
    }
    const relative = normalizeSlashes(path.relative(sourceRoot, absolute));
    if (isScannableSource(relative)) into.push(relative);
  }
}

/**
 * The shape a definition has to take to count: a top-level `export` of the symbol itself. A
 * re-export gives a symbol a second import path without defining it, so it deliberately does not
 * match — that is the same distinction `validate:no-crosslayer-reexport` draws.
 */
function definitionPattern(symbol: string): RegExp {
  return new RegExp(
    `^export (abstract )?(class|interface|function|const|type|enum) ${escapeRegExp(symbol)}\\b`,
    'mu'
  );
}

function definesSymbol(text: string, symbol: string): boolean {
  return definitionPattern(symbol).test(text);
}

/**
 * Symbol -> every scannable file under `sourceRoot` that exports it, relative to `sourceRoot`.
 *
 * One pass over the tree for all symbols; each file is read once.
 */
export function resolveOwnershipDefinitions(
  sourceRoot: string,
  symbols: readonly string[]
): Map<string, string[]> {
  const unique = [...new Set(symbols)];
  const found = new Map<string, string[]>(unique.map((symbol) => [symbol, []]));
  const files: string[] = [];
  collectSourceFiles(sourceRoot, sourceRoot, files);
  for (const relative of files.sort((left, right) => left.localeCompare(right))) {
    const text = readFileSync(path.join(sourceRoot, relative), 'utf8');
    for (const symbol of unique) {
      if (definesSymbol(text, symbol)) found.get(symbol)?.push(relative);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Matrix parsing
// ---------------------------------------------------------------------------

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

/**
 * Rows of the matrix that follows `## Domain Ownership Matrix`, header and separator dropped.
 *
 * Rows before the separator are the header, so collection starts there rather than assuming a
 * particular header text.
 */
function parseOwnershipMatrix(markdown: string): MatrixRow[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(MATRIX_HEADING));
  if (start < 0) throw new Error(`no "${MATRIX_HEADING}" heading found`);

  const rows: MatrixRow[] = [];
  let inBody = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const cells = tableCells(line);
    if (cells === null) continue;
    if (isSeparatorRow(cells)) {
      inBody = true;
      continue;
    }
    if (!inBody) continue;
    rows.push({ capability: cells[0] ?? '', ownerCell: cells[1] ?? '', text: line.trim() });
  }
  if (rows.length === 0) throw new Error(`the ${MATRIX_HEADING} table has no rows`);
  return rows;
}

function ownerCellNamesSymbol(ownerCell: string, symbol: string): boolean {
  const pattern = new RegExp(
    `(^|${IDENTIFIER_BOUNDARY})${escapeRegExp(symbol)}(${IDENTIFIER_BOUNDARY}|$)`,
    'u'
  );
  return pattern.test(ownerCell);
}

/** Backticked fragments of the owner cell that look like a path — the ones a reader would follow. */
function ownerCellPathFragments(ownerCell: string): string[] {
  return [...ownerCell.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1] ?? '')
    .filter((fragment) => fragment.includes('/'));
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** A. The symbol is exported by exactly one file, and that file lives in the declaring module. */
function checkDefinition(
  record: OwnershipRecord,
  definitions: ReadonlyMap<string, readonly string[]>
): OwnershipProblem[] {
  const paths = definitions.get(record.symbol) ?? [];
  if (paths.length === 0) {
    return [
      {
        path: record.descriptorPath,
        message: `owns '${record.capability}' names ${record.symbol}, which no file under server/src exports`,
      },
    ];
  }
  if (paths.length > 1) {
    return [
      {
        path: record.descriptorPath,
        message: `owns '${record.capability}' names ${record.symbol}, which ${paths.length} files export: ${paths.join(', ')}`,
      },
    ];
  }
  const definedIn = paths[0] ?? '';
  const prefix = record.modulePath === '.' ? '' : `${record.modulePath}/`;
  if (!definedIn.startsWith(prefix)) {
    return [
      {
        path: record.descriptorPath,
        message: `owns '${record.capability}' names ${record.symbol}, defined outside module '${record.moduleId}' at src/${definedIn}`,
      },
    ];
  }
  return [];
}

/** B. One owner per symbol. Two capabilities in ONE descriptor is fine; two descriptors is not. */
function checkSingleOwner(records: readonly OwnershipRecord[]): OwnershipProblem[] {
  const owners = new Map<string, string>();
  const problems: OwnershipProblem[] = [];
  for (const record of records) {
    const previous = owners.get(record.symbol);
    if (previous === undefined) {
      owners.set(record.symbol, record.descriptorPath);
      continue;
    }
    if (previous !== record.descriptorPath) {
      problems.push({
        path: record.descriptorPath,
        message: `${record.symbol} is already owned by ${previous}; a symbol has one owning module`,
      });
    }
  }
  return problems;
}

function checkOwnerCell(
  row: MatrixRow,
  record: OwnershipRecord,
  definitions: ReadonlyMap<string, readonly string[]>,
  claudeMdPath: string
): OwnershipProblem[] {
  const problems: OwnershipProblem[] = [];
  if (!ownerCellNamesSymbol(row.ownerCell, record.symbol)) {
    problems.push({
      path: claudeMdPath,
      message: `row '${row.text}' does not name ${record.symbol}, declared by ${record.descriptorPath}`,
    });
  }
  const definedIn = (definitions.get(record.symbol) ?? [])[0];
  if (definedIn === undefined) return problems;
  for (const fragment of ownerCellPathFragments(row.ownerCell)) {
    if (!definedIn.includes(fragment)) {
      problems.push({
        path: claudeMdPath,
        message: `row '${row.text}' points at '${fragment}', but ${record.symbol} is defined at src/${definedIn} (declared by ${record.descriptorPath})`,
      });
    }
  }
  return problems;
}

/** C, forward: every row has exactly one declaration, and the row's own text agrees with it. */
function checkRow(
  row: MatrixRow,
  records: readonly OwnershipRecord[],
  definitions: ReadonlyMap<string, readonly string[]>,
  claudeMdPath: string
): OwnershipProblem[] {
  const matches = records.filter(
    (record) => normalizeCapability(record.capability) === normalizeCapability(row.capability)
  );
  if (matches.length === 0) {
    return [
      {
        path: claudeMdPath,
        message: `row '${row.text}' has no owns entry in any module.yaml`,
      },
    ];
  }
  if (matches.length > 1) {
    return [
      {
        path: claudeMdPath,
        message: `row '${row.text}' matches ${matches.length} owns entries: ${matches.map((match) => match.descriptorPath).join(', ')}`,
      },
    ];
  }
  return checkOwnerCell(row, matches[0] as OwnershipRecord, definitions, claudeMdPath);
}

/** C, reverse: every declaration has a row. Without this half a module can own a secret domain. */
function checkDeclaredRowsExist(
  records: readonly OwnershipRecord[],
  rows: readonly MatrixRow[],
  claudeMdPath: string
): OwnershipProblem[] {
  const declared = new Set(rows.map((row) => normalizeCapability(row.capability)));
  return records
    .filter((record) => !declared.has(normalizeCapability(record.capability)))
    .map((record) => ({
      path: record.descriptorPath,
      message: `owns '${record.capability}' (${record.symbol}) has no row in the Domain Ownership Matrix of ${claudeMdPath}`,
    }));
}

function checkOwnership(
  records: readonly OwnershipRecord[],
  rows: readonly MatrixRow[],
  definitions: ReadonlyMap<string, readonly string[]>,
  claudeMdPath: string
): OwnershipProblem[] {
  const problems: OwnershipProblem[] = [];
  for (const record of records) problems.push(...checkDefinition(record, definitions));
  problems.push(...checkSingleOwner(records));
  for (const row of rows) problems.push(...checkRow(row, records, definitions, claudeMdPath));
  problems.push(...checkDeclaredRowsExist(records, rows, claudeMdPath));
  return problems;
}

export function auditOwnership(options: AuditOwnershipOptions): OwnershipAudit {
  const repoRoot = path.resolve(options.repoRoot);
  const sourceRoot = path.resolve(options.sourceRoot);
  const claudeMdPath = path.resolve(options.claudeMdPath);
  const tree = loadSemanticModuleTree({ repoRoot, sourceRoot });
  if (tree.problems.length > 0) {
    return {
      records: [],
      definitions: new Map(),
      problems: tree.problems.map((problem) => ({
        path: problem.path,
        message: `descriptor must validate first: ${problem.message}`,
      })),
    };
  }

  const records = collectOwnershipRecords(tree.descriptors, repoRoot);
  const definitions = resolveOwnershipDefinitions(
    sourceRoot,
    records.map((record) => record.symbol)
  );
  const rows = parseOwnershipMatrix(readFileSync(claudeMdPath, 'utf8'));
  const problems = checkOwnership(records, rows, definitions, displayPath(repoRoot, claudeMdPath));
  return {
    records,
    definitions,
    problems: problems.sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.message.localeCompare(right.message)
    ),
  };
}

export function formatOwnershipProblems(problems: readonly OwnershipProblem[]): string {
  return problems.map((problem) => `- ${problem.path}: ${problem.message}`).join('\n');
}
