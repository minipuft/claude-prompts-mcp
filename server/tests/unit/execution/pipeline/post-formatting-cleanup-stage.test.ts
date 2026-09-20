import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { PostFormattingCleanupStage } from '../../../../src/engine/execution/pipeline/stages/22-post-formatting-cleanup-stage.js';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('PostFormattingCleanupStage', () => {
  test('persists blueprint and inline gate ids for active sessions', async () => {
    const manager = {
      updateSessionBlueprint: jest.fn(),
    } as any;
    const registry = {
      cleanupScope: jest.fn(),
    } as any;

    const stage = new PostFormattingCleanupStage(manager, registry, logger);
    const context = new ExecutionContext({ command: 'run chain' });

    context.parsedCommand = {
      promptId: 'chain-alpha',
      rawArgs: '',
      format: 'symbolic',
      confidence: 1,
      metadata: {
        originalCommand: 'run chain',
        parseStrategy: 'unit',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      inlineGateIds: ['inline_gate_command'],
      steps: [
        { stepNumber: 1, promptId: 'step-one', args: {}, inlineGateIds: ['inline_gate_step'] },
      ],
    } as any;

    context.executionPlan = {
      strategy: 'chain',
      gates: ['framework-compliance'],
      requiresFramework: false,
      requiresSession: true,
    };

    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-alpha',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    context.gateInstructions = 'Gate footer';

    await stage.execute(context);

    expect(manager.updateSessionBlueprint).toHaveBeenCalledTimes(1);
    const [sessionId, blueprint] = manager.updateSessionBlueprint.mock.calls[0];
    expect(sessionId).toBe('session-1');
    expect(blueprint.parsedCommand.inlineGateIds).toEqual(['inline_gate_command']);
    expect(blueprint.parsedCommand.steps?.[0].inlineGateIds).toEqual(['inline_gate_step']);
  });

  /**
   * Row B.54: `updateSessionBlueprint` is async and the stage did not await it, so the
   * `catch` around the call could not see a rejected write — the failure surfaced as an
   * unhandled rejection with nothing logged, and the exit line reported the blueprint
   * persisted regardless.
   */
  test('a blueprint write that rejects is logged and reported as not persisted', async () => {
    const stageLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;
    const manager = {
      updateSessionBlueprint: jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error('chain session store is read-only')),
    } as any;

    const stage = new PostFormattingCleanupStage(manager, null, stageLogger);
    const context = new ExecutionContext({ command: 'run chain' });
    context.parsedCommand = { promptId: 'chain-alpha' } as any;
    context.executionPlan = { strategy: 'chain' } as any;
    context.sessionContext = { sessionId: 'session-1' } as any;

    await stage.execute(context);

    // Positive control: the write was reached, so the assertions below are about a real
    // rejection rather than a call that never happened.
    expect(manager.updateSessionBlueprint).toHaveBeenCalledTimes(1);

    const warned = stageLogger.warn.mock.calls.some(([message]: [string]) =>
      String(message).includes('Failed to update session blueprint')
    );
    expect(warned).toBe(true);

    const exit = stageLogger.debug.mock.calls.find(([message]: [string]) =>
      String(message).includes('Complete')
    );
    expect(exit?.[1]).toMatchObject({ blueprintPersisted: false });
  });

  test('cleans up execution and tracked temporary gate scopes', async () => {
    const registry = { cleanupScope: jest.fn() } as any;
    const stage = new PostFormattingCleanupStage(null, registry, logger);
    const context = new ExecutionContext({ command: 'noop' });

    context.state.session.executionScopeId = 'exec-1';
    context.state.gates.temporaryGateScopes = [
      { scope: 'step', scopeId: 'exec-1:step_1' },
      { scope: 'session', scopeId: 'session-1' },
    ];

    await stage.execute(context);

    expect(registry.cleanupScope).toHaveBeenCalledWith('execution', 'exec-1');
    expect(registry.cleanupScope).toHaveBeenCalledWith('step', 'exec-1:step_1');
    expect(registry.cleanupScope).toHaveBeenCalledWith('session', 'session-1');
  });
});
