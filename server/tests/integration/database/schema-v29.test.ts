// @lifecycle test - Guards the v29 bump: durable rows survive it, and the new store survives the NEXT one
/**
 * Schema v29 adds `objects` + `version_entries` (the content-addressed store behind byte-exact
 * rollback) and two nullable `version_history` columns, `tree_hash` and `tree_origin`.
 *
 * TWO PROPERTIES, and the second is the one worth the file:
 *
 *   a. a v28 database opens under v29 with every durable row intact and `tree_hash` NULL. The
 *      fixture is hand-written v28 SQL, not a database this build produced, so it cannot inherit
 *      the new DDL's correctness.
 *
 *   b. a v29 database carrying objects and entries survives the NEXT schema bump with both
 *      tables' rows intact. This is the test that catches a wrong `posture`: `DURABLE_TABLE_NAMES`
 *      derives from `posture`, so declaring either table `ephemeral` means the next unrelated
 *      bump silently drops every object while `version_history.tree_hash` stays non-NULL — a row
 *      pointing at a tree that is not there. Nothing else in the suite would notice, because
 *      nothing reads these tables yet.
 *
 *      The next bump is SIMULATED with the seam `sqlite-backend.test.ts` already uses: rewrite
 *      `schema_version` to a stale number and reopen. The recreate path is version-agnostic — any
 *      mismatch takes snapshot → drop → recreate → restore — so a stale row against the CURRENT
 *      DDL performs exactly the round trip a v30 bump would, and needs no future DDL to exist.
 *
 *      Positive control in the same case: a `resource_index` row (posture `derived`) must NOT
 *      survive. Without it, "the objects came back" would also pass against a reopen that never
 *      recreated anything.
 *
 * The seeded bytes carry a NUL, a BOM and a non-ASCII character deliberately: a BLOB round trip
 * through node:sqlite is where a silent truncation would live, and a plain ASCII fixture cannot
 * see it.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

/**
 * The v28 shape of the two durable tables plus `schema_version` — hand-written, so this fixture
 * states what v28 WAS rather than what the current engine happens to produce.
 */
const V28_DDL = `
  CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE version_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    organization_id TEXT,
    workspace_id TEXT,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    diff_summary TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_version_history_key
    ON version_history(tenant_id, resource_type, resource_id, version);
  CREATE TABLE skills_sync_manifests (
    client TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
    resource_key TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    output_hash TEXT NOT NULL,
    output_files TEXT NOT NULL,
    exported_at TEXT NOT NULL,
    version INTEGER,
    version_date TEXT,
    config_hash TEXT NOT NULL,
    source_snapshot TEXT,
    PRIMARY KEY (client, scope, resource_key)
  );
`;

/** Bytes a naive text round trip mangles: a NUL, a BOM, and a non-ASCII character. */
const OBJECT_BYTES = new Uint8Array([
  0xef, 0xbb, 0xbf, 0x6b, 0x65, 0x79, 0x3a, 0x20, 0x00, 0xc3, 0xa9, 0x0a,
]);
const OBJECT_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000001';
const TREE_HASH = 'sha256:00000000000000000000000000000000000000000000000000000000000000ff';
/**
 * Not `'primary'`: a value that is also the natural default cannot distinguish "carried across"
 * from "silently re-defaulted". `'bundled'` is the one the restore has the most reason to get
 * wrong, since it is what makes a rollback a workspace override rather than an overwrite.
 */
const TREE_ORIGIN = 'bundled';

/**
 * What `SCHEMA_VERSION` reads today. A literal, because the engine does not export the constant;
 * the sibling schema-literal assertions in `sqlite-backend.test.ts` and
 * `chain-run-storage.integration.test.ts` carry the same number and move with it. This file's two
 * properties are version-agnostic — a stale `schema_version` row against the CURRENT DDL performs
 * whatever round trip the latest bump performs — so only this constant follows a bump.
 */
const CURRENT_SCHEMA_VERSION = 30;

