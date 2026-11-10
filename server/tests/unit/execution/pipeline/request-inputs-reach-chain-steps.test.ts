// @lifecycle test - typed `inputs` reach argument resolution on symbolic and chain commands.
/**
 * Two sightings, one cause: stage 04 merged request `inputs` into `ParsedCommand.promptArgs`, and
 * a symbolic command's `promptArgs` is not what renders.
 *
 *   - `>>a --> >>b` with `inputs:{feature:"…"}` started the run with every argument empty and no
 *     refusal. `promptArgs` of a chain is a CLONE of step 1's args (`compileWorkflowIR`), so the
 *     merge landed on the clone while the step the run renders (`steps[0].args`) kept the empty
 *     map the command string produced.
 *   - `>>interview :: "criterion"` with `inputs:{trigger:"open-fork"}` and a patterned argument:
 *     the symbolic builder parsed the inline (empty) arguments WITHOUT deferring schema
 *     validation, the pattern refused `''`, and `parseArgumentsSafely` swallowed the refusal into
 *     an empty map — so the defaults the parser would have supplied were lost too.
 *
 * The direct `>>prompt` spelling of the second is pinned in `command-parsing-stage.test.ts`
 * (a4dbed49); it is repeated here as the control that this file's fixtures reach the same answer
 * through the real parser, builder and compiler.
 *
 * Real collaborators throughout: a mocked ArgumentParser cannot show which map a value lands in.
 */
import { describe, expect, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { ArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';
import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { createSimpleLogger } from '../../../../src/infra/logging/index.js';
import { retargetGates } from '../../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

/** Assembled, so no command literal in this file carries the operator as prose. */
const ARROW = ' -' + '-> ';
const PATTERN = '^(open-fork|other)$';

const prompt = (id: string, args: ConvertedPrompt['arguments']): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'test',
  arguments: args,
  userMessageTemplate: `BODY-${id}`,
});

/** The shape of `implementation_plan`: a required argument and an optional one. */
const planner = prompt('ri_planner', [
  { name: 'feature', type: 'string', required: true },
  { name: 'research_focus', type: 'string', required: false },
]);
const consumer = prompt('ri_consumer', [{ name: 'feature', type: 'string', required: false }]);
/** The shape of `interview`: a required argument carrying a `validation.pattern`. */
const patterned = prompt('ri_patterned', [
  { name: 'decision', type: 'string', required: true },
  { name: 'trigger', type: 'string', required: true, validation: { pattern: PATTERN } },
]);
const prompts = [planner, consumer, patterned];

const logger = createSimpleLogger();
const argumentParser = new ArgumentParser(logger);
const irPort = { validate: validateWorkflowIR, compile: compileWorkflowIR, retargetGates };
const stage = new CommandParsingStage(
  new UnifiedCommandParser(logger),
  argumentParser,
  () => prompts,
  logger,
  new SymbolicCommandBuilder(argumentParser, logger, irPort)
);

/** Stage 04 over a command and the request's `inputs`/`options`, as stage 01 hands them over. */
async function parse(
  command: string,
  inputs?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<ParsedCommand> {
  const context = new PromptRequestContext({ command, inputs, options } as never);
  if (inputs !== undefined) context.state.normalization.requestInputs = inputs;
  if (options !== undefined) context.state.normalization.requestOptions = options;
  await stage.execute(context);
  if (context.parsedCommand === undefined) {
    throw new Error(`no parsed command for ${command}`);
  }
  return context.parsedCommand;
}

describe('inputs on a chain command reach the first step', () => {
  test('a required argument supplied only through inputs renders in step 1', async () => {
    const parsed = await parse(`>>ri_planner${ARROW}>>ri_consumer`, {
      feature: 'F-typed',
      research_focus: 'R-typed',
    });

    expect(parsed.steps?.[0]?.args).toMatchObject({
      feature: 'F-typed',
      research_focus: 'R-typed',
    });
    // The run-level map is what the run was invoked WITH: the same values.
    expect(parsed.promptArgs).toMatchObject({ feature: 'F-typed', research_focus: 'R-typed' });
  });

  test('inline beats inputs beats options on the first segment', async () => {
    const parsed = await parse(
      `>>ri_planner feature:"F-inline"${ARROW}>>ri_consumer`,
      { feature: 'F-typed', research_focus: 'R-typed' },
      { feature: 'F-legacy', research_focus: 'R-legacy' }
    );

    expect(parsed.steps?.[0]?.args).toMatchObject({
      feature: 'F-inline',
      research_focus: 'R-typed',
    });
  });

  test('an inline key in a LATER segment does not shadow the first segment', async () => {
    const parsed = await parse(`>>ri_planner${ARROW}>>ri_consumer feature:"F-later"`, {
      feature: 'F-typed',
    });

    expect(parsed.steps?.[0]?.args).toMatchObject({ feature: 'F-typed' });
    expect(parsed.steps?.[1]?.args).toMatchObject({ feature: 'F-later' });
  });

  test('a patterned argument supplied through inputs validates the supplied value', async () => {
    const parsed = await parse(`>>ri_patterned${ARROW}>>ri_consumer`, {
      decision: 'D',
      trigger: 'open-fork',
    });
    expect(parsed.steps?.[0]?.args).toMatchObject({ decision: 'D', trigger: 'open-fork' });

    await expect(
      parse(`>>ri_patterned${ARROW}>>ri_consumer`, { decision: 'D', trigger: 'nope' })
    ).rejects.toThrow(`Value must match pattern ${PATTERN}`);
  });
});

describe('inputs on a symbolic single prompt', () => {
  test('a patterned argument supplied through inputs is accepted, and its defaults survive', async () => {
    const parsed = await parse('>>ri_patterned :: "the answer names a decision"', {
      decision: 'D',
      trigger: 'open-fork',
    });

    expect(parsed.promptArgs).toEqual({ decision: 'D', trigger: 'open-fork' });
  });

  test('a non-matching value supplied through inputs is refused', async () => {
    await expect(
      parse('>>ri_patterned :: "the answer names a decision"', { decision: 'D', trigger: 'nope' })
    ).rejects.toThrow(`Value must match pattern ${PATTERN}`);
  });
});
