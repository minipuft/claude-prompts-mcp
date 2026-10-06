// @lifecycle canonical - Pins that a scoped state store's teardown writes nothing (row B.96).
/**
 * State Store Teardown Persist
 *
 * `FrameworkStateStore.shutdown()` called `await this.saveStateToFile()` with no scope. One
 * process serving several workspaces over HTTP holds one `scopedStates` entry per workspace,
 * so that call covered the launch scope and silently skipped the other N-1 — a teardown that
 * reads as a safety net and is one by construction for exactly one of its callers.
 *
 * Widening it to every scope would have been the wrong repair. The question the row forced is
 * what a final save is FOR, and the answer here is nothing: every field these stores persist
 * is written by a method that awaits `saveStateToFile(scope)` before returning, so no mutation
 * can reach teardown unpersisted. `GateStateStore.cleanup()` carried the identical unscoped
 * call, and its resolved key was the literal `default` — the pre-isolation bucket a later
 * start reads back as an operator's own choice. Both are gone.
 *
 * WHAT THIS PINS, in both directions, because a store that persists nothing at all would pass
 * a one-sided "teardown wrote nothing" assertion:
 *
 *   1. a mutator writes before it returns (the positive control — the spy observes writes)
 *   2. a teardown method writes not at all
 *   3. the teardown methods these two classes expose are exactly the two driven here, read off
 *      the prototypes rather than listed from memory, so a third one added later fails until
 *      it is covered
 *
 * Classification: Unit (two real stores over a temp SQLite file, no server).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

import {
  FrameworkStateStore,
  createFrameworkStateStore,
  type PersistedFrameworkState,
} from '../../../src/engine/frameworks/framework-state-store.js';
import {
  GateStateStore,
  type PersistedGateSystemState,
} from '../../../src/engine/gates/gate-state-store.js';
import { SqliteEngine, SqliteStateStore } from '../../../src/infra/database/index.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/** A method name that tears an instance down rather than changing its state. */
const TEARDOWN = /^(shutdown|cleanup|dispose|close|destroy)$/;

function teardownMethodsOf(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => TEARDOWN.test(name))
    .filter((name) => typeof (prototype as Record<string, unknown>)[name] === 'function')
    .sort();
}

describe('a scoped state store persists on mutation, never at teardown', () => {
  let tmpRoot: string;
  let stateDbPath: string;
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teardown-persist-'));
    fs.mkdirSync(path.join(tmpRoot, 'runtime-state'), { recursive: true });
    stateDbPath = path.join(tmpRoot, 'runtime-state', 'state.db');
    dbManager = await SqliteEngine.getInstance(createLogger() as never, { dbPath: stateDbPath });
    await dbManager.initialize();
  });

  afterAll(async () => {
    await dbManager?.shutdown();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* the temp tree is best-effort */
    }
  });

  test('the teardown surface is exactly the two methods driven below', () => {
    expect(teardownMethodsOf(FrameworkStateStore.prototype)).toEqual(['shutdown']);
    expect(teardownMethodsOf(GateStateStore.prototype)).toEqual(['cleanup']);
  });

  test('FrameworkStateStore: a toggle writes, shutdown does not', async () => {
    const logger = createLogger();
    const backing = new SqliteStateStore<PersistedFrameworkState>(
      dbManager,
      {
        tableName: 'kv_state',
        key: 'framework',
        defaultState: () => ({
          version: '1.0.0',
          frameworkSystemEnabled: false,
          activeFramework: 'CAGEERF',
          lastSwitchedAt: new Date().toISOString(),
          switchReason: 'test',
        }),
      },
      logger
    );
    const save = jest.spyOn(backing, 'save');

    const store = await createFrameworkStateStore(logger, stateDbPath, {
      stateStore: backing,
      defaultScope: { workspaceId: 'teardown-framework' },
    });

    // Positive control: the spy observes a real write, so a zero below is an absence and
    // not a spy watching a path nothing takes.
    save.mockClear();
    await store.enableFrameworkSystem('teardown-persist probe');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual({ workspaceId: 'teardown-framework' });

    save.mockClear();
    await store.shutdown();
    expect(save).toHaveBeenCalledTimes(0);
  });

  test('GateStateStore: a toggle writes, cleanup does not', async () => {
    const logger = createLogger();
    const backing = new SqliteStateStore<PersistedGateSystemState>(
      dbManager,
      {
        tableName: 'kv_state',
        key: 'gates',
        defaultState: () => ({
          enabled: true,
          enabledAt: new Date().toISOString(),
          enableReason: 'test',
          validationMetrics: {
            totalValidations: 0,
            successfulValidations: 0,
            averageValidationTime: 0,
            lastValidationTime: null,
          },
        }),
      },
      logger
    );
    const save = jest.spyOn(backing, 'save');

    const scope = { workspaceId: 'teardown-gates' };
    const store = new GateStateStore(logger, backing, { defaultScope: scope });
    await store.initialize();

    // Positive control, as above.
    save.mockClear();
    await store.disableGateSystem('teardown-persist probe', scope);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toEqual(scope);

    save.mockClear();
    await store.cleanup();
    expect(save).toHaveBeenCalledTimes(0);
  });
});
