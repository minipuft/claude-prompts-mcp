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
  {
    id: 'sv_pair',
    name: 'sv_pair',
    description: 'd',
    category: 'c',
    userMessageTemplate: 'CHAIN',
    arguments: [{ name: 'topic', type: 'string', required: false }],
    chainSteps: [
      { promptId: 'sv_a', stepName: 'A' },
      { promptId: 'sv_a', stepName: 'B' },
    ],
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
  const prompt = parsedCommand.convertedPrompt;
  if (prompt === undefined) throw new Error('a single-prompt command resolves its prompt');
  const assembler = new ResponseAssembler() as unknown as {
    buildInvocationString: (c: ExecutionContext, p: ConvertedPrompt) => string;
  };
  return assembler.buildInvocationString(context, prompt);
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

/** The reply that completes a run parsed from `parsedCommand`, standing on `currentNodeId`. */
function completionReply(parsedCommand: ParsedCommand, currentNodeId: string | null): string {
  const context = new ExecutionContext({ command: 'unused' });
  context.parsedCommand = parsedCommand;
  context.executionResults = {
    content: 'final output',
    metadata: { promptId: 'investigate_unknown' },
    generatedAt: Date.now(),
  };
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
  };
  context.sessionContext = {
    sessionId: 'session-186',
    chainId: 'chain-186#1',
    isChainExecution: true,
    currentStep: 2,
    totalSteps: 2,
    ...(currentNodeId !== null ? { currentNodeId } : {}),
  };
  context.state.session.chainComplete = true;
  return new ResponseAssembler().formatChainResponse(context, { isChainFormatting: true } as never);
}

const rerunLine = (reply: string): string | undefined => /Re-run: `([^`]*)`/.exec(reply)?.[1];

/**
 * P6.186 / R89. MEASURED 2026-09-27 on `97c33a89` (driven over HTTP): an arrow-chain run completed,
 * with and without an inserted node, and a workflow run printed "Chain execution complete" and no
 * `Re-run:`; `>>sv_pair :: "CRIT-P"` completed with `Re-run: >>sv_pair topic:""` — the criterion
 * dropped, so the line re-ran a different run. A completion without a resolved prompt fell back to
 * the literal `>>prompt` whenever the reply's metadata named one, and one standing on a planned
 * node named that node's prompt (`>>b` for `>>a` arrow-chain `>>b`), which is not the run either.
 *
 * P6.194 / R89 (amended): an arrow-chain run re-runs as its original command text, which re-parses to
 * the same steps, args and operators; a workflow submission has no command text and renders none.
 */
describe('P6.186: a completed run re-runs as the command that started it, or not at all', () => {
  test('twin (a): a chain prompt re-runs with its gate, and the line round-trips', async () => {
    const first = await parse('>>sv_pair :: "CRIT-P"');
    const rerun = rerunLine(completionReply(first, null));
    expect(rerun).toBe(`>>sv_pair topic:"" :: 'CRIT-P'`);
    expect(meaning(await parse(rerun ?? ''))).toEqual(meaning(first));
  });

  test.each([null, 'n1', 'n2', 'inv-u-186'])(
    'P6.194 twin (a): an arrow-chain run standing on %s re-runs as its original command',
    async (currentNodeId) => {
      const command = '>>sv_a topic:"T1" -' + '-> >>sv_pair';
      const first = await parse(command);
      const rerun = rerunLine(completionReply(first, currentNodeId));
      expect(rerun).toBe(command);
      const again = await parse(rerun ?? '');
      expect(again.steps?.map((step) => [step.promptId, step.args])).toEqual(
        first.steps?.map((step) => [step.promptId, step.args])
      );
      expect(again.operators).toEqual(first.operators);
    }
  );

  test('P6.194 twin (b): a workflow run renders no Re-run and never >>prompt', async () => {
    const workflow = await parse('>>sv_a -' + '-> >>sv_pair');
    workflow.metadata = {
      ...workflow.metadata,
      parseStrategy: 'workflow-ir',
      originalCommand: '<workflow-ir>',
    };
    const reply = completionReply(workflow, 'n2');
    expect(reply).toContain('Chain execution complete');
    expect(reply).not.toContain('Re-run:');
    expect(reply).not.toContain('>>prompt');
  });

  test('positive control: a single prompt still renders its Re-run line', async () => {
    const context = new ExecutionContext({ command: 'unused' });
    context.parsedCommand = await parse('>>sv_a topic:"x"');
    context.executionResults = { content: 'out', metadata: {}, generatedAt: Date.now() };
    const reply = new ResponseAssembler().formatSinglePromptResponse(context, {} as never);
    expect(rerunLine(reply)).toBe('>>sv_a topic:"x"');
  });
});
