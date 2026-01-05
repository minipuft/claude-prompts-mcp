/**
 * Script Tools Integration Test
 *
 * Tests the complete script-tools workflow with real modules:
 * - ScriptToolDefinitionLoader (real)
 * - ToolDetectionService (real)
 * - ExecutionPlanner (real)
 *
 * Mocks:
 * - Filesystem reads (controlled fixtures)
 * - Script execution (no actual Python/Node runtime)
 *
 * Classification: Integration (multiple real modules, mock I/O only)
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

import { ScriptToolDefinitionLoader } from '../../../src/scripts/core/script-definition-loader.js';
import { ToolDetectionService } from '../../../src/scripts/detection/tool-detection-service.js';
import { ExecutionPlanner } from '../../../src/execution/planning/execution-planner.js';

import type { LoadedScriptTool } from '../../../src/scripts/types.js';
import type { ConvertedPrompt } from '../../../src/types/index.js';
import type { Logger } from '../../../src/logging/index.js';
import type { ContentAnalyzer } from '../../../src/semantic/configurable-semantic-analyzer.js';
import type { ContentAnalysisResult } from '../../../src/semantic/types.js';

// Mock filesystem for controlled fixtures
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createMockAnalyzer = (): Pick<ContentAnalyzer, 'analyzePrompt' | 'isLLMEnabled'> => {
  const baseAnalysis: ContentAnalysisResult = {
    executionType: 'single',
    requiresExecution: true,
    requiresFramework: false,
    confidence: 0.85,
    reasoning: [],
    capabilities: {
      canDetectStructure: true,
      canAnalyzeComplexity: true,
      canRecommendFramework: true,
      hasSemanticUnderstanding: true,
    },
    limitations: [],
    warnings: [],
    executionCharacteristics: {
      hasConditionals: false,
      hasLoops: false,
      hasChainSteps: false,
      argumentCount: 1,
      templateComplexity: 1,
      hasSystemMessage: false,
      hasUserTemplate: true,
      hasStructuredReasoning: false,
      hasMethodologyKeywords: false,
      hasComplexAnalysis: false,
    },
    complexity: 'medium',
    suggestedGates: [],
    frameworkRecommendation: {
      shouldUseFramework: false,
      reasoning: [],
      confidence: 0.4,
    },
    analysisMetadata: {
      version: 'test',
      mode: 'minimal',
      analysisTime: 5,
      analyzer: 'content',
      cacheHit: false,
    },
  };

  return {
    analyzePrompt: jest.fn().mockResolvedValue(baseAnalysis),
    isLLMEnabled: jest.fn().mockReturnValue(true),
  };
};

describe('Script Tools Workflow Integration', () => {
  let logger: Logger;
  let analyzer: Pick<ContentAnalyzer, 'analyzePrompt' | 'isLLMEnabled'>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createLogger();
    analyzer = createMockAnalyzer();
  });

  describe('Tool Detection → Execution Planning Flow', () => {
    test('detects tools from user args and plans clean mode execution', async () => {
      // Arrange: Real services working together
      const detectionService = new ToolDetectionService();
      const planner = new ExecutionPlanner(analyzer, logger);

      // Fixture: Loaded script tool (simulating what ScriptToolDefinitionLoader produces)
      const loadedTool: LoadedScriptTool = {
        id: 'word_count',
        name: 'Word Counter',
        description: 'Counts words in text',
        scriptPath: 'script.py',
        runtime: 'python',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to analyze' },
          },
          required: ['text'],
        },
        toolDir: '/prompts/test_prompt/tools/word_count',
        absoluteScriptPath: '/prompts/test_prompt/tools/word_count/script.py',
        promptId: 'test_prompt',
        descriptionContent: 'Counts words, characters, and lines in text.',
        enabled: true,
      };

      // Fixture: Prompt with script tools
      const promptWithTools: ConvertedPrompt = {
        id: 'test_prompt',
        name: 'Test Prompt',
        description: 'Test prompt with script tools',
        category: 'general',
        userMessageTemplate: 'Analyze: {{text}}',
        arguments: [{ name: 'text', description: 'Text to analyze', required: true, type: 'string' }],
        scriptTools: [loadedTool],
      };

      // Act: Detection phase (real ToolDetectionService)
      const userArgs = { text: 'Hello world' };
      const matches = detectionService.detectTools('', userArgs, [loadedTool]);

      // Act: Planning phase (real ExecutionPlanner)
      const plan = await planner.createPlan({
        convertedPrompt: promptWithTools,
        frameworkEnabled: true,
      });

      // Assert: Tool was detected via parameter/schema match
      expect(matches.length).toBe(1);
      expect(matches[0].toolId).toBe('word_count');
      expect(matches[0].priority).toBeGreaterThanOrEqual(0.8);
      expect(matches[0].matchReason).toBe('schema_match');

      // Assert: Planner applied clean mode default
      expect(plan.modifiers?.clean).toBe(true);
      expect(plan.requiresFramework).toBe(false);
    });

    test('respects explicit modifier override in integrated flow', async () => {
      // Arrange
      const planner = new ExecutionPlanner(analyzer, logger);

      const loadedTool: LoadedScriptTool = {
        id: 'analyzer',
        name: 'Analyzer',
        description: 'Analyzes content',
        scriptPath: 'script.py',
        runtime: 'python',
        inputSchema: { type: 'object', properties: {}, required: [] },
        toolDir: '/tools/analyzer',
        absoluteScriptPath: '/tools/analyzer/script.py',
        promptId: 'test',
        enabled: true,
      };

      const promptWithTools: ConvertedPrompt = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        category: 'general',
        userMessageTemplate: 'Test',
        arguments: [],
        scriptTools: [loadedTool],
      };

      // Act: User explicitly requests %framework mode
      const plan = await planner.createPlan({
        convertedPrompt: promptWithTools,
        frameworkEnabled: true,
        parsedCommand: {
          promptId: 'test',
          rawArgs: '',
          format: 'symbolic',
          confidence: 0.9,
          modifiers: { framework: true }, // Explicit override
          metadata: {
            originalCommand: '%framework >>test',
            parseStrategy: 'symbolic',
            detectedFormat: 'symbolic',
            warnings: [],
          },
        },
      });

      // Assert: User's explicit modifier takes precedence
      expect(plan.modifiers?.framework).toBe(true);
      expect(plan.requiresFramework).toBe(true);
    });

    test('custom gates override clean default in integrated flow', async () => {
      // Arrange
      const planner = new ExecutionPlanner(analyzer, logger);

      const loadedTool: LoadedScriptTool = {
        id: 'validator',
        name: 'Validator',
        description: 'Validates input',
        scriptPath: 'script.py',
        runtime: 'python',
        inputSchema: { type: 'object', properties: {}, required: [] },
        toolDir: '/tools/validator',
        absoluteScriptPath: '/tools/validator/script.py',
        promptId: 'test',
        enabled: true,
      };

      const promptWithTools: ConvertedPrompt = {
        id: 'test',
        name: 'Test',
        description: 'Test',
        category: 'general',
        userMessageTemplate: 'Test',
        arguments: [],
        scriptTools: [loadedTool],
      };

      // Act: User provides custom gates
      const plan = await planner.createPlan({
        convertedPrompt: promptWithTools,
        frameworkEnabled: true,
        gateOverrides: {
          gates: ['code-quality', 'security-review'],
        },
      });

      // Assert: Clean default NOT applied (gates signal user intent)
      expect(plan.modifiers?.clean).toBeFalsy();
      // Gates should be present
      expect(plan.gates).toContain('code-quality');
      expect(plan.gates).toContain('security-review');
    });
  });

  describe('Input Extraction', () => {
    test('extracts inputs matching schema properties', () => {
      const service = new ToolDetectionService();

      const tool: LoadedScriptTool = {
        id: 'formatter',
        name: 'Formatter',
        description: 'Formats content',
        scriptPath: 'script.py',
        runtime: 'python',
        inputSchema: {
          type: 'object',
          properties: {
            input_text: { type: 'string' },
            output_format: { type: 'string' },
          },
          required: ['input_text'],
        },
        toolDir: '/tools/formatter',
        absoluteScriptPath: '/tools/formatter/script.py',
        promptId: 'test',
        enabled: true,
      };

      const args = {
        input_text: 'Hello World',
        output_format: 'markdown',
        extra_field: 'ignored',
      };

      const inputs = service.extractInputs(args, tool);

      expect(inputs).toEqual({
        input_text: 'Hello World',
        output_format: 'markdown',
      });
      expect(inputs).not.toHaveProperty('extra_field');
    });

    test('handles camelCase to snake_case conversion', () => {
      const service = new ToolDetectionService();

      const tool: LoadedScriptTool = {
        id: 'converter',
        name: 'Converter',
        description: 'Converts data',
        scriptPath: 'script.py',
        runtime: 'python',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
          },
          required: ['file_path'],
        },
        toolDir: '/tools/converter',
        absoluteScriptPath: '/tools/converter/script.py',
        promptId: 'test',
        enabled: true,
      };

      // User provides camelCase, schema expects snake_case
      const args = { filePath: '/path/to/file.txt' };
      const inputs = service.extractInputs(args, tool);

      expect(inputs.file_path).toBe('/path/to/file.txt');
    });
  });

});
