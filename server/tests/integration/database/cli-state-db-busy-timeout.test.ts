// @lifecycle test - The CLI's own state.db connection waits on a held write lock rather than failing.
/**
 * `openStateDb` applies `STATE_DB_WRITER_PRAGMAS`, and `busy_timeout` in that list is not a no-op.
 *
 * WHY THIS EXISTS. Removing the pragma loop from `openStateDb` left **501 tests green** (mutant M9,
 * measured 2026-09-21). The object-store design already records that the `foreign_keys` line in the
 * same list changes no behaviour on this driver — a documented no-op — but `busy_timeout` is the
 * opposite: `state.db` has two accepted writers, the server and this CLI, and without it a `cpm`
 * command that meets the server mid-transaction fails outright instead of waiting. Nothing
 * distinguished the two lines, so the honest reading was that the whole list was unpinned.
 *
 * WHY IT IS BEHAVIOURAL AND NOT A PRAGMA READ. `openStateDb` is private, and its connection is
 * closed before any caller could read a pragma off it. The only probe that reaches it is the
 * observable one: hold the write lock and see whether a CLI call waits. `deleteVersionRows` is the
 * entry point used because it is genuinely production-reached — `cpm delete` calls it through
 * `deleteResourceDir` — and it takes `BEGIN IMMEDIATE`, which is what the held lock blocks.
 *
 * WHY THE HOLDER IS A CHILD PROCESS. A connection waiting on a lock blocks its whole thread, so a
 * same-process holder could never reach its own COMMIT and a same-process timer could never fire.
 * The child releases on a message, so the ordering is driven by messages rather than by racing.
 * Sibling harness: `version-history-uniqueness.test.ts` §a writer meeting a held lock.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { deleteVersionRows, saveVersion } from '../../../src/cli-shared/version-history.js';
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

describe('the CLI connection waits on a held state.db write lock', () => {
  let testDir: string;
  let dbPath: string;
  let promptDir: string;

  beforeEach(async () => {
    testDir = testScratchPath('cli-busy-timeout');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    promptDir = path.join(testDir, 'resources', 'prompts', 'general', 'demo');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.mkdir(promptDir, { recursive: true });

    const engine = await SqliteEngine.getInstance(logger as never, { dbPath });
    await engine.initialize();
    await engine.shutdown();
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** A child process holding BEGIN IMMEDIATE on `dbPath` until its stdin says to let go. */
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
         db.exec('PRAGMA busy_timeout = 0');
         db.exec('BEGIN IMMEDIATE');
         db.prepare("INSERT INTO version_history (tenant_id, organization_id, workspace_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at) VALUES ('ws', NULL, 'ws', 'prompt', 'holder', 1, '{}', '', 'holder', '2026-01-01T00:00:00.000Z')").run();
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
      // Called from a `finally`: a failing assertion would otherwise leave the child holding the
      // lock forever and the run would hang instead of reporting the failure.
      abandon: () => child.kill('SIGKILL'),
    };
  }

  it('waits for the lock instead of failing, on a connection the CLI opened itself', async () => {
    // Something for the delete to remove, so a `true` return cannot mean "found nothing to do".
    expect(
      saveVersion(promptDir, 'prompt', 'demo', { id: 'demo' }, { description: 'v1' }).success
    ).toBe(true);

    const holder = await lockHolder();
    try {
      // The positive control, and it is the same shape as the subject: a connection with ZERO
      // patience against the SAME held lock is refused at once. Without it, the subject below
      // could pass over a file nobody had locked.
      expect(() => {
        const db = new DatabaseSync(dbPath);
        try {
          db.exec('PRAGMA busy_timeout = 0');
          db.exec('BEGIN IMMEDIATE');
          db.exec('COMMIT');
        } finally {
          db.close();
        }
      }).toThrow(/busy|locked/i);

      // Subject: the CLI entry point, which opens its own connection through `openStateDb`. The
      // child lets go RELEASE_DELAY_MS after this message, landing while the call below is already
      // waiting — so a call that returns before then did not wait at all.
      holder.release();
      const startedAt = Date.now();
      const removed = deleteVersionRows(promptDir, { resourceType: 'prompt', resourceId: 'demo' });
      const elapsed = Date.now() - startedAt;
      await holder.done;

      expect(removed).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(RELEASE_DELAY_MS / 2);
      // 16x margin: 300 ms held against 5000 ms of patience.
      expect(elapsed).toBeLessThan(STATE_DB_BUSY_TIMEOUT_MS);

      // And it really deleted — the row is gone while the holder's own row survived.
      const db = new DatabaseSync(dbPath);
      const ids = (
        db
          .prepare(`SELECT resource_id FROM version_history ORDER BY resource_id`)
          .all() as unknown as Array<{ resource_id: string }>
      ).map((row) => row.resource_id);
      db.close();
      expect(ids).toEqual(['holder']);
    } finally {
      holder.abandon();
      await holder.done;
    }
  }, 30000);
});
