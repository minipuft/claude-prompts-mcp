// @lifecycle test - Pins which transactions may stay DEFERRED, and what an IMMEDIATE lock costs readers
/**
 * A DEFERRED transaction takes no lock until its first WRITE.
 *
 * That is safe for a body that writes first and only reads afterwards, and unsafe for one that
 * reads a value it then writes back: two connections can both take the read, and the second to
 * write is refused — an upgrade race `busy_timeout` cannot rescue, because waiting does not resolve
 * it. `VersionHistoryService.saveVersion` was that shape and now passes `'immediate'`.
 *
 * `ChainManager.persistSessionsOrThrow` is the other high-traffic transaction, running on every
 * chain step, and the question asked of it was the same. The answer is measured here rather than
 * read: a recording `DatabasePort` captures the statements the transaction issues, IN ORDER, and
 * the first one is a `DELETE`. There is no window between a read and a write because there is no
 * read before the write — so the transaction is correct as DEFERRED, and this test is what fails if
 * a later edit puts a `SELECT` at the top of that body, where it would silently acquire the shape
 * `'immediate'` exists for.
 *
 * The second case is the cost side of the same question: an IMMEDIATE lock excludes other WRITERS,
 * not readers. Under WAL a reader sees the last committed snapshot while a write transaction is
 * open, which is what lets the Python hooks keep reading `chain_sessions` while the server writes.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { DatabasePort, TransactionMode } from '../../../src/shared/types/persistence.js';
import type { ChainNode } from '../../../src/shared/types/chain-execution.js';
import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

/** The first word of a SQL statement, upper-cased — `SELECT`, `DELETE`, `INSERT`, `BEGIN`. */
function verbOf(sql: string): string {
  return (/^\s*(\w+)/.exec(sql)?.[1] ?? '').toUpperCase();
}

describe('transaction lock mode', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = testScratchPath('tx-lock-mode');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('writes before it reads when persisting chain sessions, so DEFERRED holds', async () => {
    const engine = await SqliteEngine.getInstance(createLogger(), { dbPath });
    await engine.initialize();

    // The seam: every statement, in the order the transaction issues it.
    const statements: string[] = [];
    let inTransaction = false;
    const recordingPort = {
      isInitialized: () => engine.isInitialized(),
      initialize: () => engine.initialize(),
      query: (sql: string, params?: unknown[]) => {
        if (inTransaction) statements.push(sql);
        return engine.query(sql, params);
      },
      queryOne: (sql: string, params?: unknown[]) => {
        if (inTransaction) statements.push(sql);
        return engine.queryOne(sql, params);
      },
      run: (sql: string, params?: unknown[]) => {
        if (inTransaction) statements.push(sql);
        return engine.run(sql, params);
      },
      transaction: <T>(fn: () => T | Promise<T>, mode?: TransactionMode) =>
        engine.transaction(fn, mode),
      beginTransaction: (mode?: TransactionMode) => {
        engine.beginTransaction(mode);
        inTransaction = true;
      },
      commit: () => {
        inTransaction = false;
        engine.commit();
      },
      rollback: () => {
        inTransaction = false;
        engine.rollback();
      },
    } as unknown as DatabasePort;

    const store = new ChainSessionStore(
      createLogger(),
      new StubTextReferenceStore() as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-lock' } },
      recordingPort
    );
    const nodes: ChainNode[] = [
      { id: 'n1', promptId: 'prompt-a', stepName: 'Gather' },
      { id: 'n2', promptId: 'prompt-b', stepName: 'Report' },
    ];
    await store.createSession('sess-lock', 'chain-lock#1', 2, { topic: 'locks' }, {
      nodes,
    } as never);
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();
    await store.cleanup();

    // Positive control: the seam observed the transaction at all. Without this, an empty list
    // would read as "no read before the write" just as loudly as a correct body does.
    expect(statements.length).toBeGreaterThan(0);

    // The property: nothing is read before the first write, so there is no lock to upgrade.
    const firstWriteAt = statements.findIndex((sql) =>
      ['INSERT', 'UPDATE', 'DELETE'].includes(verbOf(sql))
    );
    expect(firstWriteAt).toBe(0);
    expect(verbOf(statements[0] ?? '')).toBe('DELETE');
    expect(statements.slice(0, firstWriteAt).filter((sql) => verbOf(sql) === 'SELECT')).toEqual([]);

    await engine.shutdown();
  });

  it('admits a concurrent read while a write transaction holds the lock', async () => {
    const engine = await SqliteEngine.getInstance(createLogger(), { dbPath });
    await engine.initialize();
    engine.run(
      `INSERT INTO version_history
         (tenant_id, organization_id, workspace_id, resource_type, resource_id,
          version, snapshot, diff_summary, description, created_at)
       VALUES ('ws', NULL, 'ws', 'prompt', 'visible', 1, '{}', '', 'committed', '2026-01-01T00:00:00.000Z')`
    );
    await engine.shutdown();

    // A child process holds BEGIN IMMEDIATE — a holder in this process would block this thread.
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite');
         const db = new DatabaseSync(${JSON.stringify(dbPath)});
         db.exec('PRAGMA busy_timeout = 0');
         db.exec('BEGIN IMMEDIATE');
         db.prepare("INSERT INTO version_history (tenant_id, organization_id, workspace_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at) VALUES ('ws', NULL, 'ws', 'prompt', 'uncommitted', 1, '{}', '', 'holder', '2026-01-02T00:00:00.000Z')").run();
         process.stdout.write('locked\\n');
         process.stdin.once('data', () => { db.exec('ROLLBACK'); db.close(); process.exit(0); });`,
      ],
      { stdio: ['pipe', 'pipe', 'inherit'] }
    );
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('locked')) resolve();
      });
    });

    // `finally`, because a failing assertion here would otherwise leave the child holding the lock
    // forever and the run would hang instead of reporting the failure — measured while mutating
    // this very test.
    try {
      const reader = new DatabaseSync(dbPath, { readOnly: true });
      reader.exec('PRAGMA busy_timeout = 0');
      const seen = (
        reader
          .prepare(`SELECT resource_id FROM version_history ORDER BY resource_id`)
          .all() as unknown as Array<{ resource_id: string }>
      ).map((row) => row.resource_id);
      reader.close();

      // Not blocked: the reader got the last committed snapshot while the writer held the lock.
      expect(seen).toEqual(['visible']);

      // Positive control that the lock was genuinely held: a WRITER with no patience is refused.
      const writer = new DatabaseSync(dbPath);
      writer.exec('PRAGMA busy_timeout = 0');
      expect(() => writer.exec('BEGIN IMMEDIATE')).toThrow(/busy|locked/i);
      writer.close();
    } finally {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    }
  }, 20000);
});
