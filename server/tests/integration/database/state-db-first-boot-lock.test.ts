// @lifecycle test - Engine initialization waits on a lock another process holds, from its first read
/**
 * `state.db` is shared by every server on the machine, the `cpm` CLI and the Python hooks, so two
 * processes starting on one file at once is ordinary. Until 2026-10-12 the engine's FIRST statement
 * (the schema-version read) ran before `busy_timeout` was set, so it had SQLite's default patience
 * of zero: against a held lock `initialize()` failed in about 2 ms with "database is locked", and
 * the message ended in a recovery hint ("Use a compatible runtime to inspect/recover…") written for
 * a malformed schema, which sends an operator to repair a file that has nothing wrong with it.
 *
 * WHY THE HOLDER IS A CHILD PROCESS. `DatabaseSync` blocks its thread while it waits, so a
 * same-process holder could never let go. Sibling harness: `cli-state-db-busy-timeout.test.ts`.
 *
 * The control holds the lock past the timeout, so it takes `STATE_DB_BUSY_TIMEOUT_MS` (5 s) by
 * construction: there is one patience value for every writer of this file, and the test does not
 * get a second one.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { STATE_DB_BUSY_TIMEOUT_MS } from '../../../src/shared/utils/runtime-state-location.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const logger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

/** How long the child keeps the lock after it is told to let go. */
const RELEASE_DELAY_MS = 300;

describe('first-boot initialization against a held lock', () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = testScratchPath('first-boot-lock');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * A child process holding an EXCLUSIVE lock on a brand-new `dbPath` — what another process
   * mid-way through creating the schema looks like to a reader — until its stdin says to let go.
   * It rolls back, so the file it leaves is still a first-boot file.
   */
  async function lockHolder(): Promise<{
    release: () => void;
    done: Promise<void>;
    abandon: () => void;
  }> {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite');
         const db = new DatabaseSync(${JSON.stringify(dbPath)});
         db.exec('BEGIN EXCLUSIVE');
         process.stdout.write('locked\\n');
         process.stdin.once('data', () => {
           setTimeout(() => { db.exec('ROLLBACK'); db.close(); process.exit(0); }, ${RELEASE_DELAY_MS});
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
      abandon: () => child.kill('SIGKILL'),
    };
  }

  it('waits for the lock and then initializes', async () => {
    const holder = await lockHolder();
    try {
      // The child lets go RELEASE_DELAY_MS after this, while initialize() below is already
      // waiting — so a call that succeeds faster than that did not meet the lock at all.
      holder.release();
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      const startedAt = Date.now();
      await engine.initialize();
      const elapsed = Date.now() - startedAt;

      expect(engine.isInitialized()).toBe(true);
      expect(engine.getSchemaVersion()).toBeGreaterThan(0);
      expect(elapsed).toBeGreaterThanOrEqual(RELEASE_DELAY_MS / 2);
      expect(elapsed).toBeLessThan(STATE_DB_BUSY_TIMEOUT_MS);
    } finally {
      holder.abandon();
      await holder.done;
    }
  }, 30000);

  it('fails after the busy timeout with a lock message naming the file (control)', async () => {
    const holder = await lockHolder();
    try {
      const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
      const startedAt = Date.now();
      const error: unknown = await engine.initialize().catch((failure: unknown) => failure);
      const elapsed = Date.now() - startedAt;

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(dbPath);
      expect(message).toMatch(/locked/i);
      // The recovery hint is for a malformed or incompatible schema, not a busy file.
      expect(message).not.toContain('Use a compatible runtime');
      // It waited out its patience rather than failing at once.
      expect(elapsed).toBeGreaterThanOrEqual(STATE_DB_BUSY_TIMEOUT_MS - 250);
      expect(engine.isInitialized()).toBe(false);
    } finally {
      holder.abandon();
      await holder.done;
    }
  }, 30000);
});
