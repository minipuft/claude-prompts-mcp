// @lifecycle test - A schema recreate that fails part-way leaves the old schema, rows and version intact
/**
 * The version-mismatch branch of `ensureSchema` is snapshot → drop every table → apply the new
 * schema → restore the durable rows, and the new schema's `INSERT` into `schema_version` is part of
 * the apply step. Until 2026-10-12 none of it ran in a transaction: a restore that threw (a durable
 * row the new DDL refuses) still left the file at the NEW version with the durable table EMPTY, so
 * the next start read the file as current and the rows were gone for good. Measured on a scratch
 * database: the first start reported "Failed to restore 1 durable row(s) into version_history", the
 * second started cleanly over zero rows.
 *
 * The forced failure is the one the restore's own error message names: a durable row that violates
 * a `NOT NULL` the new DDL declares. The outgoing table is rebuilt without the constraint so it can
 * hold such a row, exactly as an older schema without that column constraint would.
 *
 * Positive control: the same seam with a VALID row carries it across and moves the version, so the
 * "nothing changed" assertions below are not what a recreate that never ran would also produce.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

interface FileState {
  readonly version: unknown;
  readonly schema: unknown[];
  readonly history: unknown[];
}

describe('a schema recreate is one transaction', () => {
  let testDir: string;
  let dbPath: string;
  let currentVersion: number;

  beforeEach(async () => {
    testDir = testScratchPath('schema-recreate-atomicity');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await engine.initialize();
    currentVersion = engine.getSchemaVersion();
    await engine.shutdown();
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Rewind the file to the previous version, with one `version_history` row of `snapshot`. */
  function seedOlderFile(snapshot: string | null): void {
    const raw = new DatabaseSync(dbPath);
    try {
      raw.exec('PRAGMA foreign_keys = OFF');
      // CREATE TABLE AS copies the columns and drops every constraint, NOT NULL included.
      raw.exec(`CREATE TABLE vh_outgoing AS SELECT * FROM version_history;
        DROP TABLE version_history;
        ALTER TABLE vh_outgoing RENAME TO version_history;`);
      raw
        .prepare(
          `INSERT INTO version_history (tenant_id, resource_type, resource_id, version, snapshot, created_at)
           VALUES ('ws', 'prompt', 'seed', 1, ?, '2026-01-01T00:00:00.000Z')`
        )
        .run(snapshot);
      raw.prepare('UPDATE schema_version SET version = ?').run(currentVersion - 1);
    } finally {
      raw.close();
    }
  }

  function readFileState(): FileState {
    const raw = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return {
        version: (raw.prepare('SELECT version FROM schema_version').get() as { version: unknown })
          .version,
        schema: raw.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all(),
        history: raw
          .prepare('SELECT resource_id, version, snapshot FROM version_history ORDER BY id')
          .all(),
      };
    } finally {
      raw.close();
    }
  }

  it('leaves the old tables, durable rows and version in place when the restore fails', async () => {
    seedOlderFile(null);
    const before = readFileState();
    expect(before.version).toBe(currentVersion - 1);
    expect(before.history).toEqual([{ resource_id: 'seed', version: 1, snapshot: null }]);

    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await expect(engine.initialize()).rejects.toThrow(
      /Failed to restore 1 durable row\(s\) into version_history/
    );
    expect(engine.isInitialized()).toBe(false);
    await SqliteEngine.shutdownInstance();

    // The whole file is as it was: same version, same DDL (the constraint-free outgoing table, not
    // the new one), same row.
    expect(readFileState()).toEqual(before);

    // And the next start fails the same way, rather than reading the file as current.
    const again = await SqliteEngine.getInstance(logger as never, { dbPath });
    await expect(again.initialize()).rejects.toThrow(/Failed to restore/);
    expect(readFileState()).toEqual(before);
  });

  it('carries a valid durable row across and moves the version (positive control)', async () => {
    seedOlderFile('{"step":"one"}');

    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await engine.initialize();
    await engine.shutdown();

    const after = readFileState();
    expect(after.version).toBe(currentVersion);
    expect(after.history).toEqual([
      { resource_id: 'seed', version: 1, snapshot: '{"step":"one"}' },
    ]);
    // The new DDL is back: the recreate really ran, it did not just leave the outgoing table.
    const historyDdl = (after.schema as Array<{ name: string; sql: string | null }>).find(
      (entry) => entry.name === 'version_history'
    );
    expect(historyDdl?.sql).toMatch(/snapshot TEXT NOT NULL/);
  });
});
