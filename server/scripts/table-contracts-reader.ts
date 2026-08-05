/**
 * Shared reader for the two table-contract gates.
 *
 * The contracts themselves are imported, not parsed — `tsx` runs these gates, so
 * `TABLE_CONTRACTS` is read as the actual exported value rather than a text approximation
 * of it. Only the two things that exist solely as SQL strings need parsing: the embedded
 * schema in `applySchema()`, and the INSERT/UPDATE statements scattered across `src/`.
 *
 * Parens are matched rather than regex-terminated because column defaults nest them
 * (`DEFAULT (datetime('now'))`), and a lazy `\)` stops in the middle of one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(scriptDir, '..');
export const REPO_DIR = path.resolve(SERVER_DIR, '..');

export const ENGINE_RELATIVE_PATH = 'src/infra/database/sqlite-engine.ts';

/**
 * Files excluded from the write scan because they contain SQL as prose, not as behaviour.
 *
 * The contracts file quotes statements inside `reason` strings to explain why a column has no
 * writer; without this it reports itself as an unauthorised writer of the very tables it
 * declares.
 */
const SQL_SCAN_EXEMPT = new Set(['src/infra/database/table-contracts.ts']);

export interface DdlColumn {
  readonly name: string;
  /** A column with a DDL default is legitimately never named by a writer. */
  readonly hasDefault: boolean;
  readonly isAutoIncrement: boolean;
}

export interface DdlTable {
  readonly name: string;
  readonly columns: readonly DdlColumn[];
}

/** Keywords that begin a table-level constraint rather than a column definition. */
const CONSTRAINT_KEYWORDS = new Set([
  'primary',
  'unique',
  'foreign',
  'check',
  'constraint',
  'exclude',
]);

/**
 * Walk forward from an opening paren and return the index of its match.
 * Quote-aware so that `'now'` inside a default cannot unbalance the count.
 */
function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  throw new Error(`Unbalanced parenthesis starting at offset ${openIndex} in the embedded schema`);
}

/** Split a table body on commas that sit at paren depth 0. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

/** Strip `-- ...` line comments so a commented-out column is not read as real. */
function stripSqlComments(text: string): string {
  return text.replace(/--[^\n]*/g, '');
}

