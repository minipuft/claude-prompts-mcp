import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { PostFormattingCleanupStage } from '../../../../src/execution/pipeline/stages/12-post-formatting-cleanup-stage.js';

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
