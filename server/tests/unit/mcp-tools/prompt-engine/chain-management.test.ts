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
  runStatus: 'working',
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
      promoteDormant: false,
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
      promoteDormant: false,
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

  test('gates chain lists each open review by the node it grades (row 3.4)', async () => {
    const manager = createSessionManager();
    const review = (nodeId: string, kind: 'gate' | 'detached', gateIds: string[]) => ({
      nodeId,
      kind,
      phase: 'awaiting-verdict' as const,
      gateIds,
      combinedPrompt: '',
      prompts: [],
      createdAt: 1,
      attemptCount: 0,
      maxAttempts: 2,
    });
    manager.getSessionByChainIdentifier.mockReturnValue(
      createChainSession({
        chainId: 'chain-tenant#3',
        reviews: { n1: review('n1', 'detached', ['dr-block']), n2: review('n2', 'gate', []) },
      })
    );
    const { service } = createService([], manager.service);

    const text = getText(await service.tryHandleCommand('gates chain chain-tenant#3', {}));

    expect(text).toContain('- Open Gate Review on `n1` (detached): dr-block');
    expect(text).toContain('- Open Gate Review on `n2` (gate): unspecified');
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
      promoteDormant: false,
      continuityScopeId: 'tenant-b',
    });
    expect(manager.getSession).toHaveBeenCalledWith('chain-shared#1', {
      continuityScopeId: 'tenant-b',
    });
    expect(response?.isError).toBe(true);
    expect(getText(response)).toContain('not found');
  });
});

describe('ChainSessionRouter conversation pause (row T2.4)', () => {
  const pausedRun = () =>
    createChainSession({
      chainId: 'chain-paused#1',
      lastActivity: 1,
      lifecycle: 'dormant',
      handoffToken: 'secret-recovery-token',
      conversationPause: { kind: 'conversation', nodeId: 'n2', pausedAt: 5 },
    });
  // The store's promoting read: a dormant run found without `promoteDormant: false` is touched.
  const promotingManager = (run: ChainSession) => {
    const manager = createSessionManager();
    manager.getSessionByChainIdentifier.mockImplementation((_id, options: any) => {
      if (options?.promoteDormant !== false) {
        Object.assign(run, { lifecycle: 'canonical', lastActivity: 99 });
      }
      return run;
    });
    manager.listActiveSessions.mockReturnValue([
      {
        sessionId: 'sess-1',
        chainId: run.chainId,
        currentStep: 1,
        totalSteps: 3,
        pendingReview: false,
        lastActivity: 1,
        startTime: 1,
      },
    ]);
    return manager;
  };

  test.each([
    'list chains',
    'validate chain chain-paused#1',
    'status chain chain-paused#1',
    'gates chain chain-paused#1',
  ])('%s shows the pause and its actions, touches nothing, prints no token', async (command) => {
    const run = pausedRun();
    const { service } = createService([], promotingManager(run).service);
    const before = JSON.stringify([run.lastActivity, run.lifecycle, run.conversationPause]);

    const text = getText(await service.tryHandleCommand(command, {}));

    expect(text).toContain('Paused for conversation');
    expect(text).toContain('step 1 of 3');
    expect(text).toContain('gate_action:"resume"');
    expect(text).toContain('gate_action:"abort"');
    expect(text).toContain('chain_id:"chain-paused#1"');
    expect(text).not.toContain('secret-recovery-token');
    expect(JSON.stringify([run.lastActivity, run.lifecycle, run.conversationPause])).toBe(before);
  });

  test('an unpaused run is shown without any pause wording', async () => {
    const manager = createSessionManager();
    manager.getSessionByChainIdentifier.mockReturnValue(createChainSession());
    const { service } = createService([], manager.service);

    const text = getText(await service.tryHandleCommand('validate chain chain-research#1', {}));

    expect(text).not.toContain('Paused');
  });
});
