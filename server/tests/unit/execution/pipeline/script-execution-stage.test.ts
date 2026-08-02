import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ScriptExecutionStage } from '../../../../src/engine/execution/pipeline/stages/08-script-execution-stage.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ToolDetectionService } from '../../../../src/modules/automation/detection/tool-detection-service.js';
import type { ToolTriggerFilter } from '../../../../src/modules/automation/execution/tool-trigger-filter.js';
import type { ScriptExecutor } from '../../../../src/modules/automation/execution/script-executor.js';
import type {
  LoadedScriptTool,
  ScriptExecutionResult,
  ToolDetectionMatch,
  ToolTriggerFilterResult,
} from '../../../../src/modules/automation/types.js';

const createLogger = (): Logger =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as Logger;

const createBaseTool = (id: string, overrides?: Partial<LoadedScriptTool>): LoadedScriptTool => ({
  id,
  name: `Tool ${id}`,
  description: `Description for ${id}`,
  scriptPath: 'script.py',
  runtime: 'python',
  inputSchema: { type: 'object', properties: {} },
  toolDir: `/path/to/tools/${id}`,
  absoluteScriptPath: `/path/to/tools/${id}/script.py`,
  promptId: 'test-prompt',
  descriptionContent: 'Test tool',
  ...overrides,
});

const createToolMatch = (
  toolId: string,
  overrides?: Partial<ToolDetectionMatch>
): ToolDetectionMatch => ({
  toolId,
  promptId: 'test-prompt',
  priority: 0.9,
  matchReason: 'schema_match',
  extractedInputs: {},
  ...overrides,
});

const createExecutionResult = (
  overrides?: Partial<ScriptExecutionResult>
): ScriptExecutionResult => ({
  success: true,
  output: { valid: true },
  stdout: '{"valid": true}',
  stderr: '',
  exitCode: 0,
  durationMs: 100,
  ...overrides,
});

