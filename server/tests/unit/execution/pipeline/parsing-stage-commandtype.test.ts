/**
 * Test suite for CommandParsingStage commandType integration (Phase , Day -)
 *
 * Verifies that the parsing stage correctly updates commandType when detecting
 * chain prompts from prompt definitions.
 */
import { describe, test, expect, beforeEach } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ArgumentParser } from '../../../../src/engine/execution/parsers/argument-parser.js';
import { UnifiedCommandParser } from '../../../../src/engine/execution/parsers/command-parser.js';
import { SymbolicCommandBuilder } from '../../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { CommandParsingStage } from '../../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { createSimpleLogger } from '../../../../src/infra/logging/index.js';

import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

describe('CommandParsingStage - commandType Integration', () => {
  const logger = createSimpleLogger('test', 'error');
  const commandParser = new UnifiedCommandParser(logger);
  const argumentParser = new ArgumentParser(logger);

  const singleConverted: ConvertedPrompt = {
    id: 'single_test',
    name: 'Single Test',
    description: 'Test single prompt',
    category: 'test',
    arguments: [],
    userMessageTemplate: 'Test {{input}}',
    systemMessage: null,
  };

  // Step prompt referenced by chain_test's chainSteps
  const stepConverted: ConvertedPrompt = {
    id: 'step',
    name: 'Step Prompt',
    description: 'Step in chain',
    category: 'test',
    arguments: [],
    userMessageTemplate: 'Step content',
    systemMessage: null,
  };

  // Tier A: a chain declaring the two new YAML surfaces — step `args` and a chain-level `budget`.
  // Separate from `chainConverted` so the negative controls above keep measuring their absence.
  const budgetChainConverted: ConvertedPrompt = {
    id: 'budget_chain',
    name: 'Budget Chain',
    description: 'Chain declaring step args and a run budget',
    category: 'test',
    arguments: [],
    userMessageTemplate: 'Test chain',
    systemMessage: null,
    chainSteps: [
      { promptId: 'step', stepName: 'First', args: { depth: 'deep' } },
      { promptId: 'step', stepName: 'Second' },
    ],
    budget: { maxInsertions: 1, pauseOnBlocking: true },
  };

  const chainConverted: ConvertedPrompt = {
    id: 'chain_test',
    name: 'Chain Test',
    description: 'Test chain prompt',
    category: 'test',
    arguments: [],
    userMessageTemplate: 'Test chain',
    systemMessage: null,
    chainSteps: [
      { promptId: 'step', stepName: 'Step ' },
      { promptId: 'step', stepName: 'Step ' },
    ],
  };

  let stage: CommandParsingStage;

  beforeEach(() => {
    const symbolicCommandBuilder = new SymbolicCommandBuilder(argumentParser, logger);
    stage = new CommandParsingStage(
      commandParser,
      argumentParser,
      () => [singleConverted, stepConverted, chainConverted, budgetChainConverted],
      logger,
      symbolicCommandBuilder
    );
  });

  describe('Simple command parsing', () => {
    test('assigns commandType: single for single prompts', async () => {
      const context = new ExecutionContext({
        command: '>>single_test input=test',
      });

      await stage.execute(context);

      expect(context.parsedCommand).toBeDefined();
      expect(context.parsedCommand!.commandType).toBe('single');
      expect(context.parsedCommand!.promptId).toBe('single_test');
      expect(context.parsedCommand!.steps).toBeUndefined();
    });

    test('updates commandType to chain for prompts with chainSteps', async () => {
      const context = new ExecutionContext({
        command: '>>chain_test',
      });

      await stage.execute(context);

      expect(context.parsedCommand).toBeDefined();
      expect(context.parsedCommand!.commandType).toBe('chain');
      expect(context.parsedCommand!.promptId).toBe('chain_test');
      expect(context.parsedCommand!.steps).toBeDefined();
      expect(context.parsedCommand!.steps?.length).toBe(chainConverted.chainSteps?.length);
    });

    test('round-trips byte-identical when no step declares visibility (negative control, P5 Tier 1)', async () => {
      const context = new ExecutionContext({
        command: '>>chain_test',
      });

      await stage.execute(context);

      expect(context.parsedCommand!.steps?.[0]?.visibility).toBeUndefined();
      expect(context.parsedCommand!.steps?.[1]?.visibility).toBeUndefined();
    });

    // The THIRD stripper on the YAML step path (row A.1). `ChainStepSchema` and
    // `normalizeChainSteps` are covered in tests/unit/prompts; a field carried at fewer than all
    // three is silently dead (P6-F7), so this is where the projection is measured.
    test('projects step-declared args over the run arguments, for that step only', async () => {
      const context = new ExecutionContext({ command: '>>budget_chain' });

      await stage.execute(context);

      expect(context.parsedCommand!.steps?.[0]?.args).toMatchObject({ depth: 'deep' });
      // Positive control for the "for that step only" half: the sibling step, which declares
      // nothing, must NOT have picked the value up.
      expect(context.parsedCommand!.steps?.[1]?.args).not.toHaveProperty('depth');
    });

    test('projects a chain-declared budget onto the same field an IR submission sets', async () => {
      const context = new ExecutionContext({ command: '>>budget_chain' });

      await stage.execute(context);

      // Both fields, not just the cap: the converter and this projection hand the whole
      // DeclaredRunBudget across, so `pauseOnBlocking` arriving here is the hop that carries a
      // TEMPLATE chain's dial to the stage that reads it (row 1.3).
      expect(context.parsedCommand!.budget).toEqual({
        maxInsertions: 1,
        pauseOnBlocking: true,
      });
    });

    test('leaves budget absent for a chain that declares none (negative control)', async () => {
      const context = new ExecutionContext({ command: '>>chain_test' });

      await stage.execute(context);

      expect(context.parsedCommand!.budget).toBeUndefined();
    });
  });

  describe('Symbolic command parsing', () => {
    test('assigns commandType: chain for chain operator (-->)', async () => {
      const context = new ExecutionContext({
        command: '>>single_test input --> single_test input',
      });

      await stage.execute(context);

      expect(context.parsedCommand).toBeDefined();
      expect(context.parsedCommand!.commandType).toBe('chain');
      expect(context.parsedCommand!.format).toBe('symbolic');
    });

    test('assigns commandType: single for single symbolic prompt without chain operator', async () => {
      const context = new ExecutionContext({
        command: '>>single_test input :: "quality check"',
      });

      await stage.execute(context);

      expect(context.parsedCommand).toBeDefined();
      expect(context.parsedCommand!.commandType).toBe('single');
      expect(context.parsedCommand!.format).toBe('symbolic');
    });
  });

  describe('isChainExecution() integration', () => {
    test('returns true for commandType: chain', async () => {
      const context = new ExecutionContext({
        command: '>>chain_test',
      });

      await stage.execute(context);

      expect(context.isChainExecution()).toBe(true);
    });

    test('returns false for commandType: single', async () => {
      const context = new ExecutionContext({
        command: '>>single_test input=test',
      });

      await stage.execute(context);

      expect(context.isChainExecution()).toBe(false);
    });

    test('returns true for symbolic chain operator', async () => {
      const context = new ExecutionContext({
        command: '>>single_test input --> single_test input',
      });

      await stage.execute(context);

      expect(context.isChainExecution()).toBe(true);
    });
  });
});
