// @lifecycle test - Pins that state.db's foreign keys hold on BOTH writers, by behaviour
/**
 * Since schema v29 the object store's correctness depends on foreign keys being enforced: the
 * manifest's `ON DELETE CASCADE` is what stops a deleted version row from stranding entries, and
 * the store's `ON DELETE RESTRICT` is what stops a delete from stranding a reference.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, stated up front because the distinction is the point.
 * `node:sqlite`'s `DatabaseSync` enables foreign keys BY DEFAULT — measured 2026-09-20. So
 * `STATE_DB_WRITER_PRAGMAS`' explicit `PRAGMA foreign_keys = ON` changes no behaviour on this
 * driver today, and **no test here goes red if that line is deleted**. Saying so is the honest
 * position: the line is an assertion that the repository owns the guarantee rather than inheriting
 * it, and its value shows up only if a driver default changes or a new opener is written from that
 * list. Pretending a pin on it is falsifiable would be worse than having no pin.
 *
 * What IS falsifiable, and is what this file actually pins:
 *   * the live `PRAGMA foreign_keys` value on the engine's own connection — red if the shared list
 *     ever says OFF;
 *   * the BEHAVIOUR, on both writers: a referenced object cannot be deleted, and deleting a
 *     version row takes its entries with it. Red if the pragma is turned off, and red if the DDL
 *     loses either FOREIGN KEY clause.
 *
 * One more boundary, measured rather than assumed: deleting the words `ON DELETE RESTRICT` leaves
 * every case here green, because SQLite's default action is `NO ACTION`, which refuses an
 * immediate constraint just as RESTRICT does — the two differ only in WHEN the check fires within
 * a statement. So the refusal below pins that a foreign key exists and is enforced, not the choice
 * of RESTRICT over the default. Removing the whole `FOREIGN KEY` clause is what goes red.
 *
 * The CLI is a separate connection in a separate module (`cli-shared/version-history.ts`, which
 * cannot import `runtime/` and bundles for a lower Node floor), so it is exercised through a real
 * exported entry point rather than by reading its source — `deleteVersionRows` opens its own
 * `DatabaseSync`, and whether the cascade fires there is a fact about THAT connection.
 *
 * Every destructive assertion carries a control that differs in ONE identifier, so a pass cannot
 * come from a delete that hit nothing.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { deleteVersionRows, saveVersion } from '../../../src/cli-shared/version-history.js';
import { STATE_DB_WRITER_PRAGMAS } from '../../../src/shared/utils/runtime-state-location.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const HASH_A = 'sha256:000000000000000000000000000000000000000000000000000000000000000a';
const HASH_B = 'sha256:000000000000000000000000000000000000000000000000000000000000000b';

describe('state.db foreign keys hold on both writers', () => {
  let testDir: string;
  let dbPath: string;
  const savedRuntimeRoot = process.env['MCP_RUNTIME_ROOT'];

  beforeEach(async () => {
    testDir = testScratchPath('state-db-fk');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    process.env['MCP_RUNTIME_ROOT'] = testDir;
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    if (savedRuntimeRoot === undefined) {
      delete process.env['MCP_RUNTIME_ROOT'];
    } else {
      process.env['MCP_RUNTIME_ROOT'] = savedRuntimeRoot;
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Insert a version row and return its id. */
  function insertVersionRow(engine: SqliteEngine, resourceId: string): number {
    engine.run(
      `INSERT INTO version_history
         (tenant_id, organization_id, workspace_id, resource_type, resource_id,
          version, snapshot, diff_summary, description, created_at, tree_hash, tree_origin)
       VALUES ('ws', NULL, 'ws', 'prompt', ?, 1, '{}', '', '', ?, 'sha256:tree', 'primary')`,
      [resourceId, '2026-01-01T00:00:00.000Z']
    );
    const row = engine.queryOne<{ id: number }>(
      `SELECT id FROM version_history WHERE resource_id = ?`,
      [resourceId]
    );
    return Number(row?.id);
  }

  function insertObject(engine: SqliteEngine, hash: string): void {
    engine.run(
      `INSERT INTO objects (tenant_id, hash, bytes, size, created_at)
       VALUES ('ws', ?, ?, 2, '2026-01-01T00:00:00.000Z')`,
      [hash, new Uint8Array([7, 7])]
    );
  }

  describe('the shared pragma list', () => {
    it('names foreign_keys, and the engine connection reads it as on', async () => {
      expect(STATE_DB_WRITER_PRAGMAS).toContain('PRAGMA foreign_keys = ON');

      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      const row = engine.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys');
      expect(Number(row?.foreign_keys)).toBe(1);

      await engine.shutdown();
    });
  });

  describe('the server connection', () => {
    it('refuses to delete an object an entry references, and allows one nothing references', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      const versionRowId = insertVersionRow(engine, 'referenced');
      insertObject(engine, HASH_A);
      insertObject(engine, HASH_B);
      engine.run(
        `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
         VALUES (?, 'ws', 'prompt.yaml', ?)`,
        [versionRowId, HASH_A]
      );

      expect(() => engine.run(`DELETE FROM objects WHERE hash = ?`, [HASH_A])).toThrow(
        /FOREIGN KEY/i
      );

      // Control differing in ONE identifier: the same statement, an unreferenced hash. Without it
      // the throw above could come from anything about this table rather than from the reference.
      expect(() => engine.run(`DELETE FROM objects WHERE hash = ?`, [HASH_B])).not.toThrow();
      expect(engine.query(`SELECT hash FROM objects`)).toHaveLength(1);

      await engine.shutdown();
    });

    it('takes a version row entries with it, and leaves a sibling row entries alone', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      const doomedId = insertVersionRow(engine, 'doomed');
      const keptId = insertVersionRow(engine, 'kept');
      insertObject(engine, HASH_A);
      for (const id of [doomedId, keptId]) {
        engine.run(
          `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
           VALUES (?, 'ws', 'prompt.yaml', ?)`,
          [id, HASH_A]
        );
      }
      // The probe is only meaningful if both entries were there to begin with.
      expect(engine.query(`SELECT * FROM version_entries`)).toHaveLength(2);

      engine.run(`DELETE FROM version_history WHERE id = ?`, [doomedId]);

      const remaining = engine.query<{ version_row_id: number }>(
        `SELECT version_row_id FROM version_entries`
      );
      expect(remaining.map((row) => Number(row.version_row_id))).toEqual([keptId]);

      await engine.shutdown();
    });
  });

  describe('the cpm connection', () => {
    it('takes a version row entries with it when the CLI deletes the history', async () => {
      // The CLI opens its own DatabaseSync inside `deleteVersionRows`, so the cascade firing here
      // is a fact about THAT connection, not about the engine's.
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();
      await engine.shutdown();

      saveVersion(testDir, 'prompt', 'doomed', { step: 1 }, { description: 'doomed' });
      saveVersion(testDir, 'prompt', 'kept', { step: 1 }, { description: 'kept' });

      const seedDb = new DatabaseSync(dbPath);
      seedDb
        .prepare(
          `INSERT INTO objects (tenant_id, hash, bytes, size, created_at)
           SELECT tenant_id, ?, ?, 2, '2026-01-01T00:00:00.000Z'
           FROM version_history WHERE resource_id = 'doomed'`
        )
        .run(HASH_A, new Uint8Array([7, 7]));
      seedDb
        .prepare(
          `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
           SELECT id, tenant_id, 'prompt.yaml', ? FROM version_history
           WHERE resource_id IN ('doomed', 'kept')`
        )
        .run(HASH_A);
      const before = seedDb.prepare(`SELECT COUNT(*) AS c FROM version_entries`).get() as {
        c: number;
      };
      seedDb.close();
      // Both entries exist, so a later "they are gone" cannot be a delete that hit nothing.
      expect(Number(before.c)).toBe(2);

      expect(deleteVersionRows(testDir, { resourceType: 'prompt', resourceId: 'doomed' })).toBe(
        true
      );

      const readDb = new DatabaseSync(dbPath, { readOnly: true });
      // Read `version_entries` RAW. An earlier version of this assertion joined to
      // `version_history`, which made it useless: an orphaned entry has no parent row, so the join
      // dropped exactly the rows the cascade is supposed to have removed and the test passed with
      // foreign keys OFF. A claim about orphans cannot be made through a query that discards them.
      const entries = readDb
        .prepare(`SELECT version_row_id FROM version_entries`)
        .all() as unknown as Array<{ version_row_id: number }>;
      const kept = readDb
        .prepare(`SELECT id FROM version_history WHERE resource_id = 'kept'`)
        .get() as { id: number } | undefined;
      readDb.close();

      // Control in the same assertion: the untouched resource keeps its entry, so the cascade is
      // scoped to the deleted row rather than being a table-wide wipe.
      expect(entries.map((row) => Number(row.version_row_id))).toEqual([Number(kept?.id)]);
    });
  });
});
