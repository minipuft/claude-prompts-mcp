/**
 * SessionActionHandler — id-namespace resolution and scope enforcement.
 *
 * Regression coverage for F12 in
 * `plans/techincal_debt/resource-versioning-consolidation-2026-08-17.md`.
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

describe('SessionActionHandler', () => {
  let clearSession: jest.MockedFunction<(id: string, scope?: unknown) => Promise<boolean>>;
  let clearSessionsForChain: jest.MockedFunction<(id: string, scope?: unknown) => Promise<void>>;
  let cancelChain: jest.MockedFunction<(id: string, scope?: unknown) => Promise<boolean>>;
  let sessions: Summary[];
  let handler: SessionActionHandler;
  const requestScope = { continuityScopeId: 'workspace-a' };

  function textOf(result: { content: Array<{ text?: string }> }): string {
    return result.content[0]?.text ?? '';
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sessions = [
      { sessionId: 'sess-1', chainId: 'chain-alpha' },
      { sessionId: 'sess-2', chainId: 'chain-alpha' },
    ];

    clearSession = jest.fn<(id: string, scope?: unknown) => Promise<boolean>>(() =>
      Promise.resolve(true)
    );
    clearSessionsForChain = jest.fn<(id: string, scope?: unknown) => Promise<void>>(() =>
      Promise.resolve()
    );
    cancelChain = jest.fn<(id: string, scope?: unknown) => Promise<boolean>>(() =>
      Promise.resolve(true)
    );

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
        clearSession,
        clearSessionsForChain,
        cancelChain,
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

  describe('cancel — relocated to prompt_engine', () => {
    /**
     * `cancel` moved to `prompt_engine(chain_id, cancel: true)`. The refusal names the
     * replacement rather than falling into the generic unknown-operation branch: a caller
     * reaching for it here is not confused about the vocabulary, they are using the interface
     * that used to have it, and a bare "unknown operation" would send them looking for a typo.
     */
    test('refuses and names the replacement instead of cancelling', async () => {
      await expect(handler.execute({ operation: 'cancel', session_id: 'sess-1' })).rejects.toThrow(
        /prompt_engine/
      );

      expect(cancelChain).not.toHaveBeenCalled();
    });

    test('does not list cancel among the operations it still serves', async () => {
      await expect(handler.execute({ operation: 'nonsense' })).rejects.toThrow(
        'Unknown session operation: nonsense. Valid operations: list, clear, inspect'
      );
    });
  });
});
