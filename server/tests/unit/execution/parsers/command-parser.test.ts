import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { UnifiedCommandParser } from '../../../../src/execution/parsers/command-parser.js';

import type { ConvertedPrompt } from '../../../../src/types/index.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const basePrompts: ConvertedPrompt[] = [
  {
    id: 'analyze',
    name: 'Analyze',
    description: 'Analyze content',
    category: 'analysis',
    arguments: [],
    userMessageTemplate: 'Analyze {{input}}',
  },
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Summarize content',
    category: 'analysis',
    arguments: [],
    userMessageTemplate: 'Summarize {{input}}',
  },
] as ConvertedPrompt[];

describe('UnifiedCommandParser symbolic behavior', () => {
  let parser: UnifiedCommandParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new UnifiedCommandParser(mockLogger);
  });

  test('parses JSON-wrapped commands and derives chain discriminant from inner command', async () => {
    const command = JSON.stringify({
      command: '>>analyze --> summarize',
      step_args: [{ input: 'first-step' }, { format: 'bullet-list' }],
    });

    const result = await parser.parseCommand(command, basePrompts);

    expect(result.format).toBe('json');
    expect(result.commandType).toBe('chain');
    expect(result.metadata?.parseStrategy).toBe('json');
  });

  test('parses framework prefixes without failing', async () => {
    const result = await parser.parseCommand('@cageerf >>analyze', basePrompts);

    expect(result.promptId).toBe('analyze');
    const frameworkOperator = result.operators?.operators.find((op) => op.type === 'framework');
    if (frameworkOperator?.type !== 'framework') {
      throw new Error('Expected framework operator');
    }
    expect(frameworkOperator.frameworkId).toBe('cageerf');
  });

  test('detects chain command types from symbolic strings', async () => {
    const result = await parser.parseCommand('>>analyze --> summarize', basePrompts);

    expect(result.commandType).toBe('chain');
    expect(result.executionPlan?.steps?.map((step) => step.promptId)).toEqual([
      'analyze',
      'summarize',
    ]);
  });

  test('normalizes prompt names and records metadata warning', async () => {
    const prompts: ConvertedPrompt[] = [
      {
        id: 'test_prompt_name',
        name: 'Test Prompt Name',
        description: 'Normalize prompt ids',
        category: 'general',
        arguments: [],
        userMessageTemplate: 'Hello {{input}}',
      },
    ] as ConvertedPrompt[];

    const result = await parser.parseCommand('>>Test-Prompt-Name value=', prompts);

    expect(result.promptId).toBe('test_prompt_name');
    expect(result.metadata?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Normalized prompt name')])
    );
  });
});
