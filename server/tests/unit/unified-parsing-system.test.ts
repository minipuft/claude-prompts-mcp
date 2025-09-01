/**
 * Comprehensive Test Suite for Unified Parsing System
 * 
 * Tests all aspects of the new parsing infrastructure:
 * - Unified Command Parser with multi-strategy support
 * - Argument Processing Pipeline with validation and enrichment
 * - Context Resolution System with priority fallbacks
 * - Backward Compatibility Wrapper
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { Logger } from '../../src/logging/index.js';
import { PromptData } from '../../src/types/index.js';
import {
  UnifiedCommandParser,
  createUnifiedCommandParser,
  ArgumentProcessor,
  createArgumentProcessor,
  ContextResolver,
  createContextResolver,
  createParsingSystem,
  CompatibilityWrapper,
  createCompatibilityWrapper,
  type ExecutionContext,
  type ContextProvider
} from '../../src/execution/parsers/index.js';

// Mock logger for testing
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as any;

// Sample prompt data for testing
const samplePrompts: PromptData[] = [
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
    userMessageTemplate: 'Process {{text}} with {{format}} in {{language}}',
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
      },
      {
        name: 'language',
        description: 'Target language',
        required: false
      }
    ],
    category: 'test'
  }
];

describe('UnifiedCommandParser', () => {
  let parser: UnifiedCommandParser;

  beforeEach(() => {
    parser = createUnifiedCommandParser(mockLogger);
  });

  describe('Simple Command Format', () => {
    test('should parse basic >>prompt format', async () => {
      const result = await parser.parseCommand('>>test_prompt hello world', samplePrompts);
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.rawArgs).toBe('hello world');
      expect(result.format).toBe('simple');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    test('should parse basic /prompt format', async () => {
      const result = await parser.parseCommand('/test_prompt hello world', samplePrompts);
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.rawArgs).toBe('hello world');
      expect(result.format).toBe('simple');
    });

    test('should handle prompts with no arguments', async () => {
      const result = await parser.parseCommand('>>test_prompt', samplePrompts);
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.rawArgs).toBe('');
      expect(result.format).toBe('simple');
    });
  });

  describe('JSON Command Format', () => {
    test('should parse JSON command format', async () => {
      const command = '{"command": ">>test_prompt", "args": "hello world"}';
      const result = await parser.parseCommand(command, samplePrompts);
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('json');
    });

    test('should handle complex JSON arguments', async () => {
      const command = '{"command": ">>multi_arg_prompt", "args": {"text": "hello", "format": "json"}}';
      const result = await parser.parseCommand(command, samplePrompts);
      
      expect(result.promptId).toBe('multi_arg_prompt');
      expect(result.format).toBe('json');
    });
  });

  describe('Structured Command Format', () => {
    test('should parse structured format', async () => {
      const command = 'test_prompt {"text": "hello world", "format": "json"}';
      const result = await parser.parseCommand(command, samplePrompts);
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('structured');
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown prompt', async () => {
      await expect(parser.parseCommand('>>unknown_prompt', samplePrompts))
        .rejects.toThrow('Unknown prompt: unknown_prompt');
    });

    test('should throw error for empty command', async () => {
      await expect(parser.parseCommand('', samplePrompts))
        .rejects.toThrow('Command cannot be empty');
    });

    test('should provide helpful suggestions for typos', async () => {
      try {
        await parser.parseCommand('>>test_promp', samplePrompts);
      } catch (error: any) {
        expect(error.message).toContain('test_prompt');
      }
    });
  });

  describe('Statistics', () => {
    test('should track parsing statistics', async () => {
      await parser.parseCommand('>>test_prompt hello', samplePrompts);
      await parser.parseCommand('/test_prompt world', samplePrompts);
      
      const stats = parser.getStats();
      expect(stats.totalParses).toBe(2);
      expect(stats.successfulParses).toBe(2);
      expect(stats.failedParses).toBe(0);
    });

    test('should reset statistics', () => {
      parser.resetStats();
      const stats = parser.getStats();
      expect(stats.totalParses).toBe(0);
      expect(stats.successfulParses).toBe(0);
    });
  });
});

describe('ArgumentProcessor', () => {
  let processor: ArgumentProcessor;
  
  beforeEach(() => {
    processor = createArgumentProcessor(mockLogger);
  });

  describe('JSON Argument Processing', () => {
    test('should process JSON arguments correctly', async () => {
      const jsonArgs = '{"content": "hello world", "format": "text"}';
      const result = await processor.processArguments(jsonArgs, samplePrompts[1]);
      
      expect(result.processedArgs.content).toBe('hello world');
      expect(result.processedArgs.format).toBe('text');
      expect(result.metadata.processingStrategy).toBe('json');
    });
  });

  describe('Key-Value Argument Processing', () => {
    test('should process key-value pairs', async () => {
      const kvArgs = 'text=hello world format=json language=en';
      const result = await processor.processArguments(kvArgs, samplePrompts[1]);
      
      expect(result.processedArgs.text).toBe('hello world');
      expect(result.processedArgs.format).toBe('json');
      expect(result.processedArgs.language).toBe('en');
      expect(result.metadata.processingStrategy).toBe('keyvalue');
    });
  });

  describe('Simple Text Processing', () => {
    test('should handle simple text for single argument prompts', async () => {
      const result = await processor.processArguments('hello world', samplePrompts[0]);
      
      expect(result.processedArgs.content).toBe('hello world');
      expect(result.metadata.processingStrategy).toBe('simple');
    });

    test('should apply intelligent defaults for multiple arguments', async () => {
      const result = await processor.processArguments('hello world', samplePrompts[1]);
      
      expect(result.processedArgs.text).toBe('hello world');
      expect(result.metadata.appliedDefaults.length).toBeGreaterThan(0);
    });
  });

  describe('Type Coercion', () => {
    test('should coerce argument types based on descriptions', async () => {
      const promptWithTypes: PromptData = {
        id: 'typed_prompt',
        name: 'typed_prompt',
        description: 'Prompt with typed arguments',
        userMessageTemplate: 'Count: {{count}}, Flag: {{enabled}}',
        arguments: [
          {
            name: 'count',
            description: 'Number of items',
            required: true
          },
          {
            name: 'enabled',
            description: 'Boolean flag',
            required: false
          }
        ],
        category: 'test'
      };

      const result = await processor.processArguments('count=5 enabled=true', promptWithTypes);
      
      expect(typeof result.processedArgs.count).toBe('number');
      expect(result.processedArgs.count).toBe(5);
      expect(typeof result.processedArgs.enabled).toBe('boolean');
      expect(result.processedArgs.enabled).toBe(true);
    });
  });

  describe('Context Integration', () => {
    test('should use execution context for defaults', async () => {
      const context: ExecutionContext = {
        conversationHistory: [
          { role: 'user', content: 'Previous message', timestamp: Date.now() }
        ],
        environmentVars: { PROMPT_FORMAT: 'json' },
        promptDefaults: { language: 'en' }
      };

      const result = await processor.processArguments('hello', samplePrompts[1], context);
      
      expect(result.processedArgs.text).toBe('hello');
      expect(result.metadata.contextSources).toBeDefined();
    });
  });
});

describe('ContextResolver', () => {
  let resolver: ContextResolver;

  beforeEach(() => {
    resolver = createContextResolver(mockLogger);
  });

  describe('Default Providers', () => {
    test('should resolve from conversation history', async () => {
      const hint = {
        conversationHistory: [
          { role: 'user', content: 'Hello world', timestamp: Date.now() }
        ]
      };

      const result = await resolver.resolveContext('previous_message', hint);
      
      expect(result.value).toBe('Hello world');
      expect(result.source).toBe('conversation_history');
    });

    test('should resolve from environment variables', async () => {
      process.env.PROMPT_TEST = 'environment_value';
      
      const result = await resolver.resolveContext('test');
      
      expect(result.value).toBe('environment_value');
      expect(result.source).toBe('environment_variables');
      
      delete process.env.PROMPT_TEST;
    });

    test('should generate smart placeholders', async () => {
      const result = await resolver.resolveContext('unknown_key');
      
      expect(result.source).toBe('generated_placeholder');
      expect(result.value).toContain('unknown_key');
    });
  });

  describe('Custom Providers', () => {
    test('should support custom providers', async () => {
      const customProvider: ContextProvider = {
        name: 'custom',
        priority: 100,
        isAvailable: () => true,
        resolve: async (key: string) => ({
          value: `custom_${key}`,
          source: 'system_context' as any,
          confidence: 0.9,
          metadata: {
            resolvedAt: Date.now(),
            strategy: 'custom',
            warnings: []
          }
        })
      };

      resolver.registerProvider(customProvider);
      const result = await resolver.resolveContext('test');
      
      expect(result.value).toBe('custom_test');
      expect(result.confidence).toBe(0.9);
    });
  });

  describe('Caching', () => {
    test('should cache resolution results', async () => {
      const result1 = await resolver.resolveContext('test');
      const result2 = await resolver.resolveContext('test');
      
      const stats = resolver.getStats();
      expect(stats.cacheHits).toBe(1);
    });

    test('should clear cache when requested', async () => {
      await resolver.resolveContext('test');
      resolver.clearCache();
      
      const stats = resolver.getStats();
      expect(stats.cacheHits).toBe(0);
    });
  });
});

describe('CompatibilityWrapper', () => {
  let wrapper: CompatibilityWrapper;
  let commandParser: UnifiedCommandParser;
  let argumentProcessor: ArgumentProcessor;
  let contextResolver: ContextResolver;

  beforeEach(() => {
    commandParser = createUnifiedCommandParser(mockLogger);
    argumentProcessor = createArgumentProcessor(mockLogger);
    contextResolver = createContextResolver(mockLogger);
    wrapper = createCompatibilityWrapper(
      mockLogger,
      commandParser,
      argumentProcessor,
      contextResolver,
      { enableNewParser: true }
    );
  });

  describe('Legacy Interface Compatibility', () => {
    test('should maintain parseCommand signature', async () => {
      // Mock the unified parser's parseCommand method for this test
      jest.spyOn(commandParser, 'parseCommand').mockResolvedValue({
        promptId: 'test_prompt',
        rawArgs: 'hello world',
        format: 'simple',
        confidence: 0.95,
        metadata: {
          originalCommand: '>>test_prompt hello world',
          parseStrategy: 'simple',
          detectedFormat: '>>prompt format',
          warnings: []
        }
      });

      const result = await wrapper.parseCommand('>>test_prompt hello world');
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.arguments).toBeDefined();
      expect(result.convertedPrompt).toBeDefined();
    });
  });

  describe('Migration Statistics', () => {
    test('should track migration progress', async () => {
      // Mock successful parsing
      jest.spyOn(commandParser, 'parseCommand').mockResolvedValue({
        promptId: 'test_prompt',
        rawArgs: 'hello world',
        format: 'simple',
        confidence: 0.95,
        metadata: {
          originalCommand: '>>test_prompt hello world',
          parseStrategy: 'simple',
          detectedFormat: '>>prompt format',
          warnings: []
        }
      });

      await wrapper.parseCommand('>>test_prompt hello world');
      
      const stats = wrapper.getMigrationStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.newParserUsage).toBe(1);
      expect(stats.migrationProgress).toBe(100);
    });
  });

  describe('Fallback Behavior', () => {
    test('should fallback to old parser on errors when enabled', async () => {
      const wrapper = createCompatibilityWrapper(
        mockLogger,
        commandParser,
        argumentProcessor,
        contextResolver,
        { enableNewParser: true, fallbackToOldParser: true }
      );

      // Mock the new parser to throw an error
      jest.spyOn(commandParser, 'parseCommand').mockRejectedValue(new Error('Parser error'));

      const result = await wrapper.parseCommand('>>test_prompt hello world');
      
      expect(result.promptId).toBe('test_prompt');
      expect(result.arguments.content).toBe('hello world');
    });
  });
});

describe('Integrated Parsing System', () => {
  let parsingSystem: ReturnType<typeof createParsingSystem>;

  beforeEach(() => {
    parsingSystem = createParsingSystem(mockLogger);
  });

  test('should provide complete parsing system', () => {
    expect(parsingSystem.commandParser).toBeDefined();
    expect(parsingSystem.argumentProcessor).toBeDefined();
    expect(parsingSystem.contextResolver).toBeDefined();
  });

  test('should work end-to-end', async () => {
    // Parse command
    const parseResult = await parsingSystem.commandParser.parseCommand(
      '>>multi_arg_prompt hello world',
      samplePrompts
    );

    // Process arguments
    const context: ExecutionContext = {
      conversationHistory: [],
      environmentVars: {},
      promptDefaults: { format: 'text' }
    };

    const argResult = await parsingSystem.argumentProcessor.processArguments(
      parseResult.rawArgs,
      samplePrompts[1],
      context
    );

    // Resolve additional context
    const contextResult = await parsingSystem.contextResolver.resolveContext(
      'previous_message',
      { conversationHistory: [] }
    );

    expect(parseResult.promptId).toBe('multi_arg_prompt');
    expect(argResult.processedArgs).toBeDefined();
    expect(contextResult.value).toBeDefined();
  });
});

describe('Performance and Monitoring', () => {
  test('should track performance metrics across all systems', async () => {
    const parsingSystem = createParsingSystem(mockLogger);
    
    // Perform several operations
    for (let i = 0; i < 5; i++) {
      await parsingSystem.commandParser.parseCommand(`>>test_prompt test${i}`, samplePrompts);
      await parsingSystem.argumentProcessor.processArguments(`test${i}`, samplePrompts[0]);
      await parsingSystem.contextResolver.resolveContext(`key${i}`);
    }

    const commandStats = parsingSystem.commandParser.getStats();
    const argStats = parsingSystem.argumentProcessor.getStats();
    const contextStats = parsingSystem.contextResolver.getStats();

    expect(commandStats.totalParses).toBe(5);
    expect(argStats.totalProcessed).toBe(5);
    expect(contextStats.totalResolutions).toBe(5);
  });
});

describe('Error Recovery and Robustness', () => {
  test('should gracefully handle malformed inputs', async () => {
    const parser = createUnifiedCommandParser(mockLogger);
    
    const malformedInputs = [
      'invalid command format',
      '>>',
      '{"invalid": json',
      'prompt_name {"incomplete": json',
      ''
    ];

    for (const input of malformedInputs) {
      try {
        await parser.parseCommand(input, samplePrompts);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBeTruthy();
      }
    }
  });

  test('should provide helpful error messages', async () => {
    const parser = createUnifiedCommandParser(mockLogger);
    
    try {
      await parser.parseCommand('invalid format', samplePrompts);
    } catch (error: any) {
      expect(error.message).toContain('Supported command formats:');
      expect(error.message).toContain('>>prompt_name');
    }
  });
});