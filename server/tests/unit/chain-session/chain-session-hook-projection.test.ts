/**
 * Hook-view projection contract.
 *
 * `chain_sessions` is the per-row projection Python hooks read across three repos, and the
 * `state` column's integer keys (`currentStep`, `totalSteps`) are a cross-repo public shape.
 * The store became node-keyed in P3 Tier 2; these tests exist so that change cannot alter a
 * single byte of what a hook observes.
 *
 * Everything here is driven through the PUBLIC store API — no session literal is constructed —
 * because a projection test built on hand-written state would only prove the projection matches
 * the fixture, not that the pipeline's own sessions still project the same way.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainRunRegistry, ClaimRunResult } from '../../../src/modules/chains/run-registry.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/** Records every statement the store issues so the projection can be read back verbatim. */
interface RecordedStatement {
  sql: string;
  params: unknown[];
}

class RecordingDatabasePort implements DatabasePort {
  readonly statements: RecordedStatement[] = [];
  transactions = 0;
  commits = 0;
  rollbacks = 0;

  isInitialized(): boolean {
    return true;
  }
  async initialize(): Promise<void> {}
  query<T>(): T[] {
    return [];
  }
  queryOne<T>(): T | null {
    return null;
  }
  run(sql: string, params: unknown[] = []): void {
    this.statements.push({ sql, params });
  }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return fn();
  }
  beginTransaction(): void {
    this.transactions += 1;
  }
  commit(): void {
    this.commits += 1;
  }
  rollback(): void {
    this.rollbacks += 1;
  }
}

/** In-memory stand-in for the run tables, so save/load round-trips without SQLite. */
class InMemoryRunRegistry implements ChainRunRegistry {
  saved: ChainSession[] | undefined;
  async ensureInitialized(): Promise<void> {}
  async load(): Promise<ChainSession[]> {
    return (this.saved ?? []).map(cloneSession);
  }
  async save(sessions: readonly ChainSession[]): Promise<string[]> {
    this.saved = sessions.map(cloneSession);
    return [];
  }
  claimRunByToken(): ClaimRunResult {
    return { status: 'unknown-token' };
  }
  deleteRunsForOwners(): void {}
}

/** Deep copy that survives the `stepStates` Map, which JSON round-tripping does not. */
function cloneSession(session: ChainSession): ChainSession {
  const copy = JSON.parse(
    JSON.stringify({ ...session, state: { ...session.state, stepStates: undefined } })
  ) as ChainSession;
  copy.state.stepStates = new Map(session.state.stepStates ?? []);
  return copy;
}

/** The most recent `chain_sessions` INSERT, decoded into the row a hook would SELECT. */
const latestHookRow = (
  db: RecordingDatabasePort
): { columns: string[]; params: unknown[]; state: Record<string, unknown> } | undefined => {
  const inserts = db.statements.filter((s) => s.sql.includes('INSERT INTO chain_sessions'));
  const last = inserts[inserts.length - 1];
  if (last === undefined) return undefined;
  const columnList = /INSERT INTO chain_sessions \(([^)]*)\)/.exec(last.sql)?.[1] ?? '';
  const columns = columnList.split(',').map((c) => c.trim());
  // `state` is the 5th bound parameter (run_number is a literal 1 in the statement).
  const state = JSON.parse(String(last.params[4])) as Record<string, unknown>;
  return { columns, params: last.params, state };
};

const countHookRows = (db: RecordingDatabasePort): number =>
  db.statements.filter((s) => s.sql.includes('INSERT INTO chain_sessions')).length;

