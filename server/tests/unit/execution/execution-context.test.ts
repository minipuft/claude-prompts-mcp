import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/execution/context/execution-context.js';
import type { ChainStepPrompt } from '../../../src/execution/operators/chain-operator-executor.js';
import type { ConvertedPrompt } from '../../../src/types/index.js';

const baseRequest = { command: '>>demo' };

const samplePrompt: ConvertedPrompt = {
  id: 'demo',
  name: 'Demo Prompt',
  description: 'Used for execution-context tests',
  category: 'test',
  userMessageTemplate: 'Hello {{name}}',
  arguments: [],
};

describe('ExecutionContext helpers', () => {
  test('getSessionId prefers resume metadata value', () => {
    const context = new ExecutionContext({ ...baseRequest, chain_id: 'chain-demo' });
    context.metadata.resumeSessionId = 'metadata-session';
    context.sessionContext = { sessionId: 'context-session', isChainExecution: false } as any;
    expect(context.getSessionId()).toBe('metadata-session');
  });

  test('getSessionId falls back to session context', () => {
    const context = new ExecutionContext(baseRequest);
    context.sessionContext = { sessionId: 'context-session', isChainExecution: true };
    expect(context.getSessionId()).toBe('context-session');
  });

  test('isChainExecution inspects execution plan and parsed command', () => {
    const context = new ExecutionContext(baseRequest);
    expect(context.isChainExecution()).toBe(false);

    const chainResumeContext = new ExecutionContext({ chain_id: 'chain-demo' });
    expect(chainResumeContext.isChainExecution()).toBe(true);

    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
    };
    expect(context.isChainExecution()).toBe(true);

    const chainContext = new ExecutionContext(baseRequest);
    chainContext.parsedCommand = {
      promptId: 'chain',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.8,
      metadata: {
        originalCommand: '>>chain',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      steps: [
        { promptId: 'demo', stepNumber: 1, args: {} },
      ] as ChainStepPrompt[],
    };
    expect(chainContext.isChainExecution()).toBe(true);
  });

  test('hasSinglePromptCommand type guard', () => {
    const context = new ExecutionContext(baseRequest);
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
      commandType: 'single',
      convertedPrompt: samplePrompt,
    };

    expect(context.hasSinglePromptCommand()).toBe(true);
    if (context.hasSinglePromptCommand()) {
      expect(context.parsedCommand.convertedPrompt.id).toBe('demo');
    }
  });

  test('hasChainCommand type guard', () => {
    const context = new ExecutionContext(baseRequest);
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      steps: [{ promptId: 'demo', stepNumber: 1, args: {} }] as ChainStepPrompt[],
    };

    expect(context.hasChainCommand()).toBe(true);
    if (context.hasChainCommand()) {
      expect(context.parsedCommand.steps.length).toBe(1);
    }
  });
});
