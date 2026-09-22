/**
 * Every hand-written copy of an engine table's DDL in `tests/` declares the engine's column set.
 *
 * Covers `execution_records` (seven copies, the class this gate was written for) and
 * `chain_run_nodes` (zero copies as of 2026-09-22, v31 — the table every test reaches through a
 * real `SqliteEngine`; a copy added tomorrow is held to the engine's columns on the day it lands).
 *
 * Seven test files build an in-memory `execution_records` by copying the engine's `CREATE TABLE`
 * rather than booting `SqliteEngine`. That is a deliberate trade — an in-memory table is what
 * makes those harnesses fast and hermetic — but it makes the DDL a SHAPE that exists in eight
 * places, and a column renamed in the engine leaves seven copies that still compile, still parse
 * as SQL, and only fail when a writer happens to bind the renamed column.
 *
 * Measured 2026-09-21: renaming `delegation_skipped` to `handoff_evidence` merged cleanly into a
 * branch whose own copies were already renamed, and left `chain-lifecycle-emission` declaring the
 * retired column. Nothing went red at merge time; the class was closed by reading, not by a gate.
 * This is that gate.
 *
 * It enumerates by SHAPE — every `tests/**` file containing an `execution_records` CREATE TABLE —
 * rather than by a list, so a copy added tomorrow is covered on the day it lands. It compares
 * column NAMES only: the copies deliberately drop the engine's index and comment text, and the
 * `CHECK` on `handoff_evidence` is asserted separately by the tests that write that column.
 */

import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TESTS_ROOT = path.resolve(here, '../../..');
const ENGINE = path.resolve(TESTS_ROOT, '../src/infra/database/sqlite-engine.ts');

/**
 * The column names of the `execution_records` CREATE TABLE in `source`, or `undefined` when the
 * file declares none. PURE.
 *
 * Walks parenthesis depth rather than matching a closing `);`, because `handoff_evidence` carries
 * a multi-line `CHECK (...)` whose own `)` would end the block early.
 */
function tableColumns(source: string, table: string): string[] | undefined {
  const match = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table}\\s*\\(`).exec(source);
  if (match === null) return undefined;

  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let i = bodyStart;
  for (; i < source.length && depth > 0; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') depth -= 1;
  }
  const body = source.slice(bodyStart, i - 1);

  // Split on commas at depth 0, with `--` comments stripped first so a comma inside one cannot
  // invent a column.
  const stripped = body
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  const parts: string[] = [];
  let current = '';
  let inner = 0;
  for (const ch of stripped) {
    if (ch === '(') inner += 1;
    if (ch === ')') inner -= 1;
    if (ch === ',' && inner === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name !== '' && /^[a-z_]+$/.test(name));
}

/** Every `.ts` file under `tests/`, recursively. */
function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...testFiles(full));
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * Each table this gate holds copies of: the column its engine DDL must carry (the positive
 * control — an extractor that read nothing would pass every copy vacuously), a retired column it
 * must not, and the fewest copies the enumeration may find.
 */
const TABLES = [
  {
    table: 'execution_records',
    present: 'handoff_evidence',
    retired: 'delegation_skipped',
    minCopies: 6,
  },
  // v31: the detached-delegation lifecycle column. No copy exists yet, so `minCopies` is 0 and
  // the engine-side control is what this entry asserts until one does.
  { table: 'chain_run_nodes', present: 'spawned_at', retired: 'reported_at', minCopies: 0 },
] as const;

const TEST_SOURCES = testFiles(TESTS_ROOT).map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
}));

describe.each(TABLES)('$table DDL parity', ({ table, present, retired, minCopies }) => {
  const engineColumns = tableColumns(readFileSync(ENGINE, 'utf8'), table);

  it('reads the engine DDL and finds the column the class was closed on', () => {
    expect(engineColumns).toBeDefined();
    expect(engineColumns).toContain(present);
    expect(engineColumns).not.toContain(retired);
  });

  const copies = TEST_SOURCES.map(({ file, source }) => ({
    file,
    columns: tableColumns(source, table),
  })).filter((entry): entry is { file: string; columns: string[] } => entry.columns !== undefined);

  it('finds every hand-written copy in tests/', () => {
    expect(copies.length).toBeGreaterThanOrEqual(minCopies);
  });

  // `it.each` over an empty table throws in Jest, so a table with no copies asserts the empty
  // enumeration instead of registering zero cases.
  if (copies.length === 0) {
    it('has no hand-written copy to compare', () => {
      expect(copies).toEqual([]);
    });
    return;
  }

  it.each(copies.map((copy) => [path.relative(TESTS_ROOT, copy.file), copy] as const))(
    '%s declares the engine column set',
    (_name, copy) => {
      expect([...copy.columns].sort()).toEqual([...(engineColumns ?? [])].sort());
    }
  );
});
