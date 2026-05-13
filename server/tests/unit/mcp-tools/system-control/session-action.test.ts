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
  const systemControl = createConsolidatedSystemControl(
    createLogger(),
    { sendNotification: jest.fn() } as any,
    () => Promise.resolve()
  );
  systemControl.setChainSessionManager(chainSessionStore);
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
        currentStep: 1,
        totalSteps: 3,
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

  test('scopes clear operation to organization id', async () => {
    const sessions = createSessionStore();
    sessions.clearSession.mockResolvedValue(true);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'clear', session_id: 'sess-1' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.clearSession).toHaveBeenCalledWith('sess-1');
    expect(getText(response)).toContain('Session Cleared');
  });

  test('scopes clear-by-chain fallback to organization id', async () => {
    const sessions = createSessionStore();
    sessions.clearSession.mockResolvedValue(false);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'clear', session_id: 'chain-shared#1' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.clearSession).toHaveBeenCalledWith('chain-shared#1');
    expect(sessions.clearSessionsForChain).toHaveBeenCalledWith('chain-shared#1');
    expect(getText(response)).toContain('Chain Sessions Cleared');
  });

  test('scopes inspect operation lookups to organization id', async () => {
    const sessions = createSessionStore();
    sessions.getSession.mockReturnValue({
      sessionId: 'sess-1',
      chainId: 'chain-research#1',
      state: { currentStep: 1, totalSteps: 3 },
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

  test('cancel operation routes to ChainSessionService.cancelChain', async () => {
    const sessions = createSessionStore();
    sessions.cancelChain.mockResolvedValue(true);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'cancel', session_id: 'sess-active' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.cancelChain).toHaveBeenCalledWith('sess-active');
    expect(getText(response)).toContain('Session Cancelled');
    expect(getText(response)).toContain('sess-active');
  });

  test('cancel returns idempotent success when service reports already-cancelled', async () => {
    const sessions = createSessionStore();
    sessions.cancelChain.mockResolvedValue(true);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'cancel', session_id: 'sess-already-cancelled' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.cancelChain).toHaveBeenCalledWith('sess-already-cancelled');
    expect(getText(response)).toContain('Session Cancelled');
  });

  test('cancel surfaces non-applicable message when service refuses terminal state', async () => {
    const sessions = createSessionStore();
    sessions.cancelChain.mockResolvedValue(false);
    const systemControl = createSystemControl(sessions.store);

    const response = await systemControl.handleAction(
      { action: 'session', operation: 'cancel', session_id: 'sess-completed' },
      { organizationId: 'org-acme' }
    );

    expect(sessions.cancelChain).toHaveBeenCalledWith('sess-completed');
    expect(getText(response)).toContain('Cancel Not Applied');
    expect(getText(response)).toContain('terminal state');
  });

  test('cancel throws when session_id is missing', async () => {
    const sessions = createSessionStore();
    const systemControl = createSystemControl(sessions.store);

    await expect(
      systemControl.handleAction(
        { action: 'session', operation: 'cancel' },
        { organizationId: 'org-acme' }
      )
    ).rejects.toThrow(/session_id/i);

    expect(sessions.cancelChain).not.toHaveBeenCalled();
  });

  test('keeps scope context isolated across concurrent session operations', async () => {
    const sessions = createSessionStore();
    sessions.clearSession.mockImplementation(async (_sessionId, options) => {
      const continuityScopeId = options?.continuityScopeId;
      const delayMs = continuityScopeId === 'org-a' ? 25 : 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
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

    expect(sessions.clearSession).toHaveBeenCalledWith('sess-a');
    expect(sessions.clearSession).toHaveBeenCalledWith('sess-b');
    expect(getText(tenantAResponse)).toContain('sess-a');
    expect(getText(tenantBResponse)).toContain('sess-b');
  });
});
