import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../../src/execution/pipeline/decisions/index.js';
import { SessionManagementStage } from '../../../../src/execution/pipeline/stages/07-session-stage.js';

import type { ChainSession, ChainSessionService } from '../../../../src/chain-session/types.js';
import type {
  ExecutionPlan,
  ParsedCommand,
} from '../../../../src/execution/context/execution-context.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createExecutionPlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  strategy: 'chain',
  gates: [],
  requiresFramework: false,
  requiresSession: true,
  ...overrides,
});

const createParsedCommand = (): ParsedCommand => ({
  promptId: 'chain_prompt',
  rawArgs: '',
  format: 'symbolic',
  confidence: 0.98,
  commandType: 'chain',
  metadata: {
    originalCommand: '>>chain_prompt',
    parseStrategy: 'symbolic',
    detectedFormat: 'symbolic',
    warnings: [],
  },
  chainId: 'chain-chain_prompt',
  steps: [
    { stepNumber: 1, promptId: 'first', args: {} },
    { stepNumber: 2, promptId: 'second', args: {} },
  ],
});

const createChainSession = (overrides: Partial<ChainSession> = {}): ChainSession => ({
  sessionId: 'session-1',
  chainId: 'chain-chain_prompt#1',
  state: {
    currentStep: 1,
    totalSteps: 2,
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

const createSessionManager = (): jest.Mocked<ChainSessionService> => {
  const manager: Partial<ChainSessionService> = {
    hasActiveSession: jest.fn().mockReturnValue(false),
    hasActiveSessionForChain: jest.fn(),
    getSession: jest.fn(),
    getActiveSessionForChain: jest.fn(),
    getSessionByChainIdentifier: jest.fn(),
    getLatestSessionForBaseChain: jest.fn(),
    getRunHistory: jest.fn().mockReturnValue([]),
    createSession: jest.fn(async () => createChainSession()),
    getPendingGateReview: jest.fn().mockReturnValue(undefined),
    setPendingGateReview: jest.fn(),
    clearPendingGateReview: jest.fn(),
    getChainContext: jest.fn(),
    getOriginalArgs: jest.fn(),
    getSessionBlueprint: jest.fn(),
    updateSessionBlueprint: jest.fn(),
    getInlineGateIds: jest.fn(),
    clearSessionsForChain: jest.fn(),
    listActiveSessions: jest.fn().mockReturnValue([]),
    updateSessionState: jest.fn(),
    setStepState: jest.fn(),
    getStepState: jest.fn(),
    transitionStepState: jest.fn(),
    isStepComplete: jest.fn(),
    completeStep: jest.fn(),
    cleanup: jest.fn(),
  };

  return manager as jest.Mocked<ChainSessionService>;
};

describe('SessionManagementStage', () => {
  let manager: jest.Mocked<ChainSessionService>;
  let stage: SessionManagementStage;

  beforeEach(() => {
    manager = createSessionManager();
    stage = new SessionManagementStage(manager, createLogger());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates a new session when none exists', async () => {
    const context = new ExecutionContext({ command: '>>chain_prompt' } as any);
    context.executionPlan = createExecutionPlan({ gates: ['gate-alpha'] });
    context.parsedCommand = createParsedCommand();

    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    manager.getRunHistory.mockReturnValue([]);

    await stage.execute(context);

    expect(manager.createSession).toHaveBeenCalledTimes(1);
    const [sessionId, chainId, totalSteps, originalArgs, options] =
      manager.createSession.mock.calls[0];
    expect(sessionId).toBe('review-chain_prompt-1700000000000');
    expect(chainId).toBe('chain-chain_prompt#1');
    expect(totalSteps).toBe(2);
    expect(originalArgs).toEqual({});
    expect(options?.blueprint?.parsedCommand?.promptId).toBe('chain_prompt');

    expect(context.sessionContext).toEqual({
      sessionId: 'review-chain_prompt-1700000000000',
      chainId: 'chain-chain_prompt#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    });
    expect(context.state.session.lifecycleDecision).toBe('create-new');
    dateSpy.mockRestore();
  });

  test('resumes an existing session using resume metadata when session is active', async () => {
    const existingSession = createChainSession({
      sessionId: 'sess-active',
      chainId: 'chain-chain_prompt#2',
      state: {
        currentStep: 2,
        totalSteps: 3,
        stepStates: new Map(),
        lastUpdated: Date.now(),
      },
    });

    manager.hasActiveSession.mockImplementation((id) => id === 'sess-active');
    manager.getSession.mockReturnValue(existingSession);

    const context = new ExecutionContext({ command: '>>chain_prompt' } as any);
    context.state.session.resumeSessionId = 'sess-active';
    context.executionPlan = createExecutionPlan();
    context.parsedCommand = createParsedCommand();

    await stage.execute(context);

    expect(manager.createSession).not.toHaveBeenCalled();
    expect(context.sessionContext).toEqual({
      sessionId: 'sess-active',
      chainId: 'chain-chain_prompt#2',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 3,
      pendingReview: undefined,
    });
    expect(context.state.session.lifecycleDecision).toBe('resume-chain');
  });

  test('resumes sessions using chain identifiers when no session id is provided', async () => {
    const existingSession = createChainSession({
      sessionId: 'sess-from-chain',
      chainId: 'chain-chain_prompt#5',
      state: {
        currentStep: 1,
        totalSteps: 2,
        stepStates: new Map(),
        lastUpdated: Date.now(),
      },
    });

    manager.getSessionByChainIdentifier.mockReturnValue(existingSession);

    const context = new ExecutionContext({
      command: '>>chain_prompt',
      chain_id: 'chain-chain_prompt#5',
    } as any);
    context.executionPlan = createExecutionPlan();
    context.parsedCommand = createParsedCommand();

    await stage.execute(context);

    expect(manager.createSession).not.toHaveBeenCalled();
    expect(manager.getSessionByChainIdentifier).toHaveBeenCalledWith('chain-chain_prompt#5', {
      includeDormant: true,
    });
    expect(context.sessionContext).toEqual({
      sessionId: 'sess-from-chain',
      chainId: 'chain-chain_prompt#5',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
      pendingReview: undefined,
    });
    expect(context.state.session.lifecycleDecision).toBe('resume-chain-id');
  });

  test('creates a new session when only base history exists without explicit resume', async () => {
    const existingSession = createChainSession({
      sessionId: 'sess-history',
      chainId: 'chain-chain_prompt#4',
      state: {
        currentStep: 2,
        totalSteps: 3,
        stepStates: new Map(),
        lastUpdated: Date.now(),
      },
    });

    manager.getLatestSessionForBaseChain.mockReturnValue(existingSession);

    const context = new ExecutionContext({ command: '>>chain_prompt' } as any);
    context.executionPlan = createExecutionPlan();
    context.parsedCommand = createParsedCommand();

    await stage.execute(context);

    expect(manager.getSessionByChainIdentifier).not.toHaveBeenCalled();
    expect(manager.getLatestSessionForBaseChain).not.toHaveBeenCalled();
    expect(manager.createSession).toHaveBeenCalledTimes(1);
    expect(context.state.session.lifecycleDecision).toBe('create-new');
    expect(context.sessionContext?.chainId).not.toBe(existingSession.chainId);
  });

  test('forces restart when force_restart flag is set even if prior session exists', async () => {
    const existingSession = createChainSession({
      sessionId: 'sess-old',
      chainId: 'chain-chain_prompt#3',
      state: {
        currentStep: 2,
        totalSteps: 2,
        stepStates: new Map(),
        lastUpdated: Date.now(),
      },
    });

    manager.hasActiveSession.mockReturnValue(true);
    manager.getSession.mockReturnValue(existingSession);

    const context = new ExecutionContext({ command: '>>chain_prompt', force_restart: true } as any);
    context.executionPlan = createExecutionPlan();
    context.parsedCommand = createParsedCommand();

    await stage.execute(context);

    expect(manager.createSession).toHaveBeenCalledTimes(1);
    expect(context.state.session.lifecycleDecision).toBe('create-force-restart');
    expect(context.sessionContext?.currentStep).toBe(1);
  });

  test('delegates pending review creation to GateEnforcementAuthority', async () => {
    const context = new ExecutionContext({ command: '>>chain_prompt' } as any);
    context.executionPlan = createExecutionPlan({ gates: ['gate-alpha'] });
    context.parsedCommand = createParsedCommand();
    context.gateInstructions = 'Review these gates carefully.';

    // Set up gate state to trigger review creation
    context.state.gates.hasBlockingGates = true;
    context.state.gates.accumulatedGateIds = ['gate-alpha', 'gate-beta'];

    // Initialize the authority on context (normally done by DI stage)
    context.gateEnforcement = new GateEnforcementAuthority(manager as any, createLogger() as any);

    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    manager.getRunHistory.mockReturnValue([]);

    await stage.execute(context);

    // Verify review was created via authority and persisted
    expect(manager.setPendingGateReview).toHaveBeenCalledTimes(1);
    const [sessionId, pendingReview] = manager.setPendingGateReview.mock.calls[0];
    expect(sessionId).toBe('review-chain_prompt-1700000000000');
    expect(pendingReview.gateIds).toEqual(['gate-alpha', 'gate-beta']);
    expect(pendingReview.combinedPrompt).toBe('Review these gates carefully.');
    expect(pendingReview.attemptCount).toBe(0);
    expect(pendingReview.maxAttempts).toBe(2); // DEFAULT_RETRY_LIMIT

    // Verify review is attached to session context
    expect(context.sessionContext?.pendingReview).toBeDefined();
    expect(context.sessionContext?.pendingReview?.gateIds).toEqual(['gate-alpha', 'gate-beta']);

    dateSpy.mockRestore();
  });

  test('skips review creation when no authority is available', async () => {
    const context = new ExecutionContext({ command: '>>chain_prompt' } as any);
    context.executionPlan = createExecutionPlan({ gates: ['gate-alpha'] });
    context.parsedCommand = createParsedCommand();

    // Set up gate state but no authority
    context.state.gates.hasBlockingGates = true;
    context.state.gates.accumulatedGateIds = ['gate-alpha'];
    // context.gateEnforcement is undefined

    manager.getRunHistory.mockReturnValue([]);

    await stage.execute(context);

    // Session should be created but no pending review
    expect(manager.createSession).toHaveBeenCalledTimes(1);
    expect(manager.setPendingGateReview).not.toHaveBeenCalled();
    expect(context.sessionContext?.pendingReview).toBeUndefined();
  });
});
