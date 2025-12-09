import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { DependencyInjectionStage } from '../../../../dist/execution/pipeline/stages/00-dependency-injection-stage.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createMockChainSessionManager = () => ({
  getSession: jest.fn(),
  hasActiveSession: jest.fn(),
  getPendingGateReview: jest.fn(),
  setPendingGateReview: jest.fn(),
  clearPendingGateReview: jest.fn(),
  isRetryLimitExceeded: jest.fn().mockReturnValue(false),
  resetRetryCount: jest.fn(),
  recordGateReviewOutcome: jest.fn(),
});

describe('DependencyInjectionStage', () => {
  test('records dependency snapshot metadata', async () => {
    const registry = {};
    const analyticsService = { id: 'analytics-1' };
    const chainSessionManager = createMockChainSessionManager();
    const stage = new DependencyInjectionStage(
      registry as any,
      chainSessionManager as any,
      () => true,
      () => analyticsService as any,
      'canonical-stage-0',
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>demo' });
    await stage.execute(context);

    expect(context.metadata.pipelineDependencies).toMatchObject({
      frameworkEnabled: true,
      analyticsService,
      temporaryGateRegistry: registry,
      pipelineVersion: 'canonical-stage-0',
    });

    expect(context.metadata.executionOptions).toBeDefined();
  });

  test('initializes gate enforcement authority', async () => {
    const registry = {};
    const chainSessionManager = createMockChainSessionManager();
    const stage = new DependencyInjectionStage(
      registry as any,
      chainSessionManager as any,
      () => false,
      () => undefined,
      'canonical-stage-0',
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>demo' });
    await stage.execute(context);

    expect(context.gateEnforcement).toBeDefined();
    expect(typeof context.gateEnforcement?.parseVerdict).toBe('function');
    expect(typeof context.gateEnforcement?.resolveAction).toBe('function');
  });
});
