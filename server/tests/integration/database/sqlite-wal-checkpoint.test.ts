// @lifecycle test - Tier 5.1: WAL is checkpointed on shutdown
/**
 * WAL Checkpoint Integration Test
 *
 * `state.db` runs in WAL mode so Python hooks and the skills-sync CLI can read
 * concurrently. SQLite checkpoints on its own only when the LAST connection closes,
 * and nothing called `SqliteEngine.shutdown()` at all until Tier 5.2 — so the log grew
 * across restarts (measured 2026-08-05: 4.2 MB WAL against a 598 KB database).
 *
 * These tests own two distinct claims:
 *   1. shutdown truncates the WAL
 *   2. a checkpoint that fails does NOT prevent the close — the handle still closes
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const testDir = path.join(process.cwd(), 'tests/tmp/wal-checkpoint-test');
const walPath = path.join(testDir, 'runtime-state', 'state.db-wal');

/** Write enough rows that the WAL is unambiguously non-empty before we checkpoint. */
function growWal(engine: SqliteEngine): void {
  for (let i = 0; i < 200; i++) {
    engine.run(
      `INSERT INTO resource_index (id, type, name, description, file_path, content_hash, indexed_at)
       VALUES (?, 'prompt', ?, ?, ?, ?, ?)`,
      [
        `wal-probe-${i}`,
        `Probe ${i}`,
        'x'.repeat(400),
        `/tmp/probe-${i}.md`,
        `hash-${i}`,
        Date.now(),
      ]
    );
  }
}

async function sizeOf(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return 0; // SQLite may remove the WAL entirely on a truncating checkpoint
  }
}

describe('WAL checkpoint on shutdown', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('truncates a grown WAL when the engine shuts down', async () => {
    const engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await engine.initialize();

    growWal(engine);
    const beforeShutdown = await sizeOf(walPath);
    // Guard the guard: if the WAL never grew, a passing assertion below proves nothing.
    expect(beforeShutdown).toBeGreaterThan(0);

    await engine.shutdown();

    const afterShutdown = await sizeOf(walPath);
    expect(afterShutdown).toBeLessThan(beforeShutdown);
  });

  it('still closes the database when the checkpoint fails', async () => {
    const engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await engine.initialize();
    growWal(engine);

    // Simulate a reader holding the file: the checkpoint PRAGMA throws, everything else
    // on the handle keeps working. A shutdown that rethrew here would skip `db.close()`
    // and leak the handle — trading a large WAL for a lost one.
    const rawDb = (engine as unknown as { db: { exec(sql: string): void } }).db;
    const realExec = rawDb.exec.bind(rawDb);
    rawDb.exec = (sql: string): void => {
      if (sql.includes('wal_checkpoint')) {
        throw new Error('database is locked');
      }
      realExec(sql);
    };

    await expect(engine.shutdown()).resolves.toBeUndefined();
    expect(engine.isInitialized()).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('WAL checkpoint skipped during shutdown')
    );
  });

  it('shutdownInstance is a no-op when no engine was ever opened', async () => {
    // Shutdown must not route through getInstance(), which would CREATE an engine and
    // open a database handle during teardown.
    await expect(SqliteEngine.shutdownInstance()).resolves.toBeUndefined();
    await expect(fs.stat(path.join(testDir, 'runtime-state', 'state.db'))).rejects.toThrow();
  });
});
