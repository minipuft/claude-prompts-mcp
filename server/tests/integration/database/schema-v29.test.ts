// @lifecycle test - Guards the v29 content-addressed store: its rows survive the NEXT schema upgrade
/**
 * Schema v29 added `objects` + `version_entries` (the content-addressed store behind byte-exact
 * rollback) and two nullable `version_history` columns, `tree_hash` and `tree_origin`.
 *
 * ONE PROPERTY: a database carrying objects and entries survives the next schema upgrade with
 * both tables' rows intact. This is the test that catches a wrong `posture`: `DURABLE_TABLE_NAMES`
 * derives from `posture`, so declaring either table `ephemeral` means the next unrelated upgrade
 * silently drops every object while `version_history.tree_hash` stays non-NULL — a row pointing at
 * a tree that is not there. Nothing else would notice, because the store is read only on rollback.
 *
 * The next upgrade is SIMULATED with the engine's `schemaVersion` seam: a file created at the
 * current version is reopened by an engine whose target is one higher, with no migration steps.
 * That takes the real upgrade path — backup, snapshot → drop → recreate → strict restore — against
 * today's DDL, so it needs no future DDL to exist.
 *
 * Positive control in the same case: a `resource_index` row (posture `derived`) must NOT survive.
 * Without it, "the objects came back" would also pass against a reopen that never recreated
 * anything.
 *
 * The seeded bytes carry a NUL, a BOM and a non-ASCII character deliberately: a BLOB round trip
 * through node:sqlite is where a silent truncation would live, and a plain ASCII fixture cannot
 * see it.
 */

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

  describe('a database carrying the store, meeting the NEXT upgrade', () => {
    /**
     * Seed one version row with a tree, its entry, its object, and one derived-table control, in a
     * file at the current schema version. Returns the row id and that version.
     */
    async function seedStore(): Promise<{ versionRowId: number; seededVersion: number }> {
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

      const seededVersion = engine.getSchemaVersion();
      await engine.shutdown();

      return { versionRowId, seededVersion };
    }

    it('carries every object and entry across the upgrade', async () => {
      const { versionRowId, seededVersion } = await seedStore();

      // The seam: an engine one version ahead with no steps upgrades the file the way the next
      // real bump will, against today's DDL.
      const engine = await SqliteEngine.getInstance(logger as never, {
        dbPath,
        schemaVersion: seededVersion + 1,
        durableMigrations: [],
      });
      await engine.initialize();

      expect(engine.getSchemaVersion()).toBe(seededVersion + 1);

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
