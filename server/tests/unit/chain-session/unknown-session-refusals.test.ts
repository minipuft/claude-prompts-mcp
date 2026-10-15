/**
 * Every `ChainSessionStore` method that is handed an id the store never created must refuse
 * with its own named value and leave the store exactly as it found it.
 *
 * Two tables, one per kind of caller: mutators (which would otherwise persist) and readers. Each
 * row asserts the refusal AND carries a control that runs the same call against a real session
 * and sees it succeed, so a refusal is never read from a probe that cannot observe anything.
 * "Unchanged" is measured on a store that holds one real session: the run map, that session's
 * whole state, the stats, and the persist funnel (`persistSessionsOrThrow`, which every persisting
 * path runs through) must not move.
 *
 * Methods with no branch of their own for an unknown id are covered by the behaviour anyway and
 * named here: the readers `getStepState`, `getSessionBlueprint`, `getInlineGateIds`, `getReview`,
 * `getPendingShellVerification`, `isStepComplete` and the `clear*` mutators answer an unknown id
 * through optional chaining or a combined condition, and `recordStepDeclaration` through
 * `setStepState`.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore, type SessionBlueprint } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type {
  GateReview,
  PendingGateReview,
  PendingShellVerificationSnapshot,
} from '../../../src/shared/types/chain-execution.js';

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

const UNKNOWN = 'never-created';
const REAL = 'real';

const review = (nodeId: string, kind: GateReview['kind'] = 'gate'): GateReview => ({
  nodeId,
  kind,
  phase: 'awaiting-verdict',
  combinedPrompt: 'review this',
  gateIds: ['gate-a'],
  prompts: [],
  createdAt: 1,
  attemptCount: 0,
  maxAttempts: 3,
});

const pendingReview = (nodeId: string): PendingGateReview => {
  const { kind: _kind, phase: _phase, ...legacy } = review(nodeId);
  return legacy;
};

const shellVerification = (): PendingShellVerificationSnapshot => ({
  gateId: 'gate-shell',
  shellVerify: { command: 'true' },
  attemptCount: 0,
  maxAttempts: 3,
  previousResults: [],
});

const blueprint = (): SessionBlueprint => ({
  parsedCommand: {
    promptId: 'chain-real',
    commandType: 'chain',
    inlineGateIds: ['inline_gate_real'],
  },
  executionPlan: {
    strategy: 'chain',
    gates: ['framework-compliance'],
    requiresFramework: true,
    requiresSession: true,
  },
});

/** One method's refusal on `UNKNOWN`, and the same call succeeding on `REAL`. */
interface RefusalRow {
  readonly method: string;
  readonly refusal: (store: ChainSessionStore) => Promise<void> | void;
  readonly control: (store: ChainSessionStore) => Promise<void> | void;
  /** Builds the control's session when a three-node run is not the right starting point. */
  readonly setup?: (store: ChainSessionStore) => Promise<void>;
}

