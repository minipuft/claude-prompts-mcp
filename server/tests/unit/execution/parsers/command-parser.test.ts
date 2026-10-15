import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { ArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

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

  // 'xyzzy123' above is a SINGLE token, so it never reaches the word-overlap
  // term and passed vacuously. Multi-token nonsense is where the term bites:
  // before the minOverlapWordLength floor, 'co' matched 'code' and every
  // query scored at least once.
  test('short words in multi-token nonsense do not score overlap', async () => {
    await expect(parser.parseCommand('zz_co_qq', fuzzyPrompts)).rejects.not.toThrow(/Did you mean/);
  });

  test('words at the floor still score overlap', async () => {
    // 'cod' is exactly minOverlapWordLength (3) and is a substring of 'code',
    // so it must still reach code_review. This pins the floor at 3, not higher.
    await expect(parser.parseCommand('zzz_cod_qqq', fuzzyPrompts)).rejects.toThrow(
      /Did you mean.*code_review/
    );
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

/**
 * P6.196 / R96. MEASURED 2026-09-27 on `9e05bce6` through `parseCommand`: `>>analyze :: "it's
 * fine"` parsed as the criterion `it`, with ` s fine"` left in the args, and no signal. The gate
 * grammar delimits a criterion or a verify command with either quote and has no escape, so a quote
 * inside the text is refused by name at parse, the way a reserved operator is.
 */
describe('P6.196: a quote inside a gate criterion or verify command is refused by name', () => {
  const parser = new UnifiedCommandParser(mockLogger);

  test('(a) a criterion holding an apostrophe is refused, naming the operator and the quote', async () => {
    await expect(parser.parseCommand(`>>analyze :: "it's fine"`, basePrompts)).rejects.toThrow(
      /Operator "::" cannot take a criterion containing the quote character '/
    );
  });

  test('(a) a possessive apostrophe before a space is refused too', async () => {
    // Nothing is glued to the closing quote here; only its differing from the opening one shows it.
    await expect(
      parser.parseCommand(`>>analyze :: "check the users' data"`, basePrompts)
    ).rejects.toThrow(/Operator "::" cannot take a criterion containing the quote character '/);
  });

  test('(a) a named criterion closed by its own quote character mid-text is refused', async () => {
    await expect(
      parser.parseCommand(`>>analyze :: tone:"say "hi" first"`, basePrompts)
    ).rejects.toThrow(/Operator "::" cannot take a criterion containing the quote character "/);
  });

  test('(b) a verify command holding a double quote is refused', async () => {
    await expect(
      parser.parseCommand(`>>analyze :: verify:'grep "x" out.txt'`, basePrompts)
    ).rejects.toThrow(
      /Operator "::" cannot take a verify command containing the quote character "/
    );
  });

  test('(c) control: a plain criterion and a plain verify command parse as before', async () => {
    const plain = await parser.parseCommand('>>analyze :: "plain"', basePrompts);
    expect(plain.promptId).toBe('analyze');
    expect(JSON.stringify(plain.operators)).toContain('"parsedCriteria":["plain"]');
    const verify = await parser.parseCommand('>>analyze :: verify:"npm test" :fast', basePrompts);
    expect(JSON.stringify(verify.operators)).toContain('"command":"npm test"');
    const single = await parser.parseCommand(">>analyze :: 'single quoted'", basePrompts);
    expect(JSON.stringify(single.operators)).toContain('"parsedCriteria":["single quoted"]');
  });
});

/**
 * P6.206 / R106. MEASURED 2026-09-27 on `a8e012c5` through `parseCommand`: the P6.196 quote check
 * read the JSON form's JSON text, where every quote is escaped, so `{"command": ">>analyze ::
 * \"it's fine\""}` was refused naming `"`, not `'`, and so was every JSON-form criterion,
 * even `:: plain` (the closing JSON quote read as glued to it). The reserved-operator check read
 * the JSON text's tokens, which the tokenizer never scans, so `{"command": ">>analyze + >>analyze"}`
 * parsed with the `+` silently dropped. Both refusals now read the decoded inner command.
 */
describe('P6.206: the JSON command form is parsed through the same refusals', () => {
  const parser = new UnifiedCommandParser(mockLogger);
  const json = (command: string) => JSON.stringify({ command });

  test('(a) a JSON-form criterion holding an apostrophe is refused, naming :: and the quote', async () => {
    await expect(
      parser.parseCommand(json(`>>analyze :: "it's fine"`), basePrompts)
    ).rejects.toThrow(/Operator "::" cannot take a criterion containing the quote character '\./);
    // Double-encoded: the inner JSON object is decoded before the check too.
    await expect(
      parser.parseCommand(json(json(`>>analyze :: "it's fine"`)), basePrompts)
    ).rejects.toThrow(/Operator "::" cannot take a criterion containing the quote character '\./);
  });

  test('(a) a reserved operator in the JSON form is refused', async () => {
    await expect(parser.parseCommand(json('>>analyze + >>summarize'), basePrompts)).rejects.toThrow(
      /Operator "\+" is reserved/
    );
  });

  test('(b) control: the JSON form with a plain criterion parses', async () => {
    for (const criterion of ['"plain"', "'plain'", 'plain']) {
      const result = await parser.parseCommand(json(`>>analyze :: ${criterion}`), basePrompts);
      expect({ criterion, promptId: result.promptId, format: result.format }).toEqual({
        criterion,
        promptId: 'analyze',
        format: 'json',
      });
    }
  });
});

/**
 * P6.218 / R112. MEASURED 2026-09-28 on `1f54e885` through `parseCommand`: the JSON form parsed
 * its inner command with the symbolic strategy and returned `operators` and `executionPlan`
 * undefined for `:: "X-218"`, `@ReACT` and an arrow-chain. It now carries the inner parse's
 * operators and plan whole, so stage 04 builds the same command from either spelling.
 */
describe('P6.218: the JSON command form carries its inner command operators', () => {
  const parser = new UnifiedCommandParser(mockLogger, (id) => id.toLowerCase() === 'react');
  const json = (command: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ command, ...extra });

  test('(a)(b) operators and plan equal the symbolic form, for a criterion, a framework and a chain', async () => {
    for (const inner of ['>>analyze :: "X-218"', '@ReACT >>analyze', '>>analyze --> >>summarize']) {
      const symbolic = await parser.parseCommand(inner, basePrompts);
      const wrapped = await parser.parseCommand(json(inner), basePrompts);
      expect(symbolic.operators?.hasOperators).toBe(true);
      expect({ inner, operators: wrapped.operators, plan: wrapped.executionPlan }).toEqual({
        inner,
        operators: symbolic.operators,
        plan: symbolic.executionPlan,
      });
      expect(wrapped.format).toBe('json');
    }
  });

  test('(a) outer args fill the first step of the carried plan', async () => {
    const wrapped = await parser.parseCommand(
      json('>>analyze :: "X-218"', { args: { input: 'I-218' } }),
      basePrompts
    );
    expect(wrapped.executionPlan?.steps[0]?.args).toBe('{"input":"I-218"}');
    expect(wrapped.rawArgs).toBe('{"input":"I-218"}');
  });

  /**
   * P6.227 / R112 amended: a multi-step plan's outer `args` fill the FIRST step only, the rule
   * `docs/reference/mcp-tools.md` §JSON command form states.
   */
  test('P6.227 outer args reach step 1 only; step 2 keeps its own args', async () => {
    const inner = '>>analyze --> >>summarize input="S2-227"';
    const symbolic = await parser.parseCommand(inner, basePrompts);
    const wrapped = await parser.parseCommand(
      json(inner, { args: { input: 'I-227' } }),
      basePrompts
    );
    const steps = wrapped.executionPlan?.steps ?? [];
    expect(steps).toHaveLength(2);
    expect(steps[0]?.args).toBe('{"input":"I-227"}');
    // Control: step 2's own args are the symbolic parse's, untouched by the outer args.
    expect(symbolic.executionPlan?.steps[1]?.args).toContain('S2-227');
    expect(steps[1]?.args).toBe(symbolic.executionPlan?.steps[1]?.args);
  });

  test('(c) control: a JSON form with no operator carries no plan', async () => {
    const wrapped = await parser.parseCommand(json('>>analyze'), basePrompts);
    expect(wrapped.operators).toBeUndefined();
    expect(wrapped.executionPlan).toBeUndefined();
  });
});

/**
 * MEASURED 2026-10-12 on `ca0df3bf` through the built server: `>>minimal_prompt :: ""` rendered
 * the prompt with no gate and no warning. The gate grammar's quoted text is `[^"']+`, so an empty
 * quoted criterion matched no gate token and was left in the args. It is refused at parse, before
 * any strategy runs, with stage 05's `gate-criteria-invalid` reason text and accepted forms.
 */
describe('an empty quoted inline gate criterion is refused at parse', () => {
  const parser = new UnifiedCommandParser(mockLogger);
  const refusal =
    /^\[gate-criteria-invalid\] inline gate has the criterion "", which is empty\..*Accepted forms: `:: "criterion"`, `:: id:"criterion"`, `:: verify:"command"`\.$/;

  test.each([
    ['double-quoted', '>>analyze :: ""'],
    ['single-quoted', ">>analyze :: ''"],
    ['before a chain arrow', '>>analyze :: "" --> >>analyze'],
    ['after a criterion', '>>analyze :: "plain" :: ""'],
  ])('%s', async (_, command) => {
    await expect(parser.parseCommand(command, basePrompts)).rejects.toThrow(refusal);
  });

  test('a named gate with empty quotes is refused naming the gate', async () => {
    await expect(parser.parseCommand('>>analyze :: security:""', basePrompts)).rejects.toThrow(
      /^\[gate-criteria-invalid\] named inline gate "security" carries no criterion: the text between its quotes is blank\./
    );
  });

  test('the JSON command form is refused the same way', async () => {
    await expect(
      parser.parseCommand(JSON.stringify({ command: '>>analyze :: ""' }), basePrompts)
    ).rejects.toThrow(refusal);
  });

  test('control: empty quotes inside an argument value, or as an argument, are not a gate', async () => {
    const inArg = await parser.parseCommand('>>analyze text:"a :: \'\' b"', basePrompts);
    expect(inArg.promptId).toBe('analyze');
    const asArg = await parser.parseCommand('>>analyze text:""', basePrompts);
    expect(asArg.promptId).toBe('analyze');
  });
});

describe('whole registered prompt selectors', () => {
  const ids = [
    'implementation_plan',
    'implementation_plan/plan_table',
    'implementation_plan/plan_table/detail',
    'Legacy-Root',
    'Legacy_Root',
    '9start/Leaf-2',
  ];
  const prompts: ConvertedPrompt[] = ids.map((id) => ({
    id,
    name: id,
    description: id,
    category: 'planning',
    arguments: [],
    userMessageTemplate: '{{input}}',
  }));
  let parser: UnifiedCommandParser;
  beforeEach(() => {
    parser = new UnifiedCommandParser(mockLogger);
  });

  test.each(ids)('literal selects exact registered ID %s', async (id) => {
    for (const marker of ['', '>>', '/']) {
      const result = await parser.parseCommand(`${marker}${id} input:"a/b"`, prompts);
      expect(result.promptId).toBe(id);
      expect(result.rawArgs).toBe('input:"a/b"');
    }
  });

  test.each(ids)('JSON selects exact registered ID %s', async (id) => {
    for (const key of ['command', 'prompt']) {
      const result = await parser.parseCommand(
        JSON.stringify({ [key]: `>>${id}`, args: { input: 'https://example.test/a/b?x=1' } }),
        prompts
      );
      expect(result.promptId).toBe(id);
      expect(result.rawArgs).toBe(JSON.stringify({ input: 'https://example.test/a/b?x=1' }));
    }
  });

  test('typed spelling resolves full reference through existing lookup', async () => {
    expect((await parser.parseCommand('>>IMPLEMENTATION-PLAN/PLAN-TABLE', prompts)).promptId).toBe(
      'implementation_plan/plan_table'
    );
  });

  test.each(['-->', '==>'])(
    'qualified chain with %s preserves steps and node bindings',
    async (arrow) => {
      const command = `>>implementation_plan/plan_table input:"a/b"${arrow}>>implementation_plan/plan_table/detail`;
      for (const wrapped of [command, JSON.stringify({ command })]) {
        const result = await parser.parseCommand(wrapped, prompts);
        expect(result.promptId).toBe('implementation_plan/plan_table');
        expect(result.executionPlan?.steps.map((step) => step.promptId)).toEqual(ids.slice(1, 3));
        expect(result.executionPlan?.steps.map((step) => step.nodeId)).toEqual(['n1', 'n2']);
        expect(result.executionPlan?.steps.map((step) => step.delegated === true)).toEqual([
          false,
          arrow === '==>',
        ]);
        expect(result.executionPlan?.steps[0]?.args).toBe('input:"a/b"');
      }
    }
  );

  test('qualified repetition preserves every full selector', async () => {
    const result = await parser.parseCommand(
      '>>implementation_plan/plan_table input:"a/b" *2',
      prompts
    );
    expect(result.executionPlan?.steps.map((step) => step.promptId)).toEqual([
      'implementation_plan/plan_table',
      'implementation_plan/plan_table',
    ]);
    expect(result.executionPlan?.steps.map((step) => step.args)).toEqual([
      'input:"a/b"',
      'input:"a/b"',
    ]);
  });

  test.each(['implementation_plan/missing_child', 'implementation_plan/plan_table/missing'])(
    'unknown full child diagnostic %s',
    async (id) => {
      for (const command of [`>>${id}`, `/${id}`, JSON.stringify({ command: `>>${id}` })]) {
        await expect(parser.parseCommand(command, prompts)).rejects.toThrow(
          `Unknown prompt "${id}"`
        );
      }
    }
  );

  test.each([
    'implementation_plan/',
    'implementation_plan//plan_table',
    'implementation_plan/../plan_table',
    'implementation_plan/plan.table',
    'implementation_plan/plan_table%clean',
    'implementation_plan/plan_table@ReACT',
    'implementation_plan/plan_table:arg',
    'implementation_plan/plan_table\\bad',
    'implementation_plan/plan_tableé',
  ])('malformed whole selector refuses %s', async (id) => {
    for (const command of [
      `>>${id}`,
      JSON.stringify({ command: `>>${id}` }),
      `>>implementation_plan --> ${id}`,
    ]) {
      await expect(parser.parseCommand(command, prompts)).rejects.toThrow();
    }
  });

  test.each([' + implementation_plan', " ? 'ready' : implementation_plan"])(
    'qualified reserved operator stays refused %s',
    async (tail) => {
      for (const command of [
        `>>implementation_plan/plan_table${tail}`,
        JSON.stringify({ command: `>>implementation_plan/plan_table${tail}` }),
      ]) {
        await expect(parser.parseCommand(command, prompts)).rejects.toThrow(/reserved/);
      }
    }
  );

  test.each(['clean', 'judge', 'lean', 'framework'])(
    'prefix modifier %s has independent effects',
    async (modifier) => {
      for (const command of [
        `%${modifier} >>implementation_plan/plan_table`,
        JSON.stringify({ command: `%${modifier} >>implementation_plan/plan_table` }),
      ]) {
        const result = await parser.parseCommand(command, prompts);
        expect(result.promptId).toBe('implementation_plan/plan_table');
        expect(result.modifiers).toEqual({
          clean: modifier === 'clean',
          judge: modifier === 'judge',
          lean: modifier === 'lean',
          framework: modifier === 'framework',
        });
        expect(result.metadata?.modifierToken).toBe(modifier);
      }
    }
  );

  test('postfix modifier bytes remain arguments without effects', async () => {
    const tail = 'input:"/tmp/a/b" %clean';
    for (const command of [
      `>>implementation_plan/plan_table ${tail}`,
      JSON.stringify({ command: `>>implementation_plan/plan_table ${tail}` }),
    ]) {
      const result = await parser.parseCommand(command, prompts);
      expect(result.promptId).toBe('implementation_plan/plan_table');
      expect(result.rawArgs).toBe(tail);
      expect(result.modifiers).toBeUndefined();
      expect(result.metadata?.modifierToken).toBeUndefined();
    }
    await expect(
      parser.parseCommand('%clean %judge >>implementation_plan/plan_table', prompts)
    ).rejects.toThrow(/Only one/);
  });

  test.each(["'", '"'])(
    'quoted URL/path/operator bytes stay exact in literal args %s',
    async (quote) => {
      const tail = `input:${quote}https://example.test/a/b?x=1 /tmp/a/b : --> ==> + ? # @ :: %clean *2${quote}`;
      const result = await parser.parseCommand(`>>implementation_plan/plan_table ${tail}`, prompts);
      expect(result.promptId).toBe('implementation_plan/plan_table');
      expect(result.rawArgs).toBe(tail);
      expect(result.operators?.hasOperators ?? false).toBe(false);
    }
  );

  test.each(["'", '"'])(
    'shared prefix normalization keeps quoted marker bytes %s',
    async (quote) => {
      const tail = `input:${quote}/tmp/a/b --> >>implementation_plan${quote}`;
      const result = await parser.parseCommand(`>>implementation_plan/plan_table ${tail}`, prompts);
      expect(result.rawArgs).toBe(tail);
    }
  );
});

describe('F23.1 composed command processed arguments', () => {
  const input = 'keep / path --> ==> + ? %clean exactly';
  const prompts: ConvertedPrompt[] = ['wire_namespace', 'wire_namespace/child/deep'].map((id) => ({
    id,
    name: id,
    description: '',
    category: 'tests',
    userMessageTemplate: '{{input}}',
    arguments: [{ name: 'input', type: 'string', required: false }],
  }));
  const rootPrompt = prompts[0];
  if (rootPrompt === undefined) throw new Error('Root fixture is required');
  let commandParser: UnifiedCommandParser;
  let argumentParser: ArgumentParser;
  beforeEach(() => {
    commandParser = new UnifiedCommandParser(mockLogger);
    argumentParser = new ArgumentParser(mockLogger);
  });

  test('F23.1 documented root JSON command reaches exact processed arguments', async () => {
    const parsed = await commandParser.parseCommand(
      JSON.stringify({
        command: '>>wire_namespace',
        args: { input },
      }),
      prompts
    );
    const result = await argumentParser.parseArguments(parsed.rawArgs, rootPrompt, {});
    expect(parsed.promptId).toBe('wire_namespace');
    expect(result.metadata.parsingStrategy).toBe('json');
    expect(result.processedArgs['input']).toBe(input);
  });

  test('F23.1 deep JSON selector preserves exact registered identity and processed value', async () => {
    const deepPrompt = prompts[1];
    if (deepPrompt === undefined) throw new Error('Deep fixture is required');
    for (const key of ['command', 'prompt']) {
      const parsed = await commandParser.parseCommand(
        JSON.stringify({
          [key]: '>>wire_namespace/child/deep',
          args: { input },
        }),
        prompts
      );
      const result = await argumentParser.parseArguments(parsed.rawArgs, deepPrompt, {});
      expect(parsed.promptId).toBe('wire_namespace/child/deep');
      expect(result.processedArgs['input']).toBe(input);
    }
  });

  test('F23.1 valid symbolic arrows modifiers and first-step JSON preserve processed data', async () => {
    for (const arrow of ['-->', '==>']) {
      const parsed = await commandParser.parseCommand(
        JSON.stringify({
          command: `%clean >>wire_namespace ${arrow} >>wire_namespace/child/deep input="second > stay"`,
          args: { input },
        }),
        prompts
      );
      const steps = parsed.executionPlan?.steps;
      if (steps === undefined || steps[0] === undefined || steps[1] === undefined) {
        throw new Error('Both real parsed steps are required');
      }
      expect(steps.map((step) => step.promptId)).toEqual([
        'wire_namespace',
        'wire_namespace/child/deep',
      ]);
      expect(steps[1].delegated === true).toBe(arrow === '==>');
      expect(parsed.modifiers).toEqual({
        clean: true,
        judge: false,
        lean: false,
        framework: false,
      });
      if (steps[0].args === undefined || steps[1].args === undefined) {
        throw new Error('Both parsed argument payloads are required');
      }
      const first = await argumentParser.parseArguments(steps[0].args, rootPrompt, {});
      const second = await argumentParser.parseArguments(steps[1].args, rootPrompt, {});
      expect(first.metadata.parsingStrategy).toBe('json');
      expect(first.processedArgs['input']).toBe(input);
      expect(second.processedArgs['input']).toBe('second > stay');
    }
  });

  test('F23.1 malformed outside grammar remains refused separately from valid data', async () => {
    for (const command of [
      '>>wire_namespace + >>wire_namespace/child/deep',
      ">>wire_namespace ? 'ready' : >>wire_namespace/child/deep",
    ]) {
      await expect(
        commandParser.parseCommand(JSON.stringify({ command, args: { input } }), prompts)
      ).rejects.toThrow(/reserved/);
    }
    await expect(
      commandParser.parseCommand('%clean %judge >>wire_namespace', prompts)
    ).rejects.toThrow(/Only one/);
    await expect(commandParser.parseCommand('>>wire_namespace//child', prompts)).rejects.toThrow();
  });
});