/** Parse every `CREATE TABLE` in the engine's embedded schema. */
export function parseSchemaDdl(engineSource: string): Map<string, DdlTable> {
  const source = stripSqlComments(engineSource);
  const tables = new Map<string, DdlTable>();
  const header = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = header.exec(source)) !== null) {
    const name = match[1];
    const openIndex = source.indexOf('(', match.index + match[0].length - 1);
    const closeIndex = findMatchingParen(source, openIndex);
    const body = source.slice(openIndex + 1, closeIndex);

    const columns: DdlColumn[] = [];
    for (const rawPart of splitTopLevel(body)) {
      const part = rawPart.trim();
      if (part.length === 0) continue;

      const firstToken = part.split(/\s+/)[0].replace(/["'`]/g, '');
      if (CONSTRAINT_KEYWORDS.has(firstToken.toLowerCase())) continue;

      columns.push({
        name: firstToken,
        hasDefault: /\bDEFAULT\b/i.test(part),
        isAutoIncrement: /\bAUTOINCREMENT\b/i.test(part),
      });
    }

    tables.set(name, { name, columns });
  }

  return tables;
}

/** Parse every `CREATE VIEW` name in the engine's embedded schema. */
export function parseSchemaViews(engineSource: string): string[] {
  const source = stripSqlComments(engineSource);
  const names: string[] = [];
  const header = /CREATE VIEW(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  let match: RegExpExecArray | null;
  while ((match = header.exec(source)) !== null) {
    names.push(match[1]);
  }

  return names;
}

export interface SqlSite {
  /** Repo-relative path, e.g. `server/src/...` normalised to the contract's `src/...` form. */
  readonly file: string;
  readonly line: number;
  readonly kind: 'insert' | 'update' | 'delete' | 'ddl';
  readonly table: string;
}

const WRITE_PATTERNS: ReadonlyArray<{ kind: SqlSite['kind']; pattern: RegExp }> = [
  { kind: 'insert', pattern: /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi },
  { kind: 'update', pattern: /UPDATE\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi },
  { kind: 'delete', pattern: /DELETE\s+FROM\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi },
  {
    kind: 'ddl',
    pattern: /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi,
  },
];

/** Recursively collect `.ts` files, skipping generated output and declaration files. */
export function collectSourceFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_generated' || entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found;
}

/**
 * Find every statement in `src/` that writes or declares one of the contracted tables.
 *
 * Table names are matched literally, so a dynamically-interpolated table name is invisible
 * here. That is acceptable for this gate's purpose: the store abstraction takes its table
 * name from config, and the violations this exists to catch are hand-written SQL.
 */
export function findSqlSites(contractedTables: ReadonlySet<string>): SqlSite[] {
  const sites: SqlSite[] = [];
  const srcRoot = path.join(SERVER_DIR, 'src');

  for (const absolute of collectSourceFiles(srcRoot)) {
    const relative = path.relative(SERVER_DIR, absolute).split(path.sep).join('/');
    if (SQL_SCAN_EXEMPT.has(relative)) continue;

    const lines = stripSqlComments(fs.readFileSync(absolute, 'utf8')).split('\n');

    lines.forEach((line, index) => {
      for (const { kind, pattern } of WRITE_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const table = match[1];
          if (contractedTables.has(table)) {
            sites.push({ file: relative, line: index + 1, kind, table });
          }
        }
      }
    });
  }

  return sites;
}

/**
 * Collect the columns a module actually names when writing a table.
 *
 * Two shapes are read: the parenthesised column list of an INSERT, and the assignment
 * targets of an UPDATE ... SET. Anything else (a `SELECT *` round-trip, a dynamically
 * assembled column list) is invisible, which is why the phantom gate treats its result as
 * "columns proven written" rather than "columns that exist".
 */
export function collectWrittenColumns(source: string, table: string): Set<string> {
  const text = stripSqlComments(source);
  const written = new Set<string>();

  const insertPattern = new RegExp(
    `INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+["'\`]?${table}["'\`]?\\s*\\(`,
    'gi'
  );
  let match: RegExpExecArray | null;
  while ((match = insertPattern.exec(text)) !== null) {
    const openIndex = text.indexOf('(', match.index + match[0].length - 1);
    const closeIndex = findMatchingParen(text, openIndex);
    for (const raw of text.slice(openIndex + 1, closeIndex).split(',')) {
      const name = raw.trim().replace(/["'`]/g, '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) written.add(name);
    }
  }

  const updatePattern = new RegExp(`UPDATE\\s+["'\`]?${table}["'\`]?\\s+SET\\b`, 'gi');
  while ((match = updatePattern.exec(text)) !== null) {
    // Read to the clause that ends the SET list, or to the end of the statement.
    const rest = text.slice(match.index + match[0].length);
    const stop = rest.search(/\b(WHERE|RETURNING)\b|;|`/i);
    const setClause = stop === -1 ? rest : rest.slice(0, stop);
    for (const assignment of splitTopLevel(setClause)) {
      const name = assignment.split('=')[0].trim().replace(/["'`]/g, '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) written.add(name);
    }
  }

  return written;
}

export function readEngineSource(): string {
  return fs.readFileSync(path.join(SERVER_DIR, ENGINE_RELATIVE_PATH), 'utf8');
}

/** Resolve a contract path (`src/...` or `hooks/...`) against the right root. */
export function contractPathExists(contractPath: string): boolean {
  const root = contractPath.startsWith('src/') ? SERVER_DIR : REPO_DIR;
  return fs.existsSync(path.join(root, contractPath));
}
