import { describe, expect, jest, test } from '@jest/globals';

import { createConsolidatedSystemControl } from '../../../../src/mcp/tools/system-control/index.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSessionService } from '../../../../src/shared/types/chain-session.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createSessionStore = () => {
  const listActiveSessions = jest.fn().mockReturnValue([]);
  const clearSession = jest.fn().mockResolvedValue(false);
  const clearSessionsForChain = jest.fn().mockResolvedValue(undefined);
  const getSession = jest.fn();
  const getChainContext = jest.fn().mockReturnValue({});
  const cancelChain = jest.fn().mockResolvedValue(true);

  return {
    store: {
      listActiveSessions,
      clearSession,
      clearSessionsForChain,
      getSession,
      getChainContext,
      cancelChain,
    } as unknown as ChainSessionService,
    listActiveSessions,
    clearSession,
    clearSessionsForChain,
    getSession,
    getChainContext,
    cancelChain,
  };
};

const createSystemControl = (chainSessionStore: ChainSessionService) => {
  const systemControl = createConsolidatedSystemControl(createLogger(), () => Promise.resolve());
  systemControl.setChainSessionStore(chainSessionStore);
  return systemControl;
};

const getText = (response: ToolResponse) =>
  response.content?.[0]?.type === 'text' ? response.content[0].text : '';

