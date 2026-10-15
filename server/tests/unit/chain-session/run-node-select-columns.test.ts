// @lifecycle canonical - P6.101: every chain_run_nodes read that rebuilds a node names every column the writer binds.
/**
 * MEASURED 2026-09-27 on `6dad55f3`: `ChainRunRegistry` rebuilds a run's nodes from two SELECTs —
 * the owner's load and the handoff claim — and the claim's named neither `delegated` nor
 * `args_json`. `reconstructNode` reads a missing key as a present one (`undefined !== null`), so
 * every node of a claimed run came back `delegated: true` with no arguments: driven, a claimed run
 * holding a remainder node refused its next answer for a missing HANDOFF trailer. P6.101 adds
 * `inline_gate_ids` to both, and this test holds the class: each node-rebuilding SELECT
 * (`query<ChainRunNodeRow>`) names every column the INSERT writes, except `updated_at`, which no
 * reader reconstructs. The planted control proves the comparison reports a missing column.
 * The writer names its columns through a `${NAME}` template constant, so each `${NAME}` is read
 * as that constant's text, and `SELECT *` (the selected-control read) names every column.
 */
import { describe, expect, test } from '@jest/globals';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inlineTemplateConstants } from '../../../scripts/validate-no-phantom-columns.js';

const REGISTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/modules/chains/run-registry.ts'
);

const columnsOf = (list: string): string[] =>
  list
    .split(',')
    .map((column) => column.trim().replace(/^n\./, ''))
    .filter((column) => column.length > 0);

/** The INSERT's column list and every node-rebuilding SELECT's, from `raw`. */
function nodeColumnLists(raw: string): { written: string[]; reads: string[][] } {
  const source = inlineTemplateConstants(raw);
  const insert = /INSERT INTO chain_run_nodes \(([\s\S]*?)\)\s*VALUES/.exec(source);
  const reads = [
    ...source.matchAll(/query<ChainRunNodeRow>\(\s*['`]SELECT([\s\S]*?)FROM chain_run_nodes/g),
  ].map((match) => columnsOf(match[1] ?? ''));
  return {
    written: columnsOf(insert?.[1] ?? '').filter((column) => column !== 'updated_at'),
    reads,
  };
}

const missingFrom = (written: string[], read: string[]): string[] =>
  read.includes('*') ? [] : written.filter((column) => !read.includes(column));

describe('P6.101: a chain_run_nodes read that rebuilds a node names every written column', () => {
  const { written, reads } = nodeColumnLists(readFileSync(REGISTRY, 'utf8'));

  test('the writer and all three node reads are found', () => {
    expect(written).toContain('inline_gate_ids');
    expect(written.some((column) => column.includes('$'))).toBe(false);
    expect(reads).toHaveLength(3);
  });

  test('no node read omits a written column', () => {
    expect(reads.map((read) => missingFrom(written, read))).toEqual([[], [], []]);
  });

  test('planted control: a read missing a written column is reported', () => {
    const planted = [
      'INSERT INTO chain_run_nodes (session_id, node_id, delegated, updated_at) VALUES (?)',
      'this.db.query<ChainRunNodeRow>(`SELECT session_id, n.node_id FROM chain_run_nodes`)',
    ].join('\n');
    const lists = nodeColumnLists(planted);
    expect(lists.reads.map((read) => missingFrom(lists.written, read))).toEqual([['delegated']]);
  });

  test('planted control: a written column held in a constant is read through it', () => {
    const planted = [
      'const COLS = `session_id, node_id, delegated, updated_at`;',
      'INSERT INTO chain_run_nodes (${COLS}) VALUES (?)',
      "this.db.query<ChainRunNodeRow>('SELECT * FROM chain_run_nodes')",
      'this.db.query<ChainRunNodeRow>(`SELECT session_id, n.node_id FROM chain_run_nodes`)',
    ].join('\n');
    const lists = nodeColumnLists(planted);
    expect(lists.written).toEqual(['session_id', 'node_id', 'delegated']);
    expect(lists.reads.map((read) => missingFrom(lists.written, read))).toEqual([
      [],
      ['delegated'],
    ]);
  });
});
