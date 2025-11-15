import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { ConsolidatedPromptEngine } from '../../src/mcp-tools/prompt-engine/core/engine.js';
import type { Logger } from '../../src/logging/index.js';
import type { PromptManager } from '../../src/prompts/index.js';
import type { ConfigManager } from '../../src/config/index.js';
import type { SemanticAnalyzer } from '../../src/semantic/index.js';
import type { ConversationManager } from '../../src/execution/conversation.js';
import type { TextReferenceManager } from '../../src/text-references/index.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const mockPromptManager: PromptManager = {
  loadAndConvertPrompts: jest.fn().mockResolvedValue([]),
  processTemplateAsync: jest.fn().mockResolvedValue('mocked result'),
  convertedPrompts: [],
  promptsData: [],
} as any;

const mockConfigManager: ConfigManager = {
  getConfig: jest.fn().mockReturnValue({
    server: { name: 'test', version: '1.0.0' },
    gates: {},
    frameworks: {}
  }),
  getFrameworksConfig: jest.fn().mockReturnValue({}),
} as any;

const mockSemanticAnalyzer: SemanticAnalyzer = {
  analyzePrompt: jest.fn().mockResolvedValue({
    executionType: 'prompt',
    requiresExecution: true,
    confidence: 0.8
  }),
  getConfig: jest.fn().mockReturnValue({
    llmIntegration: { enabled: false }
  })
} as any;

const mockConversationManager: ConversationManager = {
  setChainSessionManager: jest.fn(),
  setTextReferenceManager: jest.fn(),
  setChainState: jest.fn(),
} as any;

const mockTextReferenceManager: TextReferenceManager = {
  saveStepResult: jest.fn(),
  getStepResult: jest.fn(),
  getChainStepMetadata: jest.fn(),
} as any;

const mockMcpServer = {
  registerTool: jest.fn(),
  setRequestHandler: jest.fn(),
} as any;

describe('PromptEngine Validation', () => {
  let engine: ConsolidatedPromptEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ConsolidatedPromptEngine(
      mockLogger,
      mockMcpServer,
      mockPromptManager,
      mockConfigManager,
      mockSemanticAnalyzer,
      mockConversationManager,
      mockTextReferenceManager
    );
  });

  describe('Parameter Validation', () => {
    test('should reject conflicting force_restart and session_id parameters', async () => {
      const result = await engine.executePromptCommand({
        command: '>>analyze_code test code',
        force_restart: true,
        session_id: 'test-session-123'
      }, {});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Conflicting parameters detected');
      expect(result.content[0].text).toContain('force_restart=true');
      expect(result.content[0].text).toContain('session_id');
      expect(result.content[0].text).toContain('cannot be used together');
    });

    test('should allow force_restart without session_id', async () => {
      // Mock the parseAndPrepareExecution to return a simple prompt execution
      jest.spyOn(engine as any, 'parseAndPrepareExecution').mockResolvedValue({
        convertedPrompt: { promptId: 'test', content: 'test content' },
        isChainManagement: false,
        symbolicExecution: null
      });

      // Mock determineExecutionStrategy to avoid complex setup
      jest.spyOn(engine as any, 'determineExecutionStrategy').mockResolvedValue({
        name: 'prompt',
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Success' }],
          isError: false
        })
      });

      const result = await engine.executePromptCommand({
        command: '>>analyze_code test code',
        force_restart: true
      }, {});

      // Should not error due to parameter validation
      expect(result.isError).toBe(false);
    });

    test('should allow session_id without force_restart', async () => {
      // Mock the parseAndPrepareExecution to return a simple prompt execution
      jest.spyOn(engine as any, 'parseAndPrepareExecution').mockResolvedValue({
        convertedPrompt: { promptId: 'test', content: 'test content' },
        isChainManagement: false,
        symbolicExecution: null
      });

      // Mock determineExecutionStrategy to avoid complex setup
      jest.spyOn(engine as any, 'determineExecutionStrategy').mockResolvedValue({
        name: 'prompt',
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Success' }],
          isError: false
        })
      });

      const result = await engine.executePromptCommand({
        command: '>>analyze_code test code',
        session_id: 'test-session-123'
      }, {});

      // Should not error due to parameter validation
      expect(result.isError).toBe(false);
    });

    test('should allow neither force_restart nor session_id', async () => {
      // Mock the parseAndPrepareExecution to return a simple prompt execution
      jest.spyOn(engine as any, 'parseAndPrepareExecution').mockResolvedValue({
        convertedPrompt: { promptId: 'test', content: 'test content' },
        isChainManagement: false,
        symbolicExecution: null
      });

      // Mock determineExecutionStrategy to avoid complex setup
      jest.spyOn(engine as any, 'determineExecutionStrategy').mockResolvedValue({
        name: 'prompt',
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Success' }],
          isError: false
        })
      });

      const result = await engine.executePromptCommand({
        command: '>>analyze_code test code'
      }, {});

      // Should not error due to parameter validation
      expect(result.isError).toBe(false);
    });
  });
});
