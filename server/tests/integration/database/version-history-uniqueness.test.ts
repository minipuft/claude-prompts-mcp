// @lifecycle test - Guards the (tenant, type, resource, version) uniqueness of version_history
/**
 * `version_history` had no unique version key.
 *
 * Two rows could share `(tenant_id, resource_type, resource_id, version)`, and the producer that
 * made that happen was the CLI's `rename_history`: it re-keyed a resource's rows onto a new id with
 * a bare `UPDATE ... SET resource_id`, so renaming onto an id that still carried history — the rows
 * of a deleted prompt survive its deletion by design — merged two sequences and left two rows
 * claiming to be v1. Every reader of this table selects by version: `getVersion`, `compareVersions`
 * and `rollback` would then restore whichever of the two SQLite returned first.
 *
 * Three properties are pinned here, one per failure the fix has to own:
 *   a. a v27 database ALREADY holding duplicates opens under v28 with every row present and every
 *      key unique — the migration renumbers rather than throwing or discarding, and the fixture is
 *      hand-written SQL so it cannot inherit the new writer's correctness;
 *   b. a rename onto an id with existing history continues after that id's newest version;
 *   c. a duplicate INSERT is refused outright — the positive control for the index, and the gate
 *      that catches a future writer of this shape that nobody enumerated.
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import {
  loadHistory,
  renameHistoryResource,
  saveVersion,
} from '../../../src/cli-shared/version-history.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

/** The v27 shape of the two tables this migration reads — no unique index, by definition. */
const V27_DDL = `
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
`;

interface KeyRow {
  resource_id: string;
  version: number;
  description: string;
  created_at: string;
}

