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

    await expect(store.writeState('session-control', pending)).resolves.toBeUndefined();
    expect(rowCount(store.stateDbPath, 'session-control')).toBe(1);

    await expect(store.clearState('session-control')).resolves.toBeUndefined();
    expect(rowCount(store.stateDbPath, 'session-control')).toBe(0);
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

  test('a write that cannot persist rejects instead of resolving with success logged', async () => {
    const store = brokenStore('blocked-write');

    // The caller (whatever awaits writeState) receives the failure as a rejected promise —
    // before this fix it resolved silently while only a warn log recorded the failure.
    await expect(store.writeState('session-a', pending)).rejects.toThrow();
  });

  test('the write failure states the loop could not be armed, not that it was', async () => {
    const store = brokenStore('blocked-write-message');

    // This message is exactly what the pipeline's single error boundary renders as the
    // `:: verify` reply text (`Error: ${message}`) — asserting its wording here is asserting
    // what OQ-10 requires the reply say.
    await expect(store.writeState('session-b', pending)).rejects.toThrow(
      /Failed to arm verify-loop state for session session-b/
    );
  });

  test('a clear that cannot persist rejects instead of resolving with success logged', async () => {
    const store = brokenStore('blocked-clear');

    await expect(store.clearState('session-c')).rejects.toThrow();
  });

  test('the clear failure states the loop could not be cleared, not that it was', async () => {
    const store = brokenStore('blocked-clear-message');

    await expect(store.clearState('session-d')).rejects.toThrow(
      /Failed to clear verify-loop state for session session-d/
    );
  });

  test('a clear-all (no sessionId) failure names no session rather than "session undefined"', async () => {
    const store = brokenStore('blocked-clear-all');

    await expect(store.clearState()).rejects.toThrow(/^Failed to clear verify-loop state: /);
  });
});
