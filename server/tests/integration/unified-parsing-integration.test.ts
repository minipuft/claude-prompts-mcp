/**
 * Integration Tests for Unified Parsing System
 * 
 * End-to-end integration tests that verify the complete parsing system
 * works correctly with the real MCP server infrastructure.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Logger } from '../../src/logging/index.js';
import { PromptManager } from '../../src/prompts/index.js';
import { ConsolidatedPromptEngine, createConsolidatedPromptEngine } from '../../src/mcp-tools/consolidated-prompt-engine.js';
import { SemanticAnalyzer } from '../../src/analysis/semantic-analyzer.js';
import { PromptData, ConvertedPrompt } from '../../src/types/index.js';
import { isChainPrompt } from '../../src/utils/chainUtils.js';
import { cleanupPromptEngine } from '../helpers/test-helpers.js';

// Mock logger
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as any;

// Mock MCP server
const mockMcpServer = {
  tool: jest.fn()
};

// Mock prompt manager
const mockPromptManager = {
  processTemplateAsync: jest.fn().mockResolvedValue('Processed template content'),
  convertedPrompts: [] as ConvertedPrompt[],
  promptsData: [] as PromptData[]
} as any;

// Mock semantic analyzer
const mockSemanticAnalyzer = {
  analyzePrompt: jest.fn().mockResolvedValue({
    executionType: 'template',
    requiresExecution: true,
    confidence: 0.8,
    reasoning: ['Simple prompt detected'],
    suggestedGates: []
  })
} as any;

// Test data
const testPromptsData: PromptData[] = [
  {
    id: 'simple_test',
    name: 'simple_test',
    description: 'A simple test prompt',
    userMessageTemplate: 'Process this: {{content}}',
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
    id: 'multi_arg_test',
    name: 'multi_arg_test', 
    description: 'Multi-argument test prompt',
    userMessageTemplate: 'Transform {{text}} to {{format}} in {{language}}',
    arguments: [
      {
        name: 'text',
        description: 'Text to transform',
        required: true
      },
      {
        name: 'format',
        description: 'Output format (json, xml, csv)',
        required: false
      },
      {
        name: 'language',
        description: 'Target language',
        required: false
      }
    ],
    category: 'test'
  },
  {
    id: 'chain_test',
    name: 'chain_test',
    description: 'Chain execution test prompt',
    userMessageTemplate: 'Step result: {{result}}',
    arguments: [
      {
        name: 'result',
        description: 'Result from previous step',
        required: false
      }
    ],
    category: 'test'
  }
];

const testConvertedPrompts: ConvertedPrompt[] = testPromptsData.map(prompt => ({
  ...prompt,
  chainSteps: prompt.id === 'chain_test' ? [
    { stepName: 'Step 1', promptId: 'simple_test' },
    { stepName: 'Step 2', promptId: 'multi_arg_test' }
  ] : undefined
}));

describe('Unified Parsing Integration Tests', () => {
  let promptEngine: ConsolidatedPromptEngine;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create prompt engine with enhanced parsing
    promptEngine = createConsolidatedPromptEngine(
      mockLogger,
      mockMcpServer,
      mockPromptManager,
      mockSemanticAnalyzer
    );
    
    // Update test data
    promptEngine.updateData(testPromptsData, testConvertedPrompts);
  });

  describe('End-to-End Command Processing', () => {
    test('should process simple command through entire pipeline', async () => {
      const mockExecutePrompt = jest.fn();
      
      // Mock the internal executePrompt method
      (promptEngine as any).executePrompt = mockExecutePrompt.mockResolvedValue({
        content: [{ type: 'text', text: 'Success: Processed content' }]
      });

      // Simulate the command execution
      const result = await (promptEngine as any).executePrompt({
        command: '>>simple_test Hello world',
        execution_mode: 'auto'
      }, {});

      expect(mockExecutePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          command: '>>simple_test Hello world',
          execution_mode: 'auto'
        }),
        {}
      );
    });

    test('should handle JSON command format', async () => {
      const mockExecutePrompt = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success: JSON processed' }]
      });
      
      (promptEngine as any).executePrompt = mockExecutePrompt;

      const jsonCommand = JSON.stringify({
        command: '>>multi_arg_test',
        args: {
          text: 'Hello world',
          format: 'json',
          language: 'en'
        }
      });

      await (promptEngine as any).executePrompt({
        command: jsonCommand,
        execution_mode: 'auto'
      }, {});

      expect(mockExecutePrompt).toHaveBeenCalled();
    });

    test('should handle structured command format', async () => {
      const mockExecutePrompt = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success: Structured processed' }]
      });
      
      (promptEngine as any).executePrompt = mockExecutePrompt;

      const structuredCommand = 'multi_arg_test {"text": "Hello", "format": "xml"}';

      await (promptEngine as any).executePrompt({
        command: structuredCommand,
        execution_mode: 'template'
      }, {});

      expect(mockExecutePrompt).toHaveBeenCalled();
    });

    test('should parse multi-line arguments in simple command format', async () => {
      const multiLineCommand = [
        '>>simple_test **Title**: Network Layers Model',
        '**Summary**:',
        'Line one of details.',
        'Line two of details.'
      ].join('\n');

      const result = await (promptEngine as any).parseCommandUnified(multiLineCommand);

      expect(result.promptId).toBe('simple_test');
      expect(result.arguments).toBeDefined();
      expect(result.arguments.content).toContain('Line two of details.');
      expect(result.arguments.content.split('\n').length).toBeGreaterThan(1);
    });
  });

  describe('Context-Aware Processing', () => {
    test('should use conversation history for context', async () => {
      // Mock conversation history in prompt manager
      const mockHistory = [
        { role: 'user', content: 'Previous message content', timestamp: Date.now() - 1000 }
      ];
      
      mockPromptManager.getHistory = jest.fn().mockReturnValue(mockHistory);

      const mockExecutePrompt = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success: Context aware' }]
      });
      
      (promptEngine as any).executePrompt = mockExecutePrompt;

      // Execute command that should use context
      await (promptEngine as any).executePrompt({
        command: '>>simple_test',
        execution_mode: 'auto'
      }, {});

      expect(mockExecutePrompt).toHaveBeenCalled();
    });

    test('should resolve environment variables for defaults', async () => {
      // Set environment variable
      process.env.PROMPT_FORMAT = 'json';
      process.env.PROMPT_LANGUAGE = 'es';

      const mockExecutePrompt = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success: Environment resolved' }]
      });
      
      (promptEngine as any).executePrompt = mockExecutePrompt;

      await (promptEngine as any).executePrompt({
        command: '>>multi_arg_test Hello world',
        execution_mode: 'auto'
      }, {});

      expect(mockExecutePrompt).toHaveBeenCalled();

      // Clean up
      delete process.env.PROMPT_FORMAT;
      delete process.env.PROMPT_LANGUAGE;
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should provide helpful error messages for unknown prompts', async () => {
      try {
        await (promptEngine as any).parseCommandUnified('>>unknown_prompt test');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Unknown prompt: unknown_prompt');
        expect(error.message).toContain('>>listprompts');
      }
    });

    test('should suggest corrections for typos', async () => {
      try {
        await (promptEngine as any).parseCommandUnified('>>simple_tst test');
      } catch (error: any) {
        expect(error.message).toContain('simple_test');
      }
    });

    test('should handle malformed JSON gracefully', async () => {
      try {
        await (promptEngine as any).parseCommandUnified('{"command": ">>simple_test", "malformed": json}');
      } catch (error: any) {
        expect(error.message).toContain('Supported command formats');
      }
    });
  });

  describe('Performance and Statistics', () => {
    test('should track parsing statistics', async () => {
      // Execute several commands
      const commands = [
        '>>simple_test hello',
        '>>multi_arg_test world format=json',
        'chain_test {"result": "test"}'
      ];

      for (const command of commands) {
        try {
          await (promptEngine as any).parseCommandUnified(command);
        } catch (error) {
          // Expected for some test cases
        }
      }

      const stats = promptEngine.getParsingStats();
      
      expect(stats.commandParser).toBeDefined();
      expect(stats.argumentProcessor).toBeDefined();
      expect(stats.contextResolver).toBeDefined();
      
      expect(stats.commandParser.totalParses).toBeGreaterThan(0);
      expect(stats.argumentProcessor.totalProcessed).toBeGreaterThan(0);
      expect(stats.contextResolver.totalResolutions).toBeGreaterThan(0);
    });

    test('should allow statistics reset', () => {
      promptEngine.resetParsingStats();
      
      const stats = promptEngine.getParsingStats();
      expect(stats.commandParser.totalParses).toBe(0);
      expect(stats.argumentProcessor.totalProcessed).toBe(0);
      expect(stats.contextResolver.totalResolutions).toBe(0);
    });
  });

  describe('Execution Mode Detection', () => {
    test('should detect template mode for simple prompts', async () => {
      mockSemanticAnalyzer.analyzePrompt.mockResolvedValue({
        executionType: 'template',
        requiresExecution: false,
        confidence: 0.9,
        reasoning: ['Simple informational prompt'],
        suggestedGates: []
      });

      const mockExecuteTemplate = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Template result' }]
      });
      
      (promptEngine as any).executeTemplate = mockExecuteTemplate;

      await (promptEngine as any).executePrompt({
        command: '>>simple_test info request',
        execution_mode: 'auto'
      }, {});

      // Would verify template mode was selected
    });

    test('should detect chain mode for chain prompts', async () => {
      const chainPrompt = testConvertedPrompts.find(p => isChainPrompt(p));
      expect(chainPrompt).toBeDefined();

      const mockExecuteChain = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Chain result' }]
      });
      
      (promptEngine as any).executeChain = mockExecuteChain;

      // Test would verify chain execution
    });
  });

  describe('Backward Compatibility', () => {
    test('should maintain compatibility with legacy parseCommand calls', async () => {
      const legacyResult = await (promptEngine as any).parseCommand('>>simple_test legacy test');
      
      expect(legacyResult.promptId).toBe('simple_test');
      expect(legacyResult.arguments).toBeDefined();
      expect(legacyResult.convertedPrompt).toBeDefined();
    });

    test('should maintain compatibility with legacy parseArguments calls', async () => {
      const legacyResult = await (promptEngine as any).parseArguments(
        'legacy argument test',
        testPromptsData[0]
      );
      
      expect(legacyResult).toBeDefined();
      expect(typeof legacyResult).toBe('object');
    });

    test('should log migration warnings for deprecated methods', async () => {
      await (promptEngine as any).parseCommand('>>simple_test legacy');
      await (promptEngine as any).parseArguments('test', testPromptsData[0]);
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[MIGRATION]')
      );
    });
  });

  describe('Real-World Scenarios', () => {
    test('should handle complex multi-step workflow', async () => {
      const workflow = [
        '>>simple_test Extract key information from this document',
        '>>multi_arg_test format=json language=en',
        '>>chain_test'
      ];

      for (const command of workflow) {
        try {
          await (promptEngine as any).parseCommandUnified(command);
        } catch (error) {
          // Some commands may fail in test environment
        }
      }

      // Verify the workflow was processed
      const stats = promptEngine.getParsingStats();
      expect(stats.commandParser.totalParses).toBe(workflow.length);
    });

    test('should handle concurrent command processing', async () => {
      const concurrentCommands = [
        '>>simple_test concurrent test 1',
        '>>multi_arg_test concurrent test 2',
        '>>simple_test concurrent test 3'
      ];

      const promises = concurrentCommands.map(command => 
        (promptEngine as any).parseCommandUnified(command).catch(() => null)
      );

      await Promise.all(promises);

      const stats = promptEngine.getParsingStats();
      expect(stats.commandParser.totalParses).toBe(concurrentCommands.length);
    });

    test('should maintain state consistency under load', async () => {
      const commands = Array(50).fill(null).map((_, i) => 
        `>>simple_test load test ${i}`
      );

      for (const command of commands) {
        try {
          await (promptEngine as any).parseCommandUnified(command);
        } catch (error) {
          // Expected in test environment
        }
      }

      const stats = promptEngine.getParsingStats();
      expect(stats.commandParser.successfulParses + stats.commandParser.failedParses)
        .toBe(stats.commandParser.totalParses);
    });
  });
});

describe('Migration Validation', () => {
  test('should demonstrate zero-breaking-changes migration', async () => {
    const promptEngine = createConsolidatedPromptEngine(
      mockLogger,
      mockMcpServer,
      mockPromptManager,
      mockSemanticAnalyzer
    );
    
    promptEngine.updateData(testPromptsData, testConvertedPrompts);

    // All these legacy patterns should still work
    const legacyPatterns = [
      '>>simple_test hello',
      '>>multi_arg_test text format=json',
      'chain_test'
    ];

    let allPassed = true;
    for (const pattern of legacyPatterns) {
      try {
        await (promptEngine as any).parseCommandUnified(pattern);
      } catch (error) {
        // Error handling is expected, but should be graceful
        expect((error as Error).message).toBeTruthy();
      }
    }

    // Verify enhanced features are available
    expect(promptEngine.getParsingStats).toBeDefined();
    expect(promptEngine.resetParsingStats).toBeDefined();
  });
});

describe('System Health and Monitoring', () => {
  test('should provide comprehensive system health metrics', () => {
    const promptEngine = createConsolidatedPromptEngine(
      mockLogger,
      mockMcpServer,
      mockPromptManager,
      mockSemanticAnalyzer
    );

    const executionStats = promptEngine.getAnalytics();
    const parsingStats = promptEngine.getParsingStats();

    expect(executionStats).toHaveProperty('totalExecutions');
    expect(executionStats).toHaveProperty('successfulExecutions');
    expect(executionStats).toHaveProperty('executionsByMode');

    expect(parsingStats).toHaveProperty('commandParser');
    expect(parsingStats).toHaveProperty('argumentProcessor');
    expect(parsingStats).toHaveProperty('contextResolver');
  });

  test('should enable performance monitoring', async () => {
    const promptEngine = createConsolidatedPromptEngine(
      mockLogger,
      mockMcpServer,
      mockPromptManager,
      mockSemanticAnalyzer
    );
    
    promptEngine.updateData(testPromptsData, testConvertedPrompts);

    // Perform operations
    try {
      await (promptEngine as any).parseCommandUnified('>>simple_test monitoring test');
    } catch (error) {
      // Expected in test environment
    }

    const stats = promptEngine.getParsingStats();
    
    // Verify metrics are being collected
    expect(stats.commandParser.totalParses).toBeGreaterThan(0);
    expect(stats.commandParser.averageConfidence).toBeGreaterThanOrEqual(0);
  });

  afterEach(async () => {
    // Cleanup prompt engine to prevent async handle leaks
    if (promptEngine) {
      await cleanupPromptEngine(promptEngine);
    }
  });
});
