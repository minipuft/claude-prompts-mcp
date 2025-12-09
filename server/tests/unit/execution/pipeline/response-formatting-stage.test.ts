import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { ResponseFormattingStage } from '../../../../src/execution/pipeline/stages/10-formatting-stage.js';
import { ResponseFormatter } from '../../../../src/mcp-tools/prompt-engine/processors/response-formatter.js';

import type { Logger } from '../../../../src/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('ResponseFormattingStage', () => {
  test('formats chain responses with footer and structured metadata', async () => {
    const formatter = new ResponseFormatter(createLogger());
    const stage = new ResponseFormattingStage(formatter, createLogger());

    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
      category: 'analysis',
    } as any;
    context.sessionContext = {
      sessionId: 'sess-123',
      chainId: 'chain-demo#2',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
    };
    context.executionResults = {
      content: 'Chain output with inline guidance',
    };
    context.gateInstructions = 'Gate Summary:\n- inline gate passed';

    await stage.execute(context);

    const response = context.response;
    if (!response) {
      throw new Error('expected response');
    }
    const text = response.content[0].text;
    expect(text).toContain('Chain output with inline guidance');
    expect(text).toContain('Gate Summary');
    expect(text).toContain('Chain: chain-demo#2');
    expect(text).toContain('✓ Chain complete (2/2)');
    expect(text).toContain('Next: Chain complete. No user_response needed.');
    // Note: structuredContent is intentionally disabled (includeStructuredContent: false)
    // to keep model input lean. Chain metadata is included in the text footer instead.
    expect(response.structuredContent).toBeUndefined();
  });

  test('passes simple prompt content through response formatter when no session data is present', async () => {
    const formatter = new ResponseFormatter(createLogger());
    const stage = new ResponseFormattingStage(formatter, createLogger());

    const context = new ExecutionContext({ command: '>>prompt' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      promptId: 'prompt',
      rawArgs: '',
      format: 'simple',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>prompt',
        parseStrategy: 'simple',
        detectedFormat: 'simple',
        warnings: [],
      },
      convertedPrompt: { id: 'prompt' },
    } as any;
    context.executionResults = {
      content: 'Single prompt output',
    };

    await stage.execute(context);

    const content = context.response?.content[0].text ?? '';
    expect(content).toContain('Single prompt output');
    expect(content).not.toContain('Gate Inputs Provided');
    expect(context.response?.structuredContent).toBeUndefined();
  });
});
