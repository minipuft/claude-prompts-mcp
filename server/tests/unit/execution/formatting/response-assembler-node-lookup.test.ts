// @lifecycle test - P6.176 / R77: the assembler reads the current step's prompt by node.
import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const prompt = (id: string): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'general',
  userMessageTemplate: `BODY-${id}`,
  arguments: [],
});

/**
 * A completed chain reply standing on `currentNodeId`, with a parse array of `n1`/`n2`. The
 * completion Re-run line names the prompt `resolveCurrentPrompt` answers for the current node.
 */
function completion(currentNodeId: string): ExecutionContext {
  const context = new ExecutionContext({ command: '>>a' });
  context.executionResults = {
    content: 'final output',
    metadata: { promptId: 'investigate_unknown' },
    generatedAt: Date.now(),
  };
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
  };
  context.parsedCommand = {
    promptId: 'a',
    rawArgs: '',
    format: 'symbolic' as const,
    confidence: 0.9,
    steps: [
      { stepNumber: 1, nodeId: 'n1', promptId: 'a', args: {}, convertedPrompt: prompt('a') },
      { stepNumber: 2, nodeId: 'n2', promptId: 'b', args: {}, convertedPrompt: prompt('b') },
    ],
    metadata: {
      originalCommand: '>>a',
      parseStrategy: 'symbolic',
      detectedFormat: 'symbolic',
      warnings: [],
    },
  } as ExecutionContext['parsedCommand'];
  context.sessionContext = {
    sessionId: 'session-176',
    chainId: 'chain-a#1',
    isChainExecution: true,
    currentStep: 2,
    totalSteps: 2,
    currentNodeId,
  };
  context.state.session.chainComplete = true;
  return context;
}

const rerun = (context: ExecutionContext): string | undefined =>
  /Re-run: `>>(\w+)/.exec(
    new ResponseAssembler().formatChainResponse(context, { isChainFormatting: true } as never)
  )?.[1];

describe('ResponseAssembler: the current prompt is resolved by node (P6.176)', () => {
  test('a node the parse did not mint is not read as the planned step at its ordinal', () => {
    // No parse step is this node's, so no converted prompt is read; the planned `b` never is.
    const named = rerun(completion('inv-u-176'));
    expect(named).toBeDefined();
    expect(named).not.toBe('b');
  });

  test('control: the planned node at that ordinal names its own prompt', () => {
    expect(rerun(completion('n2'))).toBe('b');
  });
});
