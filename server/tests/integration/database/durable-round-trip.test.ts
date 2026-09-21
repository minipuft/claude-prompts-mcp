// @lifecycle test - Generic gate: every durable table survives a schema recreate, in an order foreign keys allow
/**
 * A wrong `posture` is the failure mode a schema bump has no other defence against.
 * `DURABLE_TABLE_NAMES` derives from `posture`, so a table declared `ephemeral` by mistake is
 * dropped by the NEXT unrelated bump and nothing says so — `validate:table-contracts` passes,
 * because `ephemeral` is a perfectly coherent declaration by every rule it checks. Until this
 * file, the only cover was a hand-written test per table, which is cover for the tables somebody
 * remembered.
 *
 * THIS TEST IS GENERATED FROM `TABLE_CONTRACTS`, so it covers tables that do not exist yet. Two
 * properties:
 *
 *   (a) ROUND TRIP — one row is seeded in EVERY durable table, the recreate path runs, and every
 *       row must come back byte-identical. A durable table with no seed entry FAILS the test
 *       rather than being skipped: that is the enumeration, and it is what makes the next durable
 *       table someone adds the next author's problem instead of a silent gap.
 *
 *   (b) ORDER — `restoreDurableTables` replays `DURABLE_TABLE_NAMES` in declaration order, and
 *       since schema v29 that order is a CORRECTNESS requirement, not a nicety: foreign keys are
 *       enforced on this connection, so a child restored before its parent is refused outright.
 *       The foreign key edges are read out of the engine's own DDL rather than listed here, so an
 *       edge added later is covered without anyone updating this file. The checker is proven
 *       falsifiable against a PLANTED mis-ordered list inside this test — not by reordering the
 *       source — and the loudness of the failure is proven against a live database.
 *
 * Positive controls throughout: a `derived` row must NOT survive (a), the DDL parser must find the
 * edges that exist (b), and the order checker must report a violation on the planted order (b).
 */

import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { DURABLE_TABLE_NAMES } from '../../../src/infra/database/table-contracts.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const ENGINE_SOURCE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/infra/database/sqlite-engine.ts'
);

/** Fixed rather than AUTOINCREMENT-assigned, so the child seed can name its parent declaratively. */
const SEED_VERSION_ROW_ID = 4242;
const SEED_HASH = 'sha256:000000000000000000000000000000000000000000000000000000000000cafe';
/** A BOM, a NUL and a non-ASCII byte — where a silent BLOB truncation would live. */
const SEED_BYTES = new Uint8Array([0xef, 0xbb, 0xbf, 0x00, 0xc3, 0xa9]);

interface Seed {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * One row per durable table, in an order foreign keys accept.
 *
 * Per-table knowledge cannot be generated — a valid row needs real column names and real values —
 * so it is a map, and the test below FAILS when a durable table is missing from it. That failure
 * is the point: it turns "somebody should test the new durable table" into a red run.
 */
const SEEDS: Readonly<Record<string, Seed>> = {
  skills_sync_manifests: {
    sql: `INSERT INTO skills_sync_manifests
            (client, scope, resource_key, resource_id, resource_type, source_hash, output_hash,
             output_files, exported_at, version, version_date, config_hash, source_snapshot)
          VALUES ('claude', 'project', 'prompt:seed', 'seed', 'prompt', 'src', 'out', ?, ?, 3,
                  '2026-01-01', 'cfg', '{}')`,
    params: [JSON.stringify(['skills/seed/SKILL.md']), '2026-01-01T00:00:00.000Z'],
  },
  version_history: {
    sql: `INSERT INTO version_history
            (id, tenant_id, organization_id, workspace_id, resource_type, resource_id,
             version, snapshot, diff_summary, description, created_at, tree_hash, tree_origin)
          VALUES (?, 'ws', 'org', 'ws', 'prompt', 'seed', 1, ?, 'diff', 'seeded', ?, ?, 'bundled')`,
    params: [
      SEED_VERSION_ROW_ID,
      JSON.stringify({ step: 'one' }),
      '2026-01-01T00:00:00.000Z',
      'sha256:tree',
    ],
  },
  objects: {
    sql: `INSERT INTO objects (tenant_id, hash, bytes, size, created_at)
          VALUES ('ws', ?, ?, ?, '2026-01-01T00:00:00.000Z')`,
    params: [SEED_HASH, SEED_BYTES, SEED_BYTES.length],
  },
  version_entries: {
    sql: `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
          VALUES (?, 'ws', 'prompt.yaml', ?)`,
    params: [SEED_VERSION_ROW_ID, SEED_HASH],
  },
};

/** BLOBs come back as Uint8Array, which `toEqual` compares by identity of shape — normalise. */
function normalise(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Uint8Array ? Array.from(value) : value,
      ])
    )
  );
}

interface ForeignKeyEdge {
  readonly child: string;
  readonly parent: string;
}

/**
 * Read every `REFERENCES` in the engine's embedded DDL. PURE.
 *
 * Parsed rather than listed, so an edge added by a later schema version is covered here without
 * anyone remembering this file. Comments are stripped first, so prose mentioning a table name
 * cannot be read as a constraint.
 */
