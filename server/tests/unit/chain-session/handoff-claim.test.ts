/**
 * Cross-client chain handoff (plan 2A, T1).
 *
 * Two server processes sharing one state.db are modelled as two registries over one engine
 * with different run-owner scopes. The registry owns the transfer semantics (token is the key,
 * claim rewrites owner and burns the token in one statement, the donor's next save reports
 * the run as claimed elsewhere); the manager owns what happens in memory around them (mint,
 * load-on-claim, refuse-without-blueprint, evict-on-save). Cross-PROCESS coverage is row 2.2.
 */
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../src/engine/execution/pipeline/decisions/index.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import {
  DirectChainRunRegistry,
  type ChainRunRegistry,
  type ClaimRunResult,
} from '../../../src/modules/chains/run-registry.js';
import { buildIdentityScope } from '../../../src/shared/utils/request-identity-scope.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { StateStoreOptions } from '../../../src/shared/types/persistence.js';

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
}

const DONOR: StateStoreOptions = { continuityScopeId: 'pid-donor', workspaceId: 'ws-a' };
const CLAIMER: StateStoreOptions = { continuityScopeId: 'pid-claimer', workspaceId: 'ws-a' };
const FOREIGN_WS: StateStoreOptions = { continuityScopeId: 'pid-other', workspaceId: 'ws-b' };

function makeSession(sessionId: string, token?: string): ChainSession {
  return {
    sessionId,
    chainId: 'chain-demo#1',
    state: {
      currentNodeId: 'n1',
      nodes: [
        { id: 'n1', promptId: 'p1', stepName: 'one' },
        { id: 'n2', promptId: 'p2', stepName: 'two' },
      ] as ChainSession['state']['nodes'],
      lastUpdated: 1,
      stepStates: new Map(),
    },
    executionOrder: [],
    startTime: 1,
    lastActivity: 1,
    originalArgs: {},
    lifecycle: 'canonical',
    runStatus: 'working',
    blueprint: {
      parsedCommand: { promptId: 'p1' },
      executionPlan: {
        strategy: 'chain',
        gates: [],
        requiresFramework: false,
        requiresSession: true,
      },
    },
    ...(token !== undefined && { handoffToken: token }),
  };
}