const MUTATORS: readonly RefusalRow[] = [
  {
    method: 'setStepState',
    refusal: (s) => expect(s.setStepState(UNKNOWN, 'n1', 'rendered')).toBe(false),
    control: (s) => {
      expect(s.setStepState(REAL, 'n1', 'rendered')).toBe(true);
      expect(s.getStepState(REAL, 'n1')).toBeDefined();
    },
  },
  {
    method: 'recordStepDeclaration',
    refusal: (s) => expect(s.recordStepDeclaration(UNKNOWN, 'n1', ['a'])).toBe(false),
    control: (s) => {
      expect(s.recordStepDeclaration(REAL, 'n1', ['a'])).toBe(true);
      expect(s.getStepState(REAL, 'n1')?.declaredSections).toEqual(['a']);
    },
  },
  {
    method: 'transitionRunStatus',
    refusal: async (s) => expect(await s.transitionRunStatus(UNKNOWN, 'cancelled')).toBe(false),
    control: async (s) => {
      expect(await s.transitionRunStatus(REAL, 'cancelled')).toBe(true);
      expect(s.getSession(REAL)?.runStatus).toBe('cancelled');
    },
  },
  {
    method: 'markNodeSpawned',
    refusal: async (s) => expect(await s.markNodeSpawned(UNKNOWN, 'n1')).toBe(false),
    control: async (s) => {
      expect(await s.markNodeSpawned(REAL, 'n1')).toBe(true);
      expect(s.getStepState(REAL, 'n1')?.spawnedAt).toBeDefined();
    },
  },
  {
    method: 'completeHeldRun',
    refusal: async (s) => expect(await s.completeHeldRun(UNKNOWN)).toBe(false),
    setup: async (s) => {
      await s.createSession(REAL, 'chain-real', 1);
      await s.advanceStep(REAL, 'n1');
    },
    control: async (s) => {
      expect(await s.completeHeldRun(REAL)).toBe(true);
      expect(s.getSession(REAL)?.runStatus).toBe('completed');
    },
  },
  {
    method: 'mintHandoffToken',
    refusal: async (s) => expect(await s.mintHandoffToken(UNKNOWN)).toBeUndefined(),
    control: async (s) => {
      const minted = await s.mintHandoffToken(REAL);
      expect(minted).toEqual({
        token: expect.stringMatching(/^hnd_/),
        chainId: expect.any(String),
        sessionId: REAL,
      });
    },
  },
  {
    method: 'cancelChain',
    refusal: async (s) => expect(await s.cancelChain(UNKNOWN)).toBe(false),
    control: async (s) => {
      expect(await s.cancelChain(REAL)).toBe(true);
      expect(s.getSession(REAL)?.runStatus).toBe('cancelled');
    },
  },
  {
    method: 'updateSessionState',
    refusal: async (s) => expect(await s.updateSessionState(UNKNOWN, 'n1', 'result')).toBe(false),
    control: async (s) => {
      expect(await s.updateSessionState(REAL, 'n1', 'result')).toBe(true);
      expect(s.getStepState(REAL, 'n1')).toBeDefined();
    },
  },
  {
    method: 'completeStep',
    refusal: async (s) => expect(await s.completeStep(UNKNOWN, 'n1')).toBe(false),
    control: async (s) => {
      expect(await s.completeStep(REAL, 'n1')).toBe(true);
      expect(s.isStepComplete(REAL, 'n1')).toBe(true);
    },
  },
  {
    method: 'advanceStep',
    refusal: async (s) => expect(await s.advanceStep(UNKNOWN, 'n1')).toBe(false),
    control: async (s) =>
      expect(await s.advanceStep(REAL, 'n1')).toEqual({ nodeId: 'n2', ordinal: 2 }),
  },
  {
    method: 'insertNodeAfter',
    refusal: async (s) =>
      expect(await s.insertNodeAfter(UNKNOWN, 'n1', { stepName: 'x', promptId: 'p' })).toBeNull(),
    control: async (s) =>
      expect(await s.insertNodeAfter(REAL, 'n1', { stepName: 'x', promptId: 'p' })).toEqual(
        expect.objectContaining({ stepName: 'x', promptId: 'p' })
      ),
  },
  {
    method: 'markNodeSkipped',
    refusal: async (s) => expect(await s.markNodeSkipped(UNKNOWN, 'n3', 'u1')).toBe(false),
    control: async (s) => {
      expect(await s.markNodeSkipped(REAL, 'n3', 'u1')).toBe(true);
      expect(s.getStepState(REAL, 'n3')?.state).toBe('skipped');
    },
  },
  {
    method: 'replaceRemainder',
    refusal: async (s) =>
      expect(
        await s.replaceRemainder(UNKNOWN, [{ promptId: 'p', stepName: 'x' }], 'u1', 'append')
      ).toEqual({ kind: 'rejected', reason: 'session-unknown' }),
    control: async (s) =>
      expect(
        await s.replaceRemainder(REAL, [{ promptId: 'p', stepName: 'x' }], 'u1', 'append')
      ).toEqual(expect.objectContaining({ kind: 'applied', mode: 'append' })),
  },
  {
    method: 'remapRunGates',
    refusal: async (s) =>
      expect(await s.remapRunGates(UNKNOWN, new Map([['a', 'b']]))).toBeUndefined(),
    control: async (s) => {
      await s.remapRunGates(REAL, new Map([['a', 'b']]));
      expect(s.getSession(REAL)?.gateRemap).toEqual({ a: 'b' });
    },
  },
  {
    method: 'setReview',
    refusal: async (s) => expect(await s.setReview(UNKNOWN, review('n1'))).toBeUndefined(),
    control: async (s) => {
      await s.setReview(REAL, review('n1'));
      expect(s.getReview(REAL, 'n1')).toMatchObject({ nodeId: 'n1', kind: 'gate' });
    },
  },
  {
    method: 'clearReview',
    refusal: async (s) => expect(await s.clearReview(UNKNOWN, 'n1')).toBeUndefined(),
    control: async (s) => {
      await s.setReview(REAL, review('n1'));
      expect(s.getReview(REAL, 'n1')).toBeDefined();
      await s.clearReview(REAL, 'n1');
      expect(s.getReview(REAL, 'n1')).toBeUndefined();
    },
  },
  {
    method: 'setPendingGateReview',
    refusal: async (s) =>
      expect(await s.setPendingGateReview(UNKNOWN, pendingReview('n1'))).toBeUndefined(),
    control: async (s) => {
      await s.setPendingGateReview(REAL, pendingReview('n1'));
      expect(s.getReview(REAL, 'n1')).toMatchObject({ nodeId: 'n1', kind: 'gate' });
    },
  },
  {
    method: 'clearPendingGateReview',
    refusal: async (s) =>
      expect(await s.clearPendingGateReview(UNKNOWN, { nodeId: 'n1' })).toBeUndefined(),
    control: async (s) => {
      await s.setReview(REAL, review('n1', 'detached'));
      expect(s.getReview(REAL, 'n1')).toBeDefined();
      await s.clearPendingGateReview(REAL, { nodeId: 'n1' });
      expect(s.getReview(REAL, 'n1')).toBeUndefined();
    },
  },
  {
    method: 'setPendingShellVerification',
    refusal: async (s) =>
      expect(await s.setPendingShellVerification(UNKNOWN, shellVerification())).toBeUndefined(),
    control: async (s) => {
      await s.setPendingShellVerification(REAL, shellVerification());
      expect(s.getPendingShellVerification(REAL)).toMatchObject({ gateId: 'gate-shell' });
    },
  },
  {
    method: 'clearPendingShellVerification',
    refusal: async (s) => expect(await s.clearPendingShellVerification(UNKNOWN)).toBeUndefined(),
    control: async (s) => {
      await s.setPendingShellVerification(REAL, shellVerification());
      expect(s.getPendingShellVerification(REAL)).toBeDefined();
      await s.clearPendingShellVerification(REAL);
      expect(s.getPendingShellVerification(REAL)).toBeUndefined();
    },
  },
  {
    method: 'recordGateReviewOutcome',
    refusal: async (s) =>
      expect(await s.recordGateReviewOutcome(UNKNOWN, { verdict: 'FAIL' })).toBeUndefined(),
    control: async (s) => {
      await s.recordGateReviewOutcome(REAL, { verdict: 'FAIL' });
      expect(s.getRunTelemetry(REAL)).toMatchObject({ gatesFired: 1, gateRetries: 1 });
    },
  },
  {
    method: 'clearSession',
    refusal: async (s) => expect(await s.clearSession(UNKNOWN)).toBe(false),
    control: async (s) => {
      expect(await s.clearSession(REAL)).toBe(true);
      expect(s.hasActiveSession(REAL)).toBe(false);
    },
  },
  {
    method: 'applyUnknownObservations',
    refusal: async (s) =>
      await expect(
        s.applyUnknownObservations(UNKNOWN, 'n1', [
          { type: 'unknown_discovered', id: 'u1', statement: 'what?' },
        ])
      ).rejects.toThrow(/session not found/),
    control: async (s) => {
      const ledger = await s.applyUnknownObservations(REAL, 'n1', [
        { type: 'unknown_discovered', id: 'u1', statement: 'what?' },
      ]);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ id: 'u1' });
    },
  },
];

