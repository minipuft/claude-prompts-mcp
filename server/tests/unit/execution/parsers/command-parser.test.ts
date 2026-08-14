import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';

import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

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
  {
    id: 'implementation_plan',
    name: 'Implementation Plan',
    description: 'Creates implementation plans',
    category: 'planning',
    arguments: [{ name: 'feature', type: 'string', description: 'Feature to implement' }],
    userMessageTemplate: '{{feature}}',
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

  test('resolves prompt when arguments contain special characters (parentheses, colons, slashes, plus)', async () => {
    // Regression: "+" inside quoted args triggered symbolic canHandle, gate-stripping
    // regex then corrupted the prompt ID. See plans/command-parser-special-chars-fix.md
    const result = await parser.parseCommand(
      '>>implementation_plan feature:"Two modes: (1) standalone on port 3200, (2) embedded /dashboard + SSE"',
      basePrompts
    );

    expect(result.promptId).toBe('implementation_plan');
    expect(result.rawArgs).toContain('(1)');
    expect(result.rawArgs).toContain('/dashboard');
    expect(result.rawArgs).toContain('+ SSE');
  });

  test('resolves prompt with multiple key:value args containing special characters', async () => {
    const result = await parser.parseCommand(
      '>>implementation_plan feature:"R3F + Visx charts" constraints:"target <200KB, works with node:sqlite"',
      basePrompts
    );

    expect(result.promptId).toBe('implementation_plan');
    expect(result.rawArgs).toContain('R3F + Visx');
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

describe('UnifiedCommandParser hyphen-agnostic prompt resolution', () => {
  let parser: UnifiedCommandParser;

  const hyphenPrompts: ConvertedPrompt[] = [
    {
      id: 'hot_reload_test',
      name: 'Hot Reload Test',
      description: 'Test hot reload',
      category: 'testing',
      arguments: [],
      userMessageTemplate: 'Test {{topic}}',
    },
    {
      id: 'code_review',
      name: 'Code Review',
      description: 'Review code',
      category: 'review',
      arguments: [],
      userMessageTemplate: 'Review {{code}}',
    },
    {
      id: 'deep_analysis',
      name: 'Deep Analysis',
      description: 'Deep analysis',
      category: 'analysis',
      arguments: [],
      userMessageTemplate: 'Analyze {{input}}',
    },
  ] as ConvertedPrompt[];

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new UnifiedCommandParser(mockLogger);
  });

  test('resolves hyphenated input to underscore prompt ID', async () => {
    const result = await parser.parseCommand('>>hot-reload-test', hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
  });

  test('resolves underscore input to underscore prompt ID (exact match)', async () => {
    const result = await parser.parseCommand('>>hot_reload_test', hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
  });

  test('resolves bare hyphenated name to underscore prompt ID', async () => {
    const result = await parser.parseCommand('hot-reload-test', hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
  });

  test('resolves hyphenated input with arguments', async () => {
    const result = await parser.parseCommand('>>hot-reload-test topic:"testing"', hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
    expect(result.rawArgs).toContain('topic');
  });

  test('resolves mixed-delimiter input (e.g., hot_reload-test)', async () => {
    const result = await parser.parseCommand('>>hot_reload-test', hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
  });

  test('preserves canonical ID when prompt uses hyphens in stored ID', async () => {
    // Edge case: if a prompt somehow has hyphens in its stored ID,
    // the resolver should return the stored ID as-is
    const promptsWithHyphenId: ConvertedPrompt[] = [
      {
        id: 'my-legacy-prompt',
        name: 'My Legacy Prompt',
        description: 'A prompt with hyphens in ID',
        category: 'general',
        arguments: [],
        userMessageTemplate: 'Test',
      },
    ] as ConvertedPrompt[];

    const result = await parser.parseCommand('>>my_legacy_prompt', promptsWithHyphenId);

    // Should find via normalized fallback and return the actual stored ID
    expect(result.promptId).toBe('my-legacy-prompt');
  });

  test('case-insensitive resolution works with hyphens', async () => {
    const result = await parser.parseCommand('>>Hot-Reload-Test', hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
  });

  test('still throws for genuinely unknown prompts', async () => {
    await expect(parser.parseCommand('>>nonexistent_prompt', hyphenPrompts)).rejects.toThrow(
      /Unknown prompt/
    );
  });

  test('JSON format resolves hyphenated prompt IDs', async () => {
    const jsonCommand = JSON.stringify({ command: '>>hot-reload-test' });
    const result = await parser.parseCommand(jsonCommand, hyphenPrompts);

    expect(result.promptId).toBe('hot_reload_test');
  });
});

describe('reserved operators (operators.json status: reserved)', () => {
  let parser: UnifiedCommandParser;

  const prompts: ConvertedPrompt[] = [
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

  beforeEach(() => {
    parser = new UnifiedCommandParser(mockLogger);
  });

  // Before this rejection existed, both of these PARSED and returned the leading prompt —
  // the reserved operator was tokenized and then silently dropped by every strategy.
  test('rejects the parallel operator (+)', async () => {
    await expect(parser.parseCommand('>>analyze + >>summarize', prompts)).rejects.toThrow(
      /Operator "\+" is reserved and not implemented/
    );
  });

  test('rejects the conditional operator in its documented form', async () => {
    await expect(
      parser.parseCommand(">>analyze ? 'has tests' : >>summarize", prompts)
    ).rejects.toThrow(/Operator "\?" is reserved and not implemented/);
  });

  // The exclusions below come from the tokenizer, which this rejection deliberately reuses
  // rather than re-matching the registry patterns. Each one is a case where the symbol is
  // present but is NOT the operator.
  test('allows + inside a quoted argument', async () => {
    const result = await parser.parseCommand('>>analyze content:"R3F + Visx"', prompts);
    expect(result.promptId).toBe('analyze');
  });

  // Was "allows + when a chain takes precedence" — inverted deliberately (plan row 0.5.15).
  // Chain precedence exists so a `+` in a chain is not mis-read as a parallel STEP, which only
  // matters for an operator something can execute. `+` is reserved, so the token had no consumer
  // and suppressing it only meant the reserved check never saw it: the command ran as a 2-step
  // chain with the `+` swallowed into argument text, while the standalone form errored and `?`
  // was rejected in the same position. Silently dropping a documented-but-unimplemented symbol is
  // the failure class this tier exists to close.
  test('rejects + even when a chain is present', async () => {
    await expect(
      parser.parseCommand('>>analyze --> >>summarize + >>analyze', prompts)
    ).rejects.toThrow(/Operator "\+" is reserved/);
  });

  test('allows a bare ? as natural language', async () => {
    const result = await parser.parseCommand('>>analyze is there a bug?', prompts);
    expect(result.promptId).toBe('analyze');
  });
});
