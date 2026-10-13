/**
 * Multi-session behaviour of ChainSessionStore: which sessions `listActiveSessions` reports and in
 * what order, and which of several sessions on one chain id `getSessionByChainIdentifier` picks.
 * Each case asserts the whole result (the full ordered id list), not one pairwise comparison.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore, type SessionBlueprint } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';

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

const NOW = 1_800_000_000_000;

describe('ChainSessionStore — multi-session listing and chain lookup', () => {
  let manager: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  const newManager = (): ChainSessionStore =>
    new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      cleanupIntervalMs: 1000,
    });

  const sessionOf = (id: string): any => (manager as any).activeSessions.get(id);

  /** Create a session and pin its `lastActivity`, the only field both methods order by. */
  const seed = async (
    id: string,
    chainId: string,
    lastActivity: number,
    options: Record<string, unknown> = {}
  ): Promise<void> => {
    await manager.createSession(id, chainId, 1, {}, options as any);
    sessionOf(id).lastActivity = lastActivity;
  };

  const goDormant = (id: string): void => {
    sessionOf(id).lifecycle = 'dormant';
  };

  const idsOf = (limit?: number, scope?: Record<string, unknown>): string[] =>
    manager.listActiveSessions(limit, scope as any).map((summary) => summary.sessionId);

  beforeEach(() => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'persistSessionsOrThrow')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;
    manager = newManager();
  });

  afterEach(async () => {
    await manager.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  describe('listActiveSessions', () => {
    test('lists sessions most recent first, whatever order they were created in', async () => {
      await seed('s-mid', 'chain-a', NOW - 2000);
      await seed('s-old', 'chain-b', NOW - 5000);
      await seed('s-new', 'chain-c', NOW - 1000);
      await seed('s-older', 'chain-d', NOW - 9000);

      expect(idsOf()).toEqual(['s-new', 's-mid', 's-old', 's-older']);
    });

    test('limit keeps the most recent sessions; limit 0 lists every session', async () => {
      await seed('s-1', 'chain-a', NOW - 4000);
      await seed('s-2', 'chain-b', NOW - 1000);
      await seed('s-3', 'chain-c', NOW - 3000);
      await seed('s-4', 'chain-d', NOW - 2000);

      expect(idsOf(2)).toEqual(['s-2', 's-4']);
      expect(idsOf(10)).toEqual(['s-2', 's-4', 's-3', 's-1']);
      expect(idsOf(0)).toEqual(['s-2', 's-4', 's-3', 's-1']);
    });

    test('leaves a dormant session out; the same session active is listed', async () => {
      await seed('s-live', 'chain-a', NOW - 3000);
      await seed('s-parked', 'chain-b', NOW - 1000);

      expect(idsOf()).toEqual(['s-parked', 's-live']);

      goDormant('s-parked');

      expect(idsOf()).toEqual(['s-live']);
    });

    test('with a scope lists only that scope; without one lists every scope', async () => {
      await seed('s-a1', 'chain-a', NOW - 4000, { continuityScopeId: 'scope-a' });
      await seed('s-b1', 'chain-b', NOW - 3000, { continuityScopeId: 'scope-b' });
      await seed('s-a2', 'chain-c', NOW - 2000, { continuityScopeId: 'scope-a' });
      await seed('s-b2', 'chain-d', NOW - 1000, { continuityScopeId: 'scope-b' });

      expect(idsOf(50, { continuityScopeId: 'scope-a' })).toEqual(['s-a2', 's-a1']);
      expect(idsOf(50, { continuityScopeId: 'scope-b' })).toEqual(['s-b2', 's-b1']);
      expect(idsOf(50)).toEqual(['s-b2', 's-a2', 's-b1', 's-a1']);
    });

    test('scope may be named by workspaceId as well as continuityScopeId', async () => {
      await seed('s-ws', 'chain-a', NOW - 2000, { workspaceId: 'ws-1' });
      await seed('s-other', 'chain-b', NOW - 1000, { workspaceId: 'ws-2' });

      expect(idsOf(50, { workspaceId: 'ws-1' })).toEqual(['s-ws']);
    });

    test('summary carries promptName and promptId from the converted prompt, and the whole projection', async () => {
      const blueprint = {
        parsedCommand: {
          promptId: 'fallback-id',
          convertedPrompt: { id: 'converted-id', name: 'Converted Name' },
        },
      } as unknown as SessionBlueprint;
      await seed('s-bp', 'chain-a', NOW - 1000, { blueprint });

      expect(manager.listActiveSessions()).toEqual([
        {
          sessionId: 's-bp',
          chainId: 'chain-a',
          currentStep: 1,
          totalSteps: 1,
          pendingReview: false,
          lastActivity: NOW - 1000,
          startTime: sessionOf('s-bp').startTime,
          promptName: 'Converted Name',
          promptId: 'converted-id',
        },
      ]);
    });

    test('promptId falls back to parsedCommand.promptId when the converted prompt has no id', async () => {
      const blueprint = {
        parsedCommand: {
          promptId: 'fallback-id',
          convertedPrompt: { name: 'Only Name' },
        },
      } as unknown as SessionBlueprint;
      await seed('s-fallback', 'chain-a', NOW - 1000, { blueprint });

      const [summary] = manager.listActiveSessions();

      expect(summary.promptName).toBe('Only Name');
      expect(summary.promptId).toBe('fallback-id');
    });

    test('promptName and promptId are absent keys when the blueprint carries neither', async () => {
      await seed('s-none', 'chain-a', NOW - 2000);
      const emptyBlueprint = { parsedCommand: {} } as unknown as SessionBlueprint;
      await seed('s-empty', 'chain-b', NOW - 1000, { blueprint: emptyBlueprint });

      const summaries = manager.listActiveSessions();

      expect(summaries.map((s) => s.sessionId)).toEqual(['s-empty', 's-none']);
      for (const summary of summaries) {
        expect(Object.keys(summary)).not.toContain('promptName');
        expect(Object.keys(summary)).not.toContain('promptId');
      }
    });
  });

  describe('getSessionByChainIdentifier with several sessions on one chain id', () => {
    test('prefers an active session over a more recent dormant one', async () => {
      await seed('s-active-old', 'chain-a', NOW - 5000);
      await seed('s-dormant-new', 'chain-a', NOW - 1000);
      goDormant('s-dormant-new');

      const found = manager.getSessionByChainIdentifier('chain-a', { includeDormant: true });

      expect(found?.sessionId).toBe('s-active-old');
      expect(sessionOf('s-dormant-new').lifecycle).toBe('dormant');
    });

    test('between two active sessions picks the most recent lastActivity', async () => {
      await seed('s-first', 'chain-a', NOW - 3000);
      await seed('s-newest', 'chain-a', NOW - 1000);
      await seed('s-middle', 'chain-a', NOW - 2000);

      expect(manager.getSessionByChainIdentifier('chain-a')?.sessionId).toBe('s-newest');
    });

    test('a dormant session is not found unless includeDormant is set, and stays dormant', async () => {
      await seed('s-parked', 'chain-a', NOW - 1000);
      goDormant('s-parked');

      expect(manager.getSessionByChainIdentifier('chain-a')).toBeUndefined();
      expect(sessionOf('s-parked').lifecycle).toBe('dormant');
    });

    test('includeDormant with only dormant sessions returns the most recent and promotes it', async () => {
      await seed('s-dormant-old', 'chain-a', NOW - 5000);
      await seed('s-dormant-new', 'chain-a', NOW - 1000);
      goDormant('s-dormant-old');
      goDormant('s-dormant-new');

      const found = manager.getSessionByChainIdentifier('chain-a', { includeDormant: true });

      expect(found?.sessionId).toBe('s-dormant-new');
      expect(sessionOf('s-dormant-new').lifecycle).toBe('canonical');
      expect(sessionOf('s-dormant-old').lifecycle).toBe('dormant');
    });

    test('a scope filter ignores the other scope’s more recent session', async () => {
      await seed('s-a', 'chain-a', NOW - 5000, { continuityScopeId: 'scope-a' });
      await seed('s-b', 'chain-a', NOW - 1000, { continuityScopeId: 'scope-b' });

      expect(
        manager.getSessionByChainIdentifier('chain-a', { continuityScopeId: 'scope-a' })?.sessionId
      ).toBe('s-a');
      expect(
        manager.getSessionByChainIdentifier('chain-a', { continuityScopeId: 'scope-b' })?.sessionId
      ).toBe('s-b');
      expect(manager.getSessionByChainIdentifier('chain-a')?.sessionId).toBe('s-b');
      expect(
        manager.getSessionByChainIdentifier('chain-a', { continuityScopeId: 'scope-none' })
      ).toBeUndefined();
    });

    test('a run-numbered id with no session of its own falls back to the base chain, promoting a dormant one', async () => {
      await seed('s-base', 'chain-a', NOW - 1000);
      goDormant('s-base');

      const found = manager.getSessionByChainIdentifier('chain-a#7', { includeDormant: true });

      expect(found?.sessionId).toBe('s-base');
      expect(sessionOf('s-base').lifecycle).toBe('canonical');
    });
  });
});