describe('version_history uniqueness', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = testScratchPath('vh-unique');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('a v27 database carrying duplicates', () => {
    /**
     * Hand-written v27 rows, NOT produced by the writer under test: two `p` histories merged by a
     * rename (two v1s and two v2s, interleaved in time), plus an untouched neighbour that must
     * survive with its own numbering intact.
     */
    function seedV27Duplicates(): void {
      const db = new DatabaseSync(dbPath);
      db.exec(V27_DDL);
      db.exec('INSERT INTO schema_version (version) VALUES (27)');
      const insert = db.prepare(
        `INSERT INTO version_history
           (tenant_id, organization_id, workspace_id, resource_type, resource_id,
            version, snapshot, diff_summary, description, created_at)
         VALUES ('ws', NULL, 'ws', 'prompt', ?, ?, ?, '', ?, ?)`
      );
      // resource_id, version, description, created_at — ordered so the two sequences interleave.
      const rows: Array<[string, number, string, string]> = [
        ['p', 1, 'old-a-1', '2026-01-01T00:00:00.000Z'],
        ['p', 1, 'old-b-1', '2026-01-02T00:00:00.000Z'],
        ['p', 2, 'old-a-2', '2026-01-03T00:00:00.000Z'],
        ['p', 2, 'old-b-2', '2026-01-04T00:00:00.000Z'],
        ['q', 1, 'neighbour-1', '2026-01-05T00:00:00.000Z'],
        ['q', 2, 'neighbour-2', '2026-01-06T00:00:00.000Z'],
      ];
      for (const [resourceId, version, description, createdAt] of rows) {
        insert.run(resourceId, version, JSON.stringify({ description }), description, createdAt);
      }
      db.close();
    }

    function readKeys(): KeyRow[] {
      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare(
          `SELECT resource_id, version, description, created_at FROM version_history
           ORDER BY resource_id, version`
        )
        .all() as unknown as KeyRow[];
      db.close();
      return rows;
    }

    it('opens under v28 with every row present and every key unique', async () => {
      seedV27Duplicates();

      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();
      await engine.shutdown();

      const rows = readKeys();
      expect(rows).toHaveLength(6);

      const keys = rows.map((row) => `${row.resource_id}@${row.version}`);
      expect(new Set(keys).size).toBe(6);

      // Renumbering is by existing timestamp, so the merged sequence keeps its chronology and the
      // untouched neighbour keeps the numbers it already had.
      expect(rows.filter((row) => row.resource_id === 'p').map((row) => row.description)).toEqual([
        'old-a-1',
        'old-b-1',
        'old-a-2',
        'old-b-2',
      ]);
      expect(rows.filter((row) => row.resource_id === 'p').map((row) => row.version)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(rows.filter((row) => row.resource_id === 'q').map((row) => row.version)).toEqual([
        1, 2,
      ]);
    });
  });

  describe('renaming onto an id that already has history', () => {
    const savedEnv = process.env['MCP_RUNTIME_ROOT'];

    beforeEach(async () => {
      process.env['MCP_RUNTIME_ROOT'] = testDir;
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();
      await engine.shutdown();
    });

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env['MCP_RUNTIME_ROOT'];
      } else {
        process.env['MCP_RUNTIME_ROOT'] = savedEnv;
      }
    });

    it('continues after the target id newest version instead of colliding with it', () => {
      // `target` has history from a resource that was deleted — its rows survive by design.
      saveVersion(testDir, 'prompt', 'target', { step: 'target-1' }, { description: 'target-1' });
      saveVersion(testDir, 'prompt', 'target', { step: 'target-2' }, { description: 'target-2' });
      saveVersion(testDir, 'prompt', 'source', { step: 'source-1' }, { description: 'source-1' });
      saveVersion(testDir, 'prompt', 'source', { step: 'source-2' }, { description: 'source-2' });

      expect(
        renameHistoryResource(testDir, { resourceType: 'prompt', resourceId: 'source' }, 'target')
      ).toBe(true);

      const history = loadHistory(testDir, { resourceType: 'prompt', resourceId: 'target' });
      expect(history).not.toBeNull();
      const versions = history!.versions.map((entry) => entry.version);
      expect(versions).toEqual([4, 3, 2, 1]);
      expect(history!.versions.map((entry) => entry.description)).toEqual([
        'source-2',
        'source-1',
        'target-2',
        'target-1',
      ]);
      expect(loadHistory(testDir, { resourceType: 'prompt', resourceId: 'source' })).toBeNull();
    });

    it('leaves numbering untouched when the target id has no history', () => {
      // Positive control for the renumbering branch: the plain re-key must still be a plain re-key,
      // or "continues after the max" would be indistinguishable from "always renumbers from 1".
      saveVersion(testDir, 'prompt', 'solo', { step: 1 }, { description: 'one' });
      saveVersion(testDir, 'prompt', 'solo', { step: 2 }, { description: 'two' });
      const db = new DatabaseSync(dbPath);
      db.exec(`UPDATE version_history SET version = version + 10 WHERE resource_id = 'solo'`);
      db.close();

      expect(
        renameHistoryResource(testDir, { resourceType: 'prompt', resourceId: 'solo' }, 'moved')
      ).toBe(true);

      const history = loadHistory(testDir, { resourceType: 'prompt', resourceId: 'moved' });
      expect(history!.versions.map((entry) => entry.version)).toEqual([12, 11]);
    });
  });

  describe('the unique index itself', () => {
    it('refuses a second row with the same key and accepts a differing one', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      const insert = (resourceId: string, version: number): void => {
        engine.run(
          `INSERT INTO version_history
             (tenant_id, organization_id, workspace_id, resource_type, resource_id,
              version, snapshot, diff_summary, description, created_at)
           VALUES ('ws', NULL, 'ws', 'prompt', ?, ?, '{}', '', '', '2026-01-01T00:00:00.000Z')`,
          [resourceId, version]
        );
      };

      insert('p', 1);
      expect(() => insert('p', 1)).toThrow(/UNIQUE/i);
      // Positive control: the probe above sees the KEY, not merely any second insert.
      expect(() => insert('p', 2)).not.toThrow();

      await engine.shutdown();
    });
  });
});
