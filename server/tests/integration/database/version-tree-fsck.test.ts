// @lifecycle test - Guards the startup referential check over the v29 object store
/**
 * `version_history.tree_hash` is non-NULL exactly when the row's file bytes are in the store.
 * Two things break that claim silently — a v28-era server opening a v29 database and dropping both
 * new tables, and an opener without foreign key constraints deleting a referenced object — and the
 * only symptom is a rollback that reads bytes it cannot find. The second case is narrower than the
 * design for this slice assumed: `node:sqlite` enables foreign keys by DEFAULT, so both writers
 * already refuse it, and case (b) below asserts that refusal before reaching around it.
 *
 * FOUR PROPERTIES:
 *
 *   a. THE DOWNGRADE SHAPE — a row claiming a tree with no entries at all is repaired: its
 *      `tree_hash` goes back to NULL, one line is logged, and the row's history is untouched.
 *   b. THE DANGLING SHAPE — a row whose entry points at an object that is gone is repaired the
 *      same way, and the orphaned entry is removed with it.
 *   c. POSITIVE CONTROL — an intact database logs nothing and changes nothing. Without this, a
 *      repair that NULLed every row would pass (a) and (b) perfectly.
 *   d. THE CHECK DOES NOT RUN ON A DATABASE IT JUST CREATED, observed as the query never being
 *      issued, with the reopen in the same test as the control that proves the probe fires.
 *
 * A repair is a DEGRADE, never a deletion: the row returns to the projection path it used at v28.
 * Every case below asserts the `version_history` row survives, because that is the property the
 * whole design rests on.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import {
  describeVersionTreeRepair,
  planVersionTreeRepair,
} from '../../../src/infra/database/version-tree-fsck.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const OBJECT_HASH = 'sha256:00000000000000000000000000000000000000000000000000000000000000aa';
const TREE_HASH = 'sha256:00000000000000000000000000000000000000000000000000000000000000ff';

/** The repair's own words, so an assertion cannot drift from the line the engine emits. */
const REPAIR_LINE_PREFIX = 'version trees: repaired';

