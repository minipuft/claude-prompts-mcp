import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { PromptExecutionService } from '../../../../src/mcp-tools/prompt-engine/core/prompt-execution-service.js';

import type { ConfigManager } from '../../../../src/config/index.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { PromptAssetManager } from '../../../../src/prompts/index.js';
import type { ContentAnalyzer as SemanticAnalyzer } from '../../../../src/semantic/configurable-semantic-analyzer.js';
import type { ConversationManager } from '../../../../src/text-references/conversation.js';
import type { TextReferenceManager } from '../../../../src/text-references/index.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const mockPromptManager: PromptAssetManager = {
  loadAndConvertPrompts: jest.fn().mockResolvedValue([]),
  processTemplateAsync: jest.fn().mockResolvedValue('mocked result'),
  convertedPrompts: [],
  promptsData: [],
} as any;

const mockConfigManager: ConfigManager = {
  getConfig: jest.fn().mockReturnValue({
    server: { name: 'test', version: '1.0.0' },
    gates: {},
    frameworks: {},
  }),
  getFrameworksConfig: jest.fn().mockReturnValue({}),
  getChainSessionConfig: jest.fn().mockReturnValue(undefined),
  getServerRoot: jest.fn().mockReturnValue(process.cwd()),
  on: jest.fn(),
  off: jest.fn(),
} as any;

const mockSemanticAnalyzer: SemanticAnalyzer = {
  analyzePrompt: jest.fn().mockResolvedValue({
    executionType: 'prompt',
    requiresExecution: true,
    confidence: 0.8,
  }),
  getConfig: jest.fn().mockReturnValue({
    llmIntegration: { enabled: false },
  }),
} as any;

const mockTextReferenceManager: TextReferenceManager = {
  storeChainStepResult: jest.fn(),
  getChainStepResults: jest.fn().mockReturnValue({}),
  getChainStepResult: jest.fn().mockReturnValue(null),
  getChainStepMetadata: jest.fn().mockReturnValue(null),
  buildChainVariables: jest.fn().mockReturnValue({}),
  clearChainStepResults: jest.fn(),
  getChainStats: jest.fn().mockReturnValue({ totalChains: 0, totalSteps: 0, chainsWithSteps: [] }),
  getStats: jest.fn().mockReturnValue({ totalChains: 0, totalSteps: 0, chainsWithSteps: [] }),
} as any;

const mockConversationManager: ConversationManager = {
  addToConversationHistory: jest.fn(),
  getConversationHistory: jest.fn().mockReturnValue([]),
  getPreviousMessage: jest.fn().mockReturnValue(''),
  clearHistory: jest.fn(),
  getConversationStats: jest.fn().mockReturnValue({
    totalMessages: 0,
    userMessages: 0,
    assistantMessages: 0,
    processedTemplates: 0,
    oldestMessage: undefined,
    newestMessage: undefined,
  }),
} as any;

const mockMcpServer = {
  registerTool: jest.fn(),
  setRequestHandler: jest.fn(),
} as any;

const mockFrameworkManager = {
  generateExecutionContext: jest.fn().mockReturnValue({
    selectedFramework: { methodology: 'CAGEERF', name: 'CAGEERF' },
    systemPrompt: 'Use the CAGEERF methodology',
  }),
  listFrameworks: jest.fn().mockReturnValue([]),
} as any;

const mockFrameworkStateManager = {
  isFrameworkSystemEnabled: jest.fn().mockReturnValue(false),
  getActiveFramework: jest.fn().mockReturnValue({
    methodology: 'CAGEERF',
    name: 'CAGEERF',
  }),
  shutdown: jest.fn(),
} as any;

describe('PromptEngine Validation', () => {
  let engine: PromptExecutionService;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new PromptExecutionService(
      mockLogger,
      mockMcpServer,
      mockPromptManager,
      mockConfigManager,
      mockSemanticAnalyzer,
      mockConversationManager,
      mockTextReferenceManager,
      undefined // mcpToolsManager
    );
  });

  afterEach(async () => {
    if (engine && typeof engine.cleanup === 'function') {
      await engine.cleanup();
    }
  });

  describe('Parameter Validation', () => {
    test('should reject conflicting force_restart and chain_id parameters', async () => {
      const result = await engine.executePromptCommand(
        {
          command: '>>analyze_code test code',
          force_restart: true,
          chain_id: 'chain-analyze_code',
        },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const message = result.content[0];
      expect(message.type).toBe('text');
      expect(message.text).toContain('Conflicting parameters detected');
      expect(message.text).toContain('force_restart=true');
      expect(message.text).toContain('chain_id');
      expect(message.text).toContain('cannot be used together');
    });

    // Note: Positive cases (force_restart alone, chain_id alone, neither)
    // are tested in integration tests via Node.js scripts.
    // These unit tests require extensive mocking that is brittle and low value.
  });

  // Framework manager integration behavior (validation + executor) now covered by dedicated
  // FrameworkValidator/FrameworkResolutionStage tests and future pipeline coverage.
});
