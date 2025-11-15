import { describe, test, expect } from '@jest/globals';
import { ResponseFormatter } from '../../src/mcp-tools/prompt-engine/processors/response-formatter.js';

const formatter = new ResponseFormatter();

describe('ResponseFormatter.normalize', () => {
  test('returns tool response unchanged when content array provided', () => {
    const input = {
      content: [{ type: 'text' as const, text: 'Hello world' }],
      isError: false,
      structuredContent: { sample: true },
    };

    const result = formatter.formatPromptEngineResponse(input);
    expect(result).toEqual(input);
  });

  test('wraps plain string into ToolResponse', () => {
    const result = formatter.formatPromptEngineResponse('Plain string');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Plain string' }],
      isError: false,
    });
  });

  test('handles message objects without content array', () => {
    const result = formatter.formatPromptEngineResponse({ message: 'Hi there', isError: true });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Hi there' }],
      isError: true,
    });
  });

  test('adds structured metadata only for chain executions', () => {
    const context = {
      executionId: 'exec_123',
      executionType: 'chain' as const,
      startTime: 1,
      endTime: 2,
      frameworkEnabled: true,
      frameworkUsed: 'CAGEERF',
      success: true,
      stepsExecuted: 2,
      sessionId: 'session_abc'
    };

    const result = formatter.formatPromptEngineResponse('Chain text', context, {});
    expect(result.content[0].text).toBe('Chain text');
    expect(result.structuredContent?.executionMetadata).toMatchObject({
      executionId: 'exec_123',
      executionType: 'chain',
      frameworkUsed: 'CAGEERF',
      stepsExecuted: 2,
      sessionId: 'session_abc'
    });

    const promptResult = formatter.formatPromptEngineResponse('Prompt text');
    expect(promptResult.content[0].text).toBe('Prompt text');
    expect(promptResult.structuredContent).toBeUndefined();
  });
});
