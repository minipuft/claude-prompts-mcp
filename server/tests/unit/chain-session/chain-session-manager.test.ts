import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionManager, type SessionBlueprint } from '../../../src/chain-session/manager.js';
import { StepState } from '../../../src/mcp-tools/prompt-engine/core/types.js';

import type { Logger } from '../../../src/logging/index.js';
import type { ConvertedPrompt } from '../../../src/types/index.js';

class StubTextReferenceManager {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('ChainSessionManager', () => {
  let manager: ChainSessionManager;
  let saveSpy: jest.SpyInstance;
  let loadSpy: jest.SpyInstance;
  let schedulerSpy: jest.SpyInstance;

  beforeEach(() => {
    saveSpy = jest
      .spyOn(ChainSessionManager.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined);
    loadSpy = jest
      .spyOn(ChainSessionManager.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined);
    schedulerSpy = jest
      .spyOn(ChainSessionManager.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  test('cleans review sessions faster than chain sessions', async () => {
    manager = new ChainSessionManager(createLogger(), new StubTextReferenceManager() as any, {
      serverRoot: '/tmp/test-chain-sessions',
      reviewSessionTimeoutMs: 5 * 60 * 1000,
      defaultSessionTimeoutMs: 60 * 60 * 1000,
      cleanupIntervalMs: 1000,
    });

    await manager.createSession('review-session', 'prompt-review-chain', 1);
    await manager.createSession('chain-session', 'chain-alpha', 3);

    const activeSessions = (manager as any).activeSessions as Map<string, any>;
    activeSessions.get('review-session')!.lastActivity = Date.now() - 10 * 60 * 1000;
    activeSessions.get('chain-session')!.lastActivity = Date.now() - 2 * 60 * 1000;

    const cleaned = await manager.cleanupStaleSessions();

    expect(cleaned).toBe(1);
    expect(manager.hasActiveSession('review-session')).toBe(false);
    expect(manager.hasActiveSession('chain-session')).toBe(true);
  });

  test('does not advance currentStep when completing placeholders', async () => {
    manager = new ChainSessionManager(createLogger(), new StubTextReferenceManager() as any, {
      serverRoot: '/tmp/test-chain-sessions-placeholder',
      cleanupIntervalMs: 1000,
    });

    await manager.createSession('session-placeholder', 'chain-placeholder', 2);
    manager.setStepState('session-placeholder', 1, StepState.RENDERED, true);

    await manager.completeStep('session-placeholder', 1, { preservePlaceholder: true });

    const session = (manager as any).activeSessions.get('session-placeholder');

    expect(session.state.currentStep).toBe(1);
    expect(session.executionOrder).toEqual([]);
  });

  test('includes blueprint metadata and inline gates inside chain context', async () => {
    const textReferenceManager = new StubTextReferenceManager();
    textReferenceManager.buildChainVariables.mockReturnValue({
      step_results: { '1': 'Stored result' },
    });

    manager = new ChainSessionManager(createLogger(), textReferenceManager as any, {
      serverRoot: '/tmp/test-chain-sessions-context',
      cleanupIntervalMs: 1000,
    });

    const convertedPrompt: ConvertedPrompt = {
      id: 'chain-alpha',
      name: 'Chain Alpha',
      description: 'Restores metadata banners for symbolic chains',
      category: 'code',
      userMessageTemplate: 'Do work: {{input}}',
      systemMessage: 'You are reliable',
      arguments: [],
    };

    const blueprint: SessionBlueprint = {
      parsedCommand: {
        promptId: 'chain-alpha',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        metadata: {
          originalCommand: 'run chain-alpha',
          parseStrategy: 'unit-test',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        commandType: 'chain',
        convertedPrompt,
        inlineGateIds: ['inline_gate_focus'],
        steps: [
          {
            stepNumber: 1,
            promptId: 'chain-alpha:step1',
            args: { input: 'alpha' },
            inlineGateIds: ['inline_gate_focus_step'],
          },
        ] as any,
      },
      executionPlan: {
        strategy: 'chain',
        gates: ['framework-compliance'],
        requiresFramework: true,
        requiresSession: true,
      },
    };

    await manager.createSession(
      'session-chain-context',
      'chain-alpha',
      2,
      { priority: 'high' },
      { blueprint }
    );
    const context = manager.getChainContext('session-chain-context');

    expect(context.chain_run_id).toBe('session-chain-context');
    expect(context.total_steps).toBe(2);
    expect(context.currentStepArgs).toEqual({ input: 'alpha' });
    // {{input}} exposes current step's arguments for template access
    expect(context.input).toEqual({ input: 'alpha' });
    expect(context.chain_metadata).toEqual(
      expect.objectContaining({
        chainId: 'chain-alpha',
        promptId: 'chain-alpha',
        name: 'Chain Alpha',
        description: 'Restores metadata banners for symbolic chains',
        category: 'code',
        gates: ['framework-compliance'],
        inlineGateIds: ['inline_gate_focus', 'inline_gate_focus_step'],
        chainRunId: 'session-chain-context',
      })
    );
  });

  test('updateSessionBlueprint stores snapshot independently', async () => {
    manager = new ChainSessionManager(createLogger(), new StubTextReferenceManager() as any, {
      serverRoot: '/tmp/test-chain-sessions-blueprint',
      cleanupIntervalMs: 1000,
    });

    await manager.createSession('session-blueprint', 'chain-blueprint', 1);

    const blueprint: SessionBlueprint = {
      parsedCommand: {
        promptId: 'chain-blueprint',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        metadata: {
          originalCommand: 'run chain-blueprint',
          parseStrategy: 'unit-test',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        commandType: 'chain',
      },
      executionPlan: {
        strategy: 'chain',
        gates: ['framework-compliance'],
        requiresFramework: true,
        requiresSession: true,
      },
      gateInstructions: 'Persisted gate instructions',
    };

    manager.updateSessionBlueprint('session-blueprint', blueprint);

    const stored = manager.getSessionBlueprint('session-blueprint');
    expect(stored?.gateInstructions).toBe('Persisted gate instructions');

    blueprint.gateInstructions = 'mutated';
    expect(stored?.gateInstructions).toBe('Persisted gate instructions');
  });
});