describe('chain_sessions hook projection — byte parity', () => {
  let manager: ChainSessionStore;
  let db: RecordingDatabasePort;
  let schedulerSpy: ReturnType<typeof jest.spyOn>;

  const newManager = (suffix: string): ChainSessionStore => {
    db = new RecordingDatabasePort();
    const store = new ChainSessionStore(
      createLogger(),
      new StubTextReferenceStore() as any,
      { serverRoot: `/tmp/test-hookview-${suffix}`, cleanupIntervalMs: 1000 },
      undefined,
      new InMemoryRunRegistry()
    );
    store.setDatabasePort(db);
    return store;
  };

  beforeEach(() => {
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
    schedulerSpy.mockRestore();
  });

  test('an untouched 3-step run projects currentStep 1 / totalSteps 3', async () => {
    manager = newManager('fresh');
    await manager.createSession('s1', 'chain-a', 3);

    const row = latestHookRow(db);
    expect(row).toBeDefined();
    expect(row!.state['currentStep']).toBe(1);
    expect(row!.state['totalSteps']).toBe(3);
  });

  test('the state blob key set is exactly the shape hooks parse', async () => {
    manager = newManager('keys');
    await manager.createSession('s1', 'chain-a', 3);

    const row = latestHookRow(db)!;
    // Order-independent, exhaustive: an ADDED key is as much a contract change as a removed
    // one, because hook code across repos does dict access on this document.
    expect(Object.keys(row.state).sort()).toEqual([
      'chainId',
      'currentStep',
      'lastActivity',
      'pendingGateReview',
      'pendingShellVerification',
      'runCompletedAt',
      'runStatus',
      'sessionId',
      'totalSteps',
    ]);
    expect(typeof row.state['currentStep']).toBe('number');
    expect(typeof row.state['totalSteps']).toBe('number');
  });

  test('the chain_sessions column list is unchanged', async () => {
    manager = newManager('columns');
    await manager.createSession('s1', 'chain-a', 3);

    expect(latestHookRow(db)!.columns).toEqual([
      'run_owner_pid',
      'organization_id',
      'workspace_id',
      'chain_id',
      'run_number',
      'state',
      'run_status',
      'run_completed_at',
    ]);
  });

  test('after one advance a 3-step run projects currentStep 2 / totalSteps 3', async () => {
    manager = newManager('advanced-one');
    await manager.createSession('s1', 'chain-a', 3);

    await manager.updateSessionState('s1', 'n1', 'step one output');
    await manager.completeStep('s1', 'n1');
    const advanced = await manager.advanceStep('s1', 'n1');

    expect(advanced).toEqual({ nodeId: 'n2', ordinal: 2 });

    const row = latestHookRow(db)!;
    expect(row.state['currentStep']).toBe(2);
    expect(row.state['totalSteps']).toBe(3);
  });

  // OQ-P4-4: hook projection totals reflect the MUTATED node list. `projectToHookView` derives
  // both integers from `session.state.nodes` at write time, so this already falls out — these
  // two assert it stays true by test rather than by accident. P3's byte-parity guarantee was a
  // no-mutation invariant; under P4 the correct behaviour is that the numbers MOVE.
  test('an insertion raises totalSteps in the hook projection (OQ-P4-4)', async () => {
    manager = newManager('mutation-insert');
    await manager.createSession('s1', 'chain-a', 3);
    expect(latestHookRow(db)!.state['totalSteps']).toBe(3);

    const inserted = await manager.insertNodeAfter('s1', 'n1', {
      stepName: 'Investigate: TTL undecided',
      promptId: 'investigate_unknown',
      origin: 'inserted',
      unknownId: 'cache-ttl',
    });
    expect(inserted).not.toBeNull();

    const row = latestHookRow(db)!;
    expect(row.state['totalSteps']).toBe(4);
    // The run has not moved — an insertion lands after the current node, never before it.
    expect(row.state['currentStep']).toBe(1);
    // The shape hooks parse is unchanged; only the numbers moved.
    expect(Object.keys(row.state).sort()).toEqual([
      'chainId',
      'currentStep',
      'lastActivity',
      'pendingGateReview',
      'pendingShellVerification',
      'runCompletedAt',
      'runStatus',
      'sessionId',
      'totalSteps',
    ]);
  });

  test('a skip leaves totalSteps alone — the node stays in the list', async () => {
    manager = newManager('mutation-skip');
    await manager.createSession('s1', 'chain-a', 3);

    expect(await manager.markNodeSkipped('s1', 'n2', 'cache-ttl')).toBe(true);

    const row = latestHookRow(db)!;
    // A skipped node is retired, not deleted: ordinals around it must not shift, so the
    // denominator a hook renders is unchanged. Advancing then lands past it.
    expect(row.state['totalSteps']).toBe(3);
    // ...and the run walks straight over it. (The projection is not re-read here: a run standing
    // on its final step with no pending review stops being projected at all — see the test of
    // that rule below — so the store's own answer is the observable one.)
    expect(await manager.advanceStep('s1', 'n1')).toEqual({ nodeId: 'n3', ordinal: 3 });
  });

  test('advancing past a node the run already moved beyond does not walk it backwards', async () => {
    manager = newManager('double-advance');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.advanceStep('s1', 'n1');
    await manager.advanceStep('s1', 'n2');
    expect(manager.getSession('s1')!.state.currentNodeId).toBe('n3');

    // A late or duplicated advance for an earlier node — a retried verdict arriving after the
    // run moved on. Without the position guard `nextAfter('n1')` would reset the run to 'n2',
    // silently re-running a completed step. Re-advancing the CURRENT node is harmless by
    // construction (`nextAfter` is idempotent); only the backwards case needs guarding.
    const late = await manager.advanceStep('s1', 'n1');

    expect(late).toEqual({ nodeId: 'n3', ordinal: 3 });
    expect(manager.getSession('s1')!.state.currentNodeId).toBe('n3');
    expect(manager.getSession('s1')!.executionOrder).toEqual(['n1', 'n2']);
  });

  test('advancing on a node id the run does not contain leaves the run untouched', async () => {
    manager = newManager('unknown-node');
    await manager.createSession('s1', 'chain-a', 3);

    // Callers that cannot resolve a node pass '' rather than guessing; the store must treat
    // that as already-passed, not advance blind off an unknown identity.
    const advanced = await manager.advanceStep('s1', '');

    expect(advanced).toEqual({ nodeId: 'n1', ordinal: 1 });
    expect(manager.getSession('s1')!.state.currentNodeId).toBe('n1');
    expect(manager.getSession('s1')!.executionOrder).toEqual([]);
  });

  test('a run standing on its final step with no pending review is not projected', async () => {
    manager = newManager('advanced-two');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.advanceStep('s1', 'n1');
    const rowsBefore = countHookRows(db);
    await manager.advanceStep('s1', 'n2');

    // `isSessionActiveForHooks` requires `currentStep < totalSteps` unless something is
    // pending, so a run parked ON its last step drops out of the hook view — preserved
    // exactly, and asserted here because it is easy to "fix" while re-keying and thereby
    // start showing hooks runs they never used to see.
    expect(countHookRows(db)).toBe(rowsBefore);
  });

  test('a run advanced past its terminal node stops being projected at all', async () => {
    manager = newManager('complete');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.advanceStep('s1', 'n1');
    await manager.advanceStep('s1', 'n2');

    const rowsBefore = countHookRows(db);
    const advanced = await manager.advanceStep('s1', 'n3');

    // Run complete: no current node, and `isSessionActiveForHooks` filters it out — which is
    // why the `totalSteps + 1` sentinel is never observable to a hook (OQ2 ruling).
    expect(advanced).toEqual({ nodeId: null, ordinal: 4 });
    expect(countHookRows(db)).toBe(rowsBefore);
  });

  test('a run on its final step with a pending review stays projected', async () => {
    manager = newManager('final-pending');
    await manager.createSession('s1', 'chain-a', 2);
    await manager.advanceStep('s1', 'n1');
    await manager.setPendingGateReview('s1', {
      gateIds: ['accuracy'],
      prompts: [],
      attemptCount: 0,
      maxAttempts: 2,
      createdAt: Date.now(),
    } as any);

    const row = latestHookRow(db)!;
    expect(row.state['currentStep']).toBe(2);
    expect(row.state['totalSteps']).toBe(2);
    expect(row.state['pendingGateReview']).not.toBeNull();
  });

  test('getSessionStats counts a chain’s steps, not how far along it is', async () => {
    manager = newManager('stats');
    await manager.createSession('s1', 'chain-a', 5);
    await manager.advanceStep('s1', 'n1');
    await manager.advanceStep('s1', 'n2');

    // The run is standing at position 3 of 5. `averageStepsPerChain` asks how many steps the
    // chain HAS; summing the current position (the pre-Tier-2 behaviour) answered 3 and would
    // have kept climbing as the run progressed — a cardinality read off an identity.
    const stats = manager.getSessionStats();
    expect(stats.totalChains).toBe(1);
    expect(stats.averageStepsPerChain).toBe(5);
  });

  test('the projection and the blob save commit together', async () => {
    manager = newManager('atomic');
    await manager.createSession('s1', 'chain-a', 2);

    expect(db.transactions).toBeGreaterThan(0);
    expect(db.commits).toBe(db.transactions);
    expect(db.rollbacks).toBe(0);
    // The DELETE that clears this PID's rows precedes every INSERT in the same transaction.
    const deleteIndex = db.statements.findIndex((s) =>
      s.sql.includes('DELETE FROM chain_sessions')
    );
    const insertIndex = db.statements.findIndex((s) =>
      s.sql.includes('INSERT INTO chain_sessions')
    );
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
  });
});

// The 'position-keyed session upgrade' suite was deleted at v22 with the compat shim it pinned.
// It loaded a verbatim pre-node-identity blob and asserted the upgraded projection was
// byte-identical. There is no longer a blob to load: chain runs persist as chain_runs +
// chain_run_nodes rows, and the v22 bump drops the old table, so no old-format row can reach a
// v22 server. Its successor is the cold-load round-trip in
// tests/integration/chain/chain-run-storage.integration.test.ts, which reconstructs from real
// rows rather than from a hand-written document.
