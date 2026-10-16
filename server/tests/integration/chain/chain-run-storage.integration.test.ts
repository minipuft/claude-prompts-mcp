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

import {
  afterEach,
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
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
import { resolveReviewTarget } from '../../../src/engine/execution/pipeline/decisions/gates/review-target.js';
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

  describe('conversation pause retention', () => {
    const stores: ChainSessionStore[] = [];
    const scope = { continuityScopeId: 'caller' };
    const raw = (id: string) => ({
      runs: engine.query('SELECT * FROM chain_runs WHERE session_id = ?', [id]),
      nodes: engine.query('SELECT * FROM chain_run_nodes WHERE session_id = ? ORDER BY position', [
        id,
      ]),
    });
    const storeForTest = () => {
      const store = newStore();
      stores.push(store);
      return store;
    };
    const produce = async (store: ChainSessionStore, id: string, chainId = `chain-${id}#1`) =>
      store.createSession(
        id,
        chainId,
        1,
        { evidence: id },
        { ...scope, nodes: nodes(['n1', 'p', 'One']) }
      );
    const pause = async (store: ChainSessionStore, id: string) => {
      expect(
        await store.pauseConversation(id, store.getConversationControlScope('caller'))
      ).toMatchObject({ outcome: 'paused', token: expect.stringMatching(/^hnd_/) });
    };
    afterEach(async () => {
      for (const store of stores) await store.cleanup();
      stores.length = 0;
    });

    test('dead-owner fixture retains rows, nodes and credential before replacement initialization', async () => {
      const store = storeForTest();
      await produce(store, 'paused');
      await store.setReview('paused', {
        nodeId: 'n1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        combinedPrompt: 'frozen',
        prompts: [],
        gateIds: ['quality'],
        createdAt: 1,
        attemptCount: 1,
        maxAttempts: 3,
        reviewedOutput: 'captured evidence',
      });
      await pause(store, 'paused');
      await produce(store, 'ordinary');
      await produce(store, 'terminal');
      await pause(store, 'terminal');
      expect(await store.cancelChain('terminal', scope)).toBe(true);
      await produce(store, 'unrelated');
      await store.cleanup();
      const child = spawnSync(process.execPath, ['-e', '']);
      expect(child.status).toBe(0);
      expect(() => process.kill(child.pid, 0)).toThrow();
      engine.run("UPDATE chain_runs SET run_owner_pid = ? WHERE session_id != 'unrelated'", [
        String(child.pid),
      ]);
      engine.run(
        "UPDATE chain_runs SET run_owner_pid = 'retained-foreign' WHERE session_id = 'unrelated'"
      );
      const before = raw('paused'),
        unrelated = raw('unrelated');
      const registry = new DirectChainRunRegistry(engine);
      registry.deleteRunsForOwners([String(child.pid)]);
      expect(raw('paused')).toEqual(before);
      expect(before.runs[0]).toMatchObject({
        handoff_token: expect.stringMatching(/^hnd_/),
        organization_id: null,
        workspace_id: 'ws-storage',
      });
      for (const id of ['ordinary', 'terminal']) expect(raw(id)).toEqual({ runs: [], nodes: [] });
      const replacement = storeForTest();
      await replacement['initPromise'];
      expect(replacement.getSession('paused', scope)).toBeUndefined();
      expect(replacement.getSession('unrelated', scope)).toBeUndefined();
      await replacement.cleanup();
      expect(raw('paused')).toEqual(before);
      expect(raw('unrelated')).toEqual(unrelated);
    });

    test('ten-plus protected history does not consume the ordinary ten-run cap', async () => {
      const store = storeForTest();
      for (let i = 0; i < 12; i++) {
        await produce(store, `protected-${i}`, `chain-history#${i + 1}`);
        await pause(store, `protected-${i}`);
      }
      const held = Array.from({ length: 12 }, (_, i) => raw(`protected-${i}`));
      for (let i = 0; i < 12; i++) await produce(store, `ordinary-${i}`, `chain-history#${i + 13}`);
      expect(store.getRunHistory('chain-history')).toHaveLength(22);
      expect(Array.from({ length: 12 }, (_, i) => raw(`protected-${i}`))).toEqual(held);
      for (let i = 0; i < 12; i++) expect(raw(`ordinary-${i}`).runs).toHaveLength(i < 2 ? 0 : 1);
      await store.cleanup();
      expect(Array.from({ length: 12 }, (_, i) => raw(`protected-${i}`))).toEqual(held);
    });

    test('expiry skips only paused nonterminal runs', async () => {
      const store = storeForTest();
      const statuses: ChainSession['runStatus'][] = ['working', 'completed', 'failed', 'cancelled'];
      for (const status of statuses) {
        const held = await produce(store, status);
        await pause(store, status);
        held.runStatus = status;
        held.lastActivity = 1;
      }
      const ordinary = await produce(store, 'ordinary');
      ordinary.lastActivity = 1;
      await store['saveSessions']();
      const before = raw('working');
      expect(await store.cleanupStaleSessions()).toBe(4);
      expect(raw('working')).toEqual(before);
      for (const id of ['ordinary', 'completed', 'failed', 'cancelled'])
        expect(raw(id)).toEqual({ runs: [], nodes: [] });
    });

    test('owned dormant lookup is visible and leaves complete memory and raw rows exact', async () => {
      const store = storeForTest();
      await produce(store, 'dormant');
      await pause(store, 'dormant');
      await store.cleanup();
      const reader = storeForTest();
      await reader['initPromise'];
      const held = reader['activeSessions'].get('dormant');
      expect(held).toBeDefined();
      if (!held) throw new Error('missing owned fixture');
      held.state.currentNodeId = 'invalid-pointer';
      const memory = structuredClone(held),
        before = raw('dormant');
      expect(reader.getSession('dormant', scope)).toBe(held);
      expect(reader.getSessionByChainIdentifier(held.chainId, scope)).toBe(held);
      expect(reader.getSession('dormant', { continuityScopeId: 'other' })).toBeUndefined();
      const exact = reader.getConversationControlScope('caller');
      expect(reader.inspectConversationControl('dormant', exact)?.scope).toEqual(exact);
      expect(
        reader.inspectConversationControl('dormant', { ...exact, organizationId: 'other' })
      ).toBeUndefined();
      await reader['persistQueue'];
      expect(held).toEqual(memory);
      expect(held.lifecycle).toBe('dormant');
      expect(raw('dormant')).toEqual(before);
      await reader.cleanup();
      await reader.cleanup();
      expect(raw('dormant')).toEqual(before);
    });

    test('scoped bulk clear preflights every run, then exact abort permits ordinary clear', async () => {
      const store = storeForTest();
      await produce(store, 'peer', 'chain-clear#1');
      const held = await produce(store, 'paused', 'chain-clear#2');
      await pause(store, 'paused');
      await store.createSession('other', 'chain-clear#3', 1, {}, { continuityScopeId: 'other' });
      expect(
        await store.pauseConversation('other', store.getConversationControlScope('other'))
      ).toMatchObject({ outcome: 'paused' });
      const memory = structuredClone([...store['activeSessions']]),
        before = ['peer', 'paused', 'other'].map(raw);
      const ended = jest.fn(),
        cleared = jest.fn<() => void>();
      store.onRunEnded(ended);
      store.onSessionCleared(cleared);
      const cache = jest.spyOn(store['textReferenceStore'], 'clearChainStepResults');
      await expect(store.clearSessionsForChain('chain-clear', scope)).rejects.toThrow(
        'Abort paused run'
      );
      expect([...store['activeSessions']]).toEqual(memory);
      expect(['peer', 'paused', 'other'].map(raw)).toEqual(before);
      expect(ended).not.toHaveBeenCalled();
      expect(cleared).not.toHaveBeenCalled();
      expect(cache).not.toHaveBeenCalled();
      expect(await store.cancelChain('paused', { continuityScopeId: 'other' })).toBe(false);
      expect(raw('paused')).toEqual(before[1]);
      expect(await store.cancelChain('paused', scope)).toBe(true);
      expect(raw('paused').runs[0]).toMatchObject({
        run_status: 'cancelled',
        handoff_token: held.handoffToken,
      });
      await store.clearSessionsForChain('chain-clear', scope);
      for (const id of ['peer', 'paused']) expect(raw(id)).toEqual({ runs: [], nodes: [] });
      expect(store.getSession('other', { continuityScopeId: 'other' })).toBeDefined();
      expect(raw('other')).toEqual(before[2]);
      expect(cache).toHaveBeenCalledWith('peer');
      expect(cache).toHaveBeenCalledWith('paused');
      expect(cache).not.toHaveBeenCalledWith('other');
    });
  });

  test('conversation canonical serialization preserves every stored run and node column', async () => {
    const session: ChainSession = {
      sessionId: 'canonical',
      chainId: 'chain-canonical#3',
      continuityScopeId: 'caller',
      startTime: 10,
      lastActivity: 20,
      lifecycle: 'dormant',
      runStatus: 'input_required',
      originalArgs: { target: 'retained output' },
      executionOrder: ['n1'],
      handoffToken: 'hnd_canonical_fixture',
      gateRemap: { original: 'physical' },
      gatesFiredCount: 3,
      gateRetriesCount: 2,
      state: {
        currentNodeId: 'n2',
        lastUpdated: 30,
        nodes: [
          { id: 'n1', promptId: 'p1', stepName: 'Capture' },
          {
            id: 'n2',
            promptId: 'p2',
            stepName: 'Detached',
            origin: 'remainder',
            originUnknownId: 'u',
            acceptedAtStep: 1,
            delegated: true,
            args: { note: 'declared' },
            inlineGateIds: ['quality'],
          },
          { id: 'n3', promptId: 'p3', stepName: 'Pending', delegated: false },
        ],
        stepStates: new Map([
          [
            'n1',
            {
              state: 'completed',
              isPlaceholder: false,
              renderedAt: 11,
              respondedAt: 12,
              completedAt: 13,
              declaredSections: ['Evidence'],
            },
          ],
          ['n2', { state: 'working', isPlaceholder: true, renderedAt: 21, spawnedAt: 22 }],
        ]),
      },
      reviews: {
        n1: {
          nodeId: 'n1',
          kind: 'detached',
          phase: 'awaiting-verdict',
          combinedPrompt: 'Review',
          gateIds: ['quality'],
          prompts: [],
          createdAt: 31,
          attemptCount: 1,
          maxAttempts: 3,
          reviewedOutput: 'captured report',
          history: [{ timestamp: 32, status: 'fail', reasoning: 'retain retry' }],
        },
      },
      pendingShellVerification: {
        gateId: 'shell',
        nodeId: 'n2',
        shellVerify: { command: 'fixture check', loop: true },
        attemptCount: 1,
        maxAttempts: 2,
        previousResults: [],
        originalGoal: 'retained shell goal',
      },
      unknownsLedger: [
        {
          id: 'u',
          statement: 'unknown',
          state: 'active',
          blocking: true,
          discoveredAtStep: 1,
          targetStepId: 'n2',
        },
      ],
      blueprint: {
        parsedCommand: { promptId: 'p1', promptArgs: { goal: 'retained' } },
        executionPlan: {
          strategy: 'chain',
          gates: ['quality'],
          requiresFramework: false,
          requiresSession: true,
        },
      },
    };
    await engine.transaction(() =>
      new DirectChainRunRegistry(engine).save([session], {
        continuityScopeId: 'canonical-owner',
        organizationId: 'canonical-org',
        workspaceId: 'canonical-ws',
      })
    );
    // Pin all canonical columns; the node SQL write clock is not domain progress.
    const packet = {
      run: engine.query('SELECT * FROM chain_runs ORDER BY session_id'),
      nodes: engine
        .query<Record<string, unknown>>('SELECT * FROM chain_run_nodes ORDER BY position')
        .map(({ updated_at: _writeClock, ...domain }) => domain),
    };
    expect(createHash('sha256').update(JSON.stringify(packet)).digest('hex')).toBe(
      'be425405cefa6c332dd99de240505663517a262cccc7547f4589906e65c855bf'
    );
  });

  describe('selected conversation control persistence', () => {
    const fixture = async () => {
      const refs = new StubTextReferenceStore();
      const store = new ChainSessionStore(
        logger,
        refs as never,
        { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-storage' } },
        engine
      );
      const held = await store.createSession(
        'selected',
        'chain-selected#1',
        2,
        { target: 'old' },
        { continuityScopeId: 'caller', nodes: nodes(['n1', 'p1', 'One'], ['n2', 'p2', 'Detached']) }
      );
      await store.markNodeSpawned('selected', 'n2');
      await store.mintHandoffToken('selected');
      for (const id of ['history', 'foreign', 'peer'])
        await store.createSession(id, `chain-${id}#1`, 1);
      engine.run(
        "UPDATE chain_runs SET workspace_id = 'other-namespace' WHERE session_id = 'history'"
      );
      engine.run(
        "UPDATE chain_runs SET run_owner_pid = 'foreign-owner' WHERE session_id = 'foreign'"
      );
      for (const id of ['history', 'foreign']) store['activeSessions'].delete(id);
      store.setStepState('selected', 'n1', 'rendered', false, ['Evidence']);
      return { store, refs, held, scope: store.getConversationControlScope('caller') };
    };
    const change = (session: ChainSession) => {
      session.originalArgs = { target: 'new' };
      return 'changed';
    };
    const commit = (f: Awaited<ReturnType<typeof fixture>>, mutation = change) =>
      f.store['runConversationControlMutation']('selected', f.scope, mutation);
    const raw = (other = false) => ({
      runs: engine.query(
        `SELECT * FROM chain_runs ${other ? "WHERE session_id != 'selected'" : ''} ORDER BY session_id`
      ),
      nodes: engine.query(
        `SELECT * FROM chain_run_nodes ${other ? "WHERE session_id != 'selected'" : ''} ORDER BY session_id, position`
      ),
    });

    test('canonical issued metadata commits and unrelated namespaces/history/foreign rows stay exact', async () => {
      const f = await fixture();
      const other = raw(true);
      expect(other.runs).toHaveLength(3);
      expect(
        engine.queryOne<{ rendered_at: number | null }>(
          "SELECT rendered_at FROM chain_run_nodes WHERE session_id = 'selected' AND node_id = 'n1'"
        )?.rendered_at
      ).toBeNull();
      const result = await commit(f);
      expect(result.status).toBe('committed');
      if (result.status !== 'committed') throw new Error('positive selected commit missing');
      expect(result.inspection.session.state.stepStates).toEqual(f.held.state.stepStates);
      expect(result.inspection.session.originalArgs).toEqual({ target: 'new' });
      expect(result.inspection.session).not.toHaveProperty('handoffToken');
      expect(
        engine.queryOne<{ declared_sections_json: string }>(
          "SELECT declared_sections_json FROM chain_run_nodes WHERE session_id = 'selected' AND node_id = 'n1'"
        )?.declared_sections_json
      ).toBe('["Evidence"]');
      expect(raw(true)).toEqual(other);
      await f.store.cleanup();
    });

    test('physical second-connection BUSY rejects before mutation and permits a retry', async () => {
      const f = await fixture();
      const before = raw();
      const local = structuredClone(f.held);
      const timeout = engine.queryOne<{ timeout: number }>('PRAGMA busy_timeout');
      if (timeout === null) throw new Error('busy timeout missing');
      const blocker = new DatabaseSync(path.join(tmpDir, 'runtime-state', 'state.db'));
      engine.run('PRAGMA busy_timeout = 1');
      blocker.exec('BEGIN IMMEDIATE');
      try {
        await expect(commit(f)).rejects.toThrow(/locked|busy/i);
        expect(f.held).toEqual(local);
        expect(raw()).toEqual(before);
      } finally {
        blocker.exec('ROLLBACK');
        blocker.close();
        engine.run(`PRAGMA busy_timeout = ${timeout.timeout}`);
      }
      expect((await commit(f)).status).toBe('committed');
      await f.store.cleanup();
    });

    test.each([
      [
        'SQL rejection',
        "BEFORE INSERT ON chain_run_nodes WHEN NEW.session_id = 'selected' BEGIN SELECT RAISE(ABORT, 'fixture SQL failure'); END",
      ],
      [
        'run domain alteration',
        "AFTER INSERT ON chain_runs WHEN NEW.session_id = 'selected' BEGIN UPDATE chain_runs SET current_node_id = 'n2' WHERE session_id = 'selected'; END",
      ],
      [
        'node domain alteration',
        "AFTER INSERT ON chain_run_nodes WHEN NEW.session_id = 'selected' AND NEW.node_id = 'n1' BEGIN UPDATE chain_run_nodes SET declared_sections_json = NULL WHERE session_id = 'selected' AND node_id = 'n1'; END",
      ],
      [
        'credential alteration',
        "AFTER INSERT ON chain_runs WHEN NEW.session_id = 'selected' BEGIN UPDATE chain_runs SET handoff_token = 'altered-credential' WHERE session_id = 'selected'; END",
      ],
    ])('%s rolls back canonical rows and tentative memory, then retries', async (_name, body) => {
      const f = await fixture();
      const before = raw();
      const local = structuredClone(f.held);
      engine.run(`CREATE TRIGGER selected_fault ${body}`);
      try {
        await expect(commit(f)).rejects.toThrow(
          _name === 'SQL rejection' ? 'fixture SQL failure' : 'durable row or node mismatch'
        );
        expect(raw()).toEqual(before);
        expect(f.held).toEqual(local);
      } finally {
        engine.run('DROP TRIGGER selected_fault');
      }
      expect((await commit(f)).status).toBe('committed');
      await f.store.cleanup();
    });

    test.each(['owner', 'namespace', 'zero winner'])(
      '%s refuses without foreign writes and releases only lost local custody',
      async (cause) => {
        const f = await fixture();
        if (cause === 'owner')
          engine.run(
            "UPDATE chain_runs SET run_owner_pid = 'claimed-owner' WHERE session_id = 'selected'"
          );
        if (cause === 'namespace')
          engine.run(
            "UPDATE chain_runs SET workspace_id = 'legacy-mismatch' WHERE session_id = 'selected'"
          );
        if (cause === 'zero winner')
          engine.run(
            "CREATE TRIGGER selected_zero BEFORE DELETE ON chain_runs WHEN OLD.session_id = 'selected' BEGIN SELECT RAISE(IGNORE); END"
          );
        const before = raw();
        const local = structuredClone(f.held);
        const mutation = jest.fn(change);
        const result = await commit(f, mutation);
        expect(result).toEqual({
          status: 'refused',
          reason: cause === 'namespace' ? 'scope-mismatch' : 'ownership-lost',
          inspection: null,
        });
        expect(raw()).toEqual(before);
        expect(f.held).toEqual(local);
        expect(mutation).toHaveBeenCalledTimes(cause === 'zero winner' ? 1 : 0);
        expect(f.store.hasActiveSession('selected')).toBe(cause === 'namespace');
        expect(f.store.hasActiveSession('peer')).toBe(true);
        expect(f.refs.clearChainStepResults.mock.calls).toEqual(
          cause === 'namespace' ? [] : [['selected']]
        );
        if (cause === 'zero winner') engine.run('DROP TRIGGER selected_zero');
        await f.store.cleanup();
      }
    );

    test('shared queue reserves whole jobs and observes custody lost before a delayed control starts', async () => {
      const f = await fixture();
      const before = raw();
      const order: number[] = [];
      let release!: () => void;
      f.store['persistQueue'] = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = commit(f, (session) => {
        order.push(1);
        return change(session);
      });
      const second = commit(f, (session) => {
        order.push(2);
        return change(session);
      });
      await Promise.resolve();
      expect(order).toEqual([]);
      expect(raw()).toEqual(before);
      release();
      expect((await first).status).toBe('committed');
      expect((await second).status).toBe('committed');
      expect(order).toEqual([1, 2]);
      f.store['persistQueue'] = new Promise<void>((resolve) => {
        release = resolve;
      });
      const mutation = jest.fn(change);
      const delayed = commit(f, mutation);
      await Promise.resolve();
      engine.run("UPDATE chain_runs SET run_owner_pid = 'new-owner' WHERE session_id = 'selected'");
      const foreign = raw();
      release();
      expect((await delayed).status).toBe('refused');
      expect(mutation).not.toHaveBeenCalled();
      expect(raw()).toEqual(foreign);
      expect(f.refs.clearChainStepResults.mock.calls).toEqual([['selected']]);
      await f.store.cleanup();
    });

    test('failed BEGIN leaves another caller transaction intact', async () => {
      const f = await fixture();
      const before = raw();
      engine.beginTransaction('immediate');
      engine.run("UPDATE chain_runs SET last_activity = 99 WHERE session_id = 'peer'");
      try {
        await expect(commit(f)).rejects.toThrow(/within a transaction|transaction already/i);
        expect(
          engine.queryOne<{ last_activity: number }>(
            "SELECT last_activity FROM chain_runs WHERE session_id = 'peer'"
          )?.last_activity
        ).toBe(99);
      } finally {
        engine.rollback();
      }
      expect(raw()).toEqual(before);
      expect((await commit(f)).status).toBe('committed');
      await f.store.cleanup();
    });

    test('terminal state and invalid held pointer cannot enter a control mutation', async () => {
      const f = await fixture();
      const mutation = jest.fn(change);
      const before = raw();
      f.held.state.currentNodeId = 'invalid-local';
      const local = structuredClone(f.held);
      await expect(commit(f, mutation)).rejects.toThrow('invalid held node pointer');
      expect(f.held).toEqual(local);
      expect(raw()).toEqual(before);
      await expect(f.store.pauseConversation(f.held.sessionId, f.scope)).rejects.toThrow(
        'invalid held node pointer'
      );
      expect(f.held).toEqual(local);
      expect(raw()).toEqual(before);
      f.held.runStatus = 'cancelled';
      expect((await commit(f, mutation)).status).toBe('refused');
      expect(mutation).not.toHaveBeenCalled();
      await f.store.cleanup();
    });
  });

  describe('conversation pause', () => {
    const fixture = async (hold = 'ordinary', count = 2) => {
      const refs = new StubTextReferenceStore();
      const store = new ChainSessionStore(
        logger,
        refs as never,
        { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-storage' } },
        engine
      );
      const held = await store.createSession(
        'conversation',
        'chain-conversation#1',
        count,
        { target: 'frozen' },
        {
          continuityScopeId: 'caller',
          nodes: count === 0 ? [] : nodes(['n1', 'p1', 'Capture'], ['n2', 'p2', 'Detached']),
        }
      );
      if (count > 0) {
        await store.updateSessionState(held.sessionId, 'n1', 'captured target');
        if (hold === 'unknown')
          await store.applyUnknownObservations(held.sessionId, 'n1', [
            { type: 'unknown_discovered', id: 'u', statement: 'plan shape', blocking: true },
          ]);
        if (hold === 'detached') await store.markNodeSpawned(held.sessionId, 'n2');
        const nodeId = hold === 'detached' ? 'n2' : 'n1';
        await store.setReview(held.sessionId, {
          nodeId,
          kind: hold === 'unknown' ? 'structural' : hold === 'detached' ? 'detached' : 'gate',
          phase: 'awaiting-verdict',
          combinedPrompt: 'retained review',
          prompts: [],
          createdAt: 1,
          gateIds: [hold === 'unknown' ? '__unknown_interrupt__' : 'quality'],
          attemptCount: 2,
          maxAttempts: 3,
          reviewedOutput: 'captured target',
          semanticContext: {
            nodeId,
            attemptId: 'frozen-attempt',
            definitions: {},
            target: {
              kind: 'step_output',
              content: 'captured target',
              digest: 'sha256:' + createHash('sha256').update('captured target').digest('hex'),
            },
          },
        });
        if (hold === 'shell')
          await store.setPendingShellVerification(held.sessionId, {
            gateId: 'shell',
            nodeId: 'n1',
            shellVerify: { command: 'fixture check' },
            attemptCount: 1,
            maxAttempts: 3,
            previousResults: [],
            originalGoal: 'frozen goal',
          });
      }
      return { store, held, refs, scope: store.getConversationControlScope('caller') };
    };
    const raw = () => ({
      runs: engine.query('SELECT * FROM chain_runs ORDER BY session_id'),
      nodes: engine.query('SELECT * FROM chain_run_nodes ORDER BY session_id, position'),
    });
    const domain = (session: ChainSession) => {
      const {
        conversationPause: _pause,
        handoffToken: _credential,
        ...rest
      } = structuredClone(session);
      return rest;
    };
    const forbidWrites = () => {
      for (const table of ['chain_runs', 'chain_run_nodes', 'chain_sessions'])
        for (const operation of ['INSERT', 'UPDATE', 'DELETE'])
          engine.run(
            `CREATE TRIGGER forbid_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'unexpected control write'); END`
          );
      return () => {
        for (const table of ['chain_runs', 'chain_run_nodes', 'chain_sessions'])
          for (const operation of ['INSERT', 'UPDATE', 'DELETE'])
            engine.run(`DROP TRIGGER forbid_${table}_${operation}`);
      };
    };

    test.each(['ordinary', 'unknown', 'shell', 'detached'])(
      '%s hold survives pause, readonly repeat, cold hydration and explicit resume without advance',
      async (hold) => {
        const f = await fixture(hold);
        const before = domain(f.held);
        const captures = f.refs.storeChainStepResult.mock.calls.length;
        const paused = await f.store.pauseConversation(f.held.sessionId, f.scope);
        expect(paused.outcome).toBe('paused');
        if (paused.outcome !== 'paused') throw new Error('positive pause missing');
        expect(f.held.handoffToken).toBe(paused.token);
        expect(domain(f.held)).toEqual(before);
        expect(paused.inspection.session).not.toHaveProperty('handoffToken');
        const pausedRaw = raw();
        const fullHeld = structuredClone(f.held);
        const remove = forbidWrites();
        try {
          expect(await f.store.pauseConversation(f.held.sessionId, f.scope)).toEqual({
            ...paused,
            outcome: 'already-paused',
          });
          expect(raw()).toEqual(pausedRaw);
          expect(f.held).toEqual(fullHeld);
        } finally {
          remove();
        }
        await f.store.cleanup();
        const reader = newStore();
        await reader['initPromise'];
        const restored = reader['activeSessions'].get(f.held.sessionId);
        if (restored === undefined) throw new Error('current-owner cold session missing');
        expect(restored.conversationPause).toEqual(fullHeld.conversationPause);
        expect(restored.handoffToken).toBe(paused.token);
        expect(domain(restored)).toEqual({ ...before, lifecycle: 'dormant' });
        const resumed = await reader.resumeConversation(restored.sessionId, f.scope);
        expect(resumed.outcome).toBe('resumed');
        expect(resumed).not.toHaveProperty('token');
        expect(restored.conversationPause).toBeUndefined();
        expect(restored.handoffToken).toBe(paused.token);
        expect(restored.reviews).toEqual(before.reviews);
        expect(domain(restored)).toEqual({ ...before, lifecycle: 'dormant' });
        expect(f.refs.storeChainStepResult.mock.calls).toHaveLength(captures);
        expect(reader['textReferenceStore'].storeChainStepResult).not.toHaveBeenCalled();
        const resumedRaw = raw();
        const resumedHeld = structuredClone(restored);
        const undo = forbidWrites();
        try {
          expect((await reader.resumeConversation(restored.sessionId, f.scope)).outcome).toBe(
            'resumed'
          );
          expect(raw()).toEqual(resumedRaw);
          expect(restored).toEqual(resumedHeld);
        } finally {
          undo();
        }
        await reader.cleanup();
      }
    );

    test('legacy absence survives current-owner cold load and absent resume performs no write', async () => {
      const f = await fixture();
      await f.store.cleanup();
      const reader = newStore();
      await reader['initPromise'];
      const held = reader['activeSessions'].get(f.held.sessionId);
      if (held === undefined) throw new Error('legacy cold session missing');
      expect(held.conversationPause).toBeUndefined();
      const before = raw();
      const local = structuredClone(held);
      const remove = forbidWrites();
      try {
        expect((await reader.resumeConversation(held.sessionId, f.scope)).outcome).toBe('resumed');
        expect(raw()).toEqual(before);
        expect(held).toEqual(local);
      } finally {
        remove();
      }
      await reader.cleanup();
    });

    test('existing credential is preserved and legacy absence/nullable pointer remain readable', async () => {
      const f = await fixture('ordinary', 0);
      const minted = await f.store.mintHandoffToken(f.held.sessionId);
      if (minted === undefined) throw new Error('positive credential missing');
      expect(f.held.conversationPause).toBeUndefined();
      const paused = await f.store.pauseConversation(f.held.sessionId, f.scope);
      expect(paused.outcome).toBe('paused');
      expect(paused).toHaveProperty('token', minted.token);
      expect(f.held.conversationPause).toMatchObject({ kind: 'conversation', nodeId: null });
      await f.store.cleanup();
    });

    test.each(['pause', 'resume'])(
      '%s strict BUSY and SQL failure roll back record/credential and permit retry',
      async (action) => {
        const f = await fixture();
        if (action === 'resume') await f.store.pauseConversation(f.held.sessionId, f.scope);
        const operation = () =>
          action === 'pause'
            ? f.store.pauseConversation(f.held.sessionId, f.scope)
            : f.store.resumeConversation(f.held.sessionId, f.scope);
        const before = raw();
        const local = structuredClone(f.held);
        const timeout = engine.queryOne<{ timeout: number }>('PRAGMA busy_timeout');
        if (timeout === null) throw new Error('timeout missing');
        const blocker = new DatabaseSync(path.join(tmpDir, 'runtime-state', 'state.db'));
        engine.run('PRAGMA busy_timeout = 1');
        blocker.exec('BEGIN IMMEDIATE');
        try {
          await expect(operation()).rejects.toThrow(/locked|busy/i);
          expect(raw()).toEqual(before);
          expect(f.held).toEqual(local);
        } finally {
          blocker.exec('ROLLBACK');
          blocker.close();
          engine.run(`PRAGMA busy_timeout = ${timeout.timeout}`);
        }
        engine.run(
          "CREATE TRIGGER control_failure BEFORE INSERT ON chain_runs BEGIN SELECT RAISE(ABORT, 'control SQL failure'); END"
        );
        try {
          await expect(operation()).rejects.toThrow('control SQL failure');
          expect(raw()).toEqual(before);
          expect(f.held).toEqual(local);
        } finally {
          engine.run('DROP TRIGGER control_failure');
        }
        expect((await operation()).outcome).toBe(action === 'pause' ? 'paused' : 'resumed');
        await f.store.cleanup();
      }
    );

    test.each(['pause record', 'credential'])(
      '%s held/durable disagreement throws without adoption or writes',
      async (fact) => {
        const f = await fixture();
        await f.store.pauseConversation(f.held.sessionId, f.scope);
        if (fact === 'pause record')
          f.held.conversationPause = { kind: 'conversation', nodeId: 'n2', pausedAt: 0 };
        else f.held.handoffToken = 'different-held-credential';
        const before = raw();
        const local = structuredClone(f.held);
        await expect(f.store.pauseConversation(f.held.sessionId, f.scope)).rejects.toThrow(
          'differs from durable'
        );
        await expect(f.store.resumeConversation(f.held.sessionId, f.scope)).rejects.toThrow(
          'differs from durable'
        );
        expect(raw()).toEqual(before);
        expect(f.held).toEqual(local);
        await f.store.cleanup();
      }
    );

    test('missing recovery credential refuses and terminal priority cannot acknowledge an existing pause', async () => {
      const f = await fixture();
      const record = { kind: 'conversation' as const, nodeId: 'n1', pausedAt: 1 };
      f.held.conversationPause = record;
      engine.run(
        "UPDATE chain_runs SET state = json_set(state, '$.conversationPause', json(?)) WHERE session_id = ?",
        [JSON.stringify(record), f.held.sessionId]
      );
      const before = raw();
      const local = structuredClone(f.held);
      const remove = forbidWrites();
      try {
        for (const action of ['pauseConversation', 'resumeConversation'] as const) {
          const result = await f.store[action](f.held.sessionId, f.scope);
          expect(result).toMatchObject({
            outcome: 'refused',
            reason: 'recovery-credential-missing',
          });
          expect(result).not.toHaveProperty('token');
          expect(raw()).toEqual(before);
          expect(f.held).toEqual(local);
        }
      } finally {
        remove();
      }
      await f.store.cancelChain(f.held.sessionId);
      const terminal = await f.store.pauseConversation(f.held.sessionId, f.scope);
      expect(terminal).toMatchObject({
        outcome: 'refused',
        reason: 'run-terminal',
        chainId: f.held.chainId,
      });
      expect(terminal.inspection?.session).not.toHaveProperty('handoffToken');
      await f.store.cleanup();
    });

    test('no-write decisions still refuse foreign custody and exact scope mismatch', async () => {
      const f = await fixture();
      await f.store.pauseConversation(f.held.sessionId, f.scope);
      const before = raw();
      const wrong = { ...f.scope, continuityScopeId: 'other' };
      expect(await f.store.pauseConversation(f.held.sessionId, wrong)).toMatchObject({
        outcome: 'refused',
        reason: 'scope-mismatch',
      });
      expect(raw()).toEqual(before);
      engine.run("UPDATE chain_runs SET run_owner_pid = 'new-owner' WHERE session_id = ?", [
        f.held.sessionId,
      ]);
      const foreign = raw();
      const result = await f.store.pauseConversation(f.held.sessionId, f.scope);
      expect(result).toMatchObject({
        outcome: 'refused',
        reason: 'ownership-lost',
        inspection: null,
      });
      expect(result).not.toHaveProperty('token');
      expect(raw()).toEqual(foreign);
      await f.store.cleanup();
    });
  });

  describe('conversation control identity', () => {
    const create = (store: ChainSessionStore, id: string, continuityScopeId: string) =>
      store.createSession(
        id,
        'chain-inspect#1',
        2,
        { target: id },
        {
          continuityScopeId,
          nodes: nodes(['n1', 'p1', 'One'], ['n2', 'p2', 'Two']),
        }
      );
    const rows = () => engine.query('SELECT * FROM chain_runs ORDER BY session_id');

    test('exact UUID and caller continuity return a detached durable view without credentials or local repairs', async () => {
      const store = newStore();
      const held = await create(store, 'identity-a', 'caller-a');
      const other = await create(store, 'identity-b', 'caller-b');
      expect(other.chainId).toBe(held.chainId);
      const credential = await store.mintHandoffToken(held.sessionId);
      expect(credential?.token).toEqual(expect.any(String));
      if (credential === undefined) throw new Error('positive credential missing');
      held.lifecycle = 'dormant';
      held.state.currentNodeId = 'malformed-local-pointer';
      const localBefore = structuredClone(held);
      const durableBefore = rows();
      const scope = store.getConversationControlScope('caller-a');
      expect(scope.workspaceId).toBe('ws-storage');
      const view = store.inspectConversationControl(held.sessionId, scope);
      expect(view?.session).toMatchObject({ sessionId: held.sessionId, chainId: held.chainId });
      expect(view?.scope).toEqual(scope);
      expect(view?.session.state.currentNodeId).toBe('n1');
      expect(view?.session.lifecycle).toBe('canonical');
      expect(view?.session).not.toHaveProperty('handoffToken');
      expect(JSON.stringify(view)).not.toContain(credential.token);
      expect(store.inspectConversationControl(other.sessionId, scope)).toBeUndefined();
      expect(store.inspectConversationControl('unknown-uuid', scope)).toBeUndefined();
      if (view === undefined) throw new Error('positive inspection missing');
      view.session.state.currentNodeId = 'mutated-inspection';
      expect(
        store.inspectConversationControl(held.sessionId, scope)?.session.state.currentNodeId
      ).toBe('n1');
      expect(held).toEqual(localBefore);
      expect(rows()).toEqual(durableBefore);
      await store.cleanup();
    });

    test.each([{}, { workspaceId: 'storage' }, { workspaceId: 'storage', organizationId: 'org' }])(
      'nullable namespace is exact, authoritative and read-only: %j',
      async (defaultScope) => {
        const store = new ChainSessionStore(
          logger,
          new StubTextReferenceStore() as never,
          { cleanupIntervalMs: 60_000, defaultScope },
          engine
        );
        const held = await create(store, 'namespace', 'request-continuity');
        const scope = store.getConversationControlScope('request-continuity');
        expect(store.inspectConversationControl(held.sessionId, scope)?.scope).toEqual(scope);
        const localBefore = structuredClone(held);
        for (const column of ['organization_id', 'workspace_id']) {
          const original = rows()[0];
          if (original === undefined) throw new Error('positive namespace row missing');
          const replacement = original[column] === null ? 'foreign-namespace' : null;
          engine.run(`UPDATE chain_runs SET ${column} = ? WHERE session_id = ?`, [
            replacement,
            held.sessionId,
          ]);
          const durableBefore = rows();
          expect(store.inspectConversationControl(held.sessionId, scope)).toBeUndefined();
          expect(rows()).toEqual(durableBefore);
          engine.run(`UPDATE chain_runs SET ${column} = ? WHERE session_id = ?`, [
            original[column],
            held.sessionId,
          ]);
        }
        expect(
          store.inspectConversationControl(held.sessionId, { ...scope, workspaceId: 'client-hint' })
        ).toBeUndefined();
        expect(held).toEqual(localBefore);
        await store.cleanup();
      }
    );

    test('canonical default is exact and legacy residual absence uses the existing default normalization', async () => {
      const store = newStore();
      const legacy = await create(store, 'legacy-default', 'default');
      const foreign = await create(store, 'foreign-continuity', 'other');
      engine.run(
        "UPDATE chain_runs SET state = json_remove(state, '$.continuityScopeId') WHERE session_id = ?",
        [legacy.sessionId]
      );
      const scope = store.getConversationControlScope('default');
      const owner = { continuityScopeId: String(process.pid), workspaceId: 'ws-storage' };
      const registry = new DirectChainRunRegistry(engine);
      const before = rows();
      expect(
        store.inspectConversationControl(legacy.sessionId, scope)?.scope.continuityScopeId
      ).toBe('default');
      expect(store.inspectConversationControl(foreign.sessionId, scope)).toBeUndefined();
      expect(registry.readOwnedControlRun(foreign.sessionId, owner, scope)).toEqual({
        status: 'refused',
        reason: 'scope-mismatch',
      });
      expect(rows()).toEqual(before);
      await store.cleanup();
    });

    test('a foreign durable owner refuses without local adoption or credential mutation', async () => {
      const store = newStore();
      const held = await create(store, 'foreign-owner', 'caller');
      await store.mintHandoffToken(held.sessionId);
      engine.run('UPDATE chain_runs SET run_owner_pid = ? WHERE session_id = ?', [
        'foreign',
        held.sessionId,
      ]);
      const before = rows();
      const localBefore = structuredClone(held);
      const scope = store.getConversationControlScope('caller');
      expect(store.inspectConversationControl(held.sessionId, scope)).toBeUndefined();
      expect(held).toEqual(localBefore);
      expect(rows()).toEqual(before);
      await store.cleanup();
    });
  });

  describe('exact raw run identity (R7)', () => {
    const owner = { continuityScopeId: String(process.pid), workspaceId: 'ws-storage' };
    const fixture = (sessionId: string, chainId: string): ChainSession => ({
      sessionId,
      chainId,
      continuityScopeId: 'default',
      state: {
        currentNodeId: 'capture',
        nodes: nodes(['capture', 'plan/collect', 'Collect'], ['report', 'plan/report', 'Report']),
        lastUpdated: 1,
        stepStates: new Map(),
      },
      executionOrder: [],
      startTime: 1,
      lastActivity: 1,
      originalArgs: {},
      lifecycle: 'canonical',
      runStatus: 'working',
    });

    test.each([
      'chain-plan#1',
      'chain-plan/table#1',
      'chain-plan/table/detail#1',
      'legacy-plan/table#1',
      'chain-plan/table#0',
      'chain-plan/table#01',
    ])('cold lookup preserves an existing raw token %s', async (chainId) => {
      // Registry fixtures preserve historical bytes; new-run reservation is a separate policy.
      await new DirectChainRunRegistry(engine).save([fixture('r7-raw', chainId)], owner);
      const reader = newStore();
      try {
        await (reader as unknown as { initPromise: Promise<void> }).initPromise;
        const found = reader.getSessionByChainIdentifier(chainId, { includeDormant: true });
        expect(found?.sessionId).toBe('r7-raw');
        expect(found?.chainId).toBe(chainId);
        expect(found?.state.currentNodeId).toBe('capture');
        expect(found?.state.nodes.map((node) => node.promptId)).toEqual([
          'plan/collect',
          'plan/report',
        ]);
        expect(
          engine.queryOne<{ chain_id: string }>(
            'SELECT chain_id FROM chain_runs WHERE session_id = ?',
            ['r7-raw']
          )?.chain_id
        ).toBe(chainId);
      } finally {
        await reader.cleanup();
      }
    });

    test('missing explicit numbers never fall back to an exact bare legacy row', async () => {
      await new DirectChainRunRegistry(engine).save(
        [fixture('r7-bare', 'chain-plan/table'), fixture('r7-numbered', 'chain-plan/table#1')],
        owner
      );
      const reader = newStore();
      try {
        await (reader as unknown as { initPromise: Promise<void> }).initPromise;
        expect(
          reader.getSessionByChainIdentifier('chain-plan/table', { includeDormant: true })
            ?.sessionId
        ).toBe('r7-bare');
        expect(
          reader.getSessionByChainIdentifier('chain-plan/table#1', { includeDormant: true })
            ?.sessionId
        ).toBe('r7-numbered');
        expect(
          reader.getSessionByChainIdentifier('chain-plan/table#99', { includeDormant: true })
        ).toBeUndefined();
        expect(
          reader.getSessionByChainIdentifier('chain-plan/table#01', { includeDormant: true })
        ).toBeUndefined();
        expect(
          reader.getSessionByChainIdentifier('chain-plan/table#0', { includeDormant: true })
        ).toBeUndefined();
        expect(reader.getSession('r7-bare')?.state.currentNodeId).toBe('capture');
        expect(reader.getSession('r7-numbered')?.state.currentNodeId).toBe('capture');
      } finally {
        await reader.cleanup();
      }
    });

    test('scoped exact lookup and abort keep another continuity capture and report intact', async () => {
      const store = newStore();
      const scopeA = { continuityScopeId: 'r7-request-a' };
      const scopeB = { continuityScopeId: 'r7-request-b' };
      try {
        for (const [sessionId, scope] of [
          ['r7-a', scopeA],
          ['r7-b', scopeB],
        ] as const) {
          await store.createSession(
            sessionId,
            'chain-plan/table#1',
            2,
            {},
            {
              ...scope,
              nodes: nodes(
                ['capture', 'plan/collect', 'Collect'],
                ['report', 'plan/report', 'Report']
              ),
            }
          );
          await store.updateSessionState(sessionId, 'capture', `${sessionId} capture`);
          await store.setReview(sessionId, {
            nodeId: 'report',
            kind: 'detached',
            phase: 'awaiting-verdict',
            combinedPrompt: '',
            gateIds: ['quality'],
            prompts: [],
            createdAt: 1,
            attemptCount: 1,
            maxAttempts: 2,
            reviewedOutput: `${sessionId} report`,
          });
        }
        expect(store.getSessionByChainIdentifier('chain-plan/table#1', scopeA)?.sessionId).toBe(
          'r7-a'
        );
        expect(store.getSessionByChainIdentifier('chain-plan/table#1', scopeB)?.sessionId).toBe(
          'r7-b'
        );
        expect(
          store.getSessionByChainIdentifier('chain-plan/table#1', {
            continuityScopeId: 'r7-request-missing',
          })
        ).toBeUndefined();
        const beforeCapture = store.getStepState('r7-b', 'capture');
        const beforeReport = store.getReview('r7-b', 'report');
        expect(await store.cancelChain('r7-b', scopeA)).toBe(false);
        expect(await store.cancelChain('r7-a', scopeA)).toBe(true);
        expect(store.getStepState('r7-b', 'capture')).toEqual(beforeCapture);
        expect(store.getReview('r7-b', 'report')).toEqual(beforeReport);
        expect(store.getSession('r7-b')?.runStatus).toBe('working');
        const joined = engine.query<{
          session_id: string;
          chain_id: string;
          run_status: string;
          node_id: string;
          milestone: string;
          responded_at: number | null;
        }>(
          `SELECT r.session_id, r.chain_id, r.run_status, n.node_id, n.milestone, n.responded_at
             FROM chain_runs r JOIN chain_run_nodes n ON n.session_id = r.session_id
            WHERE r.session_id IN (?, ?) AND n.node_id = ? ORDER BY r.session_id`,
          ['r7-a', 'r7-b', 'capture']
        );
        expect(
          joined.map((row) => [
            row.session_id,
            row.chain_id,
            row.run_status,
            row.node_id,
            row.milestone,
          ])
        ).toEqual([
          ['r7-a', 'chain-plan/table#1', 'cancelled', 'capture', 'working'],
          ['r7-b', 'chain-plan/table#1', 'working', 'capture', 'working'],
        ]);
        for (const row of joined) {
          expect(row.responded_at).toEqual(expect.any(Number));
          expect(row.responded_at).toBe(store.getStepState(row.session_id, 'capture')?.respondedAt);
        }
      } finally {
        await store.cleanup();
      }
    });

    test('qualified cold load joins node capture, report and attempt metadata to the exact run', async () => {
      const writer = newStore();
      await writer.createSession(
        'r7-metadata',
        'chain-plan/table/detail#1',
        2,
        {},
        {
          nodes: nodes(['capture', 'plan/collect', 'Collect'], ['report', 'plan/report', 'Report']),
        }
      );
      await writer.updateSessionState('r7-metadata', 'capture', 'captured answer');
      await writer.completeStep('r7-metadata', 'capture');
      await writer.advanceStep('r7-metadata', 'capture');
      await writer.setReview('r7-metadata', {
        nodeId: 'report',
        kind: 'detached',
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: ['quality'],
        prompts: [],
        createdAt: 1,
        attemptCount: 1,
        maxAttempts: 2,
        reviewedOutput: 'exact detached report',
      });
      const captured = writer.getStepState('r7-metadata', 'capture');
      await writer.cleanup();
      const reader = newStore();
      try {
        await (reader as unknown as { initPromise: Promise<void> }).initPromise;
        const loaded = reader.getSessionByChainIdentifier('chain-plan/table/detail#1', {
          includeDormant: true,
        });
        expect(loaded?.sessionId).toBe('r7-metadata');
        expect(loaded?.chainId).toBe('chain-plan/table/detail#1');
        expect(loaded?.state.currentNodeId).toBe('report');
        expect(loaded?.executionOrder).toEqual(['capture']);
        expect(reader.getStepState('r7-metadata', 'capture')).toEqual(captured);
        expect(reader.getReview('r7-metadata', 'report')).toMatchObject({
          nodeId: 'report',
          attemptCount: 1,
          reviewedOutput: 'exact detached report',
        });
        expect(reader.getReview('r7-metadata', 'capture')).toBeUndefined();
      } finally {
        await reader.cleanup();
      }
    });
  });

  test('the v22 schema declares both run tables and no longer declares the retired blob', () => {
    expect(engine.getSchemaVersion()).toBe(35);

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
    await writer.clearReview('sess-dreview', 'n1');
    await (writer as unknown as { persistSessions: () => Promise<void> }).persistSessions();
    await writer.cleanup();

    const reader = newStore();
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;
    expect(reader.getReview('sess-dreview', 'n1')).toBeUndefined();
    expect(reader.getReview('sess-dreview', 'rev')?.gateIds).toEqual(['node-gate']);
    // Reported, nothing owed — and still held: the open review is what holds it.
    expect(await reader.completeHeldRun('sess-dreview')).toBe(false);
    expect((reader.getSession('sess-dreview') as ChainSession).runStatus ?? 'working').toBe(
      'working'
    );

    // A PASS on the node's review deletes only that review, and the held run then completes.
    await reader.clearPendingGateReview('sess-dreview', { nodeId: 'rev' });
    expect(reader.getReview('sess-dreview', 'rev')).toBeUndefined();
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
      await writer.setPendingGateReview('sess-rv', review('slot-gate', { nodeId: 'n1' }));
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
      // A review is read out of the one store by the node it grades — a copy.
      expect(writer.getReview('sess-rv', 'n1')).toEqual(written.reviews?.['n1']);
      expect(writer.getReview('sess-rv', 'n1')).not.toBe(written.reviews?.['n1']);

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
      // A loaded run resumes through the same store.
      expect(reader.getReview('sess-rv', 'n1')?.gateIds).toEqual(['slot-gate']);
      expect(reader.getReview('sess-rv', 'rev')?.gateIds).toEqual(['node-gate']);
      await reader.cleanup();
    });

    test("a structural review is keyed by the node it grades, and another node's review opens beside it (R14)", async () => {
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
      expect(structural.reviews?.['n1']?.gateIds).toEqual(['phase-guard']);

      // A gate review of the node the run stands on opens beside it: one review per node.
      await store.setPendingGateReview('sess-rs', review('step-gate', { nodeId: 'rev' }));
      const both = store.getSession('sess-rs') as ChainSession;
      expect(Object.keys(both.reviews ?? {})).toEqual(['n1', 'rev']);
      expect(both.reviews?.['rev']?.kind).toBe('gate');
      expect(both.reviews?.['n1']?.kind).toBe('structural');

      // Clearing the current node's review leaves the other node's open.
      await store.clearReview('sess-rs', 'rev');
      expect(Object.keys((store.getSession('sess-rs') as ChainSession).reviews ?? {})).toEqual([
        'n1',
      ]);
      await store.cleanup();
    });

    test('the session listing counts any open review, a detached one included (row 3.4)', async () => {
      const store = newStore();
      await store.createSession('sess-rl', 'chain-rl#1', 3, {}, threeNodes());
      const listed = () =>
        store.listActiveSessions().find((summary) => summary.sessionId === 'sess-rl')
          ?.pendingReview;
      // Control: nothing open, nothing pending.
      expect(listed()).toBe(false);
      // Only a detached node's review is open — no current-step review exists.
      await store.setPendingGateReview('sess-rl', review('g'), { nodeId: 'n2' });
      expect(store.getReview('sess-rl', 'n1')).toBeUndefined();
      expect(listed()).toBe(true);
      await store.cleanup();
    });

    test('a counted verdict leaves the review it answered to the verdict path (row 3.4)', async () => {
      const store = newStore();
      await store.createSession('sess-rp', 'chain-rp#1', 3, {}, threeNodes());
      await store.setPendingGateReview('sess-rp', review('g', { nodeId: 'n1' }));
      await store.recordGateReviewOutcome('sess-rp', { verdict: 'FAIL' });
      await store.recordGateReviewOutcome('sess-rp', { verdict: 'PASS' });
      const session = store.getSession('sess-rp') as ChainSession;
      // Counted: two fired, one of them a FAIL.
      expect([session.gatesFiredCount, session.gateRetriesCount]).toEqual([2, 1]);
      // Untouched: no attempt spent, no history, still open — `advanceReview` owns all three.
      const open = session.reviews?.['n1'];
      expect([open?.attemptCount, open?.history, open?.phase]).toEqual([
        0,
        undefined,
        'awaiting-verdict',
      ]);
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
      expect(
        resolveReviewTarget({
          reviews: session.reviews ?? {},
          currentNodeId: session.state.currentNodeId,
          nodeIds: [],
        })
      ).toEqual({ kind: 'review', nodeId: 'n3' });
      await store.cleanup();
    });

    test('a review written without its node is refused, never keyed by where the run stands (R8)', async () => {
      const store = newStore();
      await store.createSession('sess-r8', 'chain-r8#1', 3, {}, threeNodes());
      await expect(store.setPendingGateReview('sess-r8', review('g'))).rejects.toThrow(
        'written without the node it grades'
      );
      expect((store.getSession('sess-r8') as ChainSession).reviews).toBeUndefined();
      // CONTROL: the same review naming its node is stored there.
      await store.setPendingGateReview('sess-r8', review('g', { nodeId: 'rev' }));
      expect(Object.keys((store.getSession('sess-r8') as ChainSession).reviews ?? {})).toEqual([
        'rev',
      ]);
      await store.cleanup();
    });

    test('a session holds its reviews in `reviews` alone: no per-run review slot exists', async () => {
      const store = newStore();
      const session = await store.createSession('sess-ro', 'chain-ro#1', 3, {}, threeNodes());
      await store.setPendingGateReview('sess-ro', review('g', { nodeId: 'n1' }));
      // Row 3.6 deleted the two read-only projections; `validate:review-by-node` refuses a src
      // reader or writer of either name.
      expect('pendingGateReview' in session).toBe(false);
      expect('detachedGateReviews' in session).toBe(false);
      // CONTROL: the review the call wrote is there, keyed by its node.
      expect(Object.keys(session.reviews ?? {})).toEqual(['n1']);
      await store.cleanup();
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
    // The failure reaches the caller (R74): only a held lock is swallowed, and this is not one.
    await expect(
      store.createSession('sess-rollback', 'chain-rollback#1', 2, {}, {
        nodes: nodes(['n1', 'p', 'One'], ['n2', 'p', 'Two']),
      } as never)
    ).rejects.toThrow('projection failed on purpose');

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

  describe('a store starting over rows left by dead server processes', () => {
    // A PID Linux cannot hand out (above `pid_max`), so `process.kill(pid, 0)` answers ESRCH.
    const DEAD_PID = '2147483646';

    const seedRun = async (sessionId: string, ownerPid: string): Promise<void> => {
      await new DirectChainRunRegistry(engine).save(
        [
          {
            sessionId,
            chainId: `chain-${sessionId}#1`,
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
        { continuityScopeId: ownerPid }
      );
    };

    const seedHookRow = (ownerPid: string): void => {
      engine.run(
        `INSERT INTO chain_sessions (run_owner_pid, continuity_scope_id, chain_id, state)
         VALUES (?, ?, ?, ?)`,
        [ownerPid, ownerPid, `chain-hook-${ownerPid}#1`, '{}']
      );
    };

    const owners = (table: 'chain_sessions' | 'chain_runs'): string[] =>
      engine
        .query<{ run_owner_pid: string }>(
          `SELECT DISTINCT run_owner_pid FROM ${table} ORDER BY run_owner_pid`
        )
        .map((row) => row.run_owner_pid);

    test('rows owned by a dead PID are deleted from the hook projection and the run tables, and live owners are kept', async () => {
      const live = [String(process.pid), String(process.ppid)];
      // 'default' is not a PID; the sweep skips owners it cannot parse rather than deleting them.
      const notAPid = 'default';
      for (const owner of [DEAD_PID, ...live, notAPid]) {
        seedHookRow(owner);
        await seedRun(`sess-${owner}`, owner);
      }
      // Positive control: the sweep has something to remove before it runs.
      expect(owners('chain_sessions')).toContain(DEAD_PID);
      expect(owners('chain_runs')).toContain(DEAD_PID);

      const store = newStore();
      await (store as unknown as { initPromise: Promise<void> }).initPromise;

      expect(owners('chain_sessions')).not.toContain(DEAD_PID);
      expect(owners('chain_runs')).not.toContain(DEAD_PID);
      expect(
        engine.query('SELECT 1 FROM chain_run_nodes WHERE session_id = ?', [`sess-${DEAD_PID}`])
      ).toHaveLength(0);
      for (const owner of [...live, notAPid]) {
        expect(owners('chain_sessions')).toContain(owner);
        expect(owners('chain_runs')).toContain(owner);
      }

      await store.cleanup();
    });
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
    const row = engine.queryOne<{
      position: number;
      origin: string;
      origin_unknown_id: string;
      accepted_at_step: number | null;
    }>(
      `SELECT position, origin, origin_unknown_id, accepted_at_step FROM chain_run_nodes
        WHERE session_id = ? AND node_id = ?`,
      ['sess-rem-roundtrip', 'reconsider']
    );
    expect(row?.origin).toBe('remainder');
    expect(row?.origin_unknown_id).toBe('plan-shape');
    expect(row?.position).toBe(3);
    // P6.253: accepted standing on n2, so the stamp is its ordinal, not the node's own position.
    expect(row?.accepted_at_step).toBe(2);
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
    expect(after.state.nodes[2]?.acceptedAtStep).toBe(2);
    // Control: a planned node carries no stamp across the load.
    expect(after.state.nodes[1]?.acceptedAtStep).toBeUndefined();

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
