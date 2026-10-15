import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createVerifyActiveStateStore } from '../../../../src/engine/gates/shell/verify-active-state-store.js';

import type { PendingShellVerification } from '../../../../src/engine/gates/shell/types.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

/**
 * Reads `verify_active_state` the way the real consumer does: raw SQL against the file, not a
 * TS convenience method. `readState`/`hasActiveVerification` were deleted (P4.81) as surplus —
 * the Stop hook that reads this table is Python (`hooks/ralph-stop.py`), never this class, so a
 * TS-side read method served only this test. This helper replaces it for verification purposes.
 */
function rowCount(dbPath: string, sessionId: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM verify_active_state WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const pending: PendingShellVerification = {
  gateId: 'gate-shell-test-suite',
  shellVerify: { command: 'npm test', loop: true },
  attemptCount: 1,
  maxAttempts: 5,
  previousResults: [],
};

describe('VerifyActiveStateStore (persistence)', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-state-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // Positive control: the same store, against a directory it CAN create and write to,
  // must succeed — otherwise the failure cases below would prove nothing about the
  // write path itself, only that something in the harness is broken.
  test('a write to a usable directory round-trips through the db file', async () => {
    const goodDir = path.join(tmpRoot, 'writable');
    const logger = createLogger();
    const store = createVerifyActiveStateStore(logger, { runtimeStateDir: goodDir });

    await expect(
      store.writeWorkflowState({ runSessionId: 'control', scope: {} }, pending)
    ).resolves.toBeUndefined();
    expect(rowCount(store.stateDbPath, 'workflow-run-control')).toBe(1);
  });

  test('one public chain id in two scopes keeps two rows; a release keeps the other and the host row', async () => {
    const store = createVerifyActiveStateStore(createLogger(), {
      runtimeStateDir: path.join(tmpRoot, 'two-scopes'),
    });
    for (const [run, scope] of [
      ['uuid-a', { workspaceId: 'a' }],
      ['uuid-b', {}],
    ] as const) {
      await store.writeWorkflowState({ runSessionId: run, chainId: 'chain-x#1', scope }, pending);
    }
    const db = new DatabaseSync(store.stateDbPath);
    const rows = () => db.prepare('SELECT * FROM verify_active_state ORDER BY session_id').all();
    try {
      const insert = db.prepare('INSERT INTO verify_active_state VALUES (?, ?, ?)');
      insert.run('host-client-1', JSON.stringify({ sessionId: 'host-client-1' }), 'host');
      const keys = ['host-client-1', 'workflow-run-uuid-a', 'workflow-run-uuid-b'];
      expect(rows().map((row) => row['session_id'])).toEqual(keys);
      expect(JSON.parse(String(rows()[1]?.['state_json']))).toMatchObject({
        sessionId: keys[1],
        runSessionId: 'uuid-a',
        chainId: 'chain-x#1',
        scope: { workspaceId: 'a' },
      });
      await expect(store.releaseRunState('chain-x#1', 'uuid-a')).resolves.toBe('released');
      expect(rows().map((row) => row['session_id'])).toEqual([keys[0], keys[2]]);
      await expect(
        store.writeWorkflowState({ runSessionId: '', chainId: 'chain-x#1', scope: {} }, pending)
      ).rejects.toThrow('requires a workflow run identity');
      // A row an earlier build filed under the public chain id goes only with the run it names
      const legacy = { sessionId: 'chain-x#1', runSessionId: 'uuid-old' };
      insert.run('chain-x#1', JSON.stringify(legacy), 'legacy');
      await expect(store.releaseRunState('chain-x#1', 'uuid-other')).resolves.toBe('absent');
      expect(rows()).toHaveLength(3);
      await expect(store.releaseRunState('chain-x#1', 'uuid-old')).resolves.toBe('released');
      expect(rows()).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  // `runtimeStateDir` points at a path that already exists as a plain FILE. `fs.mkdirSync`
  // with `recursive: true` throws EEXIST on a path whose last segment is a file rather than
  // a directory (verified empirically), which reaches `withDb` before any `DatabaseSync` is
  // opened — a reliable, real persistence failure, not a mocked one.
  const brokenStore = (name: string): ReturnType<typeof createVerifyActiveStateStore> => {
    const blockedPath = path.join(tmpRoot, name);
    fs.writeFileSync(blockedPath, 'this is a file, not a directory');
    return createVerifyActiveStateStore(createLogger(), { runtimeStateDir: blockedPath });
  };

  test('owned release preserves foreign and unbound bytes and accepts absent or matching rows', async () => {
    const store = createVerifyActiveStateStore(createLogger(), {
      runtimeStateDir: path.join(tmpRoot, 'owned'),
    });
    const key = 'workflow-run-review-owned';
    const owned = { runSessionId: 'review-owned', scope: {} };
    await store.writeWorkflowState(owned, pending);
    const db = new DatabaseSync(store.stateDbPath);
    const read = () =>
      db.prepare('SELECT state_json FROM verify_active_state WHERE session_id = ?').get(key);
    try {
      const bound = read();
      expect(JSON.parse(String(bound?.['state_json']))).toMatchObject({
        runSessionId: 'review-owned',
      });
      await expect(store.releaseRunState('same-key', 'other-run')).resolves.toBe('absent');
      expect(read()).toEqual(bound);
      await expect(store.releaseRunState('same-key', 'review-owned')).resolves.toBe('released');
      expect(read()).toBeUndefined();
      await expect(store.releaseRunState('same-key', 'review-owned')).resolves.toBe('absent');
      for (const raw of ['{}', '{"runSessionId":0}', '{"runSessionId":""}', 'null', '{']) {
        db.prepare('INSERT INTO verify_active_state VALUES (?, ?, ?)').run(key, raw, 'retained');
        await expect(store.releaseRunState('same-key', 'review-owned')).resolves.toBe('unbound');
        expect(read()?.['state_json']).toBe(raw);
        db.prepare('DELETE FROM verify_active_state WHERE session_id = ?').run(key);
      }
      await expect(store.releaseRunState('same-key', '')).rejects.toThrow('internal run identity');
      await store.writeWorkflowState(owned, pending);
      for (const rejection of ["ABORT, 'injected release failure'", 'IGNORE']) {
        db.exec(
          `CREATE TRIGGER deny_release BEFORE DELETE ON verify_active_state BEGIN SELECT RAISE(${rejection}); END`
        );
        await expect(store.releaseRunState('same-key', 'review-owned')).rejects.toThrow();
        expect(read()).toBeDefined();
        db.exec('DROP TRIGGER deny_release');
      }
      await expect(store.releaseRunState('same-key', 'review-owned')).resolves.toBe('released');
      expect(read()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test('a write that cannot persist rejects instead of resolving with success logged', async () => {
    const store = brokenStore('blocked-write');

    // The caller (whatever awaits writeWorkflowState) receives the failure as a rejected promise —
    // before this fix it resolved silently while only a warn log recorded the failure.
    await expect(
      store.writeWorkflowState({ runSessionId: 'session-a', scope: {} }, pending)
    ).rejects.toThrow();
  });

  test('the write failure states the loop could not be armed, not that it was', async () => {
    const store = brokenStore('blocked-write-message');

    // This message is exactly what the pipeline's single error boundary renders as the
    // `:: verify` reply text (`Error: ${message}`) — asserting its wording here is asserting
    // what OQ-10 requires the reply say.
    await expect(
      store.writeWorkflowState({ runSessionId: 'session-b', scope: {} }, pending)
    ).rejects.toThrow(/Failed to arm verify-loop state for session workflow-run-session-b/);
  });

  test('a clear that cannot persist rejects instead of resolving with success logged', async () => {
    const store = brokenStore('blocked-clear');

    await expect(store.releaseRunState('session-c', 'run-c')).rejects.toThrow();
  });
});
