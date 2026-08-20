import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

/**
 * Tier D.1/D.2 — empty symbolic args must resolve through ArgumentParser.
 *
 * `>>reference_demo` rendered `text=""` while `>>reference_demo :: code-quality` failed its
 * script tool with "Missing required field: text". A gate token is the only difference, and a
 * gate-token-only command produces EMPTY args — the one case the symbolic path answered from
 * `collectArgumentDefaults()`, which reads author-declared `defaultValue` and nothing else.
 * The direct command path answers the same question with ArgumentParser, whose fallback
 * strategy resolves every declared argument down to `{value:'', source:'empty_fallback'}`.
 *
 * The bug therefore bit prompts declaring NO defaults at all, which is why the originally filed
 * mechanism ("skips prompt argument defaults") was misleading: `reference_demo` declares none.
 *
 * The real ArgumentParser is used deliberately — a mocked one cannot exercise the fallback
 * strategy, which is the behaviour under test.
 */
describe('Tier D — empty symbolic args resolve through ArgumentParser', () => {
  let builder: SymbolicCommandBuilder;
  let logger: Logger;

  const promptOf = (args: Array<Record<string, unknown>>): ConvertedPrompt =>
    ({
      id: 'demo',
      name: 'Demo',
      category: 'test',
      description: 'fixture',
      userMessageTemplate: '{{text}}',
      arguments: args,
    }) as unknown as ConvertedPrompt;

  /** Mirrors reference_demo: required arg, optional arg, NO defaultValue on either. */
  const noDefaultsPrompt = () =>
    promptOf([
      { name: 'text', description: 'required, undefaulted', required: true, type: 'string' },
      { name: 'topic', description: 'optional, undefaulted', required: false, type: 'string' },
    ]);

  const resolve = (prompt: ConvertedPrompt, args?: string, fallbackArgs?: Record<string, any>) =>
    (
      builder as unknown as {
        resolveArgumentPayload: (
          p: ConvertedPrompt,
          a?: string,
          seed?: string[],
          f?: Record<string, any>
        ) => Promise<{ processedArgs: Record<string, unknown> }>;
      }
    ).resolveArgumentPayload(prompt, args, [], fallbackArgs);

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    builder = new SymbolicCommandBuilder(createArgumentParser(logger), logger);
    jest.clearAllMocks();
  });

  test('empty args give every declared argument a value, even with no defaultValue', async () => {
    const result = await resolve(noDefaultsPrompt(), '');

    // The defect: `text` was absent entirely, so the downstream script tool reported
    // "Missing required field: text". Presence is the assertion that fails on regression.
    expect(result.processedArgs).toHaveProperty('text');
    expect(result.processedArgs).toHaveProperty('topic');
    expect(result.processedArgs.text).toBe('');
    expect(result.processedArgs.topic).toBe('');
  });

  test('undefined args behave identically to empty-string args', async () => {
    // A gate-token-only command can produce either, depending on the stripping path.
    const fromUndefined = await resolve(noDefaultsPrompt(), undefined);
    const fromEmpty = await resolve(noDefaultsPrompt(), '');

    expect(fromUndefined.processedArgs).toEqual(fromEmpty.processedArgs);
    expect(fromUndefined.processedArgs.text).toBe('');
  });

  test('author-declared defaultValue still wins over the empty fallback', async () => {
    // Discriminating: proves the fix ADDED a tier rather than replacing the author's value
    // with '' across the board.
    const prompt = promptOf([
      { name: 'text', required: true, type: 'string', defaultValue: 'authored' },
      { name: 'topic', required: false, type: 'string' },
    ]);

    const result = await resolve(prompt, '');

    expect(result.processedArgs.text).toBe('authored');
    expect(result.processedArgs.topic).toBe('');
  });

  test('explicit fallbackArgs still override both tiers', async () => {
    const result = await resolve(noDefaultsPrompt(), '', { text: 'from-caller' });

    expect(result.processedArgs.text).toBe('from-caller');
    expect(result.processedArgs.topic).toBe('');
  });

  test('non-empty args are unaffected — user values survive alongside filled defaults', async () => {
    const result = await resolve(noDefaultsPrompt(), 'text:"hello world"');

    expect(result.processedArgs.text).toBe('hello world');
    expect(result.processedArgs).toHaveProperty('topic');
  });
});
