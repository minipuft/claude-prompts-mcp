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

import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../src/engine/execution/pipeline/decisions/index.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import {
  DirectChainRunRegistry,
  type ChainRunRegistry,
  type ClaimRunResult,
} from '../../../src/modules/chains/run-registry.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { StateStoreOptions } from '../../../src/shared/types/persistence.js';

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
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
    blueprint: { parsedCommand: { promptId: 'p1' } } as unknown as ChainSession['blueprint'],
    ...(token !== undefined && { handoffToken: token }),
  };
}

describe('DirectChainRunRegistry handoff transfer', () => {
  let tmpRoot: string;
  let engine: SqliteEngine;
  let donor: DirectChainRunRegistry;
  let claimer: DirectChainRunRegistry;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
    engine = await SqliteEngine.getInstance(tmpRoot, createLogger() as any);
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
    // is that `__unknown_interrupt__` is an ordinary `pendingGateReview` riding the run's residual
    // document, so ownership transfer carries it like any other pending state — "expected free".
    // Free is a prediction about a path nobody drove, which is why D-9 asks for a test.
    const held = makeSession('s-held', 'hnd_token-held');
    held.pendingGateReview = {
      combinedPrompt: 'A blocking unknown stopped this plan.',
      gateIds: [UNKNOWN_INTERRUPT_GATE_ID],
      prompts: [],
      createdAt: 1,
      attemptCount: 0,
      maxAttempts: 1,
      metadata: { unknownId: 'plan-shape' },
    } as unknown as ChainSession['pendingGateReview'];
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
    expect(result.session.pendingGateReview?.gateIds).toEqual([UNKNOWN_INTERRUPT_GATE_ID]);
    // The hold alone is not enough to re-raise the interrupt on the claimer's side — the OPEN
    // blocking entry is what `decideInterrupt` reads, and it has to survive the transfer too.
    expect(result.session.unknownsLedger?.[0]).toMatchObject({
      id: 'plan-shape',
      blocking: true,
      state: 'active',
    });
  });

  test('a spent token is refused', async () => {
    await donor.save([makeSession('s-spent', 'hnd_token-3')], DONOR);
    expect(claimer.claimRunByToken('hnd_token-3', CLAIMER).status).toBe('claimed');

    expect(claimer.claimRunByToken('hnd_token-3', CLAIMER)).toEqual({ status: 'unknown-token' });
    expect(claimer.claimRunByToken('never-minted', CLAIMER)).toEqual({ status: 'unknown-token' });
  });

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
      { serverRoot: '/tmp/handoff-store', cleanupIntervalMs: 1000 },
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
    const store = makeStore(fakeRegistry({ status: 'claimed', session: bare }));

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
