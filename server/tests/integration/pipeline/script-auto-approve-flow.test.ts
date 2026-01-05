/**
 * Script Auto-Approve Flow Integration Test
 *
 * Tests the complete autoApproveOnValid flow with real modules:
 * - ScriptExecutionStage (real)
 * - ToolDetectionService (real)
 * - ExecutionModeService (real)
 *
 * Mocks:
 * - ScriptExecutor (controlled outputs - no actual subprocess)
 *
 * Classification: Integration (multiple real modules, mock I/O only)
 *
 * This test catches issues that unit tests miss:
 * - checkValidationOutput parsing logic with real stage behavior
 * - autoApprovedTools state being set correctly
 * - Validation errors/warnings being stored properly
 * - Mixed tool routing (autoApprove vs normal confirm)
 */

import { describe, expect, test, jest, beforeEach } from '@jest/globals';

import { ScriptExecutionStage } from '../../../src/execution/pipeline/stages/04b-script-execution-stage.js';
import { ToolDetectionService } from '../../../src/scripts/detection/tool-detection-service.js';
import { ExecutionModeService } from '../../../src/scripts/execution/execution-mode-service.js';
import { resetDefaultPendingConfirmationTracker } from '../../../src/scripts/execution/pending-confirmation-tracker.js';
import { ExecutionContext } from '../../../src/execution/context/execution-context.js';

import type { ScriptExecutor } from '../../../src/scripts/execution/script-executor.js';
import type { ScriptExecutionResult, LoadedScriptTool } from '../../../src/scripts/types.js';
import type { Logger } from '../../../src/logging/index.js';
import type { McpToolRequest, ConvertedPrompt } from '../../../src/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createMockRequest = (command: string = '>>test_prompt'): McpToolRequest => ({
  tool: 'prompt_engine' as const,
  command,
  args: {},
});

const createAutoApproveToolFixture = (id: string): LoadedScriptTool => ({
  id,
  name: `Auto Approve Tool: ${id}`,
  description: 'Tool with autoApproveOnValid enabled',
  scriptPath: 'script.py',
  runtime: 'python',
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Input data' },
    },
    required: ['data'],
  },
  toolDir: `/tools/${id}`,
  absoluteScriptPath: `/tools/${id}/script.py`,
  promptId: 'test_prompt',
  enabled: true,
  execution: {
    trigger: 'schema_match',
    confirm: true,
    autoApproveOnValid: true,
  },
});

const createNormalConfirmToolFixture = (id: string): LoadedScriptTool => ({
  id,
  name: `Normal Confirm Tool: ${id}`,
  description: 'Tool requiring manual confirmation',
  scriptPath: 'script.py',
  runtime: 'python',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' },
    },
    required: ['input'],
  },
  toolDir: `/tools/${id}`,
  absoluteScriptPath: `/tools/${id}/script.py`,
  promptId: 'test_prompt',
  enabled: true,
  execution: {
    trigger: 'schema_match',
    confirm: true,
    // Note: autoApproveOnValid NOT set
  },
});

