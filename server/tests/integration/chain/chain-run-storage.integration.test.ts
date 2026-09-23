// @lifecycle test - P3 Tier 4: per-row chain run storage replaces the chain_run_registry blob.
/**
 * Storage-swap equivalence, driven against the REAL `SqliteEngine` schema rather than a mirrored
 * CREATE TABLE. A mirror proves the store agrees with the mirror; the point here is that the
 * store agrees with what a server actually creates, because the defect this tier removes was a
 * storage shape, not a query.
 *
 * The cold-load case constructs a second `ChainSessionStore` over the same database file. Both
 * live in one process, so both resolve the same `run_owner_pid`, which is what makes the second
 * store's `loadSessions()` a genuine reconstruction from rows rather than a memory hand-off.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { RemainderProcessor } from '../../../src/engine/execution/capture/remainder-processor.js';
import { parseAppendCommand } from '../../../src/engine/execution/parsers/append-command-parser.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { DEFAULT_WORKFLOW_CAPS } from '../../../src/modules/workflow-ir/node-schema.js';
import { validateWorkflowIR } from '../../../src/modules/workflow-ir/validator.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore, MAX_REMAINDERS_PER_RUN } from '../../../src/modules/chains/manager.js';
import { DirectChainRunRegistry } from '../../../src/modules/chains/run-registry.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainNode } from '../../../src/shared/types/chain-execution.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { RemainderSubmission } from '../../../src/modules/workflow-ir/types.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

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

const nodes = (...specs: Array<[string, string, string]>): ChainNode[] =>
  specs.map(([id, promptId, stepName]) => ({ id, promptId, stepName }));

describe('chain run storage (chain_runs + chain_run_nodes)', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;

  const newStore = (): ChainSessionStore =>
    new ChainSessionStore(
      logger,
      new StubTextReferenceStore() as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-storage' } },
      engine
    );

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chain-run-storage-'));
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

  beforeEach(() => {
    engine.run('DELETE FROM chain_run_nodes');
    engine.run('DELETE FROM chain_runs');
    engine.run('DELETE FROM chain_sessions');
    engine.run('DELETE FROM execution_records');
  });

  test('the v22 schema declares both run tables and no longer declares the retired blob', () => {
    expect(engine.getSchemaVersion()).toBe(31);

    const tables = engine
      .query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((row) => row.name);

    expect(tables).toContain('chain_runs');
    expect(tables).toContain('chain_run_nodes');
    expect(tables).not.toContain('chain_run_registry');
  });

  test('a run survives a cold load with nodes, milestones, ledger, order and status intact', async () => {
    const writer = newStore();
    await writer.createSession('sess-rt', 'chain-rt#1', 3, { topic: 'storage' }, {
      nodes: nodes(
        ['n1', 'prompt-a', 'Gather'],
        ['n2', 'prompt-b', 'Analyze'],
        ['n3', 'prompt-c', 'Report']
      ),
    } as never);

    await writer.completeStep('sess-rt', 'n1');
    await writer.advanceStep('sess-rt', 'n1');
    writer.setStepState('sess-rt', 'n2', 'rendered', true);
    await writer.applyUnknownObservations('sess-rt', 'n2', [
      { type: 'unknown_discovered', id: 'schema-shape', statement: 'row or blob?', blocking: true },
    ]);
    // Force the write rather than relying on the fire-and-forget scheduler.
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    const before = writer.getSession('sess-rt') as ChainSession;
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;
    const after = reader.getSession('sess-rt') as ChainSession;

    expect(after).toBeDefined();
    expect(after.chainId).toBe('chain-rt#1');
    expect(after.state.nodes).toEqual(before.state.nodes);
    expect(after.state.currentNodeId).toBe(before.state.currentNodeId);
    expect(after.state.currentNodeId).toBe('n2');
    expect(after.executionOrder).toEqual(before.executionOrder);
    expect(after.executionOrder).toEqual(['n1']);
    expect(after.runStatus).toBe(before.runStatus);
    expect(after.originalArgs).toEqual({ topic: 'storage' });
    expect(after.unknownsLedger).toEqual(before.unknownsLedger);
    expect(after.startTime).toBe(before.startTime);

    // Milestones are rows now (OQ3), and the substate a lifecycle alone cannot express — a
    // placeholder step and a genuinely completed one both read a StepLifecycle — comes back too.
    expect(after.state.stepStates?.get('n1')).toEqual(before.state.stepStates?.get('n1'));
    expect(after.state.stepStates?.get('n2')).toEqual(before.state.stepStates?.get('n2'));
    expect(after.state.stepStates?.get('n2')?.isPlaceholder).toBe(true);

    await reader.cleanup();
  });

  test('a spawned detached node survives a cold load and still holds the run open (v31)', async () => {
    // Tier 4: the worker's result can arrive after the process that rendered the brief is gone,
    // so the obligation must be on the row, not only in memory.
    const writer = newStore();
    await writer.createSession('sess-detached', 'chain-detached#1', 2, {}, {
      nodes: nodes(['n1', 'prompt-a', 'Gather'], ['rev', 'prompt-b', 'Review']),
    } as never);
    await writer.completeStep('sess-detached', 'n1');
    await writer.advanceStep('sess-detached', 'n1');
    expect(await writer.markNodeSpawned('sess-detached', 'rev')).toBe(true);
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    const raw = engine.queryOne<{ spawned_at: number | null }>(
      'SELECT spawned_at FROM chain_run_nodes WHERE session_id = ? AND node_id = ?',
      ['sess-detached', 'rev']
    );
    expect(raw?.spawned_at).toEqual(expect.any(Number));
    // Control: a node never spawned binds NULL, not a default.
    const blocking = engine.queryOne<{ spawned_at: number | null }>(
      'SELECT spawned_at FROM chain_run_nodes WHERE session_id = ? AND node_id = ?',
      ['sess-detached', 'n1']
    );
    expect(blocking?.spawned_at).toBeNull();
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;
    expect(reader.getStepState('sess-detached', 'rev')?.spawnedAt).toBe(raw?.spawned_at);

    // Passing the last node on the RELOADED run does not complete it — the guard read the row.
    // What passing a detached node writes (`StepCaptureService.passDetachedNode`): a placeholder.
    await reader.updateSessionState('sess-detached', 'rev', 'placeholder', { isPlaceholder: true });
    await reader.completeStep('sess-detached', 'rev', { preservePlaceholder: true });
    await reader.advanceStep('sess-detached', 'rev');
    const held = reader.getSession('sess-detached') as ChainSession;
    expect(held.state.currentNodeId).toBeNull();
    expect(held.runStatus ?? 'working').toBe('working');

    // The report lands (a real output) and the held run completes.
    await reader.updateSessionState('sess-detached', 'rev', 'late result', {
      isPlaceholder: false,
    });
    await reader.completeStep('sess-detached', 'rev');
    expect(await reader.completeHeldRun('sess-detached')).toBe(true);
    expect((reader.getSession('sess-detached') as ChainSession).runStatus).toBe('completed');
    await reader.cleanup();
  });

  test("a detached node's gate review is keyed by node beside the current-step slot, survives a cold load, and holds the run (row 4.8)", async () => {
    const review = (gateId: string) =>
      ({
        combinedPrompt: '',
        gateIds: [gateId],
        prompts: [],
        createdAt: 1,
        attemptCount: 0,
        maxAttempts: 2,
      }) as never;
    const writer = newStore();
    await writer.createSession('sess-dreview', 'chain-dreview#1', 2, {}, {
      nodes: nodes(['n1', 'prompt-a', 'Gather'], ['rev', 'prompt-b', 'Review']),
    } as never);
    await writer.completeStep('sess-dreview', 'n1');
    await writer.advanceStep('sess-dreview', 'n1');
    await writer.markNodeSpawned('sess-dreview', 'rev');
    // The parent moves past the detached node (placeholder), then its late result lands.
    await writer.updateSessionState('sess-dreview', 'rev', 'placeholder', { isPlaceholder: true });
    await writer.completeStep('sess-dreview', 'rev', { preservePlaceholder: true });
    await writer.advanceStep('sess-dreview', 'rev');
    await writer.updateSessionState('sess-dreview', 'rev', 'late result', { isPlaceholder: false });
    await writer.completeStep('sess-dreview', 'rev');
    // Two reviews at once: the current-step slot and the detached node's, each found by its key.
    // The run stands past its end, so the slot review names the node it grades: keyed by the
    // node the run last left, it would land on `rev`'s own review, which the store refuses.
    await writer.setPendingGateReview('sess-dreview', {
      ...(review('slot-gate') as object),
      nodeId: 'n1',
    } as never);
    await writer.setPendingGateReview('sess-dreview', review('node-gate'), { nodeId: 'rev' });
    await writer.clearPendingGateReview('sess-dreview');
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;
    expect(reader.getPendingGateReview('sess-dreview')).toBeUndefined();
    expect(reader.getPendingGateReview('sess-dreview', { nodeId: 'rev' })?.gateIds).toEqual([
      'node-gate',
    ]);
    // Reported, nothing owed — and still held: the open review is what holds it.
    expect(await reader.completeHeldRun('sess-dreview')).toBe(false);
    expect((reader.getSession('sess-dreview') as ChainSession).runStatus ?? 'working').toBe(
      'working'
    );

    // A PASS on the node's review deletes only that review, and the held run then completes.
    const outcome = await reader.recordGateReviewOutcome(
      'sess-dreview',
      { verdict: 'PASS', rawVerdict: 'PASS' },
      { nodeId: 'rev' }
    );
    expect(outcome).toBe('cleared');
    expect(reader.getPendingGateReview('sess-dreview', { nodeId: 'rev' })).toBeUndefined();
    expect(await reader.completeHeldRun('sess-dreview')).toBe(true);
    expect((reader.getSession('sess-dreview') as ChainSession).runStatus).toBe('completed');
    await reader.cleanup();
  });

  describe('gate reviews: one store keyed by the node each grades (primitive-rework row 3.1)', () => {
    const review = (gateId: string, extra: Record<string, unknown> = {}) =>
      ({
        combinedPrompt: '',
        gateIds: [gateId],
        prompts: [],
        createdAt: 1,
        attemptCount: 0,
        maxAttempts: 2,
        ...extra,
      }) as never;
    const residualOf = (sessionId: string): Record<string, unknown> =>
      JSON.parse(
        engine.query<{ state: string }>('SELECT state FROM chain_runs WHERE session_id = ?', [
          sessionId,
        ])[0]!.state
      ) as Record<string, unknown>;
    const persist = (store: ChainSessionStore) =>
      (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();
    const coldLoad = async (): Promise<ChainSessionStore> => {
      const reader = newStore();
      await (reader as unknown as { initPromise: Promise<void> }).initPromise;
      return reader;
    };
    const threeNodes = () =>
      ({
        nodes: nodes(
          ['n1', 'prompt-a', 'One'],
          ['rev', 'prompt-b', 'Two'],
          ['n3', 'prompt-c', 'Three']
        ),
      }) as never;

    test('a current-step and a detached review are written, read by node, and round-trip a cold load', async () => {
      const writer = newStore();
      await writer.createSession('sess-rv', 'chain-rv#1', 3, {}, threeNodes());
      await writer.setPendingGateReview('sess-rv', review('slot-gate'));
      await writer.setPendingGateReview('sess-rv', review('node-gate'), { nodeId: 'rev' });

      const written = writer.getSession('sess-rv') as ChainSession;
      expect(Object.keys(written.reviews ?? {}).sort()).toEqual(['n1', 'rev']);
      expect(written.reviews?.['n1']).toMatchObject({
        nodeId: 'n1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        gateIds: ['slot-gate'],
      });
      expect(written.reviews?.['rev']).toMatchObject({
        nodeId: 'rev',
        kind: 'detached',
        phase: 'awaiting-verdict',
        gateIds: ['node-gate'],
      });
      // The projections read the one store.
      expect(written.pendingGateReview).toBe(written.reviews?.['n1']);
      expect(Object.keys(written.detachedGateReviews ?? {})).toEqual(['rev']);

      await persist(writer);
      // The residual document carries only `reviews`.
      const residual = residualOf('sess-rv');
      expect(Object.keys(residual.reviews as object).sort()).toEqual(['n1', 'rev']);
      expect(residual).not.toHaveProperty('pendingGateReview');
      expect(residual).not.toHaveProperty('detachedGateReviews');
      await writer.cleanup();

      const reader = await coldLoad();
      const loaded = reader.getSession('sess-rv') as ChainSession;
      expect(loaded.reviews).toEqual(written.reviews);
      expect(reader.getPendingGateReview('sess-rv')?.gateIds).toEqual(['slot-gate']);
      expect(reader.getPendingGateReview('sess-rv', { nodeId: 'rev' })?.gateIds).toEqual([
        'node-gate',
      ]);
      // A slot addresses detached reviews only: the current step's is not reachable through one.
      expect(reader.getPendingGateReview('sess-rv', { nodeId: 'n1' })).toBeUndefined();
      await reader.cleanup();
    });

    test('a structural review is keyed by the node it grades, and one current-step review replaces another', async () => {
      const store = newStore();
      await store.createSession('sess-rs', 'chain-rs#1', 3, {}, threeNodes());
      await store.completeStep('sess-rs', 'n1');
      await store.advanceStep('sess-rs', 'n1');
      // Standing on `rev`, the phase guard grades `n1` — the node its metadata names.
      await store.setPendingGateReview(
        'sess-rs',
        review('phase-guard', {
          metadata: { source: 'phase-guard-verification', nodeId: 'n1', stepNumber: 1 },
        })
      );
      const structural = store.getSession('sess-rs') as ChainSession;
      expect(Object.keys(structural.reviews ?? {})).toEqual(['n1']);
      expect(structural.reviews?.['n1']?.kind).toBe('structural');
      expect(structural.pendingGateReview?.gateIds).toEqual(['phase-guard']);

      // A gate review of the node the run stands on takes the one current-step slot.
      await store.setPendingGateReview('sess-rs', review('step-gate'));
      const replaced = store.getSession('sess-rs') as ChainSession;
      expect(Object.keys(replaced.reviews ?? {})).toEqual(['rev']);
      expect(replaced.reviews?.['rev']?.kind).toBe('gate');

      await store.clearPendingGateReview('sess-rs');
      expect((store.getSession('sess-rs') as ChainSession).reviews).toBeUndefined();
      await store.cleanup();
    });

    test("the store keeps a review's phase in step with its attempts", async () => {
      const store = newStore();
      await store.createSession('sess-rp', 'chain-rp#1', 3, {}, threeNodes());
      await store.setPendingGateReview('sess-rp', review('g'));
      const fail = { verdict: 'FAIL' as const, rawVerdict: 'FAIL' };
      await store.recordGateReviewOutcome('sess-rp', fail);
      expect(store.getPendingGateReview('sess-rp')?.phase).toBe('awaiting-verdict');
      await store.recordGateReviewOutcome('sess-rp', fail);
      expect(store.getPendingGateReview('sess-rp')?.phase).toBe('exhausted');
      await store.resetRetryCount('sess-rp');
      expect(store.getPendingGateReview('sess-rp')?.phase).toBe('awaiting-verdict');
      await store.cleanup();
    });

    test('setReview writes a GateReview at its own node', async () => {
      const store = newStore();
      await store.createSession('sess-rn', 'chain-rn#1', 3, {}, threeNodes());
      await store.setReview('sess-rn', {
        ...(review('g') as object),
        nodeId: 'n3',
        kind: 'gate',
        phase: 'awaiting-verdict',
      } as never);
      const session = store.getSession('sess-rn') as ChainSession;
      expect(Object.keys(session.reviews ?? {})).toEqual(['n3']);
      // Not the node the run stands on, and still the run's current-step review.
      expect(session.pendingGateReview?.nodeId).toBe('n3');
      await store.cleanup();
    });

    test('the projections are read-only and never serialized', async () => {
      const store = newStore();
      const session = await store.createSession('sess-ro', 'chain-ro#1', 3, {}, threeNodes());
      await store.setPendingGateReview('sess-ro', review('g'));
      expect(() => {
        (session as { pendingGateReview?: unknown }).pendingGateReview = undefined;
      }).toThrow(TypeError);
      expect(() => {
        (session as { detachedGateReviews?: unknown }).detachedGateReviews = {};
      }).toThrow(TypeError);
      expect(Object.keys(session)).not.toContain('pendingGateReview');
      expect(Object.keys(session)).toContain('reviews');
      await store.cleanup();
    });

    test('a run persisted before `reviews` existed loads its reviews into the store (legacy residual)', async () => {
      const writer = newStore();
      await writer.createSession('sess-lg', 'chain-lg#1', 3, {}, threeNodes());
      await persist(writer);
      await writer.cleanup();
      // Rewrite the residual into the pre-3.1 shape: the current-step slot and 4.8's detached map.
      const legacy = { ...residualOf('sess-lg') };
      legacy.pendingGateReview = review('slot-gate');
      legacy.detachedGateReviews = {
        rev: review('node-gate', { metadata: { phase: 'awaiting-replacement' }, attemptCount: 1 }),
      };
      engine.run('UPDATE chain_runs SET state = ? WHERE session_id = ?', [
        JSON.stringify(legacy),
        'sess-lg',
      ]);

      const reader = await coldLoad();
      const loaded = reader.getSession('sess-lg') as ChainSession;
      expect(loaded.reviews?.['n1']).toMatchObject({
        nodeId: 'n1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        gateIds: ['slot-gate'],
      });
      expect(loaded.reviews?.['rev']).toMatchObject({
        nodeId: 'rev',
        kind: 'detached',
        phase: 'awaiting-replacement',
        attemptCount: 1,
      });
      // One-way: the next write persists only the new shape.
      await persist(reader);
      const rewritten = residualOf('sess-lg');
      expect(Object.keys(rewritten.reviews as object).sort()).toEqual(['n1', 'rev']);
      expect(rewritten).not.toHaveProperty('pendingGateReview');
      expect(rewritten).not.toHaveProperty('detachedGateReviews');
      await reader.cleanup();
    });
  });

  test('node rows carry position, prompt and milestone per node, in run order', async () => {
    const store = newStore();
    await store.createSession('sess-rows', 'chain-rows#1', 2, {}, {
      nodes: nodes(['na', 'prompt-a', 'First'], ['nb', 'prompt-b', 'Second']),
    } as never);
    await store.completeStep('sess-rows', 'na');
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    const rows = engine.query<{
      node_id: string;
      position: number;
      prompt_id: string;
      step_name: string | null;
      milestone: string | null;
    }>(
      `SELECT node_id, position, prompt_id, step_name, milestone
         FROM chain_run_nodes WHERE session_id = ? ORDER BY position`,
      ['sess-rows']
    );

    expect(rows.map((r) => [r.node_id, r.position, r.prompt_id, r.step_name])).toEqual([
      ['na', 1, 'prompt-a', 'First'],
      ['nb', 2, 'prompt-b', 'Second'],
    ]);
    expect(rows[0]?.milestone).toBe('completed');

    await store.cleanup();
  });

  test('current_node_id is the only stored copy — the residual document does not carry it', async () => {
    const store = newStore();
    await store.createSession('sess-single', 'chain-single#1', 2, {}, {
      nodes: nodes(['n1', 'p', 'One'], ['n2', 'p', 'Two']),
    } as never);
    await store.advanceStep('sess-single', 'n1');
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    const row = engine.queryOne<{ current_node_id: string | null; state: string }>(
      'SELECT current_node_id, state FROM chain_runs WHERE session_id = ?',
      ['sess-single']
    );

    expect(row?.current_node_id).toBe('n2');
    // Two copies of one fact with no gate between them is the drift shape the column replaces.
    expect(JSON.parse(row?.state ?? '{}')).not.toHaveProperty('currentNodeId');

    await store.cleanup();
  });

  test('run history and latest-run lookup are rebuilt from the chain id columns', async () => {
    const writer = newStore();
    await writer.createSession('sess-r1', 'chain-hist#1', 1, {}, {
      nodes: nodes(['n1', 'p', 'Only']),
    } as never);
    await writer.createSession('sess-r2', 'chain-hist#2', 1, {}, {
      nodes: nodes(['n1', 'p', 'Only']),
    } as never);
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;

    // Nothing persisted these — they are rebuilt from chain_id via stripRunNumber at load.
    expect(reader.getRunHistory('chain-hist')).toEqual(['chain-hist#1', 'chain-hist#2']);
    // chainSessionMapping is rebuilt too — resolving a run chain id back to its session id only
    // works if the inverted index came back. `includeDormant` because a loaded run stays dormant
    // until explicitly resumed, which the storage swap does not change.
    expect(
      reader.getSessionByChainIdentifier('chain-hist#2', { includeDormant: true })?.sessionId
    ).toBe('sess-r2');
    expect(
      reader.getSessionByChainIdentifier('chain-hist#1', { includeDormant: true })?.sessionId
    ).toBe('sess-r1');
    expect(
      engine.queryOne<{ base_chain_id: string }>(
        'SELECT base_chain_id FROM chain_runs WHERE session_id = ?',
        ['sess-r2']
      )?.base_chain_id
    ).toBe('chain-hist');

    await reader.cleanup();
  });

  test('the hook projection is still written in the same transaction as the run rows', async () => {
    const store = newStore();
    await store.createSession('sess-hook', 'chain-hook#1', 2, {}, {
      nodes: nodes(['n1', 'p', 'One'], ['n2', 'p', 'Two']),
    } as never);
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    const runCount = engine.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM chain_runs WHERE session_id = ?',
      ['sess-hook']
    );
    const hookRow = engine.queryOne<{ state: string; run_status: string }>(
      'SELECT state, run_status FROM chain_sessions WHERE chain_id = ?',
      ['chain-hook#1']
    );

    expect(runCount?.c).toBe(1);
    expect(hookRow).not.toBeNull();
    // The projection stays integer-keyed: its keys are a cross-repo Python contract.
    expect(JSON.parse(hookRow?.state ?? '{}')).toMatchObject({ currentStep: 1, totalSteps: 2 });

    await store.cleanup();
  });

  test('a failing hook projection rolls the run rows back with it', async () => {
    // The discriminating case for "same transaction": the run rows are written FIRST, so if the
    // projection throws afterwards and the write is not inside the caller's transaction, the run
    // survives and the hook view does not. A rollback that leaves rows behind is a lie.
    const failing: DatabasePort = {
      isInitialized: () => engine.isInitialized(),
      initialize: async () => engine.initialize(),
      query: (sql, params) => engine.query(sql, params),
      queryOne: (sql, params) => engine.queryOne(sql, params),
      run: (sql, params) => {
        if (sql.includes('INSERT INTO chain_sessions')) {
          throw new Error('projection failed on purpose');
        }
        engine.run(sql, params);
      },
      transaction: (fn) => engine.transaction(fn),
      beginTransaction: () => engine.beginTransaction(),
      commit: () => engine.commit(),
      rollback: () => engine.rollback(),
    };

    const store = new ChainSessionStore(
      logger,
      new StubTextReferenceStore() as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-storage' } },
      failing
    );
    await (store as unknown as { initPromise: Promise<void> }).initPromise;
    // Two steps, not one: `isSessionActiveForHooks` only projects a run with steps remaining,
    // so a single-step run never reaches the INSERT this test makes fail.
    await store.createSession('sess-rollback', 'chain-rollback#1', 2, {}, {
      nodes: nodes(['n1', 'p', 'One'], ['n2', 'p', 'Two']),
    } as never);
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    expect(
      engine.query('SELECT session_id FROM chain_runs WHERE session_id = ?', ['sess-rollback'])
    ).toHaveLength(0);
    expect(
      engine.query('SELECT session_id FROM chain_run_nodes WHERE session_id = ?', ['sess-rollback'])
    ).toHaveLength(0);

    await store.cleanup();
  });

  test('deleteRunsForOwners removes a dead owner run and its nodes together', async () => {
    const registry = new DirectChainRunRegistry(engine);
    await registry.save(
      [
        {
          sessionId: 'sess-dead',
          chainId: 'chain-dead#1',
          state: {
            currentNodeId: 'n1',
            nodes: nodes(['n1', 'p', 'One']),
            lastUpdated: 1,
            stepStates: new Map(),
          },
          executionOrder: [],
          startTime: 1,
          lastActivity: 1,
          originalArgs: {},
          runStatus: 'working',
        },
      ],
      { continuityScopeId: '999999' }
    );

    expect(
      engine.query('SELECT session_id FROM chain_run_nodes WHERE session_id = ?', ['sess-dead'])
    ).toHaveLength(1);

    registry.deleteRunsForOwners(['999999']);

    expect(
      engine.query('SELECT session_id FROM chain_runs WHERE session_id = ?', ['sess-dead'])
    ).toHaveLength(0);
    // The child rows go with the parent: an orphaned node list is invisible to every query that
    // starts from chain_runs, so it would leak rather than surface.
    expect(
      engine.query('SELECT session_id FROM chain_run_nodes WHERE session_id = ?', ['sess-dead'])
    ).toHaveLength(0);
  });

  // --- P4 Tier 2: chain_run_nodes.origin / origin_unknown_id (schema v23) -------------------
  //
  // Every assertion below reads the RAW column or a cold-loaded node rather than the value that
  // was just handed in. `validate:no-phantom-columns` cannot see this column at all — it exempts
  // nothing here, but it only proves a writer NAMES the column, and this table has twice shipped
  // columns that were named and always bound NULL. The check that matters is that a real
  // 'planned'/'inserted' string comes back out of SQLite.

  test('planned nodes persist origin as a real value, not a NULL a default would hide', async () => {
    const store = newStore();
    await store.createSession('sess-origin-planned', 'chain-origin#1', 2, {}, {
      nodes: nodes(['n1', 'p', 'One'], ['n2', 'p', 'Two']),
    } as never);
    await (store as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    const rows = engine.query<{
      node_id: string;
      origin: string;
      origin_unknown_id: string | null;
    }>(
      `SELECT node_id, origin, origin_unknown_id FROM chain_run_nodes
        WHERE session_id = ? ORDER BY position`,
      ['sess-origin-planned']
    );

    expect(rows.map((row) => [row.node_id, row.origin])).toEqual([
      ['n1', 'planned'],
      ['n2', 'planned'],
    ]);
    // NULL here is the fact's absence, not an unwritten column: a planned node has no
    // originating unknown.
    expect(rows.every((row) => row.origin_unknown_id === null)).toBe(true);

    await store.cleanup();
  });

  test('an inserted node round-trips origin and its originating unknown through a cold load', async () => {
    const writer = newStore();
    await writer.createSession('sess-origin-ins', 'chain-origin#2', 2, {}, {
      nodes: nodes(['n1', 'prompt-a', 'One'], ['n2', 'prompt-b', 'Two']),
    } as never);

    const inserted = await writer.insertNodeAfter('sess-origin-ins', 'n1', {
      stepName: 'Investigate: row or blob?',
      promptId: 'investigate',
      unknownId: 'schema-shape',
    });
    expect(inserted).not.toBeNull();
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    // Raw columns first — a mapper round-trips `undefined` at both ends and looks consistent
    // while carrying nothing.
    const row = engine.queryOne<{ position: number; origin: string; origin_unknown_id: string }>(
      'SELECT position, origin, origin_unknown_id FROM chain_run_nodes WHERE session_id = ? AND node_id = ?',
      ['sess-origin-ins', inserted?.id ?? '']
    );
    expect(row?.origin).toBe('inserted');
    expect(row?.origin_unknown_id).toBe('schema-shape');
    // Inserted between n1 and n2, and the ids around it were not renumbered.
    expect(row?.position).toBe(2);

    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;
    const after = reader.getSession('sess-origin-ins') as ChainSession;

    expect(after.state.nodes.map((node) => node.id)).toEqual(['n1', inserted?.id, 'n2']);
    expect(after.state.nodes.map((node) => node.origin)).toEqual([
      'planned',
      'inserted',
      'planned',
    ]);
    // The per-unknown-id insertion cap is recomputed from these rows after a restart, so the
    // unknown id has to survive the cold load — not just the 'inserted' flag.
    expect(after.state.nodes[1]?.originUnknownId).toBe('schema-shape');
    expect(after.state.nodes[0]?.originUnknownId).toBeUndefined();

    await reader.cleanup();
  });

  test('a skipped node persists milestone=skipped and reconstructs after a cold load', async () => {
    const writer = newStore();
    await writer.createSession('sess-skip-rt', 'chain-skip#1', 3, {}, {
      nodes: nodes(['n1', 'p', 'One'], ['n2', 'p', 'Two'], ['n3', 'p', 'Three']),
    } as never);

    expect(await writer.markNodeSkipped('sess-skip-rt', 'n3', 'unknown-irrelevant')).toBe(true);
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();

    expect(
      engine.queryOne<{ milestone: string | null }>(
        'SELECT milestone FROM chain_run_nodes WHERE session_id = ? AND node_id = ?',
        ['sess-skip-rt', 'n3']
      )?.milestone
    ).toBe('skipped');

    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;

    expect(reader.getStepState('sess-skip-rt', 'n3')?.state).toBe('skipped');
    // The row is preserved, not deleted — ordinals around it must not shift.
    expect(
      (reader.getSession('sess-skip-rt') as ChainSession).state.nodes.map((node) => node.id)
    ).toEqual(['n1', 'n2', 'n3']);

    await reader.cleanup();
  });

  test('an unrecognized origin value reconstructs as planned instead of reaching a consumer', async () => {
    // Negative probe: the DDL says NOT NULL and v23 recreates the table, so a row like this
    // should not exist — but reconstruction narrows rather than trusts, because the alternative
    // (a node reading 'inserted' by accident) silently exhausts the P4 insertion cap.
    const registry = new DirectChainRunRegistry(engine);
    engine.run(
      `INSERT INTO chain_runs (session_id, chain_id, base_chain_id, run_owner_pid, run_status,
                               current_node_id, state, created_at, last_activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['sess-odd', 'chain-odd#1', 'chain-odd', '424242', 'working', 'n1', '{}', 1, 1]
    );
    engine.run(
      `INSERT INTO chain_run_nodes (session_id, node_id, position, prompt_id, step_name,
                                    origin, origin_unknown_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['sess-odd', 'n1', 1, 'p', 'One', 'mystery-value', null, 1]
    );

    const loaded = await registry.load({ continuityScopeId: '424242' });

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.state.nodes[0]?.origin).toBe('planned');
    expect(loaded[0]?.state.nodes[0]?.originUnknownId).toBeUndefined();
  });

  test('execution_records.node_id reads back non-NULL when a writer supplies one', () => {
    const store = new ExecutionRecordStore(engine, logger);
    store.append({
      sessionId: 'sess-ledger',
      chainId: 'chain-ledger#1',
      stepNumber: 2,
      nodeId: 'n2',
      promptId: 'prompt-b',
      status: 'working',
      scope: { workspaceId: 'ws-storage' },
    });

    // Read the raw column, not the store's mapper: a value-dead column round-trips through a
    // mapper as `undefined` at both ends and looks consistent while carrying nothing.
    const row = engine.queryOne<{ node_id: string | null; step_number: number | null }>(
      'SELECT node_id, step_number FROM execution_records WHERE session_id = ?',
      ['sess-ledger']
    );

    expect(row?.node_id).toBe('n2');
    // The ordinal is still stamped alongside it — identity did not replace the ordinal-at-write.
    expect(row?.step_number).toBe(2);
  });

  // --- Tier 1 row 1.2: ChainSessionStore.replaceRemainder -----------------------------------
  //
  // The one path both spellings of an append take (OQ-A1) and the path a replacement takes.
  // Every assertion reads either the RAW chain_run_nodes columns or a cold-loaded session, for
  // the reason the v23 block above states: a mapper round-trips `undefined` at both ends and
  // looks consistent while carrying nothing.

  const remainderSession = async (
    store: ChainSessionStore,
    sessionId: string
  ): Promise<ChainSession> => {
    await store.createSession(sessionId, `${sessionId}#1`, 3, {}, {
      nodes: nodes(['n1', 'p1', 'One'], ['n2', 'p2', 'Two'], ['n3', 'p3', 'Three']),
    } as never);
    // Stand the run on n2 so there is a real "before" (n1, executed), a real "current" (n2) and
    // a real remainder (n3) — a run parked on its first node cannot tell the three apart.
    await store.advanceStep(sessionId, 'n1');
    return store.getSession(sessionId) as ChainSession;
  };

  test("mode 'replace' swaps every node strictly after the current one and leaves the rest alone", async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-replace');

    const outcome = await store.replaceRemainder(
      'sess-rem-replace',
      [
        { promptId: 'p-alt', stepName: 'Reconsider' },
        { promptId: 'p-alt2', stepName: 'Rewrite' },
      ],
      'plan-shape',
      'replace'
    );

    expect(outcome.kind).toBe('applied');
    const session = store.getSession('sess-rem-replace') as ChainSession;
    // n1 (executed) and n2 (current) survive untouched; n3 is gone.
    expect(session.state.nodes.map((node) => node.id)).toEqual([
      'n1',
      'n2',
      'reconsider',
      'rewrite',
    ]);
    expect(session.state.nodes.slice(0, 2).map((node) => node.origin)).toEqual([
      'planned',
      'planned',
    ]);
    expect(session.state.currentNodeId).toBe('n2');

    await store.cleanup();
  });

  test("mode 'append' adds after the existing remainder rather than replacing it", async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-append');

    const outcome = await store.replaceRemainder(
      'sess-rem-append',
      [{ promptId: 'p-extra', stepName: 'Follow up' }],
      'needs-more',
      'append'
    );

    expect(outcome).toMatchObject({ kind: 'applied', mode: 'append' });
    const session = store.getSession('sess-rem-append') as ChainSession;
    // n3 — the pre-existing remainder — is still there, and the new node lands after it.
    expect(session.state.nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3', 'follow-up']);

    await store.cleanup();
  });

  test('remainder nodes persist origin and their originating unknown, and survive a cold load', async () => {
    const writer = newStore();
    await remainderSession(writer, 'sess-rem-roundtrip');

    await writer.replaceRemainder(
      'sess-rem-roundtrip',
      [{ promptId: 'p-alt', stepName: 'Reconsider' }],
      'plan-shape',
      'replace'
    );

    // replaceRemainder awaits its own persist — no manual persistSessions() here, which is what
    // makes this also a check that the write happened inside the call rather than later.
    const row = engine.queryOne<{ position: number; origin: string; origin_unknown_id: string }>(
      `SELECT position, origin, origin_unknown_id FROM chain_run_nodes
        WHERE session_id = ? AND node_id = ?`,
      ['sess-rem-roundtrip', 'reconsider']
    );
    expect(row?.origin).toBe('remainder');
    expect(row?.origin_unknown_id).toBe('plan-shape');
    expect(row?.position).toBe(3);
    // The replaced node's row went with it: a stale row would resurrect the old plan on load.
    expect(
      engine.query('SELECT node_id FROM chain_run_nodes WHERE session_id = ? AND node_id = ?', [
        'sess-rem-roundtrip',
        'n3',
      ])
    ).toHaveLength(0);

    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;
    const after = reader.getSession('sess-rem-roundtrip') as ChainSession;

    expect(after.state.nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'reconsider']);
    // 'remainder' has to survive reconstructNodeOrigin, or both caps recompute against a
    // provenance the writer never lost.
    expect(after.state.nodes[2]?.origin).toBe('remainder');
    expect(after.state.nodes[2]?.originUnknownId).toBe('plan-shape');

    await reader.cleanup();
  });

  test('the per-unknown-id cap refuses a second remainder for the same unknown', async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-cap');

    expect(
      (
        await store.replaceRemainder(
          'sess-rem-cap',
          [{ promptId: 'p-alt', stepName: 'First alternative' }],
          'plan-shape',
          'replace'
        )
      ).kind
    ).toBe('applied');

    const second = await store.replaceRemainder(
      'sess-rem-cap',
      [{ promptId: 'p-alt', stepName: 'Second alternative' }],
      'plan-shape',
      'replace'
    );

    expect(second).toEqual({ kind: 'rejected', reason: 'cap-reached' });
    // A refusal mutates nothing — the first alternative is still the plan.
    expect(
      (store.getSession('sess-rem-cap') as ChainSession).state.nodes.map((node) => node.id)
    ).toEqual(['n1', 'n2', 'first-alternative']);

    await store.cleanup();
  });

  test('the per-run ceiling refuses a remainder once distinct unknowns have spent it', async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-run-cap');

    for (const unknownId of ['first', 'second', 'third']) {
      expect(
        (
          await store.replaceRemainder(
            'sess-rem-run-cap',
            [{ promptId: 'p-alt', stepName: `Plan ${unknownId}` }],
            unknownId,
            'append'
          )
        ).kind
      ).toBe('applied');
    }

    const fourth = await store.replaceRemainder(
      'sess-rem-run-cap',
      [{ promptId: 'p-alt', stepName: 'Plan fourth' }],
      'fourth',
      'append'
    );

    expect(fourth).toEqual({ kind: 'rejected', reason: 'cap-reached' });
    expect(MAX_REMAINDERS_PER_RUN).toBe(3);

    await store.cleanup();
  });

  test('the caps are recomputed from persisted rows, so a cold-loaded run enforces them too', async () => {
    const writer = newStore();
    await remainderSession(writer, 'sess-rem-cold-cap');
    await writer.replaceRemainder(
      'sess-rem-cold-cap',
      [{ promptId: 'p-alt', stepName: 'Alternative' }],
      'plan-shape',
      'replace'
    );
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;

    // Nothing in memory remembers the first acceptance; the refusal has to come off the rows.
    expect(
      await reader.replaceRemainder(
        'sess-rem-cold-cap',
        [{ promptId: 'p-alt', stepName: 'Another' }],
        'plan-shape',
        'replace'
      )
    ).toEqual({ kind: 'rejected', reason: 'cap-reached' });

    await reader.cleanup();
  });

  test('an empty submission is refused rather than silently truncating the run', async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-empty');

    expect(await store.replaceRemainder('sess-rem-empty', [], 'plan-shape', 'replace')).toEqual({
      kind: 'rejected',
      reason: 'empty-remainder',
    });
    expect(
      (store.getSession('sess-rem-empty') as ChainSession).state.nodes.map((node) => node.id)
    ).toEqual(['n1', 'n2', 'n3']);

    await store.cleanup();
  });

  test('an unknown session and a terminal run are refused with their own reasons', async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-terminal');

    expect(
      await store.replaceRemainder(
        'sess-does-not-exist',
        [{ promptId: 'p', stepName: 'X' }],
        'u',
        'replace'
      )
    ).toEqual({ kind: 'rejected', reason: 'session-unknown' });

    // Advance past the terminal node: the run now stands on nothing, so "strictly after the
    // current node" names nothing and an append would add steps nothing reaches.
    await store.advanceStep('sess-rem-terminal', 'n2');
    await store.advanceStep('sess-rem-terminal', 'n3');

    expect(
      await store.replaceRemainder(
        'sess-rem-terminal',
        [{ promptId: 'p', stepName: 'X' }],
        'u',
        'append'
      )
    ).toEqual({ kind: 'rejected', reason: 'run-terminal' });

    await store.cleanup();
  });

  test('a replacement that would delete an already-rendered node is refused whole', async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-started');
    // n3 is in the doomed range and has already been shown to the client.
    store.setStepState('sess-rem-started', 'n3', 'rendered');

    expect(
      await store.replaceRemainder(
        'sess-rem-started',
        [{ promptId: 'p-alt', stepName: 'Reconsider' }],
        'plan-shape',
        'replace'
      )
    ).toEqual({ kind: 'rejected', reason: 'node-already-started' });

    await store.cleanup();
  });

  test('a remainder never reuses an id the run already carries, including one it replaces', async () => {
    const store = newStore();
    await remainderSession(store, 'sess-rem-ids');

    const outcome = await store.replaceRemainder(
      'sess-rem-ids',
      [
        // Declares the id of the node this very call deletes, and then asks for it twice.
        { id: 'n3', promptId: 'p-alt', stepName: 'Reuse attempt' },
        { id: 'n3', promptId: 'p-alt', stepName: 'Second reuse attempt' },
        { id: 'n1', promptId: 'p-alt', stepName: 'Executed-node id' },
      ],
      'plan-shape',
      'replace'
    );

    expect(outcome.kind).toBe('applied');
    expect(
      (store.getSession('sess-rem-ids') as ChainSession).state.nodes.map((node) => node.id)
    ).toEqual(['n1', 'n2', 'n3-2', 'n3-3', 'n1-2']);

    await store.cleanup();
  });

  // --- Tier A row A.3 / OQ-A1: one append, two spellings ------------------------------------

  /**
   * The ruling's own close condition: submit ONE append in both spellings and assert identical
   * `chain_run_nodes`.
   *
   * Driven from the two CALLER inputs — the command string and the structured `remainder` — and
   * through `RemainderProcessor`, because that is where the two paths meet. Comparing them at
   * `replaceRemainder` would compare two copies of the same argument and prove nothing; the whole
   * question OQ-A1 asks is whether the string arrives there as the same argument.
   *
   * The rows are read RAW and compared whole (minus `session_id`, the only column that must
   * differ), so a future field on `chain_run_nodes` that one spelling sets and the other does not
   * fails here without anyone remembering to assert it.
   */
  describe('OQ-A1 — the string append and the structured append are one mechanism', () => {
    const APPEND_COMMAND = '--> >>p-extra';
    const STRUCTURED: RemainderSubmission = {
      mode: 'append',
      nodes: [{ id: 'p-extra', promptId: 'p-extra' }],
    };

    const buildProcessor = (store: ChainSessionStore): RemainderProcessor =>
      new RemainderProcessor(
        store,
        { validate: validateWorkflowIR, defaultCaps: DEFAULT_WORKFLOW_CAPS },
        () => [{ id: 'p-extra', arguments: [] }] as never,
        logger
      );

    /** Stand a run on n2 with an OPEN blocking unknown, which is what entitles it to a remainder. */
    const blockedSession = async (store: ChainSessionStore, sessionId: string): Promise<void> => {
      await remainderSession(store, sessionId);
      await store.applyUnknownObservations(sessionId, 'n2', [
        {
          type: 'unknown_discovered',
          id: 'plan-shape',
          statement: 'the rest of the plan may be wrong',
          blocking: true,
        },
      ]);
    };

    const rowsFor = (sessionId: string): unknown[] =>
      engine
        .query<Record<string, unknown>>(
          'SELECT * FROM chain_run_nodes WHERE session_id = ? ORDER BY position',
          [sessionId]
        )
        .map(({ session_id: _ignored, ...rest }) => rest);

    test('both spellings write byte-identical chain_run_nodes rows', async () => {
      const store = newStore();
      const processor = buildProcessor(store);

      await blockedSession(store, 'sess-append-string');
      await blockedSession(store, 'sess-append-structured');

      const parsed = parseAppendCommand(APPEND_COMMAND);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const fromString = await processor.apply(
        'sess-append-string',
        store.getSession('sess-append-string') as ChainSession,
        { mode: 'append', nodes: parsed.nodes }
      );
      const fromStructured = await processor.apply(
        'sess-append-structured',
        store.getSession('sess-append-structured') as ChainSession,
        STRUCTURED
      );

      expect(fromString.kind).toBe('applied');
      expect(fromStructured.kind).toBe('applied');
      expect(rowsFor('sess-append-string')).toEqual(rowsFor('sess-append-structured'));
      // Bounds the comparison: two empty result sets would also be equal.
      expect(rowsFor('sess-append-string')).toHaveLength(4);

      await store.cleanup();
    });

    test('both spellings of a DELEGATED append write the declaration onto the row (row A.5)', async () => {
      // The flip condition of row A.5, read at the row rather than at the type: a `==>` in the
      // string spelling and `delegated: true` in the structured one are one declaration, and it
      // survives `projectNodes`, `mintRemainderNodes` and the INSERT.
      const store = newStore();
      const processor = buildProcessor(store);

      await blockedSession(store, 'sess-append-string-d');
      await blockedSession(store, 'sess-append-structured-d');

      const parsed = parseAppendCommand('--> ==> >>p-extra note="check"');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const fromString = await processor.apply(
        'sess-append-string-d',
        store.getSession('sess-append-string-d') as ChainSession,
        { mode: 'append', nodes: parsed.nodes }
      );
      const fromStructured = await processor.apply(
        'sess-append-structured-d',
        store.getSession('sess-append-structured-d') as ChainSession,
        {
          mode: 'append',
          nodes: [{ id: 'p-extra', promptId: 'p-extra', delegated: true, args: { note: 'check' } }],
        }
      );

      expect(fromString.kind).toBe('applied');
      expect(fromStructured.kind).toBe('applied');
      expect(rowsFor('sess-append-string-d')).toEqual(rowsFor('sess-append-structured-d'));

      // Raw columns, not the session mapper: the whole failure this row closes was a value that
      // existed at every level above the row and nowhere on it.
      const appended = engine.queryOne<{ delegated: number | null; args_json: string | null }>(
        `SELECT delegated, args_json FROM chain_run_nodes
          WHERE session_id = ? ORDER BY position DESC LIMIT 1`,
        ['sess-append-string-d']
      );
      expect(appended?.delegated).toBe(1);
      expect(JSON.parse(appended?.args_json ?? 'null')).toEqual({ note: 'check' });

      // The negative control: a planned node declares nothing, and NULL is how that reads.
      const planned = engine.queryOne<{ delegated: number | null; args_json: string | null }>(
        'SELECT delegated, args_json FROM chain_run_nodes WHERE session_id = ? AND node_id = ?',
        ['sess-append-string-d', 'n1']
      );
      expect(planned?.delegated).toBeNull();
      expect(planned?.args_json).toBeNull();

      await store.cleanup();
    });

    test('a cold load recovers the declaration, which has no other source', async () => {
      // A remainder node has no entry in `parsedCommand.steps`, so after a restart the row is
      // the only statement of what the caller declared. A reader that dropped these two would
      // resume the run with an undelegated, argument-less step and nothing would be red.
      const store = newStore();
      const processor = buildProcessor(store);
      await blockedSession(store, 'sess-append-cold');
      await processor.apply(
        'sess-append-cold',
        store.getSession('sess-append-cold') as ChainSession,
        {
          mode: 'append',
          nodes: [{ id: 'p-extra', promptId: 'p-extra', delegated: true, args: { note: 'x' } }],
        }
      );

      await store.cleanup();
      const reader = newStore();
      await (reader as unknown as { initPromise: Promise<void> }).initPromise;
      const reloaded = (reader.getSession('sess-append-cold') as ChainSession).state.nodes.at(-1);

      expect(reloaded).toMatchObject({
        promptId: 'p-extra',
        origin: 'remainder',
        delegated: true,
        args: { note: 'x' },
      });

      await reader.cleanup();
    });

    test('a node declaring a field the run could never see is refused, not silently narrowed', async () => {
      // The class, not the two operators: `subagentModel` has no reader on a synthesized step
      // either, and before row A.5 it was accepted and dropped exactly as `==>` was.
      const store = newStore();
      const processor = buildProcessor(store);
      await blockedSession(store, 'sess-append-refused');

      const outcome = await processor.apply(
        'sess-append-refused',
        store.getSession('sess-append-refused') as ChainSession,
        {
          mode: 'append',
          nodes: [{ id: 'p-extra', promptId: 'p-extra', subagentModel: 'heavy' }],
        }
      );

      expect(outcome.kind).toBe('refused');
      if (outcome.kind !== 'refused') return;
      expect(outcome.message).toContain('subagentModel');
      expect(outcome.message).toContain('delegated:true');

      await store.cleanup();
    });

    test('and both are refused identically when the run has no open blocking unknown', async () => {
      // The negative half of one mechanism. A string append that skipped the admissibility check
      // would be a SECOND mechanism wearing the same name.
      const store = newStore();
      const processor = buildProcessor(store);
      await remainderSession(store, 'sess-append-unentitled');

      const parsed = parseAppendCommand(APPEND_COMMAND);
      if (!parsed.ok) throw new Error(parsed.message);
      const session = store.getSession('sess-append-unentitled') as ChainSession;

      const fromString = await processor.apply('sess-append-unentitled', session, {
        mode: 'append',
        nodes: parsed.nodes,
      });
      const fromStructured = await processor.apply('sess-append-unentitled', session, STRUCTURED);

      expect(fromString).toEqual(fromStructured);
      expect(fromString.kind).toBe('refused');

      await store.cleanup();
    });
  });
});
