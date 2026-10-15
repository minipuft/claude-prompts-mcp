/**
 * SessionActionHandler — id-namespace resolution and scope enforcement.
 *
 * Regression coverage for F12 in
 * `plans/reference/technical-debt/resource-versioning-consolidation-2026-08-17.md`.
 *
 * `session clear` used to try the id as a session id and, on failure, fall through to
 * `clearSessionsForChain(id)`. A stale, mistyped, or out-of-scope session id therefore escalated
 * from "one session" to "every run of that chain" — `clearSessionsForChain` strips the run number
 * and walks the chain's whole run history — and the handler reported success either way.
 *
 * These tests pin the resolution to a lookup made BEFORE anything is deleted.
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { SessionActionHandler } from '../../../../src/mcp/tools/system-control/handlers/session-action-handler.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { SystemControlContext } from '../../../../src/mcp/tools/system-control/core/types.js';

type Summary = { sessionId: string; chainId: string };
type FakeRun = Record<string, any>;

const PAUSED_AT = Date.UTC(2026, 9, 15, 12, 0, 0);
const TOKEN = 'SECRET-HANDOFF-TOKEN';
const PAUSE_REFUSAL = 'Abort paused run before clearing it';

describe('SessionActionHandler', () => {
  let clearSession: jest.MockedFunction<(id: string, scope?: unknown) => Promise<boolean>>;
  let clearSessionsForChain: jest.MockedFunction<(id: string, scope?: unknown) => Promise<void>>;
  let sessions: Summary[];
  let paused: Set<string>;
  let terminal: Set<string>;
  let runs: Map<string, FakeRun>;
  let lookups: Array<{ chainId: string; options: Record<string, unknown> }>;
  let handler: SessionActionHandler;
  const requestScope = { continuityScopeId: 'workspace-a' };

  function textOf(result: { content: Array<{ text?: string }> }): string {
    return result.content[0]?.text ?? '';
  }

  beforeEach(() => {
    jest.clearAllMocks();
    paused = new Set();
    terminal = new Set();
    runs = new Map();
    lookups = [];
    sessions = [
      { sessionId: 'sess-1', chainId: 'chain-alpha' },
      { sessionId: 'sess-2', chainId: 'chain-alpha' },
    ];

    // The store's contract for a paused run: clear and bulk clear throw before removing anything.
    clearSession = jest.fn<(id: string, scope?: unknown) => Promise<boolean>>((id) =>
      paused.has(id) ? Promise.reject(new Error(PAUSE_REFUSAL)) : Promise.resolve(true)
    );
    clearSessionsForChain = jest.fn<(id: string, scope?: unknown) => Promise<void>>((chainId) =>
      sessions.some((s) => s.chainId === chainId && paused.has(s.sessionId))
        ? Promise.reject(new Error(PAUSE_REFUSAL))
        : Promise.resolve()
    );
    const runFor = (id: string): FakeRun | undefined => {
      const summary = sessions.find((s) => s.sessionId === id);
      if (summary === undefined) return undefined;
      if (!runs.has(id)) {
        runs.set(id, {
          ...summary,
          startTime: 1_000,
          lastActivity: 2_000,
          lifecycle: 'canonical',
          runStatus: terminal.has(id) ? 'completed' : 'running',
          handoffToken: TOKEN,
          reviews: {},
          state: {
            nodes: [{ id: 'n1' }, { id: 'n2' }],
            currentNodeId: 'n2',
            stepStates: new Map(),
          },
          ...(paused.has(id) || terminal.has(id)
            ? { conversationPause: { kind: 'conversation', nodeId: 'n2', pausedAt: PAUSED_AT } }
            : {}),
        });
      }
      return runs.get(id);
    };

    const context = {
      logger: new MockLogger(),
      startTime: Date.now(),
      requestScope,
      createMinimalSystemResponse: (text: string) => ({
        content: [{ type: 'text', text }],
        isError: false,
      }),
      chainSessionStore: {
        listActiveSessions: () => sessions,
        getSessionByChainIdentifier: (chainId: string, options: Record<string, unknown>) => {
          lookups.push({ chainId, options });
          const found = sessions.find((s) => s.chainId === chainId);
          return found && runFor(found.sessionId);
        },
        // Like the store: a paused run is returned untouched, any other read bumps lastActivity.
        getSession: (id: string) => {
          const run = runFor(id);
          if (run && !paused.has(id)) run.lastActivity = Date.now();
          return run;
        },
        getChainContext: () => ({}),
        clearSession,
        clearSessionsForChain,
      },
    } as unknown as SystemControlContext;

    handler = new SessionActionHandler(context);
  });

  describe('clear — id namespace is resolved before anything is deleted', () => {
    test('clears exactly one session when the id names a session', async () => {
      const result = await handler.execute({ operation: 'clear', session_id: 'sess-1' });

      expect(clearSession).toHaveBeenCalledWith('sess-1', requestScope);
      expect(clearSessionsForChain).not.toHaveBeenCalled();
      expect(textOf(result)).toContain('Session Cleared');
    });

    test('clears the chain only when the id names a chain', async () => {
      const result = await handler.execute({ operation: 'clear', session_id: 'chain-alpha' });

      expect(clearSessionsForChain).toHaveBeenCalledWith('chain-alpha', requestScope);
      expect(clearSession).not.toHaveBeenCalled();
      expect(textOf(result)).toContain('2 session(s)');
    });

    test('an unknown id removes NOTHING and says so', async () => {
      // The defect: this id used to reach clearSessionsForChain, which strips the run number and
      // walks the chain's run history — so a typo could sweep every run of a real chain while the
      // response claimed success.
      const result = await handler.execute({ operation: 'clear', session_id: 'sess-typo' });

      expect(clearSession).not.toHaveBeenCalled();
      expect(clearSessionsForChain).not.toHaveBeenCalled();
      expect(textOf(result)).toContain('Nothing Cleared');
    });

    test('an out-of-scope session id removes nothing rather than escalating', async () => {
      // listActiveSessions is scope-filtered, so a session in another workspace is simply absent.
      // Under the old fall-through that absence was indistinguishable from "must be a chain id".
      const result = await handler.execute({ operation: 'clear', session_id: 'sess-elsewhere' });

      expect(clearSession).not.toHaveBeenCalled();
      expect(clearSessionsForChain).not.toHaveBeenCalled();
      expect(textOf(result)).toContain('Nothing Cleared');
    });

    test('refuses an id that names both a session and a chain', async () => {
      sessions = [
        { sessionId: 'ambiguous', chainId: 'chain-alpha' },
        { sessionId: 'sess-9', chainId: 'ambiguous' },
      ];

      const result = await handler.execute({ operation: 'clear', session_id: 'ambiguous' });

      expect(clearSession).not.toHaveBeenCalled();
      expect(clearSessionsForChain).not.toHaveBeenCalled();
      expect(textOf(result)).toContain('Ambiguous ID');
    });
  });

  describe('conversation-paused runs', () => {
    const abort = (id: string): void => {
      paused.delete(id);
      runs.clear();
    };
    const pausedAtText = new Date(PAUSED_AT).toLocaleString();
    const snapshot = (id: string) => {
      const { lastActivity, lifecycle } = runFor(id);
      return { lastActivity, lifecycle };
    };
    const runFor = (id: string): FakeRun => {
      // Reads once through the fake store so the cached run object is the one under test.
      return (handler as any).context.chainSessionStore.getSessionByChainIdentifier(
        sessions.find((s) => s.sessionId === id)!.chainId,
        {}
      );
    };

    test('list shows the pause without touching the run, and never the token', async () => {
      paused.add('sess-1');
      const before = snapshot('sess-1');
      lookups = [];

      const text = textOf(await handler.execute({ operation: 'list' }));

      expect(text).toContain('⏸️ Paused');
      expect(text).toContain('step 2 of 2');
      expect(text).toContain(`since ${pausedAtText}`);
      expect(text).toContain('prompt_engine(chain_id:"chain-alpha", gate_action:"resume")');
      expect(text).toContain('gate_action:"abort"');
      expect(text).not.toContain(TOKEN);
      expect(text).toContain('🟢 Active'); // sess-2 is not paused
      expect(lookups.every((l) => l.options.promoteDormant === false)).toBe(true);
      expect(snapshot('sess-1')).toEqual(before);
    });

    test('inspect shows the pause and leaves activity and lifecycle as they were', async () => {
      paused.add('sess-1');
      const before = snapshot('sess-1');

      const text = textOf(await handler.execute({ operation: 'inspect', session_id: 'sess-1' }));

      expect(text).toContain('⏸️ **Paused for conversation**');
      expect(text).toContain(`since ${pausedAtText}`);
      expect(text).toContain('gate_action:"abort"');
      expect(text).not.toContain(TOKEN);
      expect(snapshot('sess-1')).toEqual(before);
    });

    test('inspect of an ordinary run shows no pause (positive control)', async () => {
      const text = textOf(await handler.execute({ operation: 'inspect', session_id: 'sess-1' }));

      expect(text).not.toContain('Paused for conversation');
    });

    test('clearing a paused run is refused truthfully and the run is retained', async () => {
      paused.add('sess-1');

      const text = textOf(await handler.execute({ operation: 'clear', session_id: 'sess-1' }));

      expect(text).toContain('Nothing Cleared');
      expect(text).toContain('paused for conversation');
      expect(text).toContain('abort it first');
      expect(text).not.toContain('Session Cleared');
      expect(clearSession).not.toHaveBeenCalled();
      expect(sessions.map((s) => s.sessionId)).toContain('sess-1');
    });

    test('a store that answers false is reported as nothing removed, not as cleared', async () => {
      clearSession.mockResolvedValueOnce(false);

      const text = textOf(await handler.execute({ operation: 'clear', session_id: 'sess-2' }));

      expect(text).toContain('Nothing Cleared');
      expect(text).not.toContain('Session Cleared');
    });

    test('bulk clear with one paused run in the selection removes nothing', async () => {
      // One run per chain id, as in the store, so each lookup names exactly its own run.
      sessions = [{ sessionId: 'sess-1', chainId: 'chain-alpha' }];
      paused.add('sess-1');

      const text = textOf(await handler.execute({ operation: 'clear', session_id: 'chain-alpha' }));

      expect(text).toContain('Nothing Cleared');
      expect(text).toContain('1 run(s) paused');
      expect(clearSessionsForChain).not.toHaveBeenCalled();
      expect(clearSession).not.toHaveBeenCalled();
    });

    test('ordinary clear and terminal clear still succeed (positive controls)', async () => {
      terminal.add('sess-1'); // keeps a leftover pause record, but a terminal run is not paused

      const one = textOf(await handler.execute({ operation: 'clear', session_id: 'sess-1' }));
      const chain = textOf(
        await handler.execute({ operation: 'clear', session_id: 'chain-alpha' })
      );

      expect(one).toContain('Session Cleared');
      expect(chain).toContain('2 session(s)');
      expect(clearSession).toHaveBeenCalledWith('sess-1', requestScope);
      expect(clearSessionsForChain).toHaveBeenCalledWith('chain-alpha', requestScope);
    });

    test('after abort, clear succeeds', async () => {
      paused.add('sess-1');
      expect(textOf(await handler.execute({ operation: 'clear', session_id: 'sess-1' }))).toContain(
        'Nothing Cleared'
      );

      abort('sess-1');
      const text = textOf(await handler.execute({ operation: 'clear', session_id: 'sess-1' }));

      expect(text).toContain('Session Cleared');
      expect(clearSession).toHaveBeenCalledWith('sess-1', requestScope);
    });
  });

  describe('unknown operations', () => {
    test.each(['cancel', 'nonsense'])(
      'refuses %s through the generic operation boundary without mutating sessions',
      async (operation) => {
        await expect(handler.execute({ operation, session_id: 'sess-1' })).rejects.toThrow(
          `Unknown session operation: ${operation}. Valid operations: list, clear, inspect`
        );
        expect(clearSession).not.toHaveBeenCalled();
        expect(clearSessionsForChain).not.toHaveBeenCalled();
      }
    );
  });
});
