import { describe, expect, jest, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import {
  ArgumentParser,
  createArgumentParser,
} from '../../../../src/engine/execution/parsers/argument-parser.js';
import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { retargetGates } from '../../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

/**
 * The `<CALL-TOOL>` directive `hooks/prompt-suggest.py` writes carries the whole user message as
 * `command`. It used to repeat the message's `key:"value"` pairs in `options` as well. The server
 * reads those pairs from `command` itself and an inline value beats `options`, so the repeat can
 * only change the parsed arguments by ADDING a key the command text does not name as a prompt
 * argument. Each row is a message shape the hook handles, with the `options` value the hook's
 * `parse_inline_args` produced for it, and asserts what the server parses with and without it.
 */
const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const prompt = (id: string, argumentNames: string[], extra: object = {}): ConvertedPrompt =>
  ({
    id,
    name: id,
    description: 'd',
    category: 'c',
    userMessageTemplate: argumentNames.map((name) => `{{${name}}}`).join(' '),
    arguments: argumentNames.map((name) => ({ name, type: 'string', required: false })),
    ...extra,
  }) as unknown as ConvertedPrompt;

const prompts = [
  prompt('demo_a', ['topic', 'tone', 'url', 'note']),
  prompt('demo_b', ['depth', 'tone']),
  prompt('demo_chain', ['topic'], {
    chainSteps: [
      { promptId: 'demo_a', stepName: 'A' },
      { promptId: 'demo_b', stepName: 'B' },
    ],
  }),
];

const argumentParser = new ArgumentParser(logger);
const stage = new CommandParsingStage(
  new UnifiedCommandParser(logger),
  argumentParser,
  () => prompts,
  logger,
  new SymbolicCommandBuilder(createArgumentParser(logger), logger, {
    validate: validateWorkflowIR,
    compile: compileWorkflowIR,
    retargetGates,
  })
);

/** Every prompt argument the server resolved for the command: the first segment and each step. */
async function parsedArguments(
  command: string,
  options?: Record<string, string>
): Promise<unknown> {
  const context = new PromptRequestContext({ command, ...(options && { options }) } as never);
  if (options) context.state.normalization.requestOptions = options;
  await stage.execute(context);
  const parsed = context.parsedCommand;
  if (parsed === undefined) throw new Error(`no parsed command for ${command}`);
  return {
    promptArgs: parsed.promptArgs,
    steps: parsed.steps?.map((step) => [step.promptId, step.args]),
  };
}

interface ParsedArgs {
  promptArgs: Record<string, unknown>;
  steps: Array<[string, Record<string, unknown>]>;
}

interface HookShape {
  readonly name: string;
  readonly command: string;
  /** What `parse_inline_args(command)` returned, run against the hook of this change's parent. */
  readonly hookOptions: Record<string, string>;
}

const SHAPES: readonly HookShape[] = [
  {
    name: 'a prompt with inline arguments',
    command: '>>demo_a topic:"hello" tone:"dry"',
    hookOptions: { topic: 'hello', tone: 'dry' },
  },
  {
    name: 'a prompt with no arguments',
    command: '>>demo_a',
    hookOptions: {},
  },
  {
    name: 'a quoted value with spaces',
    command: '>>demo_a topic:"hello brave world"',
    hookOptions: { topic: 'hello brave world' },
  },
  {
    name: 'single and double quotes in one message',
    command: `>>demo_a topic:'single quoted value' tone:"dry"`,
    hookOptions: { topic: 'single quoted value', tone: 'dry' },
  },
  {
    name: 'values containing colons',
    command: '>>demo_a url:"http://example.com:8080/a?b=c:d" topic:"at 10:30"',
    hookOptions: { url: 'http://example.com:8080/a?b=c:d', topic: 'at 10:30' },
  },
  {
    name: 'a value holding a nested quoted pair',
    command: `>>demo_a note:"see key:'v' here"`,
    hookOptions: { note: 'see key:' },
  },
  {
    name: 'a prompt-defined chain',
    command: '>>demo_chain topic:"x"',
    hookOptions: { topic: 'x' },
  },
  {
    name: 'an inline gate criterion',
    command: '>>demo_a topic:"x" :: "answer is concise"',
    hookOptions: { topic: 'x' },
  },
];

const CHAIN: HookShape = {
  name: 'an ad-hoc chain naming arguments in each segment',
  command: '>>demo_a topic:"x" --> >>demo_b depth:"2" tone:"calm"',
  hookOptions: { topic: 'x', depth: '2', tone: 'calm' },
};

const VERIFY: HookShape = {
  name: 'an inline verify gate',
  command: '>>demo_a topic:"x" :: verify:"npm test"',
  hookOptions: { topic: 'x', verify: 'npm test' },
};

describe('prompt-suggest directive: dropping `options` keeps the parsed arguments', () => {
  test.each(SHAPES)('$name parses the same without the options clause', async (shape) => {
    const withOptions = await parsedArguments(shape.command, shape.hookOptions);
    const withoutOptions = await parsedArguments(shape.command);
    expect(withoutOptions).toEqual(withOptions);
  });

  test('an ad-hoc chain loses no value: step two keeps its own, step one stops receiving them', async () => {
    const withOptions = (await parsedArguments(CHAIN.command, CHAIN.hookOptions)) as ParsedArgs;
    const withoutOptions = (await parsedArguments(CHAIN.command)) as ParsedArgs;

    // Step two resolves from its own segment in both calls.
    expect(withoutOptions.steps[1]).toEqual(withOptions.steps[1]);
    expect(withoutOptions.steps[1][1]).toMatchObject({ depth: '2', tone: 'calm' });
    // The values `options` added to step one are the ones the later segment names for step two.
    expect(withOptions.steps[0][1]).toMatchObject({ depth: '2', tone: 'calm' });
    expect(withoutOptions.steps[0][1]).toMatchObject({ topic: 'x', tone: '' });
    expect(withoutOptions.steps[0][1]).not.toHaveProperty('depth');
  });

  test('an inline verify gate no longer reaches the prompt as an argument named verify', async () => {
    const withOptions = (await parsedArguments(VERIFY.command, VERIFY.hookOptions)) as ParsedArgs;
    const withoutOptions = (await parsedArguments(VERIFY.command)) as ParsedArgs;

    expect(withoutOptions.promptArgs).toEqual({ topic: 'x', tone: '', url: '', note: '' });
    expect(withOptions.promptArgs).toHaveProperty('verify', 'npm test');
  });

  test('positive control: an options key the command does not name does change the parse', async () => {
    const without = await parsedArguments('>>demo_a topic:"x"');
    const withExtra = await parsedArguments('>>demo_a topic:"x"', { tone: 'from-options' });
    expect(withExtra).not.toEqual(without);
  });
});
