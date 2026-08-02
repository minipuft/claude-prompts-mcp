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
      () => [singleConverted, stepConverted, chainConverted],
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
