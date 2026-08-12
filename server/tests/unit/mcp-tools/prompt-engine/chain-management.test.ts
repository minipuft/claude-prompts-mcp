import { describe, expect, jest, test } from '@jest/globals';

import { ResponseFormatter } from '../../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ChainSessionRouter } from '../../../../src/mcp/tools/prompt-engine/core/chain-session-router.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type {
  ChainSession,
  ChainSessionService,
} from '../../../../src/shared/types/chain-session.js';

const createLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const createChainSession = (overrides: Partial<ChainSession> = {}): ChainSession => ({
  sessionId: 'sess-1',
  chainId: 'chain-research#1',
  state: {
    currentNodeId: 'n1',
    nodes: [
      { id: 'n1', promptId: 'chain-research', stepName: 'Step 1' },
      { id: 'n2', promptId: 'chain-research', stepName: 'Step 2' },
      { id: 'n3', promptId: 'chain-research', stepName: 'Step 3' },
    ],
    stepStates: new Map(),
    lastUpdated: Date.now(),
  },
  executionOrder: [],
  startTime: Date.now(),
  lastActivity: Date.now(),
  originalArgs: {},
  lifecycle: 'canonical',
  ...overrides,
});

const createSessionManager = () => {
  const getSessionByChainIdentifier = jest.fn();
  const getSession = jest.fn();
  const getChainContext = jest.fn().mockReturnValue({});
  const listActiveSessions = jest.fn().mockReturnValue([]);
  const getInlineGateIds = jest.fn().mockReturnValue([]);

  return {
    service: {
      getSessionByChainIdentifier,
      getSession,
      getChainContext,
      listActiveSessions,
      getInlineGateIds,
    } as unknown as ChainSessionService,
    getSessionByChainIdentifier,
    getSession,
    getChainContext,
    listActiveSessions,
    getInlineGateIds,
  };
};

const createService = (
  prompts: ConvertedPrompt[] = [],
  manager: ChainSessionService = createSessionManager().service
) => {
  const temporaryGateRegistry = {
    getTemporaryGatesForScope: jest.fn().mockReturnValue([]),
  };
  const gateSystem = {
    getTemporaryGateRegistry: jest.fn().mockReturnValue(temporaryGateRegistry),
  } as any;

  return {
    service: new ChainSessionRouter(
      prompts,
      manager,
      new ResponseFormatter(createLogger()),
      gateSystem
    ),
    temporaryGateRegistry,
  };
};

const getText = (response: Awaited<ReturnType<ChainSessionRouter['tryHandleCommand']>>) =>
  response?.content[0]?.type === 'text' ? response.content[0].text : '';

describe('ChainSessionRouter tenant scoping', () => {
  test('scopes list chains command to tenant id', async () => {
    const manager = createSessionManager();
    manager.listActiveSessions.mockReturnValue([
      {
        sessionId: 'sess-tenant',
        chainId: 'chain-research#1',
        currentStep: 1,
        totalSteps: 3,
        pendingReview: false,
        lastActivity: Date.now(),
        startTime: Date.now(),
      },
    ]);
    const { service } = createService([], manager.service);

    const response = await service.tryHandleCommand('list chains limit:5', {
      continuityScopeId: 'tenant-acme',
    });

    expect(manager.listActiveSessions).toHaveBeenCalledWith(5, {
      continuityScopeId: 'tenant-acme',
    });
    expect(response?.isError).toBe(false);
    expect(getText(response)).toContain('Active Chain Sessions');
  });

  test('scopes validate chain session lookup and chain context to tenant id', async () => {
    const manager = createSessionManager();
    manager.getSessionByChainIdentifier.mockReturnValue(
      createChainSession({
        sessionId: 'sess-tenant',
        chainId: 'chain-tenant#1',
      })
    );
    manager.getChainContext.mockReturnValue({
      chain_metadata: {
        name: 'Tenant Chain',
        gates: ['accuracy'],
      },
    });
    const { service } = createService([], manager.service);

    const response = await service.tryHandleCommand('validate chain chain-tenant#1', {
      continuityScopeId: 'tenant-acme',
    });

    expect(manager.getSessionByChainIdentifier).toHaveBeenCalledWith('chain-tenant#1', {
      includeDormant: true,
      continuityScopeId: 'tenant-acme',
    });
    expect(manager.getChainContext).toHaveBeenCalledWith('sess-tenant', {
      continuityScopeId: 'tenant-acme',
    });
    expect(response?.isError).toBe(false);
    expect(getText(response)).toContain('Resume With');
    expect(getText(response)).toContain('chain-tenant#1');
  });

  test('scopes gates chain summary lookups to tenant id', async () => {
    const manager = createSessionManager();
    manager.getSessionByChainIdentifier.mockReturnValue(
      createChainSession({
        sessionId: 'sess-tenant',
        chainId: 'chain-tenant#2',
      })
    );
    manager.getInlineGateIds.mockReturnValue(['inline-accuracy']);
    const { service, temporaryGateRegistry } = createService([], manager.service);
    temporaryGateRegistry.getTemporaryGatesForScope.mockReturnValue([{ name: 'temp-security' }]);

    const response = await service.tryHandleCommand('gates chain chain-tenant#2', {
      continuityScopeId: 'tenant-acme',
    });

    expect(manager.getSessionByChainIdentifier).toHaveBeenCalledWith('chain-tenant#2', {
      includeDormant: true,
      continuityScopeId: 'tenant-acme',
    });
    expect(manager.getInlineGateIds).toHaveBeenCalledWith('sess-tenant', {
      continuityScopeId: 'tenant-acme',
    });
    expect(temporaryGateRegistry.getTemporaryGatesForScope).toHaveBeenCalledWith(
      'chain',
      'chain-tenant#2'
    );
    expect(response?.isError).toBe(false);
    expect(getText(response)).toContain('Inline Gates: inline-accuracy');
    expect(getText(response)).toContain('Chain-Scoped Temporary Gates: temp-security');
  });

  test('does not leak sessions across scopes with shared chain identifiers', async () => {
    const manager = createSessionManager();
    manager.getSessionByChainIdentifier.mockImplementation((_chainId, options) =>
      options?.continuityScopeId === 'tenant-a'
        ? createChainSession({ sessionId: 'sess-tenant-a', chainId: 'chain-shared#1' })
        : undefined
    );
    manager.getSession.mockReturnValue(undefined);
    const { service } = createService([], manager.service);

    const response = await service.tryHandleCommand('validate chain chain-shared#1', {
      continuityScopeId: 'tenant-b',
    });

    expect(manager.getSessionByChainIdentifier).toHaveBeenCalledWith('chain-shared#1', {
      includeDormant: true,
      continuityScopeId: 'tenant-b',
    });
    expect(manager.getSession).toHaveBeenCalledWith('chain-shared#1', {
      continuityScopeId: 'tenant-b',
    });
    expect(response?.isError).toBe(true);
    expect(getText(response)).toContain('not found');
  });
});