describe('startup referential check over the object store', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = testScratchPath('tree-fsck');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    logger.info.mockClear();
    logger.debug.mockClear();
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Open, run `seed`, close. Returns the version row's id. */
  async function seed(
    seedRows: (engine: SqliteEngine, versionRowId: number) => void
  ): Promise<number> {
    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await engine.initialize();

    engine.run(
      `INSERT INTO version_history
         (tenant_id, organization_id, workspace_id, resource_type, resource_id,
          version, snapshot, diff_summary, description, created_at, tree_hash)
       VALUES ('ws', NULL, 'ws', 'prompt', 'subject', 1, ?, '', 'v1', ?, ?)`,
      [JSON.stringify({ step: 'one' }), '2026-01-01T00:00:00.000Z', TREE_HASH]
    );
    const row = engine.queryOne<{ id: number }>(
      `SELECT id FROM version_history WHERE resource_id = 'subject'`
    );
    const versionRowId = Number(row?.id);

    seedRows(engine, versionRowId);
    await engine.shutdown();
    return versionRowId;
  }

  function insertObject(engine: SqliteEngine): void {
    engine.run(
      `INSERT INTO objects (tenant_id, hash, bytes, size, created_at)
       VALUES ('ws', ?, ?, 4, '2026-01-01T00:00:00.000Z')`,
      [OBJECT_HASH, new Uint8Array([1, 2, 3, 4])]
    );
  }

  function insertEntry(engine: SqliteEngine, versionRowId: number): void {
    engine.run(
      `INSERT INTO version_entries (version_row_id, tenant_id, path, object_hash)
       VALUES (?, 'ws', 'prompt.yaml', ?)`,
      [versionRowId, OBJECT_HASH]
    );
  }

  /** Reopen the seeded database, which is where the check runs. */
  async function reopen(): Promise<SqliteEngine> {
    logger.info.mockClear();
    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await engine.initialize();
    return engine;
  }

  function repairLines(): string[] {
    return logger.info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith(REPAIR_LINE_PREFIX));
  }

  it('repairs a row claiming a tree with no entries — the downgrade shape', async () => {
    // A v28 server drops `version_entries` wholesale and restores `version_history` intact, so the
    // row comes back claiming a tree with nothing behind it.
    await seed(() => {
      /* no entries, no objects — exactly what the downgrade leaves */
    });

    const engine = await reopen();

    const row = engine.queryOne<{ tree_hash: unknown; description: string }>(
      `SELECT tree_hash, description FROM version_history WHERE resource_id = 'subject'`
    );
    expect(row?.tree_hash).toBeNull();
    // History is never lost — the row degrades to the projection path, it is not deleted.
    expect(row?.description).toBe('v1');

    expect(repairLines()).toHaveLength(1);
    expect(repairLines()[0]).toContain('1 version_history row(s)');

    await engine.shutdown();
  });

  it('repairs a row whose entry points at an object that is gone, and drops the entry', async () => {
    const versionRowId = await seed((engine, id) => {
      insertObject(engine);
      insertEntry(engine, id);
    });

    // The engine's own connection REFUSES this — node:sqlite enables foreign keys by default, so
    // ON DELETE RESTRICT is live. The residual hole is not the constraint, it is that the
    // constraint is a per-CONNECTION driver default: a fourth opener with the pragma off writes
    // into the same file and leaves exactly this behind. That opener is what is simulated here,
    // and the refusal above is asserted first so the case cannot be mistaken for the ordinary one.
    const withConstraints = new DatabaseSync(dbPath);
    expect(() =>
      withConstraints.prepare(`DELETE FROM objects WHERE hash = ?`).run(OBJECT_HASH)
    ).toThrow(/FOREIGN KEY/i);
    withConstraints.close();

    const withoutConstraints = new DatabaseSync(dbPath);
    withoutConstraints.exec('PRAGMA foreign_keys = OFF');
    withoutConstraints.prepare(`DELETE FROM objects WHERE hash = ?`).run(OBJECT_HASH);
    withoutConstraints.close();

    const engine = await reopen();

    const row = engine.queryOne<{ tree_hash: unknown; description: string }>(
      `SELECT tree_hash, description FROM version_history WHERE id = ?`,
      [versionRowId]
    );
    expect(row?.tree_hash).toBeNull();
    expect(row?.description).toBe('v1');
    expect(engine.query(`SELECT * FROM version_entries`)).toHaveLength(0);

    expect(repairLines()).toHaveLength(1);

    await engine.shutdown();
  });

  it('leaves an intact database alone and logs nothing', async () => {
    // The positive control for both cases above: a repair that NULLed unconditionally would pass
    // them and fail here.
    const versionRowId = await seed((engine, id) => {
      insertObject(engine);
      insertEntry(engine, id);
    });

    const engine = await reopen();

    const row = engine.queryOne<{ tree_hash: string }>(
      `SELECT tree_hash FROM version_history WHERE id = ?`,
      [versionRowId]
    );
    expect(row?.tree_hash).toBe(TREE_HASH);
    expect(engine.query(`SELECT * FROM version_entries`)).toHaveLength(1);
    expect(repairLines()).toEqual([]);

    await engine.shutdown();
  });

  it('does not run on a database it just created, and does run on the next open', async () => {
    // Observed as the query never being ISSUED, not as "nothing happened": on an empty database
    // the check has no effect either way, so an effect-based assertion would be vacuous. `verbose`
    // makes every query visible on the debug channel.
    const naming = (): string[] =>
      logger.debug.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('FROM version_entries'));

    const fresh = await SqliteEngine.getInstance(logger as never, { dbPath, verbose: true });
    await fresh.initialize();
    expect(naming()).toEqual([]);
    await fresh.shutdown();

    // Positive control: the same probe against the same database, one open later. Without it, the
    // empty result above would also be what a broken probe returns.
    logger.debug.mockClear();
    const reopened = await SqliteEngine.getInstance(logger as never, { dbPath, verbose: true });
    await reopened.initialize();
    expect(naming().length).toBeGreaterThan(0);
    await reopened.shutdown();
  });

  describe('the pure decision', () => {
    it('unions the two causes into one row set and counts them separately', () => {
      const plan = planVersionTreeRepair(
        [{ version_row_id: 7 }, { version_row_id: 7 }, { version_row_id: 3 }],
        [{ version_row_id: 9 }]
      );

      expect(plan.rowIds).toEqual([3, 7, 9]);
      expect(plan.withMissingObject).toBe(3);
      expect(plan.withNoEntries).toBe(1);
    });

    it('reports counts and never a hash, a path, or bytes', () => {
      const line = describeVersionTreeRepair({
        rowIds: [1, 2],
        withMissingObject: 2,
        withNoEntries: 0,
      });

      expect(line).toContain('2 version_history row(s)');
      // The line runs on every boot of a database shared across every project on the machine.
      expect(line).not.toMatch(/sha256:|\.yaml|bytes/);
    });
  });
});
