/**
 * Test suite for commandType discriminant field (Phase , Day )
 *
 * Verifies that the parser correctly assigns commandType to all parse results.
 */
import { describe, test, expect } from '@jest/globals';

import { UnifiedCommandParser } from '../../../../src/execution/parsers/command-parser.js';
import { createSimpleLogger } from '../../../../src/logging/index.js';

import type { ConvertedPrompt } from '../../../../src/types/index.js';

describe('CommandType Discriminant', () => {
  const logger = createSimpleLogger('test', 'error');
  const parser = new UnifiedCommandParser(logger);

  const mockPrompts: ConvertedPrompt[] = [
    {
      id: 'test_prompt',
      name: 'Test Prompt',
      description: 'Test',
      category: 'test',
      userMessageTemplate: 'Test {{input}}',
      arguments: [],
    },
    {
      id: 'chain_prompt',
      name: 'Chain Prompt',
      description: 'Test chain',
      category: 'test',
      userMessageTemplate: 'Test chain',
      arguments: [],
    },
  ];

  describe('Simple commands', () => {
    test('assigns commandType: single for simple prompts', async () => {
      const result = await parser.parseCommand('>>test_prompt arg arg', mockPrompts);

      expect(result.commandType).toBe('single');
      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('simple');
    });

    test('assigns commandType: single for JSON-wrapped simple prompts', async () => {
      const command = JSON.stringify({
        command: '>>test_prompt',
        args: { input: 'test' },
      });

      const result = await parser.parseCommand(command, mockPrompts);

      expect(result.commandType).toBe('single');
      expect(result.promptId).toBe('test_prompt');
    });
  });

  describe('Chain commands', () => {
    test('assigns commandType: chain for symbolic chain operator (-->)', async () => {
      const result = await parser.parseCommand(
        '>>test_prompt input --> test_prompt input',
        mockPrompts
      );

      expect(result.commandType).toBe('chain');
      expect(result.format).toBe('symbolic');
    });

    test('assigns commandType: chain for JSON-wrapped chain commands', async () => {
      const command = JSON.stringify({
        command: '>>test_prompt arg --> test_prompt arg',
      });

      const result = await parser.parseCommand(command, mockPrompts);

      expect(result.commandType).toBe('chain');
      expect(result.format).toBe('json');
    });

    test('assigns commandType: chain for multi-step chains', async () => {
      const result = await parser.parseCommand(
        '>>test_prompt step --> test_prompt step --> test_prompt step',
        mockPrompts
      );

      expect(result.commandType).toBe('chain');
      expect(result.format).toBe('symbolic');
    });
  });

  describe('Framework operator commands', () => {
    test('assigns commandType: single for framework operator without chain', async () => {
      const result = await parser.parseCommand('@CAGEERF >>test_prompt input', mockPrompts);

      expect(result.commandType).toBe('single');
      expect(result.format).toBe('symbolic');
    });

    test('assigns commandType: chain for framework operator with chain', async () => {
      const result = await parser.parseCommand(
        '@CAGEERF >>test_prompt input --> test_prompt input',
        mockPrompts
      );

      expect(result.commandType).toBe('chain');
      expect(result.format).toBe('symbolic');
    });
  });

  describe('Gate operator commands', () => {
    test('assigns commandType: single for gate operator without chain', async () => {
      const result = await parser.parseCommand(
        '>>test_prompt input :: "quality check"',
        mockPrompts
      );

      expect(result.commandType).toBe('single');
      expect(result.format).toBe('symbolic');
    });

    test('assigns commandType: chain for gate operator with chain', async () => {
      const result = await parser.parseCommand(
        '>>test_prompt input :: "check" --> test_prompt input :: "check"',
        mockPrompts
      );

      expect(result.commandType).toBe('chain');
      expect(result.format).toBe('symbolic');
    });
  });
});