describe('Script Auto-Approve Flow Integration', () => {
  let logger: Logger;
  let toolDetectionService: ToolDetectionService;
  let executionModeService: ExecutionModeService;
  let mockScriptExecutor: jest.Mocked<ScriptExecutor>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultPendingConfirmationTracker();
    logger = createLogger();

    // Use REAL services - not mocks
    toolDetectionService = new ToolDetectionService();
    executionModeService = new ExecutionModeService();

    // Only mock the I/O boundary (ScriptExecutor)
    mockScriptExecutor = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ScriptExecutor>;
  });

  describe('autoApproveOnValid Flow', () => {
    test('valid output triggers auto-approve and sets context state correctly', async () => {
      // Arrange
      const stage = new ScriptExecutionStage(
        mockScriptExecutor,
        toolDetectionService,
        executionModeService,
        logger
      );

      const autoApproveTool = createAutoApproveToolFixture('validator');
      const prompt: ConvertedPrompt = {
        id: 'test_prompt',
        name: 'Test Prompt',
        description: 'Test',
        category: 'general',
        userMessageTemplate: 'Test {{data}}',
        arguments: [{ name: 'data', description: 'Input', required: true, type: 'string' }],
        scriptTools: [autoApproveTool],
      };

      // Mock executor returns valid output
      const validResult: ScriptExecutionResult = {
        success: true,
        toolId: 'validator',
        exitCode: 0,
        durationMs: 50,
        output: {
          valid: true,
          auto_execute: { tool: 'resource_manager', params: { action: 'create' } },
        },
      };
      mockScriptExecutor.execute.mockResolvedValue(validResult);

      const context = new ExecutionContext(createMockRequest());
      context.parsedCommand = {
        promptId: 'test_prompt',
        rawArgs: 'data:"test value"',
        format: 'symbolic',
        confidence: 0.9,
        convertedPrompt: prompt,
        metadata: {
          originalCommand: '>>test_prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };
      context.parsedCommand.promptArgs = { data: 'test value' };

      // Act
      await stage.execute(context);

      // Assert: autoApprovedTools populated, no confirmationRequired
      expect(context.state.scripts?.autoApprovedTools).toContain('validator');
      expect(context.state.scripts?.confirmationRequired).toBeUndefined();
      expect(context.state.scripts?.validationErrors).toBeUndefined();
      expect(mockScriptExecutor.execute).toHaveBeenCalledTimes(1);
    });

    test('invalid output blocks execution with proper error state', async () => {
      // Arrange
      const stage = new ScriptExecutionStage(
        mockScriptExecutor,
        toolDetectionService,
        executionModeService,
        logger
      );

      const autoApproveTool = createAutoApproveToolFixture('validator');
      const prompt: ConvertedPrompt = {
        id: 'test_prompt',
        name: 'Test Prompt',
        description: 'Test',
        category: 'general',
        userMessageTemplate: 'Test {{data}}',
        arguments: [{ name: 'data', description: 'Input', required: true, type: 'string' }],
        scriptTools: [autoApproveTool],
      };

      // Mock executor returns invalid output
      const invalidResult: ScriptExecutionResult = {
        success: true,
        toolId: 'validator',
        exitCode: 0,
        durationMs: 50,
        output: {
          valid: false,
          errors: ['Missing required field: name', 'Invalid format for description'],
        },
      };
      mockScriptExecutor.execute.mockResolvedValue(invalidResult);

      const context = new ExecutionContext(createMockRequest());
      context.parsedCommand = {
        promptId: 'test_prompt',
        rawArgs: 'data:"test value"',
        format: 'symbolic',
        confidence: 0.9,
        convertedPrompt: prompt,
        metadata: {
          originalCommand: '>>test_prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };
      context.parsedCommand.promptArgs = { data: 'test value' };

      // Act
      await stage.execute(context);

      // Assert: validationErrors populated, tool NOT in autoApprovedTools
      expect(context.state.scripts?.validationErrors).toContain('Missing required field: name');
      expect(context.state.scripts?.validationErrors).toContain('Invalid format for description');
      expect(context.state.scripts?.autoApprovedTools).toBeUndefined();
      expect(mockScriptExecutor.execute).toHaveBeenCalledTimes(1);
    });

    test('valid with warnings auto-approves but preserves warnings', async () => {
      // Arrange
      const stage = new ScriptExecutionStage(
        mockScriptExecutor,
        toolDetectionService,
        executionModeService,
        logger
      );

      const autoApproveTool = createAutoApproveToolFixture('validator');
      const prompt: ConvertedPrompt = {
        id: 'test_prompt',
        name: 'Test Prompt',
        description: 'Test',
        category: 'general',
        userMessageTemplate: 'Test {{data}}',
        arguments: [{ name: 'data', description: 'Input', required: true, type: 'string' }],
        scriptTools: [autoApproveTool],
      };

      // Mock executor returns valid output with warnings
      const warningResult: ScriptExecutionResult = {
        success: true,
        toolId: 'validator',
        exitCode: 0,
        durationMs: 50,
        output: {
          valid: true,
          warnings: ['Field "description" is empty', 'Consider adding more detail'],
          auto_execute: { tool: 'resource_manager', params: { action: 'create' } },
        },
      };
      mockScriptExecutor.execute.mockResolvedValue(warningResult);

      const context = new ExecutionContext(createMockRequest());
      context.parsedCommand = {
        promptId: 'test_prompt',
        rawArgs: 'data:"test value"',
        format: 'symbolic',
        confidence: 0.9,
        convertedPrompt: prompt,
        metadata: {
          originalCommand: '>>test_prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };
      context.parsedCommand.promptArgs = { data: 'test value' };

      // Act
      await stage.execute(context);

      // Assert: autoApprovedTools populated AND validationWarnings set
      expect(context.state.scripts?.autoApprovedTools).toContain('validator');
      expect(context.state.scripts?.validationWarnings).toContain('Field "description" is empty');
      expect(context.state.scripts?.validationWarnings).toContain('Consider adding more detail');
      expect(context.state.scripts?.validationErrors).toBeUndefined();
    });

    test('mixed tools route correctly through different flows', async () => {
      // Arrange
      const stage = new ScriptExecutionStage(
        mockScriptExecutor,
        toolDetectionService,
        executionModeService,
        logger
      );

      const autoApproveTool = createAutoApproveToolFixture('auto_validator');
      const normalTool = createNormalConfirmToolFixture('normal_tool');
      const prompt: ConvertedPrompt = {
        id: 'test_prompt',
        name: 'Test Prompt',
        description: 'Test',
        category: 'general',
        userMessageTemplate: 'Test {{data}} {{input}}',
        arguments: [
          { name: 'data', description: 'Data input', required: true, type: 'string' },
          { name: 'input', description: 'Other input', required: true, type: 'string' },
        ],
        scriptTools: [autoApproveTool, normalTool],
      };

      // Mock executor - only called for autoApproveOnValid tool
      const validResult: ScriptExecutionResult = {
        success: true,
        toolId: 'auto_validator',
        exitCode: 0,
        durationMs: 50,
        output: { valid: true },
      };
      mockScriptExecutor.execute.mockResolvedValue(validResult);

      const context = new ExecutionContext(createMockRequest());
      context.parsedCommand = {
        promptId: 'test_prompt',
        rawArgs: 'data:"test" input:"value"',
        format: 'symbolic',
        confidence: 0.9,
        convertedPrompt: prompt,
        metadata: {
          originalCommand: '>>test_prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };
      context.parsedCommand.promptArgs = { data: 'test', input: 'value' };

      // Act
      await stage.execute(context);

      // Assert: autoApprove tool processed, normal tool goes to confirmation
      expect(context.state.scripts?.autoApprovedTools).toContain('auto_validator');
      expect(context.state.scripts?.toolsPendingConfirmation).toContain('normal_tool');

      // Executor called only for autoApproveOnValid tool (normal tool waits for confirmation)
      expect(mockScriptExecutor.execute).toHaveBeenCalledTimes(1);
      expect(mockScriptExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ toolId: 'auto_validator' }),
        expect.objectContaining({ id: 'auto_validator' })
      );
    });
  });
});
