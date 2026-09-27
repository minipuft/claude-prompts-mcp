import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import {
  ArgumentParser,
  createArgumentParser,
} from '../../../../src/engine/execution/parsers/argument-parser.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { retargetGates } from '../../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/context-types.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;
const prompts = [
  {
    id: 'sv_a',
    name: 'sv_a',
    description: 'd',
    category: 'c',
    userMessageTemplate: '{{topic}}',
    arguments: [{ name: 'topic', type: 'string', required: false }],
  },
] as unknown as ConvertedPrompt[];

const stage = new CommandParsingStage(
  new UnifiedCommandParser(logger),
  new ArgumentParser(logger),
  () => prompts,
  logger,
  new SymbolicCommandBuilder(createArgumentParser(logger), logger, {
    validate: validateWorkflowIR,
    compile: compileWorkflowIR,
    retargetGates,
  })
);

async function parse(command: string): Promise<ParsedCommand> {
  const context = new ExecutionContext({ command });
  await stage.execute(context);
  if (context.parsedCommand === undefined) throw new Error(`no parse for ${command}`);
  return context.parsedCommand;
}

/** The `Re-run:` invocation the assembler renders for a parsed single-prompt command. */
function rerunOf(parsedCommand: ParsedCommand): string {
  const context = new ExecutionContext({ command: 'unused' });
  context.parsedCommand = parsedCommand;
  const assembler = new ResponseAssembler() as unknown as {
    buildInvocationString: (c: ExecutionContext, p?: ConvertedPrompt, ops?: boolean) => string;
  };
  return assembler.buildInvocationString(context, parsedCommand.convertedPrompt, true);
}

/** What a command asks the run to be: the prompt, its args, and every gate it declares. */
const meaning = (parsed: ParsedCommand) => ({
  promptId: parsed.convertedPrompt?.id,
  args: parsed.promptArgs,
  criteria: parsed.inlineGateCriteria,
  // A verify gate's id is minted from the clock, so its identity is its shell check.
  named: parsed.namedInlineGates?.map((gate) =>
    gate.shellVerify !== undefined
      ? { verify: gate.shellVerify }
      : { id: gate.gateId, criteria: gate.criteria }
  ),
  framework: parsed.executionPlan?.frameworkOverride,
  style: parsed.styleSelection,
  modifiers: parsed.modifiers,
});

/**
 * P6.178 / R89: a `Re-run:` line is a command that re-parses to the same run. MEASURED 2026-09-27
 * on `97c33a89`: the single-quoted criterion (`>>sv_a topic:"" :: 'CRIT-ONE'`) already round-trips
 * — the gate grammar admits neither quote inside a criterion, so either delimiter is exact. What
 * did not: an argument holding a quote or a backslash (`topic:"say "hi""` re-parsed to `say`),
 * and a `:: verify:"…"` gate, rendered as `:: shell-verify-<ms>:"Shell verification: …"` — an
 * LLM-judged gate with no shell check, its preset, loop, max and timeout gone.
 */
describe('P6.178: the Re-run line re-parses to the command that produced it', () => {
  test('twin: the gated single prompt re-runs as itself', async () => {
    const first = await parse('>>sv_a :: "CRIT-ONE"');
    const rerun = rerunOf(first);
    expect(rerun).toBe(`>>sv_a topic:"" :: 'CRIT-ONE'`);
    expect(meaning(await parse(rerun))).toEqual(meaning(first));
  });

  test.each([
    `>>sv_a topic:'say "hi"'`,
    String.raw`>>sv_a topic:"a\\b"`,
    '>>sv_a :: code-quality',
    '>>sv_a :: q:"be good"',
    '>>sv_a :: verify:"npm test"',
    '>>sv_a :: verify:"npm test" :fast loop:true max:3 timeout:20',
    '@ReACT >>sv_a',
    '%clean >>sv_a',
    '#concise >>sv_a',
  ])('twin: %s round-trips', async (command) => {
    const first = await parse(command);
    expect(meaning(await parse(rerunOf(first)))).toEqual(meaning(first));
  });

  test('control: a command with no criterion renders as before', async () => {
    expect(rerunOf(await parse('>>sv_a topic:"x"'))).toBe('>>sv_a topic:"x"');
  });
});
