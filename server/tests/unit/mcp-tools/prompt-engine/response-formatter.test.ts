import { describe, expect, test } from '@jest/globals';

import { ResponseFormatter } from '../../../../src/mcp-tools/prompt-engine/processors/response-formatter.js';

const formatter = new ResponseFormatter();

describe('ResponseFormatter.formatPromptEngineResponse', () => {
  test('returns tool response unchanged when payload already normalized', () => {
    const input = {
      content: [{ type: 'text' as const, text: 'Hello world' }],
      isError: false,
      structuredContent: { sample: true },
    };

    const result = formatter.formatPromptEngineResponse(input);
    expect(result).toEqual(input);
  });

  test('wraps string payloads into ToolResponse objects', () => {
    const result = formatter.formatPromptEngineResponse('Plain string');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Plain string' }],
      isError: false,
    });
  });

  test('adds structured metadata only when explicitly enabled for chain executions', () => {
    const context = {
      executionId: 'exec_123',
      executionType: 'chain' as const,
      startTime: 1,
      endTime: 2,
      frameworkEnabled: true,
      frameworkUsed: 'CAGEERF',
      success: true,
      stepsExecuted: 2,
      chainId: 'chain-research#1',
      sessionId: 'session_abc',
      chainProgress: { currentStep: 1, totalSteps: 2, status: 'in_progress' as const },
    };

    const result = formatter.formatPromptEngineResponse('Chain text', context, {
      includeStructuredContent: true,
    });
    expect(result.content[0].text).toBe('Chain text');
    expect(result.structuredContent?.execution).toMatchObject({
      id: 'exec_123',
      type: 'chain',
      framework: 'CAGEERF',
      steps: 2,
    });
    expect(result.structuredContent?.chain).toMatchObject({
      id: 'chain-research#1',
      status: 'in_progress',
    });

    const promptResult = formatter.formatPromptEngineResponse('Prompt text');
    expect(promptResult.content[0].text).toBe('Prompt text');
    expect(promptResult.structuredContent).toBeUndefined();

    const defaultChainResult = formatter.formatPromptEngineResponse(
      'Chain text (default)',
      context
    );
    expect(defaultChainResult.structuredContent).toBeUndefined();
  });

  test('chain metadata omits session identifiers', () => {
    const context = {
      executionId: 'exec_456',
      executionType: 'chain' as const,
      startTime: 10,
      endTime: 20,
      frameworkEnabled: false,
      success: true,
      chainId: 'chain-demo#2',
      sessionId: 'session-hidden',
      chainProgress: { currentStep: 2, totalSteps: 2, status: 'complete' as const },
    };

    const result = formatter.formatPromptEngineResponse('Chain text', context, {
      includeStructuredContent: true,
    });

    expect(result.structuredContent?.chain).toMatchObject({ id: 'chain-demo#2' });
    expect(result.structuredContent?.chain).not.toHaveProperty('sessionId');
  });

  test('structured content is omitted for non-chain executions even when requested', () => {
    const context = {
      executionId: 'exec_prompt',
      executionType: 'prompt' as const,
      startTime: 3,
      endTime: 4,
      frameworkEnabled: false,
      success: true,
    };

    const result = formatter.formatPromptEngineResponse('Prompt text', context, {
      includeStructuredContent: true,
    });

    expect(result.structuredContent).toBeUndefined();
  });
});