describe('ScriptExecutionStage', () => {
  let scriptExecutor: jest.Mocked<ScriptExecutor>;
  let toolDetectionService: jest.Mocked<ToolDetectionService>;
  let toolTriggerFilter: jest.Mocked<ToolTriggerFilter>;
  let stage: ScriptExecutionStage;

  beforeEach(() => {
    scriptExecutor = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ScriptExecutor>;

    toolDetectionService = {
      detectTools: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ToolDetectionService>;

    toolTriggerFilter = {
      filterByTrigger: jest.fn().mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      } satisfies ToolTriggerFilterResult),
      buildConfirmationResponse: jest.fn(),
      logManualOverride: jest.fn(),
    } as unknown as jest.Mocked<ToolTriggerFilter>;

    stage = new ScriptExecutionStage(
      scriptExecutor,
      toolDetectionService,
      toolTriggerFilter,
      createLogger()
    );
  });

  describe('execute', () => {
    test('skips when no script tools available', async () => {
      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      await stage.execute(context);

      expect(toolDetectionService.detectTools).not.toHaveBeenCalled();
      expect(context.state.scripts).toBeUndefined();
    });

    test('skips when no tools match', async () => {
      const tool = createBaseTool('my-tool');
      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([]);

      await stage.execute(context);

      expect(toolDetectionService.detectTools).toHaveBeenCalled();
      expect(context.state.scripts).toBeUndefined();
    });
  });

  describe('autoApproveOnValid flow', () => {
    test('auto-approves tool when validation passes', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue(createExecutionResult({ output: { valid: true } }));
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      expect(scriptExecutor.execute).toHaveBeenCalledTimes(1);
      expect(context.state.scripts?.autoApprovedTools).toContain('validator');
      expect(context.state.scripts?.validationErrors).toBeUndefined();
    });

    test('auto-approves with warnings when validation passes with warnings', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue(
        createExecutionResult({
          output: { valid: true, warnings: ['Consider adding more detail'] },
        })
      );
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      expect(context.state.scripts?.autoApprovedTools).toContain('validator');
      expect(context.state.scripts?.validationWarnings).toContain('Consider adding more detail');
      expect(context.state.scripts?.validationErrors).toBeUndefined();
    });

    test('blocks execution when validation fails', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue(
        createExecutionResult({
          output: { valid: false, errors: ['Missing required field: name'] },
        })
      );
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      // autoApprovedTools is not set when no tools were approved
      expect(context.state.scripts?.autoApprovedTools).toBeUndefined();
      expect(context.state.scripts?.validationErrors).toContain('Missing required field: name');
    });

    test('blocks execution when script execution fails', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue(
        createExecutionResult({
          success: false,
          exitCode: 1,
          error: 'Script crashed',
          output: null,
        })
      );
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      // autoApprovedTools is not set when no tools were approved
      expect(context.state.scripts?.autoApprovedTools).toBeUndefined();
      expect(context.state.scripts?.validationErrors).toContain('Script crashed');
    });

    test('blocks when script returns non-JSON output', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue(
        createExecutionResult({
          success: true,
          output: 'plain text output',
        })
      );
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      // autoApprovedTools is not set when no tools were approved
      expect(context.state.scripts?.autoApprovedTools).toBeUndefined();
      expect(context.state.scripts?.validationErrors).toContain(
        'Script did not return valid JSON output'
      );
    });

    test('separates autoApprove tools from normal confirmation flow', async () => {
      const autoApproveTool = createBaseTool('auto-tool', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const normalTool = createBaseTool('normal-tool', {
        execution: { trigger: 'schema_match', confirm: true },
      });

      const autoMatch = createToolMatch('auto-tool');
      const normalMatch = createToolMatch('normal-tool');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [autoApproveTool, normalTool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([autoMatch, normalMatch]);
      scriptExecutor.execute.mockResolvedValue(createExecutionResult({ output: { valid: true } }));
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [
          {
            toolId: 'normal-tool',
            toolName: 'Tool normal-tool',
            message: 'Confirm?',
            resumeCommand: 'tool:normal-tool',
          },
        ],
        requiresConfirmation: true,
      });

      await stage.execute(context);

      // Auto-approve tool was executed and approved
      expect(context.state.scripts?.autoApprovedTools).toContain('auto-tool');
      // Normal tool went through confirmation flow
      expect(context.state.scripts?.toolsPendingConfirmation).toContain('normal-tool');
      // FilterByExecutionMode was called only with normal matches
      expect(toolTriggerFilter.filterByTrigger).toHaveBeenCalledWith(
        [normalMatch],
        expect.any(Array),
        'test'
      );
    });

    test('does not auto-approve tool without autoApproveOnValid flag', async () => {
      const tool = createBaseTool('normal-tool', {
        execution: { trigger: 'schema_match', confirm: true },
      });
      const match = createToolMatch('normal-tool');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [match],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });
      scriptExecutor.execute.mockResolvedValue(createExecutionResult());

      await stage.execute(context);

      // Tool goes through normal flow, not auto-approved
      expect(context.state.scripts?.autoApprovedTools).toBeUndefined();
      expect(toolTriggerFilter.filterByTrigger).toHaveBeenCalled();
    });
  });

  describe('checkValidationOutput', () => {
    test('returns valid: false for execution failure', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue({
        success: false,
        output: null,
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
        durationMs: 50,
        error: 'Process exited with code 1',
      });
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      expect(context.state.scripts?.validationErrors).toContain('Process exited with code 1');
    });

    test('returns valid: false for null output', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue({
        success: true,
        output: null,
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      expect(context.state.scripts?.validationErrors).toContain(
        'Script did not return valid JSON output'
      );
    });

    test('defaults to "Validation failed" error when valid: false without errors', async () => {
      const tool = createBaseTool('validator', {
        execution: { trigger: 'schema_match', confirm: true, autoApproveOnValid: true },
      });
      const match = createToolMatch('validator');

      const context = new ExecutionContext({ command: '>>test' });
      context.parsedCommand = {
        promptId: 'test',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        convertedPrompt: {
          id: 'test',
          name: 'Test',
          description: 'Test prompt',
          category: 'analysis',
          userMessageTemplate: 'Hello',
          arguments: [],
          scriptTools: [tool],
        },
        metadata: {
          originalCommand: '>>test',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      toolDetectionService.detectTools.mockReturnValue([match]);
      scriptExecutor.execute.mockResolvedValue({
        success: true,
        output: { valid: false }, // No errors array
        stdout: '{"valid": false}',
        stderr: '',
        exitCode: 0,
        durationMs: 50,
      });
      toolTriggerFilter.filterByTrigger.mockReturnValue({
        readyForExecution: [],
        skippedManual: [],
        pendingConfirmation: [],
        requiresConfirmation: false,
      });

      await stage.execute(context);

      expect(context.state.scripts?.validationErrors).toContain('Validation failed');
    });
  });
});
