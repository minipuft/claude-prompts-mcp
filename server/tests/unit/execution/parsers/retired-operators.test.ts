import { describe, expect, jest, test } from '@jest/globals';

import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import * as retirementNotices from '../../../../src/shared/utils/_generated/retirement-notices.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

/**
 * The `@` framework sigil and the `=` gate operator are refused at `parseCommand`, the one entry
 * both transports' `prompt_engine` reaches, before any strategy runs. Every other `@` and `=` is
 * ordinary text: each negative below parses exactly as it would if neither operator had existed.
 * The refusals are driven against the ledger text in `retirement-refusals.test.ts` as well.
 */

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

const prompts = ['analyze', 'summarize', 'mail'].map((id) => ({
  id,
  name: id,
  description: id,
  category: 'general',
  userMessageTemplate: 'body',
  arguments: [],
})) as ConvertedPrompt[];

/** Knows CAGEERF and REACT, as `frameworkManager.has` would for the shipped frameworks. */
const parser = new UnifiedCommandParser(logger, (id) => id === 'CAGEERF' || id === 'REACT');

const AT_SIGIL = retirementNotices.commandFrameworkAtSigil;
const EQUALS_GATE = retirementNotices.commandGateEqualsOperator;

describe('the `@` framework sigil is refused, naming `^`', () => {
  test.each([
    ['@CAGEERF >>analyze', 'CAGEERF', 'at the start'],
    ['@CAGEERF>>analyze', 'CAGEERF', 'unspaced'],
    ['>> @CAGEERF >>analyze', 'CAGEERF', 'after the leading marker, spaced'],
    ['>>@CAGEERF >>analyze', 'CAGEERF', 'right after the leading marker'],
    ['%lean @cageerf >>analyze', 'cageerf', 'after a modifier, as typed'],
    ['>>analyze --> @ReACT >>summarize', 'ReACT', 'on a later chain step'],
    ['>>analyze some text @ReACT', 'ReACT', 'after whitespace in argument text, as `^` is read'],
    ['>>analyze @home @CAGEERF', 'CAGEERF', 'after an @word that names no framework'],
    [JSON.stringify({ command: '@CAGEERF >>analyze' }), 'CAGEERF', 'inside the JSON form'],
  ])('%s (%s)', async (command, id) => {
    await expect(parser.parseCommand(command, prompts)).rejects.toThrow(
      `Refused \`@${id}\`: ${AT_SIGIL.retired} was retired in ${AT_SIGIL.refusedIn}. ` +
        `Use ${AT_SIGIL.replacement}: \`^${id}\`.`
    );
  });

  test('the `^` spelling of the same command applies the framework', async () => {
    const result = await parser.parseCommand('^CAGEERF >>analyze', prompts);

    expect(result.operators?.operators).toContainEqual(
      expect.objectContaining({ type: 'framework', normalizedId: 'CAGEERF' })
    );
  });
});

describe('any other `@` is ordinary text', () => {
  test.each([
    ['>>analyze hello @home', 'analyze', 'hello @home', 'an @word that names no framework'],
    ['mail me @home >>analyze', 'mail', 'me @home >>analyze', 'an @word before a marker'],
    ['>>analyze note:"@CAGEERF"', 'analyze', 'note:"@CAGEERF"', 'a framework id inside quotes'],
    ['>>analyze contact me@cageerf.com', 'analyze', 'contact me@cageerf.com', 'an email address'],
    ['>>analyze see @file.md and @docs/x', 'analyze', 'see @file.md and @docs/x', 'file mentions'],
    ['>>analyze see @CAGEERF.md', 'analyze', 'see @CAGEERF.md', 'a file named like a framework'],
  ])('%s (%s)', async (command, promptId, rawArgs) => {
    const result = await parser.parseCommand(command, prompts);

    expect({ promptId: result.promptId, rawArgs: result.rawArgs }).toEqual({ promptId, rawArgs });
    expect(result.operators?.operators ?? []).toEqual([]);
  });

  test('without a framework lookup no @word is refused', async () => {
    const result = await new UnifiedCommandParser(logger).parseCommand(
      '>>analyze @CAGEERF',
      prompts
    );

    expect(result.rawArgs).toBe('@CAGEERF');
  });
});

describe('the `=` gate operator is refused, naming `::`', () => {
  test.each([
    ['>>analyze = "cite sources"', '= "cite sources"', ':: "cite sources"', 'quoted'],
    [">>analyze = 'cite sources'", "= 'cite sources'", ":: 'cite sources'", 'single-quoted'],
    ['>>analyze =code-quality', '=code-quality', ':: code-quality', 'unquoted'],
    [
      '>>analyze = security:"no secrets"',
      '= security:"no secrets"',
      ':: security:"no secrets"',
      'named',
    ],
    ['>>analyze note = x', '= x', ':: x', 'after argument text'],
    ['>>analyze --> >>summarize = "c"', '= "c"', ':: "c"', 'on a chain step'],
    [JSON.stringify({ command: '>>analyze = "c"' }), '= "c"', ':: "c"', 'inside the JSON form'],
  ])('%s (%s)', async (command, typed, replacement) => {
    await expect(parser.parseCommand(command, prompts)).rejects.toThrow(
      `Refused \`${typed}\`: ${EQUALS_GATE.retired} was retired in ${EQUALS_GATE.refusedIn}. ` +
        `Use ${EQUALS_GATE.replacement}: \`${replacement}\`.`
    );
  });
});

describe('any other `=` is ordinary text', () => {
  test.each([
    ['>>analyze key=value', 'key=value', 'key=value'],
    ['>>analyze a == b', 'a == b', 'equality'],
    ['>>analyze x => y', 'x => y', 'an arrow'],
    ['>>analyze url:"https://h/p?a=b&c=d"', 'url:"https://h/p?a=b&c=d"', 'a query string'],
    ['>>analyze note:"a = b"', 'note:"a = b"', 'quoted text'],
    ['>>analyze note = ""', 'note = ""', 'an empty quoted value'],
  ])('%s (%s)', async (command, rawArgs) => {
    const result = await parser.parseCommand(command, prompts);

    expect({ promptId: result.promptId, rawArgs: result.rawArgs }).toEqual({
      promptId: 'analyze',
      rawArgs,
    });
    expect(result.operators?.operators ?? []).toEqual([]);
  });

  test('`==>` stays a delegation delimiter', async () => {
    const result = await parser.parseCommand('>>analyze ==> >>summarize', prompts);

    expect(result.operators?.operatorTypes).toEqual(['chain']);
  });
});
