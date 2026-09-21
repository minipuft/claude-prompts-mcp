/**
 * Every hand-written `execution_records` DDL in `tests/` declares the engine's column set.
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
function executionRecordColumns(source: string): string[] | undefined {
  const match = /CREATE TABLE(?: IF NOT EXISTS)? execution_records\s*\(/.exec(source);
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

describe('execution_records DDL parity', () => {
  const engineColumns = executionRecordColumns(readFileSync(ENGINE, 'utf8'));

  // POSITIVE CONTROL for the enumeration below: an empty copy list, or an engine the extractor
  // could not read, would make every assertion vacuous.
  it('reads the engine DDL and finds the column the class was closed on', () => {
    expect(engineColumns).toBeDefined();
    expect(engineColumns).toContain('handoff_evidence');
    expect(engineColumns).not.toContain('delegation_skipped');
  });

  const copies = testFiles(TESTS_ROOT)
    .map((file) => ({ file, columns: executionRecordColumns(readFileSync(file, 'utf8')) }))
    .filter((entry): entry is { file: string; columns: string[] } => entry.columns !== undefined);

  it('finds every hand-written copy in tests/', () => {
    expect(copies.length).toBeGreaterThanOrEqual(6);
  });

  it.each(copies.map((copy) => [path.relative(TESTS_ROOT, copy.file), copy] as const))(
    '%s declares the engine column set',
    (_name, copy) => {
      expect([...copy.columns].sort()).toEqual([...(engineColumns ?? [])].sort());
    }
  );
});
