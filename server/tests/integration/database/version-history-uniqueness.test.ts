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
 *      that catches a future writer of this shape that nobody enumerated;
 *   d. two connections saving one resource produce contiguous distinct versions and no UNIQUE
 *      failure — the `MAX(version)`-then-INSERT pair is one unit under the write lock. The
 *      interleave is injected at the maximum-version read rather than raced, so the test carries no
 *      timing dependence;
 *   e. a writer meeting a lock held by another PROCESS waits for it and lands, where the same write
 *      with no timeout is refused — the control that also proves the lock was genuinely held;
 *   f. the engine's own connection carries that timeout, rather than SQLite's default of 0.
 */

import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import {
  loadHistory,
  renameHistoryResource,
  saveVersion,
} from '../../../src/cli-shared/version-history.js';
import { testScratchPath } from '../../helpers/scratch-path.js';
import { STATE_DB_BUSY_TIMEOUT_MS } from '../../../src/shared/utils/runtime-state-location.js';

import type { DatabasePort } from '../../../src/shared/types/persistence.js';
import type { Logger } from '../../../src/shared/types/index.js';

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

  /**
   * `saveVersion` reads `MAX(version)` and writes it back, so a second writer committing between
   * the two makes the INSERT land on a stale maximum. `state.db` has two accepted writers against
   * one file, so that connection is a real configuration.
   *
   * The interleave is made DETERMINISTIC rather than raced: a `DatabasePort` wrapping the real
   * engine drives a second connection at the exact moment the service reads the maximum — the one
   * instant the window is open. Nothing here depends on timing, a sleep, or thread scheduling.
   * The second connection sets `busy_timeout = 0`, so when the service holds the write lock the
   * interfering write is refused at once instead of waiting; the test then lets it land afterwards,
   * which is what a real second writer does when the lock releases.
   */
  describe('two connections saving one resource', () => {
    interface InterferenceLog {
      refusedDuringWindow: boolean;
      run: () => void;
    }

    /** A second connection that appends its own next version, the way the other writer would. */
    function otherWriter(): InterferenceLog {
      const log: InterferenceLog = {
        refusedDuringWindow: false,
        run: () => {
          const other = new DatabaseSync(dbPath);
          try {
            other.exec('PRAGMA busy_timeout = 0');
            other.exec('BEGIN IMMEDIATE');
            const row = other
              .prepare(
                `SELECT MAX(version) AS latest FROM version_history
                 WHERE tenant_id = 'ws' AND resource_type = 'prompt' AND resource_id = 'raced'`
              )
              .get() as { latest: number | null } | undefined;
            other
              .prepare(
                `INSERT INTO version_history
                   (tenant_id, organization_id, workspace_id, resource_type, resource_id,
                    version, snapshot, diff_summary, description, created_at)
                 VALUES ('ws', NULL, 'ws', 'prompt', 'raced', ?, '{}', '', 'other writer', ?)`
              )
              .run(Number(row?.latest ?? 0) + 1, new Date().toISOString());
            other.exec('COMMIT');
          } finally {
            other.close();
          }
        },
      };
      return log;
    }

    it('produces contiguous distinct versions with no UNIQUE failure', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      const interference = otherWriter();
      let fired = false;
      // Delegates everything to the real engine; the ONE seam is the maximum-version read.
      const racingPort = {
        ...engine,
        isInitialized: () => engine.isInitialized(),
        initialize: () => engine.initialize(),
        query: (sql: string, params?: unknown[]) => engine.query(sql, params),
        run: (sql: string, params?: unknown[]) => engine.run(sql, params),
        transaction: <T>(fn: () => T | Promise<T>, mode?: 'deferred' | 'immediate') =>
          engine.transaction(fn, mode),
        beginTransaction: (mode?: 'deferred' | 'immediate') => engine.beginTransaction(mode),
        commit: () => engine.commit(),
        rollback: () => engine.rollback(),
        queryOne: (sql: string, params?: unknown[]) => {
          const result = engine.queryOne(sql, params);
          if (sql.includes('MAX(version)') && !fired) {
            fired = true;
            try {
              interference.run();
            } catch (error) {
              // Refused because the service already holds the write lock — the property under test.
              expect(String(error)).toMatch(/busy|locked/i);
              interference.refusedDuringWindow = true;
            }
          }
          return result;
        },
      } as unknown as DatabasePort;

      const service = new VersionHistoryService({
        logger: logger as unknown as Logger,
        configManager: {
          getVersioningConfig: () => ({ enabled: true, maxVersions: 50, autoVersion: true }),
          getServerRoot: () => testDir,
        },
        dbManager: racingPort,
        scope: { workspaceId: 'ws' },
      });

      await service.saveVersion('prompt', 'raced', { step: 1 }, { description: 'first' });
      expect(fired).toBe(true);
      expect(interference.refusedDuringWindow).toBe(true);

      // The lock is released, so the other writer lands now — reading the maximum the service wrote.
      interference.run();

      const db = new DatabaseSync(dbPath);
      const versions = (
        db
          .prepare(
            `SELECT version FROM version_history WHERE resource_id = 'raced' ORDER BY version`
          )
          .all() as unknown as Array<{ version: number }>
      ).map((row) => row.version);
      db.close();

      expect(versions).toEqual([1, 2]);
      expect(new Set(versions).size).toBe(versions.length);

      await engine.shutdown();
    });
  });

  /**
   * The lock is only half the contract: a writer that meets a held lock must WAIT for it, not fail.
   *
   * That waiting is `busy_timeout`, and it is the difference between the two cases below — the same
   * write, against the same held lock, with the only change being the timeout on the connection.
   * `0` (SQLite's default, what this engine's connection had until `STATE_DB_BUSY_TIMEOUT_MS` was
   * set) is the control: it fails at once, which is what proves the lock is genuinely held and the
   * probe genuinely observes it.
   *
   * The lock is held by a CHILD PROCESS, because a connection blocked on a lock blocks its whole
   * thread — a holder in this process could never reach its own COMMIT. The child releases only
   * after this test tells it to, so the ordering is driven by messages rather than by racing:
   * `RELEASE_DELAY_MS` is how long the child waits after being told, and the write under test
   * starts before that delay expires, then measures that it really waited. The margins are 16x
   * (300 ms held against a 5000 ms patience) and the whole sequence is message-ordered.
   */
  describe('a writer meeting a held lock', () => {
    const RELEASE_DELAY_MS = 300;

    /** A child process holding BEGIN IMMEDIATE on `dbPath` until its stdin says to let go. */
    async function lockHolder(): Promise<{ release: () => void; done: Promise<void> }> {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `const { DatabaseSync } = require('node:sqlite');
           const db = new DatabaseSync(${JSON.stringify(dbPath)});
           db.exec('PRAGMA busy_timeout = 0');
           db.exec('BEGIN IMMEDIATE');
           db.prepare("INSERT INTO version_history (tenant_id, organization_id, workspace_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at) VALUES ('ws', NULL, 'ws', 'prompt', 'held', 1, '{}', '', 'holder', '2026-01-01T00:00:00.000Z')").run();
           process.stdout.write('locked\\n');
           process.stdin.once('data', () => {
             setTimeout(() => { db.exec('COMMIT'); db.close(); process.exit(0); }, ${RELEASE_DELAY_MS});
           });`,
        ],
        { stdio: ['pipe', 'pipe', 'inherit'] }
      );

      await new Promise<void>((resolve) => {
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('locked')) resolve();
        });
      });

      return {
        release: () => child.stdin.write('go\n'),
        done: new Promise<void>((resolve) => child.on('exit', () => resolve())),
      };
    }

    /** Write one row on a fresh connection carrying `timeoutMs`. Returns how long it took. */
    function writeWith(timeoutMs: number, resourceId: string): number {
      const db = new DatabaseSync(dbPath);
      const startedAt = Date.now();
      try {
        db.exec(`PRAGMA busy_timeout = ${timeoutMs}`);
        db.exec('BEGIN IMMEDIATE');
        db.prepare(
          `INSERT INTO version_history
             (tenant_id, organization_id, workspace_id, resource_type, resource_id,
              version, snapshot, diff_summary, description, created_at)
           VALUES ('ws', NULL, 'ws', 'prompt', ?, 1, '{}', '', 'waiter', '2026-01-02T00:00:00.000Z')`
        ).run(resourceId);
        db.exec('COMMIT');
      } finally {
        db.close();
      }
      return Date.now() - startedAt;
    }

    it('is refused with no timeout and waits with the shared one', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();
      await engine.shutdown();

      const holder = await lockHolder();

      // Control: zero patience, so the held lock refuses the write outright. This is also what
      // shows the lock IS held — without it, the second case could pass over an unlocked file.
      expect(() => writeWith(0, 'refused')).toThrow(/busy|locked/i);

      // Subject: the same write, the same held lock, the shared timeout. The child lets go
      // RELEASE_DELAY_MS after this message, which lands while the write below is already waiting.
      holder.release();
      const elapsed = writeWith(STATE_DB_BUSY_TIMEOUT_MS, 'waited');
      await holder.done;

      expect(elapsed).toBeGreaterThanOrEqual(RELEASE_DELAY_MS / 2);
      expect(elapsed).toBeLessThan(STATE_DB_BUSY_TIMEOUT_MS);

      const db = new DatabaseSync(dbPath);
      const ids = (
        db
          .prepare(`SELECT resource_id FROM version_history ORDER BY resource_id`)
          .all() as unknown as Array<{ resource_id: string }>
      ).map((row) => row.resource_id);
      db.close();

      // The waiter landed; the refused one never did; the holder's own row committed.
      expect(ids).toEqual(['held', 'waited']);
    }, 20000);

    it('opens its own connection with the shared timeout, not SQLite default of 0', async () => {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      await engine.initialize();

      const row = engine.queryOne<{ timeout: number }>('PRAGMA busy_timeout');
      expect(Number(row?.timeout)).toBe(STATE_DB_BUSY_TIMEOUT_MS);
      // Positive control: the pragma is readable and is not merely echoing the expectation.
      expect(STATE_DB_BUSY_TIMEOUT_MS).toBeGreaterThan(0);

      await engine.shutdown();
    });
  });
});
