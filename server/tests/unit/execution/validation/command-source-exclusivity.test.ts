// @lifecycle test - P6.128: which of the three request validators owns command-source exclusivity.
/**
 * `command` beside a `chain_id` that is not an append names two runs. Three validators see that
 * request, and two refuse it by design:
 *
 * - the `prompt_engine` tool schema (`buildPromptEngineSchema`'s source-exclusivity refinement),
 *   which guards the MCP boundary;
 * - stage 04 (`CommandParsingStage`), which guards every caller that skips the tool schema (P6.119)
 *   — its docblock names request-shape exclusivity as its own;
 * - NOT the engine's `mcpToolRequestSchema`, which stage 01's `RequestValidator` runs: it checks
 *   field shapes, and adding the rule there would be a third copy of one decision.
 *
 * PIN (as of 2026-09-27 · flips when exclusivity moves into the engine schema). All three
 * assertions read the same request and the same sentence, `COMMAND_SOURCE_EXCLUSIVITY_MESSAGE`.
 */
import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';
import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import {
  COMMAND_SOURCE_EXCLUSIVITY_MESSAGE,
  mcpToolRequestSchema,
} from '../../../../src/engine/execution/validation/schemas.js';
import { createSimpleLogger } from '../../../../src/infra/logging/index.js';
import { buildPromptEngineSchema } from '../../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import { retargetGates } from '../../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../../src/modules/workflow-ir/validator.js';

const REQUEST = { command: '>>sv_a', chain_id: 'chain-sv_chain#1' };

describe('P6.128: command beside a non-append chain_id', () => {
  test('the engine request schema accepts it: it validates field shapes only', () => {
    expect(mcpToolRequestSchema.safeParse(REQUEST).success).toBe(true);
  });

  test('stage 04 refuses it with the exclusivity sentence', async () => {
    const logger = createSimpleLogger();
    const argumentParser = new ArgumentParser(logger);
    const stage = new CommandParsingStage(
      new UnifiedCommandParser(logger),
      argumentParser,
      () => [],
      logger,
      new SymbolicCommandBuilder(argumentParser, logger, {
        validate: validateWorkflowIR,
        compile: compileWorkflowIR,
        retargetGates,
      })
    );
    const context = new ExecutionContext(REQUEST as never);
    await stage.execute(context);

    expect(context.response?.isError).toBe(true);
    const text = context.response?.content
      .map((part) => ('text' in part ? part.text : ''))
      .join('');
    expect(text).toContain(
      `[mutually-exclusive-source] workflow: ${COMMAND_SOURCE_EXCLUSIVITY_MESSAGE}`
    );
    expect(context.parsedCommand).toBeUndefined();
  });

  test('the prompt_engine tool schema refuses it with the same sentence', () => {
    const result = buildPromptEngineSchema(() => true, 'unused').safeParse(REQUEST);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      COMMAND_SOURCE_EXCLUSIVITY_MESSAGE,
    ]);
  });
});