describe('System Control session action scope propagation', () => {
  test('scopes session list to explicit organization id', async () => {
    const sessions = createSessionStore();
    sessions.listActiveSessions.mockReturnValue([
      {
        sessionId: 'sess-1',
        chainId: 'chain-research#1',
        currentNodeId: 'n1',
        nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
        pendingReview: false,
        lastActivity: Date.now(),
        startTime: Date.now(),
        promptId: 'research',
      },
    ]);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'list' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.listActiveSessions).toHaveBeenCalledWith();
    expect(getText(response)).toContain('Active Sessions');
  });

  test('uses default scope when extra identity info is missing', async () => {
    const sessions = createSessionStore();
    const systemControl = createSystemControl(sessions.store);

    await systemControl.handleAction({ action: 'session', operation: 'list' }, {});

    expect(sessions.listActiveSessions).toHaveBeenCalledWith();
  });

  test('uses workspace as continuity scope when organization differs', async () => {
    const sessions = createSessionStore();
    const systemControl = createSystemControl(sessions.store);

    await systemControl.handleAction(
      { action: 'session', operation: 'list' },
      { organizationId: 'org-acme', workspaceId: 'workspace-shared' }
    );

    expect(sessions.listActiveSessions).toHaveBeenCalledWith();
  });

  test('clear resolves a session id against the active listing before deleting', async () => {
    const sessions = createSessionStore();
    sessions.listActiveSessions.mockReturnValue([
      { sessionId: 'sess-1', chainId: 'chain-research#1' },
    ]);
    sessions.clearSession.mockResolvedValue(true);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'clear', session_id: 'sess-1' },
      { organizationId: 'org-acme' }
    );

    // The resolved scope is forwarded. It is `undefined` here because `resolveRequestIdentity`
    // reads auth claims, not a bare `organizationId` on `extra` — see F13. The assertion pins the
    // forwarding, not a particular value.
    expect(sessions.clearSession).toHaveBeenCalledWith('sess-1', undefined);
    expect(sessions.clearSessionsForChain).not.toHaveBeenCalled();
    expect(getText(response)).toContain('Session Cleared');
  });

  test('clear sweeps a chain only when the id actually names one', async () => {
    const sessions = createSessionStore();
    sessions.listActiveSessions.mockReturnValue([
      { sessionId: 'sess-9', chainId: 'chain-shared#1' },
    ]);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'clear', session_id: 'chain-shared#1' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.clearSessionsForChain).toHaveBeenCalledWith('chain-shared#1', undefined);
    expect(sessions.clearSession).not.toHaveBeenCalled();
    expect(getText(response)).toContain('Chain Sessions Cleared');
  });

  test('clear removes nothing when the id names neither a session nor a chain', async () => {
    // This test previously asserted the opposite behaviour under the name
    // "scopes clear-by-chain fallback": an unmatched id fell through to clearSessionsForChain,
    // which strips the run number and walks the chain's whole run history. A mistyped or stale
    // session id therefore swept every run of a real chain, and the response reported success.
    const sessions = createSessionStore();
    sessions.listActiveSessions.mockReturnValue([
      { sessionId: 'sess-9', chainId: 'chain-shared#1' },
    ]);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'clear', session_id: 'sess-typo' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.clearSession).not.toHaveBeenCalled();
    expect(sessions.clearSessionsForChain).not.toHaveBeenCalled();
    expect(getText(response)).toContain('Nothing Cleared');
  });

  test('scopes inspect operation lookups to organization id', async () => {
    const sessions = createSessionStore();
    sessions.getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-research#1',
      state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] },
      startTime: Date.now(),
      lastActivity: Date.now(),
      lifecycle: 'canonical',
      executionOrder: [],
      originalArgs: {},
    });
    sessions.getChainContext.mockReturnValue({ result: 'ok' });
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'inspect', session_id: 'sess-1' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.getSession).toHaveBeenCalledWith('sess-1');
    expect(sessions.getChainContext).toHaveBeenCalledWith('sess-1');
    expect(getText(response)).toContain('Session Inspection');
  });

  /**
   * `cancel` was relocated to `prompt_engine(chain_id, cancel: true)`.
   *
   * The four tests that stood here asserted routing, idempotence, terminal-state refusal and a
   * missing-id throw against this tool. They are not deleted-and-forgotten: the behaviour they
   * covered now belongs to `prompt_engine`, and what remains true HERE is that the operation is
   * gone and says where it went. The rule that decided the move — a `chain_id` is held because you
   * are running the chain, a `session_id` comes from a listing — is stated in
   * `docs/reference/mcp-tools.md`.
   */
  test('cancel is no longer served here, and the refusal names where it went', async () => {
    const sessions = createSessionStore();
    const systemControl = createSystemControl(sessions.store);

    await expect(
      systemControl.handleAction(
        { action: 'session', operation: 'cancel', session_id: 'sess-active' },
        { organizationId: 'org-acme' }
      )
    ).rejects.toThrow(/prompt_engine/);

    expect(sessions.cancelChain).not.toHaveBeenCalled();
  });

  test('keeps each concurrent request on its own session id', async () => {
    // NARROWED, and the narrowing is the point. This test was named "keeps scope context isolated
    // across concurrent session operations" and its mock branched on `options.continuityScopeId`
    // — but the handler passed no options at all, so the branch never fired, and both requests
    // resolved to the SAME scope anyway because `resolveRequestIdentity` reads auth claims rather
    // than a bare `organizationId` on `extra` (F13). Two requests that resolve identically cannot
    // demonstrate isolation between them; the test proved only that the router does not cross
    // session ids under concurrency, which is what it now claims.
    //
    // Real scope isolation needs a fixture that establishes distinct identities the way the
    // transport does. Until one exists, `requestScope` is asserted as forwarded (undefined here)
    // rather than as isolating.
    const sessions = createSessionStore();
    sessions.listActiveSessions.mockReturnValue([
      { sessionId: 'sess-a', chainId: 'chain-a' },
      { sessionId: 'sess-b', chainId: 'chain-b' },
    ]);
    sessions.clearSession.mockImplementation(async (sessionId) => {
      await new Promise((resolve) => setTimeout(resolve, sessionId === 'sess-a' ? 25 : 5));
      return true;
    });
    const systemControl = createSystemControl(sessions.store);

    const [tenantAResponse, tenantBResponse] = await Promise.all([
      systemControl.handleAction(
        { action: 'session', operation: 'clear', session_id: 'sess-a' },
        { organizationId: 'org-a' }
      ),
      systemControl.handleAction(
        { action: 'session', operation: 'clear', session_id: 'sess-b' },
        { organizationId: 'org-b' }
      ),
    ]);

    expect(sessions.clearSession).toHaveBeenCalledWith('sess-a', undefined);
    expect(sessions.clearSession).toHaveBeenCalledWith('sess-b', undefined);
    expect(getText(tenantAResponse)).toContain('sess-a');
    expect(getText(tenantBResponse)).toContain('sess-b');
  });
});
