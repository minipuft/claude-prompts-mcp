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

describe('UnifiedCommandParser bare prompt name support', () => {
  let parser: UnifiedCommandParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new UnifiedCommandParser(mockLogger);
  });

  test('parses bare prompt name without prefix', async () => {
    const result = await parser.parseCommand('analyze', basePrompts);

    expect(result.promptId).toBe('analyze');
    expect(result.format).toBe('simple');
    expect(result.metadata?.detectedFormat).toBe('bare prompt name');
  });

  test('parses bare prompt name with arguments', async () => {
    const result = await parser.parseCommand('analyze content:"test data"', basePrompts);

    expect(result.promptId).toBe('analyze');
    expect(result.rawArgs).toBe('content:"test data"');
    expect(result.format).toBe('simple');
  });

  test('preserves >> prefix behavior', async () => {
    const result = await parser.parseCommand('>>analyze', basePrompts);

    expect(result.promptId).toBe('analyze');
    expect(result.format).toBe('simple');
    expect(result.metadata?.detectedFormat).toBe('prefixed prompt format');
  });

  test('preserves / prefix behavior', async () => {
    const result = await parser.parseCommand('/analyze', basePrompts);

    expect(result.promptId).toBe('analyze');
    expect(result.format).toBe('simple');
    expect(result.metadata?.detectedFormat).toBe('prefixed prompt format');
  });

  test('routes symbolic commands to symbolic strategy (not bare name)', async () => {
    const result = await parser.parseCommand('analyze --> summarize', basePrompts);

    expect(result.format).not.toBe('simple');
    expect(result.commandType).toBe('chain');
  });

  test('routes framework operator commands to symbolic strategy', async () => {
    const result = await parser.parseCommand('@CAGEERF analyze', basePrompts);

    expect(result.operators?.operators.some((op) => op.type === 'framework')).toBe(true);
  });
});

describe('UnifiedCommandParser double-encoded JSON handling', () => {
  let parser: UnifiedCommandParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new UnifiedCommandParser(mockLogger);
  });

  test('unwraps double-encoded JSON and parses command', async () => {
    // Simulate double-encoding: outer JSON wraps an inner JSON string
    // The command field itself contains a stringified JSON object
    const innerJson = JSON.stringify({ command: '>>analyze', args: { input: 'test' } });
    const doubleEncodedPayload = JSON.stringify({ command: innerJson });
    // This creates: {"command":"{\"command\":\">>analyze\",\"args\":{\"input\":\"test\"}}"}

    // Parse the double-encoded payload - the JSON strategy should unwrap it
    const result = await parser.parseCommand(doubleEncodedPayload, basePrompts);
    expect(result.promptId).toBe('analyze');
    expect(result.format).toBe('json');
  });

  test('handles JSON with bare prompt name in command field', async () => {
    const jsonCommand = JSON.stringify({ command: 'analyze' });
    const result = await parser.parseCommand(jsonCommand, basePrompts);

    expect(result.promptId).toBe('analyze');
    expect(result.format).toBe('json');
  });

  test('handles JSON with prefixed prompt name in command field', async () => {
    const jsonCommand = JSON.stringify({ command: '>>analyze' });
    const result = await parser.parseCommand(jsonCommand, basePrompts);

    expect(result.promptId).toBe('analyze');
    expect(result.format).toBe('json');
  });
});

describe('UnifiedCommandParser fuzzy prompt suggestions', () => {
  let parser: UnifiedCommandParser;

  const fuzzyPrompts: ConvertedPrompt[] = [
    {
      id: 'analyze_code',
      name: 'Analyze Code',
      description: 'Analyze code',
      category: 'analysis',
      arguments: [],
      userMessageTemplate: 'Analyze {{input}}',
    },
    {
      id: 'analyze_data',
      name: 'Analyze Data',
      description: 'Analyze data',
      category: 'analysis',
      arguments: [],
      userMessageTemplate: 'Analyze {{input}}',
    },
    {
      id: 'code_review',
      name: 'Code Review',
      description: 'Review code',
      category: 'review',
      arguments: [],
      userMessageTemplate: 'Review {{input}}',
    },
    {
      id: 'summarize',
      name: 'Summarize',
      description: 'Summarize content',
      category: 'general',
      arguments: [],
      userMessageTemplate: 'Summarize {{input}}',
    },
  ] as ConvertedPrompt[];

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new UnifiedCommandParser(mockLogger);
  });

  test('suggests prompts with prefix match', async () => {
    await expect(parser.parseCommand('analyze', fuzzyPrompts)).rejects.toThrow(
      /Did you mean.*analyze_code/
    );
  });

  test('suggests prompts with typo correction (Levenshtein)', async () => {
    // 'summerize' is 1 edit from 'summarize' (i vs e)
    await expect(parser.parseCommand('summerize', fuzzyPrompts)).rejects.toThrow(
      /Did you mean.*summarize/
    );
  });

  test('suggests prompts with word overlap', async () => {
    await expect(parser.parseCommand('code', fuzzyPrompts)).rejects.toThrow(/Did you mean.*code/);
  });

  test('limits suggestions to 3', async () => {
    const manyPrompts = Array.from({ length: 20 }, (_, i) => ({
      id: `test_prompt_${i}`,
      name: `Test Prompt ${i}`,
      description: 'Test',
      category: 'test',
      arguments: [],
      userMessageTemplate: 'Test',
    })) as ConvertedPrompt[];

    // 'test' should match all prompts via prefix, but only show 3
    // Pattern: exactly 3 items with exactly 2 commas before the question mark
    await expect(parser.parseCommand('test', manyPrompts)).rejects.toThrow(
      /Did you mean: test_prompt_\d+, test_prompt_\d+, test_prompt_\d+\?/
    );
  });

  test('no suggestions for completely unrelated input', async () => {
    await expect(parser.parseCommand('xyzzy123', fuzzyPrompts)).rejects.not.toThrow(/Did you mean/);
  });

  test('suggests prompts when using >> prefix with typo', async () => {
    await expect(parser.parseCommand('>>anaylze_code', fuzzyPrompts)).rejects.toThrow(
      /Did you mean.*analyze_code/
    );
  });
});