const READERS: readonly RefusalRow[] = [
  {
    method: 'getSession',
    refusal: (s) => expect(s.getSession(UNKNOWN)).toBeUndefined(),
    control: (s) => expect(s.getSession(REAL)?.sessionId).toBe(REAL),
  },
  {
    method: 'getStepState',
    refusal: (s) => expect(s.getStepState(UNKNOWN, 'n1')).toBeUndefined(),
    control: (s) => {
      s.setStepState(REAL, 'n1', 'rendered');
      expect(s.getStepState(REAL, 'n1')).toBeDefined();
    },
  },
  {
    method: 'getChainContext',
    refusal: (s) => expect(s.getChainContext(UNKNOWN)).toEqual({}),
    control: (s) =>
      expect(s.getChainContext(REAL)).toMatchObject({ chain_run_id: REAL, total_steps: 3 }),
  },
  {
    method: 'getRunTelemetry',
    refusal: (s) => expect(s.getRunTelemetry(UNKNOWN)).toBeUndefined(),
    control: (s) => expect(s.getRunTelemetry(REAL)).toMatchObject({ stepsPlanned: 3 }),
  },
  {
    method: 'getSessionBlueprint',
    refusal: (s) => expect(s.getSessionBlueprint(UNKNOWN)).toBeUndefined(),
    setup: async (s) => {
      await s.createSession(REAL, 'chain-real', 3, {}, { blueprint: blueprint() });
    },
    control: (s) => expect(s.getSessionBlueprint(REAL)?.parsedCommand.promptId).toBe('chain-real'),
  },
  {
    method: 'getInlineGateIds',
    refusal: (s) => expect(s.getInlineGateIds(UNKNOWN)).toBeUndefined(),
    setup: async (s) => {
      await s.createSession(REAL, 'chain-real', 3, {}, { blueprint: blueprint() });
    },
    control: (s) => expect(s.getInlineGateIds(REAL)).toEqual(['inline_gate_real']),
  },
  {
    method: 'getReview',
    refusal: (s) => expect(s.getReview(UNKNOWN, 'n1')).toBeUndefined(),
    control: async (s) => {
      await s.setReview(REAL, review('n1'));
      expect(s.getReview(REAL, 'n1')).toMatchObject({ nodeId: 'n1' });
    },
  },
  {
    method: 'getPendingShellVerification',
    refusal: (s) => expect(s.getPendingShellVerification(UNKNOWN)).toBeUndefined(),
    control: async (s) => {
      await s.setPendingShellVerification(REAL, shellVerification());
      expect(s.getPendingShellVerification(REAL)).toMatchObject({ gateId: 'gate-shell' });
    },
  },
  {
    method: 'isStepComplete',
    refusal: (s) => expect(s.isStepComplete(UNKNOWN, 'n1')).toBe(false),
    control: async (s) => {
      await s.completeStep(REAL, 'n1');
      expect(s.isStepComplete(REAL, 'n1')).toBe(true);
    },
  },
];