describe('DirectChainRunRegistry handoff transfer', () => {
  let tmpRoot: string;
  let engine: SqliteEngine;
  let donor: DirectChainRunRegistry;
  let claimer: DirectChainRunRegistry;

  const snapshot = () => ({
    runs: engine.query('SELECT * FROM chain_runs ORDER BY session_id'),
    nodes: engine.query('SELECT * FROM chain_run_nodes ORDER BY session_id, position'),
  });

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
    engine = await SqliteEngine.getInstance(createLogger() as any, {
      dbPath: path.join(tmpRoot, 'runtime-state', 'state.db'),
    });
    await engine.initialize();
    donor = new DirectChainRunRegistry(engine);
    claimer = new DirectChainRunRegistry(engine);
  });

  afterAll(async () => {
    await engine.shutdown();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('the token is persisted on the row and comes back on load', async () => {
    await donor.save([makeSession('s-mint', 'hnd_token-1')], DONOR);

    const [loaded] = await donor.load(DONOR);

    expect(loaded?.handoffToken).toBe('hnd_token-1');
  });

  test('a claim transfers ownership, burns the token, and the donor evicts on its next save', async () => {
    const session = makeSession('s-claim', 'hnd_token-2');
    await donor.save([session], DONOR);

    const result = claimer.claimRunByToken('hnd_token-2', CLAIMER);

    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') return;
    expect(result.session.sessionId).toBe('s-claim');
    expect(result.session.handoffToken).toBeUndefined();
    expect(result.session.blueprint).toBeDefined();
    expect(result.session.state.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);

    // The row now belongs to the claimer: its load sees it, the donor's does not.
    expect((await claimer.load(CLAIMER)).map((s) => s.sessionId)).toContain('s-claim');
    expect((await donor.load(DONOR)).map((s) => s.sessionId)).not.toContain('s-claim');

    // The donor still holds the run in memory; its next save must neither collide nor revive it.
    const evicted = await donor.save([session], DONOR);
    expect(evicted).toEqual(['s-claim']);
    expect((await claimer.load(CLAIMER)).map((s) => s.sessionId)).toContain('s-claim');
  });

  test('a run HOLDING on the unknown interrupt hands the hold to the claimer (D-9, row 4.2)', async () => {
    // The claimer must receive the INTERRUPT, not the next step. The mechanism the ruling bets on
    // is that `__unknown_interrupt__` is an ordinary gate review riding the run's residual
    // document (`reviews`), so ownership transfer carries it like any other pending state —
    // "expected free". Free is a prediction about a path nobody drove, which is why D-9 asks for
    // a test.
    const held = makeSession('s-held', 'hnd_token-held');
    held.reviews = {
      n1: {
        nodeId: 'n1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        combinedPrompt: 'A blocking unknown stopped this plan.',
        gateIds: [UNKNOWN_INTERRUPT_GATE_ID],
        prompts: [],
        createdAt: 1,
        attemptCount: 0,
        maxAttempts: 1,
        metadata: { unknownId: 'plan-shape' },
      },
    };
    held.unknownsLedger = [
      {
        id: 'plan-shape',
        statement: 'the rest of the plan may be wrong',
        state: 'active',
        blocking: true,
        openedAt: 1,
        updatedAt: 1,
      },
    ] as unknown as ChainSession['unknownsLedger'];
    await donor.save([held], DONOR);

    const result = claimer.claimRunByToken('hnd_token-held', CLAIMER);

    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') return;
    expect(result.session.reviews?.['n1']?.gateIds).toEqual([UNKNOWN_INTERRUPT_GATE_ID]);
    // The hold alone is not enough to re-raise the interrupt on the claimer's side — the OPEN
    // blocking entry is what `decideInterrupt` reads, and it has to survive the transfer too.
    expect(result.session.unknownsLedger?.[0]).toMatchObject({
      id: 'plan-shape',
      blocking: true,
      state: 'active',
    });
  });

  test('a raw qualified claim transfers blueprint, node capture and report attempts exactly (R7)', async () => {
    const session = makeSession('r7-claim', 'hnd_r7-qualified');
    session.chainId = 'chain-plan/table/detail#01';
    session.continuityScopeId = 'r7-request-identity';
    session.blueprint!.parsedCommand.promptId = 'plan/table/detail';
    session.state.currentNodeId = 'n2';
    session.state.nodes[0]!.promptId = 'plan/table/collect';
    session.state.nodes[1]!.promptId = 'plan/table/report';
    session.state.nodes.forEach((node) => {
      node.origin = 'planned';
    });
    session.state.stepStates!.set('n1', {
      state: 'completed',
      isPlaceholder: false,
      respondedAt: 17,
      completedAt: 18,
    });
    session.executionOrder = ['n1'];
    session.reviews = {
      n2: {
        nodeId: 'n2',
        kind: 'detached',
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: ['quality'],
        prompts: [],
        createdAt: 19,
        attemptCount: 1,
        maxAttempts: 2,
        reviewedOutput: 'qualified report bytes',
      },
    };
    await donor.save([session], DONOR);
    const result = claimer.claimRunByToken('hnd_r7-qualified', CLAIMER);
    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') throw new Error(`Unexpected claim status: ${result.status}`);
    expect(result.session.chainId).toBe('chain-plan/table/detail#01');
    expect(result.session.continuityScopeId).toBe('r7-request-identity');
    expect(result.session.blueprint).toEqual(session.blueprint);
    expect(result.session.state.nodes).toEqual(session.state.nodes);
    expect(result.session.state.currentNodeId).toBe('n2');
    expect(result.session.state.stepStates?.get('n1')).toEqual(session.state.stepStates!.get('n1'));
    expect(result.session.executionOrder).toEqual(['n1']);
    expect(result.session.reviews?.['n2']).toEqual(session.reviews['n2']);
    expect(result.session.handoffToken).toBeUndefined();
    expect((await donor.load(DONOR)).find((run) => run.sessionId === 'r7-claim')).toBeUndefined();
    expect((await claimer.load(CLAIMER)).find((run) => run.sessionId === 'r7-claim')?.chainId).toBe(
      'chain-plan/table/detail#01'
    );
  });

  test('foreign launch storage namespace refusal retains a qualified token and its report (R7)', async () => {
    const session = makeSession('r7-storage-refusal', 'hnd_r7-storage-refusal');
    session.chainId = 'chain-plan/table#1';
    session.continuityScopeId = 'request-a';
    session.reviews = {
      n1: {
        nodeId: 'n1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: ['quality'],
        prompts: [],
        createdAt: 1,
        attemptCount: 1,
        maxAttempts: 2,
        previousResponse: 'retained capture',
      },
    };
    await donor.save([session], DONOR);
    expect(claimer.claimRunByToken('hnd_r7-storage-refusal', FOREIGN_WS)).toEqual({
      status: 'workspace-mismatch',
      rowWorkspaceId: 'ws-a',
      claimantWorkspaceId: 'ws-b',
    });
    const retained = (await donor.load(DONOR)).find((run) => run.sessionId === session.sessionId);
    expect(retained?.chainId).toBe(session.chainId);
    expect(retained?.continuityScopeId).toBe('request-a');
    expect(retained?.handoffToken).toBe('hnd_r7-storage-refusal');
    expect(retained?.state.currentNodeId).toBe('n1');
    expect(retained?.reviews?.['n1']).toEqual(session.reviews['n1']);
    expect(claimer.claimRunByToken('hnd_r7-storage-refusal', CLAIMER).status).toBe('claimed');
  });

  test('a spent token is refused', async () => {
    await donor.save([makeSession('s-spent', 'hnd_token-3')], DONOR);
    expect(claimer.claimRunByToken('hnd_token-3', CLAIMER).status).toBe('claimed');

    expect(claimer.claimRunByToken('hnd_token-3', CLAIMER)).toEqual({ status: 'unknown-token' });
    expect(claimer.claimRunByToken('never-minted', CLAIMER)).toEqual({ status: 'unknown-token' });
  });

  test('F20 requester mismatch preserves token, actor, storage and logical state before a matching claim', async () => {
    const session = makeSession('f20-retention', 'hnd_f20-retention');
    session.chainId = 'chain-plan/table#01';
    session.continuityScopeId = 'request-original';
    session.state.nodes.forEach((node) => {
      node.origin = 'planned';
    });
    session.state.currentNodeId = 'n2';
    session.state.stepStates!.set('n1', {
      state: 'completed',
      isPlaceholder: false,
      respondedAt: 17,
      completedAt: 18,
    });
    session.executionOrder = ['n1'];
    session.reviews = {
      n2: {
        nodeId: 'n2',
        kind: 'gate',
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: ['quality'],
        prompts: [],
        createdAt: 19,
        attemptCount: 1,
        maxAttempts: 2,
        previousResponse: 'retained capture',
        reviewedOutput: 'retained report',
      },
    };
    await donor.save([session], { ...DONOR, organizationId: 'storage-org' });
    const store = new ChainSessionStore(
      createLogger(),
      new StubTextReferenceStore() as any,
      {
        cleanupIntervalMs: 1000,
        defaultScope: { workspaceId: 'ws-a', organizationId: 'storage-org' },
      },
      engine,
      claimer
    );
    try {
      const refused = await store.claimHandoff('hnd_f20-retention', {
        continuityScopeId: 'foreign',
      });
      expect(
        engine.queryOne(
          'SELECT run_owner_pid, workspace_id, organization_id, handoff_token FROM chain_runs WHERE session_id = ?',
          [session.sessionId]
        )
      ).toEqual({
        run_owner_pid: 'pid-donor',
        workspace_id: 'ws-a',
        organization_id: 'storage-org',
        handoff_token: 'hnd_f20-retention',
      });
      expect(refused).toEqual({
        status: 'request-continuity-mismatch',
        runContinuityScopeId: 'request-original',
        requestContinuityScopeId: 'foreign',
      });
      expect(store.hasActiveSession(session.sessionId)).toBe(false);
      const retained = (await donor.load(DONOR)).find(
        (run) => run.sessionId === session.sessionId
      )!;
      expect(retained.continuityScopeId).toBe('request-original');
      expect(retained.chainId).toBe('chain-plan/table#01');
      expect(retained.blueprint).toEqual(session.blueprint);
      expect(retained.state.nodes).toEqual(session.state.nodes);
      expect(retained.state.currentNodeId).toBe('n2');
      expect(retained.state.stepStates?.get('n1')).toEqual(session.state.stepStates!.get('n1'));
      expect(retained.executionOrder).toEqual(['n1']);
      expect(retained.reviews?.['n2']).toEqual(session.reviews['n2']);
      expect(
        await store.claimHandoff('hnd_f20-retention', { continuityScopeId: 'request-original' })
      ).toMatchObject({ status: 'claimed', session: { continuityScopeId: 'request-original' } });
      expect(
        engine.queryOne(
          'SELECT run_owner_pid, workspace_id, organization_id, handoff_token FROM chain_runs WHERE session_id = ?',
          [session.sessionId]
        )
      ).toEqual({
        run_owner_pid: String(process.pid),
        workspace_id: 'ws-a',
        organization_id: 'storage-org',
        handoff_token: null,
      });
      expect(store.hasActiveSession(session.sessionId)).toBe(true);
    } finally {
      await store.cleanup();
    }
  });

  test.each([undefined, 'default'])(
    'F20 meaningful requester refuses stored continuity %s without burning',
    async (continuity) => {
      const id = `f20-missing-${String(continuity)}`;
      const token = `hnd_${id}`;
      const session = makeSession(id, token);
      session.continuityScopeId = continuity;
      await donor.save([session], DONOR);
      expect(claimer.claimRunByToken(token, CLAIMER, 'request-original')).toEqual({
        status: 'request-continuity-mismatch',
        runContinuityScopeId: continuity,
        requestContinuityScopeId: 'request-original',
      });
      expect((await donor.load(DONOR)).find((run) => run.sessionId === id)?.handoffToken).toBe(
        token
      );
      expect(claimer.claimRunByToken(token, CLAIMER).status).toBe('claimed');
    }
  );

  test.each([
    ['absent', undefined, 'foreign', 'claimed'],
    ['default', { continuityScopeId: 'default', workspaceId: 'default' }, 'foreign', 'claimed'],
    [
      'organization fallback',
      buildIdentityScope({ workspaceId: 'default', organizationId: 'org-request' }),
      'foreign',
      'request-continuity-mismatch',
    ],
  ] as const)(
    'F20 manager preserves %s requester normalization and PID storage ownership',
    async (label, requestScope, continuity, status) => {
      const session = makeSession(`f20-normalize-${label}`, `hnd_f20-${label}`);
      session.chainId = `chain-f20-normalize-${label.replace(/ /g, '-')}#0`;
      session.continuityScopeId = continuity;
      await donor.save([session], DONOR);
      const store = new ChainSessionStore(
        createLogger(),
        new StubTextReferenceStore() as any,
        { cleanupIntervalMs: 1000, defaultScope: { workspaceId: 'ws-a' } },
        engine,
        claimer
      );
      try {
        const result = await store.claimHandoff(`hnd_f20-${label}`, requestScope);
        expect(result.status).toBe(status);
        if (status === 'request-continuity-mismatch') {
          expect(result).toEqual({
            status,
            runContinuityScopeId: 'foreign',
            requestContinuityScopeId: 'org-request',
          });
          expect(store.hasActiveSession(session.sessionId)).toBe(false);
          expect(
            (await donor.load(DONOR)).find((run) => run.sessionId === session.sessionId)
              ?.handoffToken
          ).toBe(`hnd_f20-${label}`);
        } else {
          expect(
            engine.queryOne(
              'SELECT run_owner_pid, workspace_id FROM chain_runs WHERE session_id = ?',
              [session.sessionId]
            )
          ).toEqual({ run_owner_pid: String(process.pid), workspace_id: 'ws-a' });
        }
      } finally {
        await store.cleanup();
      }
    }
  );

  test('a claim from another workspace is refused and leaves the row untouched', async () => {
    await donor.save([makeSession('s-ws', 'hnd_token-4')], DONOR);

    const result = claimer.claimRunByToken('hnd_token-4', FOREIGN_WS);

    expect(result).toEqual({
      status: 'workspace-mismatch',
      rowWorkspaceId: 'ws-a',
      claimantWorkspaceId: 'ws-b',
    });
    expect((await donor.load(DONOR)).find((s) => s.sessionId === 's-ws')?.handoffToken).toBe(
      'hnd_token-4'
    );
  });
  test.each([
    undefined,
    null,
    {},
    [],
    'bad',
    { parsedCommand: {} },
    { parsedCommand: { promptId: 'p1' }, executionPlan: null },
  ])('C1 incompatible blueprint %j refuses without changing rows', async (blueprint) => {
    const session = makeSession('c1-invalid', 'hnd_c1-invalid');
    await donor.save([session], DONOR);
    const state = engine.queryOne<{ state: string }>(
      'SELECT state FROM chain_runs WHERE session_id = ?',
      [session.sessionId]
    )!.state;
    engine.run('UPDATE chain_runs SET state = ? WHERE session_id = ?', [
      JSON.stringify({ ...JSON.parse(state), blueprint }),
      session.sessionId,
    ]);
    const before = snapshot();
    expect(claimer.claimRunByToken('hnd_c1-invalid', CLAIMER)).toEqual({
      status: 'no-blueprint',
      chainId: session.chainId,
    });
    expect(snapshot()).toEqual(before);
  });

  test.each(['completed', 'failed', 'cancelled', 'workspace', 'continuity'] as const)(
    'C1 %s refusal preserves every row',
    async (kind) => {
      const session = makeSession('c1-refusal', 'hnd_c1-refusal');
      if (kind !== 'workspace' && kind !== 'continuity') session.runStatus = kind;
      await donor.save([session], DONOR);
      const before = snapshot();
      const result = claimer.claimRunByToken(
        'hnd_c1-refusal',
        kind === 'workspace' ? FOREIGN_WS : CLAIMER,
        kind === 'continuity' ? 'foreign' : undefined
      );
      expect(result.status).toBe(
        kind === 'workspace'
          ? 'workspace-mismatch'
          : kind === 'continuity'
            ? 'request-continuity-mismatch'
            : 'unknown-token'
      );
      expect(snapshot()).toEqual(before);
    }
  );

  test.each(['inserted', 'remainder'] as const)(
    'C1 compatible %s nodes and null pointer claim',
    async (origin) => {
      const session = makeSession(`c1-compatible-${origin}`, 'hnd_c1-compatible');
      session.state.nodes[1]!.origin = origin;
      session.state.currentNodeId = null;
      session.runStatus = 'working';
      await donor.save([session], DONOR);
      expect(claimer.claimRunByToken('hnd_c1-compatible', CLAIMER)).toMatchObject({
        status: 'claimed',
        session: { state: { currentNodeId: null, nodes: [{}, { origin }] } },
      });
    }
  );

  test.each(['nested', 'busy', 'locked', 'zero', 'throw'])(
    'C1 %s transfer boundary',
    async (kind) => {
      const session = makeSession(`c1-boundary-${kind}`, 'hnd_c1-boundary');
      await donor.save([session], DONOR);
      const before = snapshot(),
        query = engine.queryOne.bind(engine);
      const sibling = new DatabaseSync(path.join(tmpRoot, 'runtime-state', 'state.db'));
      sibling.exec('PRAGMA busy_timeout=0');
      engine.run('PRAGMA busy_timeout=0');
      if (kind === 'busy') sibling.exec('BEGIN IMMEDIATE');
      let callerCommitted = false,
        updateSeen = false;
      const spy = jest.spyOn(engine, 'queryOne').mockImplementation((sql, params) => {
        if (sql.includes('UPDATE chain_runs')) {
          updateSeen = true;
          if (kind === 'zero') return null;
          if (kind === 'locked')
            expect(() =>
              sibling
                .prepare('UPDATE chain_runs SET state = ? WHERE session_id = ?')
                .run('{"blueprint":null}', session.sessionId)
            ).toThrow(/locked|busy/);
          const result = query(sql, params);
          if (kind === 'throw') throw new Error('C1 after transfer');
          return result;
        }
        return query(sql, params);
      });
      try {
        if (kind === 'nested') {
          engine.beginTransaction('immediate');
          engine.run('UPDATE chain_runs SET last_activity = 7 WHERE session_id = ?', [
            session.sessionId,
          ]);
          const caller = snapshot();
          expect(() => claimer.claimRunByToken('hnd_c1-boundary', CLAIMER)).toThrow(/transaction/);
          expect(snapshot()).toEqual(caller);
          expect(
            sibling
              .prepare('SELECT last_activity FROM chain_runs WHERE session_id = ?')
              .get(session.sessionId)
          ).toEqual({ last_activity: 1 });
          engine.commit();
          callerCommitted = true;
          expect(
            sibling
              .prepare('SELECT last_activity FROM chain_runs WHERE session_id = ?')
              .get(session.sessionId)
          ).toEqual({ last_activity: 7 });
        } else if (kind === 'throw' || kind === 'busy')
          expect(() => claimer.claimRunByToken('hnd_c1-boundary', CLAIMER)).toThrow(
            kind === 'busy' ? /locked|busy/ : 'C1 after transfer'
          );
        else
          expect(claimer.claimRunByToken('hnd_c1-boundary', CLAIMER).status).toBe(
            kind === 'zero' ? 'unknown-token' : 'claimed'
          );
        if (kind === 'throw' || kind === 'zero' || kind === 'busy')
          expect(snapshot()).toEqual(before);
        if (kind !== 'nested' && kind !== 'busy') expect(updateSeen).toBe(true);
      } finally {
        spy.mockRestore();
        sibling.close();
        if (kind === 'nested' && !callerCommitted) {
          try {
            engine.rollback();
          } catch {
            /* A failing claim may have ended the caller transaction. */
          }
        }
      }
    }
  );
  const realStore = () =>
    new ChainSessionStore(
      createLogger(),
      new StubTextReferenceStore() as any,
      { cleanupIntervalMs: 100000, defaultScope: { workspaceId: 'ws-a' } },
      engine
    );
  test.each([
    'absent',
    'incompatible',
    'legacy',
    'chain',
    'inserted',
    'remainder',
    'detached',
  ] as const)('C2 real-store %s custody', async (kind) => {
    const session = makeSession(`c2-${kind}`, `hnd_c2-${kind}`);
    session.chainId = `chain-c2-${kind}#1`;
    session.state.nodes.forEach((node) => {
      node.origin = 'planned';
    });
    if (kind === 'absent') delete session.blueprint;
    if (kind === 'incompatible')
      session.blueprint = { parsedCommand: {} } as ChainSession['blueprint'];
    if (kind === 'chain')
      session.blueprint!.parsedCommand.steps = [{ nodeId: 'n1' }, { nodeId: 'n2' }];
    if (kind === 'inserted' || kind === 'remainder') session.state.nodes[1]!.origin = kind;
    if (kind === 'detached') {
      session.state.currentNodeId = null;
      session.runStatus = 'working';
      session.reviews = {
        n2: {
          nodeId: 'n2',
          kind: 'detached',
          phase: 'awaiting-verdict',
          combinedPrompt: '',
          gateIds: ['quality'],
          prompts: [],
          createdAt: 1,
          attemptCount: 1,
          maxAttempts: 2,
          reviewedOutput: 'retained report',
        },
      };
    }
    await donor.save([session], DONOR);
    const before = snapshot(),
      store = realStore();
    try {
      const result = await store.claimHandoff(`hnd_c2-${kind}`);
      if (kind === 'absent' || kind === 'incompatible') {
        expect(result.status).toBe('no-blueprint');
        expect(snapshot()).toEqual(before);
        expect(store.hasActiveSession(session.sessionId)).toBe(false);
      } else {
        expect(result).toMatchObject({
          status: 'claimed',
          session: {
            sessionId: session.sessionId,
            lifecycle: 'dormant',
            blueprint: session.blueprint,
            ...(session.reviews ? { reviews: session.reviews } : {}),
            state: { nodes: session.state.nodes, currentNodeId: session.state.currentNodeId },
          },
        });
        expect(
          engine.queryOne(
            'SELECT run_owner_pid, handoff_token FROM chain_runs WHERE session_id = ?',
            [session.sessionId]
          )
        ).toEqual({ run_owner_pid: String(process.pid), handoff_token: null });
        expect(
          store.getSessionByChainIdentifier(session.chainId, { includeDormant: true })?.lifecycle
        ).toBe('canonical');
      }
    } finally {
      await store.cleanup();
    }
  });
  test('C2 queued claim waits for an actual open save transaction', async () => {
    const session = makeSession('c2-wait', 'hnd_c2-wait');
    session.chainId = 'chain-c2-wait#1';
    await donor.save([session], DONOR);
    const store = realStore();
    await store.createSession('c2-local', 'chain-c2-local#1', 1);
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((resolve) => {
        release = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
    const registry = (store as unknown as { runRegistry: ChainRunRegistry }).runRegistry;
    const save = registry.save.bind(registry),
      transfer = jest.spyOn(registry, 'claimRunByToken');
    const blockedSave = jest.spyOn(registry, 'save').mockImplementationOnce(async (...args) => {
      const result = await save(...args);
      entered();
      await hold;
      return result;
    });
    const pending = store.mintHandoffToken('c2-local');
    await ready;
    const observer = new DatabaseSync(path.join(tmpRoot, 'runtime-state', 'state.db'));
    observer.exec('PRAGMA busy_timeout=0');
    const claim = store
      .claimHandoff('hnd_c2-wait')
      .catch((error) => ({ status: 'claim-error', error }));
    try {
      expect(() => observer.exec('BEGIN IMMEDIATE')).toThrow(/locked|busy/);
      await Promise.resolve();
      await Promise.resolve();
      expect(transfer).not.toHaveBeenCalled();
      release();
      await pending;
      expect(await claim).toMatchObject({
        status: 'claimed',
        session: { sessionId: session.sessionId },
      });
      expect(transfer).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await pending;
      await claim;
      observer.close();
      blockedSave.mockRestore();
      transfer.mockRestore();
      await store.cleanup();
    }
  });
});

describe('ChainSessionStore handoff verbs', () => {
  /** A registry double whose claim result the test chooses. */
  function fakeRegistry(claim: ClaimRunResult, evictOnSave: string[] = []): ChainRunRegistry {
    return {
      ensureInitialized: jest.fn(async () => {}),
      load: jest.fn(async () => []),
      save: jest.fn(async () => evictOnSave),
      claimRunByToken: jest.fn(() => claim),
      deleteRunsForOwners: jest.fn(),
    };
  }

  function makeStore(registry: ChainRunRegistry): ChainSessionStore {
    jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
    return new ChainSessionStore(
      createLogger(),
      new StubTextReferenceStore() as any,
      { cleanupIntervalMs: 1000 },
      undefined,
      registry
    );
  }

  test('mint returns a token, stores it on the session, and refuses terminal runs', async () => {
    const store = makeStore(fakeRegistry({ status: 'unknown-token' }));
    await store.createSession('s1', 'chain-demo#1', 2);

    const minted = await store.mintHandoffToken('s1');

    expect(minted?.chainId).toBe('chain-demo#1');
    expect(minted?.token).toMatch(/^hnd_/);
    expect(store.getSession('s1')?.handoffToken).toBe(minted?.token);

    await store.cancelChain('s1');
    expect(await store.mintHandoffToken('s1')).toBeUndefined();
    await store.cleanup();
  });

  test('claim loads the transferred run into memory as dormant', async () => {
    const store = makeStore(fakeRegistry({ status: 'claimed', session: makeSession('s-in') }));

    const result = await store.claimHandoff('hnd_x');

    expect(result.status).toBe('claimed');
    // Parked dormant on arrival, like every persisted run on load… (read the map directly:
    // every public accessor promotes a dormant run, which is the behavior under test next)
    const activeSessions = (store as any).activeSessions as Map<string, ChainSession>;
    expect(activeSessions.get('s-in')?.lifecycle).toBe('dormant');
    // …and promoted by the explicit resume the claimer issues next.
    const loaded = store.getSessionByChainIdentifier('chain-demo#1', { includeDormant: true });
    expect(loaded?.sessionId).toBe('s-in');
    expect(loaded?.lifecycle).toBe('canonical');
    await store.cleanup();
  });

  test('claim refuses a run with no blueprint and does not load it', async () => {
    const bare = makeSession('s-bare');
    delete bare.blueprint;
    const store = makeStore(fakeRegistry({ status: 'no-blueprint', chainId: bare.chainId }));

    const result = await store.claimHandoff('hnd_y');

    expect(result).toEqual({ status: 'no-blueprint', chainId: 'chain-demo#1' });
    expect(store.hasActiveSession('s-bare')).toBe(false);
    await store.cleanup();
  });

  test('a run the registry reports as claimed elsewhere is evicted on save', async () => {
    const store = makeStore(fakeRegistry({ status: 'unknown-token' }, ['s-gone']));
    await store.createSession('s-gone', 'chain-demo#1', 2);
    // createSession already persisted once; the fake reports the eviction on that save.

    expect(store.hasActiveSession('s-gone')).toBe(false);
    await store.cleanup();
  });
});
