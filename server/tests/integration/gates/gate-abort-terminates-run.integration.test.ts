// @lifecycle test - gate_action:"abort" must end the run, not merely annotate it.
/**
 * End-to-end proof that aborting at a gate is terminal, driven against the REAL
 * `SqliteEngine` + `ChainSessionStore` + `GateEnforcementAuthority` rather than mocks.
 *
 * The unit tests beside these assert that `resolveAction('abort')` CALLS `cancelChain`. That is
 * a wiring claim. It does not prove the run actually becomes unreachable, because the guard that
 * refuses a resume lives in a different file (`13-session-stage.ts`) and reads a different
 * predicate (`isRunComplete`) than the one abort writes. This test closes that gap by asserting
 * the predicate the resume guard actually consults, and by re-reading the run from a cold store
 * so the cancellation is proven to have been persisted rather than left in memory.
 *
 * The defect being locked out: abort used to set only `context.state.session.aborted`, a
 * per-request flag that stage 21 reads to write a `cancelled` execution record. The ledger said
 * the run was cancelled while `runStatus` stayed `working`, so the very next call resumed the
 * chain the user had just aborted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { isRunComplete } from '../../../src/shared/types/chain-session.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainNode } from '../../../src/shared/types/chain-execution.js';

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

const nodes = (...specs: Array<[string, string, string]>): ChainNode[] =>
  specs.map(([id, promptId, stepName]) => ({ id, promptId, stepName }));

describe('gate_action:"abort" terminates the run', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;

  const newStore = (): ChainSessionStore =>
    new ChainSessionStore(
      logger,
      new StubTextReferenceStore() as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-gate-abort' } },
      engine
    );

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-abort-'));
    logger = createLogger();
    engine = await SqliteEngine.getInstance(tmpDir, logger);
    await engine.initialize();
  });

  afterAll(async () => {
    await engine.shutdown();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  beforeEach(() => {
    engine.run('DELETE FROM chain_run_nodes');
    engine.run('DELETE FROM chain_runs');
    engine.run('DELETE FROM chain_sessions');
  });

  test('an aborted run reads as complete, so the resume guard refuses it', async () => {
    const store = newStore();
    await store.createSession('sess-abort', 'chain-abort#1', 3, {}, {
      nodes: nodes(
        ['n1', 'prompt-a', 'Gather'],
        ['n2', 'prompt-b', 'Analyze'],
        ['n3', 'prompt-c', 'Report']
      ),
    } as never);

    const authority = new GateEnforcementAuthority(store, logger);

    // Mid-run: the guard in 13-session-stage would let this resume.
    expect(isRunComplete(store.getSession('sess-abort')!)).toBe(false);

    const result = await authority.resolveAction('sess-abort', 'abort');
    expect(result.handled).toBe(true);
    expect(result.sessionAborted).toBe(true);

    // The predicate `13-session-stage.ts` consults before resuming.
    const aborted = store.getSession('sess-abort')!;
    expect(aborted.runStatus).toBe('cancelled');
    expect(isRunComplete(aborted)).toBe(true);
  });

  test('the cancellation survives a cold load — it is persisted, not in-memory only', async () => {
    const writer = newStore();
    await writer.createSession('sess-cold', 'chain-abort#2', 2, {}, {
      nodes: nodes(['n1', 'prompt-a', 'Gather'], ['n2', 'prompt-b', 'Report']),
    } as never);

    await new GateEnforcementAuthority(writer, logger).resolveAction('sess-cold', 'abort');
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;

    const reloaded = reader.getSession('sess-cold');
    expect(reloaded).toBeDefined();
    expect(reloaded!.runStatus).toBe('cancelled');
    expect(isRunComplete(reloaded!)).toBe(true);
  });

  test('retry and skip leave the run resumable', async () => {
    const store = newStore();
    await store.createSession('sess-live', 'chain-abort#3', 2, {}, {
      nodes: nodes(['n1', 'prompt-a', 'Gather'], ['n2', 'prompt-b', 'Report']),
    } as never);

    const authority = new GateEnforcementAuthority(store, logger);

    await authority.resolveAction('sess-live', 'retry');
    expect(isRunComplete(store.getSession('sess-live')!)).toBe(false);

    await authority.resolveAction('sess-live', 'skip');
    expect(isRunComplete(store.getSession('sess-live')!)).toBe(false);
  });
});