function foreignKeyEdges(engineSource: string): ForeignKeyEdge[] {
  const source = engineSource.replace(/--[^\n]*/g, '');
  const header = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  const blocks: Array<{ name: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = header.exec(source)) !== null) {
    blocks.push({ name: match[1] as string, index: match.index });
  }

  const edges: ForeignKeyEdge[] = [];
  blocks.forEach((block, position) => {
    const body = source.slice(block.index, blocks[position + 1]?.index ?? source.length);
    const reference = /REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let found: RegExpExecArray | null;
    while ((found = reference.exec(body)) !== null) {
      edges.push({ child: block.name, parent: found[1] as string });
    }
  });

  return edges;
}

/** Every edge whose parent is restored AFTER its child. PURE — the thing being pinned. */
function restoreOrderViolations(order: readonly string[], edges: readonly ForeignKeyEdge[]) {
  return edges
    .filter((edge) => order.includes(edge.child) && order.includes(edge.parent))
    .filter((edge) => order.indexOf(edge.parent) > order.indexOf(edge.child))
    .map((edge) => `${edge.child} is restored before its parent ${edge.parent}`);
}

describe('every durable table survives a schema recreate', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = testScratchPath('durable-round-trip');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('has a seed for every durable table', () => {
    // The enumeration that closes the class. A durable table with no seed is not skipped here; it
    // is a failure naming the table, because the alternative is a generated test that quietly
    // covers less than its name claims.
    const unseeded = DURABLE_TABLE_NAMES.filter((table) => SEEDS[table] === undefined);
    expect(unseeded).toEqual([]);
    // Positive control: the map is keyed on real table names, not silently empty.
    expect(DURABLE_TABLE_NAMES.length).toBeGreaterThan(0);
  });

  it('carries every durable row across the recreate, byte-identical', async () => {
    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await engine.initialize();

    // Seed in DURABLE_TABLE_NAMES order — the same order the restore replays, which with foreign
    // keys enforced is the only order that works on the way in as well.
    for (const table of DURABLE_TABLE_NAMES) {
      const seed = SEEDS[table] as Seed;
      engine.run(seed.sql, [...seed.params]);
    }

    // Control: `resource_index` is `derived` and must NOT survive, or "the rows came back" would
    // pass against a reopen that never recreated anything.
    engine.run(`INSERT INTO resource_index (id, type, name) VALUES ('seed', 'prompt', 'Seed')`);

    const before = new Map<string, Array<Record<string, unknown>>>();
    for (const table of DURABLE_TABLE_NAMES) {
      before.set(table, normalise(engine.query(`SELECT * FROM "${table}"`)));
    }

    // The seam: a stale schema_version row makes the next open take the version-mismatch branch,
    // which is snapshot → drop → recreate → restore, exactly as a real bump would.
    engine.run(`DELETE FROM schema_version`);
    engine.run(`INSERT INTO schema_version (version) VALUES (1)`);
    await engine.shutdown();

    const reopened = await SqliteEngine.getInstance(logger as never, { dbPath });
    await reopened.initialize();

    for (const table of DURABLE_TABLE_NAMES) {
      const after = normalise(reopened.query(`SELECT * FROM "${table}"`));
      expect({ table, rows: after }).toEqual({ table, rows: before.get(table) });
    }
    expect(reopened.query(`SELECT * FROM resource_index`)).toHaveLength(0);

    await reopened.shutdown();
  });

  describe('the restore order foreign keys require', () => {
    const edges = foreignKeyEdges(readFileSync(ENGINE_SOURCE, 'utf8'));

    it('reads the edges that exist in the schema', () => {
      // Positive control for the parser: an empty edge list would make the order check vacuous,
      // and it would look exactly like a schema with no foreign keys.
      expect(edges).toEqual(
        expect.arrayContaining([
          { child: 'version_entries', parent: 'version_history' },
          { child: 'version_entries', parent: 'objects' },
        ])
      );
    });

    it('is satisfied by the declared order, and reports a planted violation', () => {
      expect(restoreOrderViolations(DURABLE_TABLE_NAMES, edges)).toEqual([]);

      // Planted HERE, not in the source: the same checker over a mis-ordered list must report
      // both edges. Without this the empty result above is also what a broken checker returns.
      const planted = ['version_entries', 'version_history', 'objects'];
      expect(restoreOrderViolations(planted, edges).sort()).toEqual([
        'version_entries is restored before its parent objects',
        'version_entries is restored before its parent version_history',
      ]);
    });

    it('fails loudly rather than silently when a child is written before its parent', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();
      engine.run(SEEDS['objects']!.sql, [...SEEDS['objects']!.params]);

      // What a mis-ordered restore would do. It raises — it does not insert an orphan, and it does
      // not drop the row: `restoreDurableTables` rethrows with the table named, which is the loud
      // failure a durable table is owed.
      const entry = SEEDS['version_entries'] as Seed;
      expect(() => engine.run(entry.sql, [...entry.params])).toThrow(/FOREIGN KEY/i);

      // Control differing in ONE fact: insert the parent first, and the identical statement lands.
      const parent = SEEDS['version_history'] as Seed;
      engine.run(parent.sql, [...parent.params]);
      expect(() => engine.run(entry.sql, [...entry.params])).not.toThrow();

      await engine.shutdown();
    });
  });
});
