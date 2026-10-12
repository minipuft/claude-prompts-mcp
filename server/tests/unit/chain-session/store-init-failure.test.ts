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

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MANAGER_SOURCE = path.join(SERVER_ROOT, 'src/modules/chains/manager.ts');

interface UnawaitedInitOutcome {
  readonly unhandled: string[];
  readonly errors: string[];
  readonly operationRejectedWithCause: boolean | null;
}

/**
 * Build a store whose port rejects, in a fresh Node process, let the event loop turn with nothing
 * awaiting, and report what reached `unhandledRejection` and `logger.error`. `control` builds no
 * store and plants a bare rejection instead, so an empty `unhandled` is not what a deaf listener
 * would also report.
 */
function runUnawaitedInit(mode: 'control' | 'constructor' | 'late'): UnawaitedInitOutcome {
  const script = `
    const unhandled = [];
    process.on('unhandledRejection', (reason) => unhandled.push(String(reason?.message ?? reason)));
    const errors = [];
    const logger = { debug() {}, info() {}, warn() {}, error(message) { errors.push(String(message)); } };
    const failure = new Error('planted port failure');
    const port = { initialize: () => Promise.reject(failure) };
    const refs = { storeChainStepResult() {}, buildChainVariables() { return {}; }, clearChainStepResults() {} };
    let operationRejectedWithCause = null;
    if (${JSON.stringify(mode)} === 'control') {
      Promise.reject(new Error('planted unhandled rejection'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    } else {
      const { ChainSessionStore } = await import(${JSON.stringify(MANAGER_SOURCE)});
      const options = ${JSON.stringify(mode)} === 'constructor' ? { databasePort: port } : {};
      const store = new ChainSessionStore(logger, refs, options);
      if (${JSON.stringify(mode)} === 'late') store.setDatabasePort(port);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const error = await store.createSession('s-1', 'chain-a', 2).then(() => null, (e) => e);
      operationRejectedWithCause = error === failure;
    }
    process.stdout.write('OUTCOME ' + JSON.stringify({ unhandled, errors, operationRejectedWithCause }) + '\\n');
    process.exit(0);
  `;
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: SERVER_ROOT, encoding: 'utf8', timeout: 25000 }
  );
  const line = child.stdout.split('\n').find((entry) => entry.startsWith('OUTCOME '));
  if (line === undefined) {
    throw new Error(`child produced no outcome (status ${child.status}): ${child.stderr}`);
  }
  return JSON.parse(line.slice('OUTCOME '.length)) as UnawaitedInitOutcome;
}

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

  describe('when nothing awaits the failed initialization', () => {
    // A rejection nobody handles reaches `process.on('unhandledRejection')`, which `index.ts` turns
    // into an emergency shutdown. The store must log the cause once and keep the process up, while
    // every operation that awaits it still rejects.
    //
    // WHY A CHILD PROCESS. Jest intercepts unhandled rejections inside its sandbox before a
    // listener the test registers on `process` sees them — measured: a planted
    // `Promise.reject` never reached one. A plain Node process is the only place the listener
    // answers the question production asks.
    test('the listener sees a planted unhandled rejection (positive control)', () => {
      expect(runUnawaitedInit('control')).toEqual({
        unhandled: ['planted unhandled rejection'],
        errors: [],
        operationRejectedWithCause: null,
      });
    });

    test.each(['constructor', 'late'] as const)(
      'logs the cause once and raises no unhandled rejection (port bound at %s)',
      (binding) => {
        const outcome = runUnawaitedInit(binding);
        expect(outcome.unhandled).toEqual([]);
        expect(outcome.errors).toHaveLength(1);
        expect(outcome.errors[0]).toContain('ChainSessionStore');
        expect(outcome.errors[0]).toContain('planted port failure');
        expect(outcome.operationRejectedWithCause).toBe(true);
      },
      30000
    );
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