describe('schema v29 — the content-addressed store', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = testScratchPath('schema-v29');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('a hand-seeded v28 database', () => {
    function seedV28(): void {
      const db = new DatabaseSync(dbPath);
      db.exec(V28_DDL);
      db.exec('INSERT INTO schema_version (version) VALUES (28)');
      const history = db.prepare(
        `INSERT INTO version_history
           (tenant_id, organization_id, workspace_id, resource_type, resource_id,
            version, snapshot, diff_summary, description, created_at)
         VALUES ('ws', NULL, 'ws', 'prompt', ?, ?, ?, '', ?, ?)`
      );
      history.run(
        'legacy',
        1,
        JSON.stringify({ step: 'one' }),
        'first',
        '2026-01-01T00:00:00.000Z'
      );
      history.run(
        'legacy',
        2,
        JSON.stringify({ step: 'two' }),
        'second',
        '2026-01-02T00:00:00.000Z'
      );

      db.prepare(
        `INSERT INTO skills_sync_manifests
           (client, scope, resource_key, resource_id, resource_type, source_hash, output_hash,
            output_files, exported_at, config_hash)
         VALUES ('claude', 'project', 'prompt:legacy', 'legacy', 'prompt', 'src', 'out', ?, ?, 'cfg')`
      ).run(JSON.stringify(['skills/legacy/SKILL.md']), '2026-01-01T00:00:00.000Z');
      db.close();
    }

    it('opens under the current schema with every durable row intact and both tree columns NULL', async () => {
      seedV28();

      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      expect(engine.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);

      const history = engine.query<{
        version: number;
        description: string;
        tree_hash: unknown;
        tree_origin: unknown;
      }>(
        `SELECT version, description, tree_hash, tree_origin FROM version_history
         WHERE resource_id = 'legacy' ORDER BY version`
      );
      expect(history.map((row) => row.description)).toEqual(['first', 'second']);
      // No backfill: a row carried across the bump is projection-only by construction. Both
      // columns are asserted, because they are one fact — tree_origin is NULL exactly when
      // tree_hash is, and a backfill that invented one would have to invent the other.
      expect(history.map((row) => row.tree_hash)).toEqual([null, null]);
      expect(history.map((row) => row.tree_origin)).toEqual([null, null]);

      const manifests = engine.query<{ resource_key: string }>(
        `SELECT resource_key FROM skills_sync_manifests`
      );
      expect(manifests.map((row) => row.resource_key)).toEqual(['prompt:legacy']);

      // The new tables exist and are empty — the bump creates, it does not populate.
      expect(engine.query(`SELECT * FROM objects`)).toHaveLength(0);
      expect(engine.query(`SELECT * FROM version_entries`)).toHaveLength(0);

      await engine.shutdown();
    });
  });

  describe('a v29 database meeting the NEXT bump', () => {
    /** Seed one version row with a tree, its entry, its object, and one derived-table control. */
    async function seedV29(): Promise<number> {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      engine.run(
        `INSERT INTO version_history
           (tenant_id, organization_id, workspace_id, resource_type, resource_id,
            version, snapshot, diff_summary, description, created_at, tree_hash, tree_origin)
         VALUES ('ws', NULL, 'ws', 'prompt', 'kept', 1, '{}', '', 'v1', ?, ?, ?)`,
        ['2026-01-01T00:00:00.000Z', TREE_HASH, TREE_ORIGIN]
      );
      const row = engine.queryOne<{ id: number }>(
        `SELECT id FROM version_history WHERE resource_id = 'kept'`
      );
      const versionRowId = Number(row?.id);

      engine.run(
        `INSERT INTO objects (tenant_id, hash, bytes, size, created_at)
         VALUES ('ws', ?, ?, ?, ?)`,
        [OBJECT_HASH, OBJECT_BYTES, OBJECT_BYTES.length, '2026-01-01T00:00:00.000Z']
      );
      engine.run(
        `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
         VALUES (?, 'ws', 'prompt.yaml', ?)`,
        [versionRowId, OBJECT_HASH]
      );

      // Control: `resource_index` is `derived`, so the recreate must discard it. Its absence is
      // what proves the reopen below really took the snapshot/drop/recreate branch.
      engine.run(`INSERT INTO resource_index (id, type, name) VALUES ('kept', 'prompt', 'Kept')`);

      // The seam: a stale schema_version row. The recreate path is version-agnostic, so this
      // performs exactly the round trip the next real bump will.
      engine.run(`DELETE FROM schema_version`);
      engine.run(`INSERT INTO schema_version (version) VALUES (28)`);
      await engine.shutdown();

      return versionRowId;
    }

    it('carries every object and entry across the recreate', async () => {
      const versionRowId = await seedV29();

      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      expect(engine.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);

      const objects = engine.query<{ hash: string; bytes: Uint8Array; size: number }>(
        `SELECT hash, bytes, size FROM objects WHERE tenant_id = 'ws'`
      );
      expect(objects).toHaveLength(1);
      expect(objects[0]?.hash).toBe(OBJECT_HASH);
      expect(objects[0]?.size).toBe(OBJECT_BYTES.length);
      // Byte-identical, NUL and BOM included — a durable BLOB that came back truncated would be
      // indistinguishable from a healthy one on a length check alone, so compare the bytes.
      expect(Array.from(new Uint8Array(objects[0]!.bytes))).toEqual(Array.from(OBJECT_BYTES));

      const entries = engine.query<{
        version_row_id: number;
        tenant_id: string;
        path: string;
        object_hash: string;
      }>(`SELECT version_row_id, tenant_id, path, object_hash FROM version_entries`);
      expect(entries).toEqual([
        {
          version_row_id: versionRowId,
          tenant_id: 'ws',
          path: 'prompt.yaml',
          object_hash: OBJECT_HASH,
        },
      ]);

      // The entry still points at a version row that exists, with its id unchanged — a restore
      // that renumbered `version_history.id` would leave the manifest dangling.
      const history = engine.queryOne<{ id: number; tree_hash: string; tree_origin: string }>(
        `SELECT id, tree_hash, tree_origin FROM version_history WHERE resource_id = 'kept'`
      );
      expect(Number(history?.id)).toBe(versionRowId);
      expect(history?.tree_hash).toBe(TREE_HASH);
      expect(history?.tree_origin).toBe(TREE_ORIGIN);

      // Positive control: the derived row is gone, so the recreate genuinely happened.
      expect(engine.query(`SELECT * FROM resource_index WHERE id = 'kept'`)).toHaveLength(0);

      await engine.shutdown();
    });
  });
});
