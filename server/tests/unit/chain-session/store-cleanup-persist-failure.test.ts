// @lifecycle test - ChainSessionStore.cleanup() rejects when its final save fails
/**
 * `cleanup()` is the last write the store makes before the database closes. A failed save used
 * to be caught and warned inside `cleanup()`, so `Application.shutdown()` reported success over
 * sessions the rows did not hold. Persistence throws and the caller decides; the scheduler stops
 * first either way, so a failed save cannot leave the expiry interval running.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const references = {
  storeChainStepResult: jest.fn(),
  buildChainVariables: jest.fn().mockReturnValue({}),
  clearChainStepResults: jest.fn(),
};

interface StoreInternals {
  cleanupIntervalHandle: NodeJS.Timeout | undefined;
  injectedDbEngine: unknown;
  writeSessions: () => Promise<void>;
}

function buildStore(write: () => Promise<void>): {
  store: ChainSessionStore;
  internals: StoreInternals;
} {
  const store = new ChainSessionStore(createLogger(), references as never, {});
  const internals = store as unknown as StoreInternals;
  // A bound port is what makes the final save a write that can be lost; `write` stands in for it.
  internals.injectedDbEngine = {};
  internals.writeSessions = write;
  return { store, internals };
}

describe('ChainSessionStore.cleanup() final save', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a store with no database port has no write to lose and cleans up quietly', async () => {
    const store = new ChainSessionStore(createLogger(), references as never, {});

    await expect(store.cleanup()).resolves.toBeUndefined();
  });

  test('persists and clears the scheduler when the save succeeds (positive control)', async () => {
    const write = jest.fn(async () => undefined);
    const { store, internals } = buildStore(write);
    expect(internals.cleanupIntervalHandle).toBeDefined();

    await store.cleanup();

    expect(write).toHaveBeenCalledTimes(1);
    expect(internals.cleanupIntervalHandle).toBeUndefined();
  });

  test('rejects with the save failure and still stops the scheduler', async () => {
    const failure = new Error('disk I/O error');
    const { store, internals } = buildStore(async () => {
      throw failure;
    });
    expect(internals.cleanupIntervalHandle).toBeDefined();

    await expect(store.cleanup()).rejects.toBe(failure);

    expect(internals.cleanupIntervalHandle).toBeUndefined();
  });

  test('rejects on a held lock, which no later persist will heal', async () => {
    const locked = Object.assign(new Error('database is locked'), { errcode: 5 });
    const { store } = buildStore(async () => {
      throw locked;
    });

    await expect(store.cleanup()).rejects.toBe(locked);
  });
});
