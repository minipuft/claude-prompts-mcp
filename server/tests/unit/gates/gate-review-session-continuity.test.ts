import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/execution/context/execution-context.js';
import { SessionManagementStage } from '../../../src/execution/pipeline/stages/07-session-stage.js';

import type { ChainSession, ChainSessionManager } from '../../../src/chain-session/manager.js';
import type { Logger } from '../../../src/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const sampleExecutionPlan = {
  strategy: 'chain' as const,
  gates: [],
  requiresFramework: false,
  requiresSession: true,
};

class StubChainSessionManager implements ChainSessionManager {
  private sessions = new Map<string, ChainSession>();

  constructor(private readonly logger: Logger) {}

  async createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs: Record<string, any>
  ): Promise<ChainSession> {
    const session: ChainSession = {
      sessionId,
      chainId,
      state: {
        currentStep: totalSteps > 0 ? 1 : 0,
        totalSteps,
        lastUpdated: Date.now(),
        stepStates: new Map(),
      },
      executionOrder: [],
      startTime: Date.now(),
      lastActivity: Date.now(),
      originalArgs,
    };
    this.sessions.set(sessionId, session);
    this.logger.debug?.(`Created session ${sessionId} for ${chainId}`);
    return session;
  }

  hasActiveSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
  getSession(sessionId: string): ChainSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Unused interface members stubbed for typing
  getSessionByChainIdentifier(_chainId: string, _options?: any): ChainSession | undefined {
    return undefined;
  }
  getLatestSessionForBaseChain(): ChainSession | undefined {
    return undefined;
  }
  getPendingGateReview(): any {
    return undefined;
  }
  clearSession(): Promise<void> {
    return Promise.resolve();
  }
  getRunHistory(): string[] {
    return [];
  }
  getSessionByChainId(): ChainSession | undefined {
    return undefined;
  }
  // @ts-ignore - other methods are not needed for these tests
  [key: string]: any;
}

describe('SessionManagementStage continuity', () => {
  test('creates a new session when none exists', async () => {
    const logger = createLogger();
    const stubManager = new StubChainSessionManager(logger);
    const stage = new SessionManagementStage(stubManager as any, logger);

    const context = new ExecutionContext({ command: '>>demo' });
    context.executionPlan = { ...sampleExecutionPlan, totalSteps: 2 } as any;
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'simple',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'simple',
        detectedFormat: 'simple',
        warnings: [],
      },
      promptArgs: { topic: 'testing' },
      commandType: 'single',
    } as any;

    await stage.execute(context);

    expect(context.sessionContext?.sessionId).toBeDefined();
    expect(context.sessionContext?.totalSteps).toBe(1);
    expect(stubManager.hasActiveSession(context.sessionContext!.sessionId)).toBe(true);
  });

  test('resumes an existing session when resume metadata is provided', async () => {
    const logger = createLogger();
    const stubManager = new StubChainSessionManager(logger);
    const existingSession = await stubManager.createSession('session-123', 'chain-abc', 3, {});

    const stage = new SessionManagementStage(stubManager as any, logger);
    const context = new ExecutionContext({ command: '>>demo' });
    context.state.session.resumeSessionId = existingSession.sessionId;
    context.executionPlan = { ...sampleExecutionPlan, totalSteps: 3 } as any;

    await stage.execute(context);

    expect(context.sessionContext?.sessionId).toBe(existingSession.sessionId);
    expect(context.sessionContext?.currentStep).toBe(existingSession.state.currentStep);
  });
});