describe('ChainSessionStore — an id the store never created', () => {
  let store: ChainSessionStore;
  let persistSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  beforeEach(() => {
    // `persistSessionsOrThrow` is the single funnel both persist paths run through, so one spy
    // sees every write a mutator could attempt. It resolves so a control's persist succeeds on a
    // store that has no database port.
    persistSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'persistSessionsOrThrow')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;
  });

  afterEach(async () => {
    await store?.cleanup();
    persistSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  const newStore = async (setup?: RefusalRow['setup']): Promise<ChainSessionStore> => {
    store = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      cleanupIntervalMs: 1000,
    });
    if (setup !== undefined) {
      await setup(store);
    } else {
      await store.createSession(REAL, 'chain-real', 3);
    }
    persistSpy.mockClear();
    return store;
  };

  /** Everything an unknown-id call could disturb, as plain comparable values. */
  const observe = (target: ChainSessionStore) => {
    const { oldestSessionAge: _age, ...stats } = target.getSessionStats();
    return {
      ids: target.listActiveSessions().map((summary) => summary.sessionId),
      stats,
      sessions: structuredClone(
        Array.from(((target as any).activeSessions as Map<string, unknown>).entries())
      ),
      chainMap: structuredClone(
        Array.from(((target as any).chainSessionMapping as Map<string, Set<string>>).entries())
      ),
    };
  };

  describe.each([
    ['mutator', MUTATORS],
    ['reader', READERS],
  ] as const)('%s', (_kind, rows) => {
    test.each(rows.map((row) => [row.method, row] as const))(
      '%s refuses an unknown session and leaves the store unchanged',
      async (_method, row) => {
        const target = await newStore(row.setup);
        const before = observe(target);

        await row.refusal(target);

        expect(observe(target)).toEqual(before);
        expect(target.hasActiveSession(UNKNOWN)).toBe(false);
        expect(persistSpy).not.toHaveBeenCalled();
      }
    );

    test.each(rows.map((row) => [row.method, row] as const))(
      '%s control: the same call on a real session is not refused',
      async (_method, row) => {
        const target = await newStore(row.setup);

        await row.control(target);
      }
    );
  });
});
