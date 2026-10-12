// @lifecycle test - A chain-session store whose database cannot initialize reports why, where it is used
/**
 * `ChainSessionStore` initializes its database port asynchronously — from the constructor, and
 * again when a port arrives late through `setDatabasePort`. Both paths caught every failure and
 * logged it as a warning, which left `runRegistry` unassigned: the next operation then failed with
 * an unrelated `TypeError` ("Cannot read properties of undefined (reading 'save')") far from the
 * cause. Startup already refuses when the engine itself cannot initialize, so the only thing those
 * catches could still hide was a test-path or ordering defect.
 *
 * Now the failure rejects `initPromise`, which every session operation awaits, so the operation
 * reports the database's own error.
 *
 * Positive control: the same store with a port that initializes cleanly (a real engine on a scratch
 * file) creates a session, so the rejection below is about the port and not about a store that
 * cannot create sessions at all.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/** A port whose `initialize()` rejects with `failure`; nothing else on it may be reached. */
function rejectingPort(failure: Error): DatabasePort {
  const unreachable = (name: string) => () => {
    throw new Error(`${name} reached on a port that never initialized`);
  };
  return {
    initialize: () => Promise.reject(failure),
    isInitialized: () => false,
    run: unreachable('run'),
    query: unreachable('query'),
    queryOne: unreachable('queryOne'),
    beginTransaction: unreachable('beginTransaction'),
    commit: unreachable('commit'),
    rollback: unreachable('rollback'),
    transaction: unreachable('transaction'),
  } as unknown as DatabasePort;
}

describe('a chain-session store whose database port fails to initialize', () => {
  let store: ChainSessionStore | undefined;
  let schedulerSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    schedulerSpy.mockRestore();
    store = undefined;
    await SqliteEngine.shutdownInstance();
  });

  test('reports the port error from the next operation (port given at construction)', async () => {
    const failure = new Error('cannot open state.db at /nowhere: disk I/O error');
    store = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      databasePort: rejectingPort(failure),
    });

    await expect(store.createSession('s-1', 'chain-a', 2)).rejects.toBe(failure);
  });

  test('reports the port error from the next operation (port bound late)', async () => {
    const failure = new Error('cannot open state.db at /nowhere: disk I/O error');
    store = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {});
    store.setDatabasePort(rejectingPort(failure));

    await expect(store.createSession('s-1', 'chain-a', 2)).rejects.toBe(failure);
  });

  test('creates a session when the port initializes (positive control)', async () => {
    const scratch = testScratchPath('store-init-failure');
    try {
      const engine = await SqliteEngine.getInstance(createLogger(), {
        dbPath: path.join(scratch, 'runtime-state', 'state.db'),
      });
      store = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
        databasePort: engine,
      });

      const session = await store.createSession('s-1', 'chain-a', 2);
      expect(session.sessionId).toBe('s-1');
      expect(engine.query('SELECT chain_id FROM chain_runs')).toHaveLength(1);
      await store.cleanup();
    } finally {
      await SqliteEngine.shutdownInstance();
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });
});
