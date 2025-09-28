/**
 * Simplified Unified Parsing System Tests
 *
 * Core functionality tests focusing on essential parsing behavior
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../src/logging/index.js';
import { PromptData } from '../../src/types/index.js';
import {
  createParsingSystem,
  type ExecutionContext
} from '../../src/execution/parsers/index.js';

// Mock logger for testing
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as any;

// Sample prompt data for testing
const testPrompts: PromptData[] = [
  {
    id: 'test_prompt',
    name: 'test_prompt',
    description: 'A test prompt',
    userMessageTemplate: 'Test message: {{content}}',
    arguments: [
      {
        name: 'content',
        description: 'Content to process',
        required: true
      }
    ],
    category: 'test'
  },
  {
    id: 'multi_arg_prompt',
    name: 'multi_arg_prompt',
    description: 'A prompt with multiple arguments',
    userMessageTemplate: 'Process {{text}} with {{format}}',
    arguments: [
      {
        name: 'text',
        description: 'Text to process',
        required: true
      },
      {
        name: 'format',
        description: 'Output format',
        required: false
      }
    ],
    category: 'test'
  }
];

describe('Unified Parsing System - Core Functionality', () => {
  let parsingSystem: ReturnType<typeof createParsingSystem>;

  beforeEach(() => {
    parsingSystem = createParsingSystem(mockLogger);
  });

  describe('Command Parsing', () => {
    test('should parse simple >>prompt format', async () => {
      const result = await parsingSystem.commandParser.parseCommand(
        '>>test_prompt hello world',
        testPrompts
      );

      expect(result.promptId).toBe('test_prompt');
      expect(result.rawArgs).toBe('hello world');
      expect(result.format).toBe('simple');
    });

    test('should parse JSON command format', async () => {
      const command = '{"command": ">>test_prompt", "args": "hello world"}';
      const result = await parsingSystem.commandParser.parseCommand(command, testPrompts);

      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('json');
    });

    test('should handle unknown prompts', async () => {
      await expect(
        parsingSystem.commandParser.parseCommand('>>unknown_prompt', testPrompts)
      ).rejects.toThrow('Unknown prompt: unknown_prompt');
    });
  });

  describe('Argument Processing', () => {
    test('should process simple arguments', async () => {
      const result = await parsingSystem.argumentProcessor.processArguments(
        'hello world',
        testPrompts[0]
      );

      expect(result.processedArgs.content).toBe('hello world');
      expect(result.metadata.processingStrategy).toBe('simple');
    });

    test('should process JSON arguments', async () => {
      const jsonArgs = '{"text": "hello", "format": "json"}';
      const result = await parsingSystem.argumentProcessor.processArguments(
        jsonArgs,
        testPrompts[1]
      );

      expect(result.processedArgs.text).toBe('hello');
      expect(result.processedArgs.format).toBe('json');
      expect(result.metadata.processingStrategy).toBe('json');
    });

    test('should process key-value pairs', async () => {
      const kvArgs = 'text=hello format=xml';
      const result = await parsingSystem.argumentProcessor.processArguments(
        kvArgs,
        testPrompts[1]
      );

      expect(result.processedArgs.text).toBe('hello');
      expect(result.processedArgs.format).toBe('xml');
      expect(result.metadata.processingStrategy).toBe('keyvalue');
    });
  });

  describe('Context Resolution', () => {
    test('should resolve from environment variables', async () => {
      process.env.PROMPT_TEST = 'environment_value';

      const result = await parsingSystem.contextResolver.resolveContext('test');

      expect(result.value).toBe('environment_value');
      expect(result.source).toBe('environment_variables');

      delete process.env.PROMPT_TEST;
    });

    test('should generate placeholders for unknown keys', async () => {
      const result = await parsingSystem.contextResolver.resolveContext('unknown_key');

      expect(result.source).toBe('generated_placeholder');
      expect(result.value).toContain('unknown_key');
    });

    test('should use caching for repeated resolutions', async () => {
      const result1 = await parsingSystem.contextResolver.resolveContext('cached_key');
      const result2 = await parsingSystem.contextResolver.resolveContext('cached_key');

      const stats = parsingSystem.contextResolver.getStats();
      expect(stats.cacheHits).toBe(1);
    });
  });

  describe('Integration', () => {
    test('should work end-to-end', async () => {
      // Parse command
      const parseResult = await parsingSystem.commandParser.parseCommand(
        '>>multi_arg_prompt hello world',
        testPrompts
      );

      // Process arguments
      const context: ExecutionContext = {
        conversationHistory: [],
        environmentVars: {},
        promptDefaults: { format: 'text' }
      };

      const argResult = await parsingSystem.argumentProcessor.processArguments(
        parseResult.rawArgs,
        testPrompts[1],
        context
      );

      expect(parseResult.promptId).toBe('multi_arg_prompt');
      expect(argResult.processedArgs.text).toBe('hello world');
    });
  });

  describe('Performance', () => {
    test('should complete parsing within reasonable time', async () => {
      const start = Date.now();

      for (let i = 0; i < 10; i++) {
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt test${i}`,
          testPrompts
        );
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete 10 parses in under 1 second
    });

    test('should maintain reasonable memory usage', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform multiple operations
      for (let i = 0; i < 50; i++) {
        await parsingSystem.commandParser.parseCommand(`>>test_prompt test${i}`, testPrompts);
        await parsingSystem.argumentProcessor.processArguments(`test${i}`, testPrompts[0]);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      expect(memoryIncrease).toBeLessThan(10); // Should not increase by more than 10MB
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON gracefully', async () => {
      await expect(
        parsingSystem.commandParser.parseCommand('{"invalid": json', testPrompts)
      ).rejects.toThrow();
    });

    test('should handle empty commands', async () => {
      await expect(
        parsingSystem.commandParser.parseCommand('', testPrompts)
      ).rejects.toThrow('Command cannot be empty');
    });

    test('should provide helpful error messages', async () => {
      try {
        await parsingSystem.commandParser.parseCommand('invalid format', testPrompts);
      } catch (error: any) {
        expect(error.message).toContain('Supported command formats:');
      }
    });
  });
});