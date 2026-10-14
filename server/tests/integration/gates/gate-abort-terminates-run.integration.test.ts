// @lifecycle test - gate_action:"abort" must end the run, not merely annotate it.
/** Real executor cancellation events with SQLite persistence; no transport/native claim. */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../src/engine/execution/pipeline/decisions/mutation/types.js';
import { PromptExecutor } from '../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';
import { HookRegistry } from '../../../src/infra/hooks/hook-registry.js';
import { McpNotificationEmitter } from '../../../src/infra/observability/notifications/mcp-notification-emitter.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { isRunComplete } from '../../../src/shared/types/chain-session.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { McpNotificationServer } from '../../../src/infra/observability/notifications/mcp-notification-emitter.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
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
}

let logger: Logger;

const nodes = (...specs: Array<[string, string, string]>): ChainNode[] =>
  specs.map(([id, promptId, stepName]) => ({ id, promptId, stepName }));

describe('gate_action:"abort" terminates the run', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  const executors: PromptExecutor[] = [];
  const scope = { workspaceId: 'ws-gate-abort', organizationId: 'org-abort' };
  const extras = { _sdkExtra: { http: { authInfo: { extra: scope } } } };
  const newExecutor = async () => {
    const config = {
      getConfig: () => ({ identity: { launchDefaults: { workspaceId: scope.workspaceId } } }),
      getChainSessionConfig: () => undefined,
    };
    const textStore = new StubTextReferenceStore();
    const executor = new PromptExecutor(
      logger,
      {} as never,
      config as never,
      textStore as never,
      {} as never,
      undefined,
      undefined,
      engine
    );
    executor.setDatabasePort(engine);
    executors.push(executor);
    const store = executor.getChainSessionStore() as ChainSessionStore;
    await (store as unknown as { initPromise: Promise<void> }).initPromise;
    const hooks = new HookRegistry(logger);
    const failed = jest.spyOn(hooks, 'emitChainFailed');
    const emitter = new McpNotificationEmitter(logger);
    const sent = jest
      .fn<McpNotificationServer['notification']>()
      .mockImplementation(async () => {});
    emitter.setServer({ notification: sent });
    executor.setHookRegistry(hooks);
    executor.setNotificationEmitter(emitter);
    const pipeline = jest.spyOn(
      executor as unknown as { getPromptExecutionPipeline: () => unknown },
      'getPromptExecutionPipeline'
    );
    return { executor, store, failed, sent, pipeline, textStore };
  };

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
    engine = await SqliteEngine.getInstance(logger, {
      dbPath: path.join(tmpDir, 'runtime-state', 'state.db'),
    });
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

  afterEach(async () => {
    for (const executor of executors.splice(0)) await executor.getChainSessionStore().cleanup();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    engine.run('DELETE FROM execution_records');
    engine.run('DELETE FROM chain_run_nodes');
    engine.run('DELETE FROM chain_runs');
    engine.run('DELETE FROM chain_sessions');
  });

  test.each(['active', 'blocking-unknown-paused', 'ordinary-review', 'detached-held'] as const)(
    'source fixture %s: canonical abort retains state and ends the run exactly once',
    async (state) => {
      const { executor, store, failed, sent, pipeline, textStore } = await newExecutor();
      const sessionId = `fixture-${state}`;
      const session = await store.createSession(
        sessionId,
        `chain-fixture-${state}#1`,
        3,
        { seededArtifact: `input-${state}` },
        {
          ...scope,
          nodes: nodes(['n1', 'a', 'Captured'], ['n2', 'b', 'Current'], ['n3', 'c', 'Detached']),
          blueprint: {
            parsedCommand: { promptId: 'fixture-owner', budget: { pauseOnBlocking: true } },
            executionPlan: {},
          },
        } as never
      );
      // These are persisted source fixtures, not runs driven through the pipeline.
      await store.updateSessionState(sessionId, 'n1', `fixture-output-${state}`);
      await store.completeStep(sessionId, 'n1');
      await store.advanceStep(sessionId, 'n1');
      if (state === 'blocking-unknown-paused') {
        await store.applyUnknownObservations(sessionId, 'n2', [
          {
            type: 'unknown_discovered',
            id: 'fixture-unknown',
            statement: 'Unresolved fixture',
            blocking: true,
            target_step_id: 'n2',
          },
        ]);
      }
      if (state === 'ordinary-review' || state === 'blocking-unknown-paused') {
        await store.setReview(sessionId, {
          nodeId: 'n2',
          kind: 'gate',
          phase: 'awaiting-verdict',
          combinedPrompt: 'Fixture hold',
          gateIds: [state === 'ordinary-review' ? 'fixture-gate' : UNKNOWN_INTERRUPT_GATE_ID],
          prompts: [],
          createdAt: 1,
          attemptCount: 0,
          maxAttempts: 2,
          previousResponse: `seeded-review-artifact-${state}`,
        });
        expect(store.getReview(sessionId, 'n2')?.attemptCount).toBe(0);
      }
      if (state === 'detached-held') {
        await store.markNodeSpawned(sessionId, 'n3');
        await store.advanceStep(sessionId, 'n2');
        await store.advanceStep(sessionId, 'n3');
        expect(session.state.currentNodeId).toBeNull();
        expect(session.state.stepStates?.get('n3')?.spawnedAt).toBeDefined();
        expect(session.state.stepStates?.get('n3')?.respondedAt).toBeUndefined();
      }
      expect(isRunComplete(session)).toBe(false);
      const preserved = (run: ChainSession) => ({
        nodes: run.state.nodes,
        currentNodeId: run.state.currentNodeId,
        stepStates: [...(run.state.stepStates ?? [])],
        executionOrder: run.executionOrder,
        originalArgs: run.originalArgs,
        reviews: run.reviews,
        unknownsLedger: run.unknownsLedger,
        blueprint: run.blueprint,
      });
      const before = structuredClone(preserved(session));
      const captureWrites = textStore.storeChainStepResult.mock.calls.length;
      const ended = jest.fn();
      store.onRunEnded(ended);
      const call = { chain_id: session.chainId, gate_action: 'abort' as const };
      expect(Object.keys(call).sort()).toEqual(['chain_id', 'gate_action']);
      const result = await executor.executePromptCommand(call, extras);
      expect(result.isError).toBe(false);
      expect(pipeline).not.toHaveBeenCalled();
      expect(session.runStatus).toBe('cancelled');
      expect(preserved(session)).toEqual(before);
      expect(
        engine.queryOne('SELECT run_status FROM chain_runs WHERE session_id = ?', [sessionId])
      ).toEqual({ run_status: 'cancelled' });
      expect(ended).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          status: 'cancelled',
          chainId: session.chainId,
          completedAt: session.runCompletedAt,
          scope: expect.objectContaining(scope),
        })
      );
      expect((await executor.executePromptCommand(call, extras)).isError).toBe(false);
      expect(ended).toHaveBeenCalledTimes(1);
      expect(failed).toHaveBeenCalledTimes(1);
      expect(sent).toHaveBeenCalledTimes(1);
      expect(sent).toHaveBeenCalledWith({
        method: 'notifications/chain/complete',
        params: expect.objectContaining({ status: 'cancelled', chainId: session.chainId }),
      });
      expect(pipeline).not.toHaveBeenCalled();
      expect(textStore.storeChainStepResult).toHaveBeenCalledTimes(captureWrites);
      expect(textStore.clearChainStepResults).not.toHaveBeenCalled();
      expect(executor.getExecutionRecordStore()!.queryBySession(sessionId, scope)).toEqual([
        expect.objectContaining({ status: 'cancelled', chainId: session.chainId }),
      ]);
      const reader = newStore();
      try {
        await (reader as unknown as { initPromise: Promise<void> }).initPromise;
        const reloaded = reader.getSession(sessionId)!;
        expect(reloaded.runStatus).toBe('cancelled');
        expect(isRunComplete(reloaded)).toBe(true);
        expect(preserved(reloaded)).toEqual(before);
      } finally {
        await reader.cleanup();
      }
    }
  );

  test('an aborted run reads as complete, so the resume guard refuses it', async () => {
    const store = newStore();
    await store.createSession('sess-abort', 'chain-abort#1', 3, {}, {
      ...scope,
      blueprint: { parsedCommand: { promptId: 'chain-owner' }, executionPlan: {} },
      nodes: nodes(
        ['n1', 'prompt-a', 'Gather'],
        ['n2', 'prompt-b', 'Analyze'],
        ['n3', 'prompt-c', 'Report']
      ),
    } as never);

    // Mid-run: the guard in 13-session-stage would let this resume.
    expect(isRunComplete(store.getSession('sess-abort')!)).toBe(false);

    await store.cleanup();
    const { executor, store: loaded, failed, sent, pipeline } = await newExecutor();
    const stale = jest.spyOn(executor.getExecutionRecordStore()!, 'append');
    executor.setDatabasePort(engine); // The eager observer must read the current port.
    const result = await executor.executePromptCommand(
      { chain_id: 'chain-abort#1', gate_action: 'abort' },
      extras
    );
    expect(result.isError).toBe(false);
    expect(pipeline).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    const aborted = loaded.getSession('sess-abort')!;
    expect(aborted.runStatus).toBe('cancelled');
    expect(isRunComplete(aborted)).toBe(true);
    expect(
      engine.queryOne('SELECT run_status FROM chain_runs WHERE session_id = ?', ['sess-abort'])
    ).toEqual({ run_status: 'cancelled' });
    const rows = executor.getExecutionRecordStore()!.queryBySession('sess-abort', scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'cancelled',
      chainId: 'chain-abort#1',
      completedAt: aborted.runCompletedAt,
      startedAt: aborted.runCompletedAt,
      stepsPlanned: 3,
      promptId: 'chain-owner',
    });
    expect(rows[0]!.nodeId).toBeUndefined();
    expect(rows[0]!.stepNumber).toBeUndefined();
    expect(rows[0]!.evidence).toBeUndefined();
    expect(rows[0]!.gateVerdicts).toEqual([]);
    expect(
      engine.queryOne(
        'SELECT tenant_id, organization_id, workspace_id, node_id, step_number, evidence_json FROM execution_records'
      )
    ).toEqual({
      tenant_id: scope.workspaceId,
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      node_id: null,
      step_number: null,
      evidence_json: null,
    });
    await executor.executePromptCommand(
      { chain_id: 'chain-abort#1', gate_action: 'abort' },
      extras
    );
    expect(executor.getExecutionRecordStore()!.queryBySession('sess-abort', scope)).toHaveLength(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith({
      method: 'notifications/chain/complete',
      params: expect.objectContaining({ status: 'cancelled', chainId: 'chain-abort#1' }),
    });
  });

  test('the cancellation survives a cold load — it is persisted, not in-memory only', async () => {
    const writer = newStore();
    await writer.createSession('sess-cold', 'chain-abort#2', 2, {}, {
      ...scope,
      nodes: nodes(['n1', 'prompt-a', 'Gather'], ['n2', 'prompt-b', 'Report']),
    } as never);

    await writer.cleanup();
    const { executor } = await newExecutor();
    await executor.executePromptCommand({ chain_id: 'chain-abort#2', gate_action: 'abort' }, {});
    const record = executor.getExecutionRecordStore()!.queryBySession('sess-cold', scope)[0];
    expect(record).toMatchObject({ status: 'cancelled', stepsPlanned: 2 });
    expect(engine.queryOne('SELECT organization_id, workspace_id FROM execution_records')).toEqual({
      organization_id: null,
      workspace_id: null,
    });

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;

    const reloaded = reader.getSession('sess-cold');
    expect(reloaded).toBeDefined();
    expect(reloaded!.runStatus).toBe('cancelled');
    expect(isRunComplete(reloaded!)).toBe(true);
    await reader.cleanup();
  });

  test('refused and clear-only operations append no cancellation event', async () => {
    const { executor, store } = await newExecutor();
    for (const status of ['completed', 'failed'] as const) {
      await store.createSession(status, `chain-${status}#1`, 1, {}, scope);
      await store.transitionRunStatus(status, status, scope);
      expect(
        (
          await executor.executePromptCommand(
            { chain_id: `chain-${status}#1`, gate_action: 'abort' },
            extras
          )
        ).isError
      ).toBe(true);
    }
    await store.createSession('other', 'chain-other#1', 1, {}, { workspaceId: 'other' });
    for (const chainId of ['chain-other#1', 'chain-missing#1']) {
      expect(
        (await executor.executePromptCommand({ chain_id: chainId, gate_action: 'abort' }, extras))
          .isError
      ).toBe(true);
    }
    expect(store.getSession('other', { workspaceId: 'other' })!.runStatus).toBe('working');
    await store.createSession('clear', 'chain-clear#1', 1, {}, scope);
    const ended = jest.fn();
    store.onRunEnded(ended);
    await store.clearSession('clear', scope);
    expect(ended).toHaveBeenCalledWith('clear');
    expect(executor.getExecutionRecordStore()!.queryRecent(100, scope)).toEqual([]);
  });

  test.each(['persist', 'record'] as const)(
    '%s failure retains the established mutation policy',
    async (fault) => {
      const { executor, store, failed, sent } = await newExecutor();
      await store.createSession('fault', 'chain-fault#1', 1, {}, scope);
      const run = engine.run.bind(engine);
      const failure = jest.spyOn(engine, 'run').mockImplementation((sql, params) => {
        if (
          sql.includes(
            fault === 'persist' ? 'INSERT INTO chain_runs' : 'INSERT INTO execution_records'
          )
        )
          throw new Error('injected write failure');
        run(sql, params);
      });
      const call = executor.executePromptCommand(
        { chain_id: 'chain-fault#1', gate_action: 'abort' },
        extras
      );
      if (fault === 'persist') {
        await expect(call).rejects.toThrow('injected write failure');
        expect(store.getSession('fault')!.runStatus).toBe('working');
        expect(
          engine.queryOne('SELECT run_status FROM chain_runs WHERE session_id = ?', ['fault'])
        ).toEqual({ run_status: 'working' });
        expect(failed).not.toHaveBeenCalled();
        expect(sent).not.toHaveBeenCalled();
      } else {
        expect((await call).isError).toBe(false);
        expect(store.getSession('fault')!.runStatus).toBe('cancelled');
        expect(failed).toHaveBeenCalledTimes(1);
        expect(sent).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to append record')
        );
      }
      failure.mockRestore();
      expect(executor.getExecutionRecordStore()!.queryRecent(100, scope)).toEqual([]);
    }
  );
});
