import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  cleanupPromptExecutionService,
  createPromptExecutionService,
} from '../../../src/mcp-tools/prompt-engine/index.js';
import { createConsolidatedPromptManager } from '../../../src/mcp-tools/prompt-manager/index.js';
import { createConsolidatedSystemControl } from '../../../src/mcp-tools/system-control.js';
import { MockLogger, MockMcpServer, testPrompts } from '../../helpers/test-helpers.js';

import type { GateManager } from '../../../src/gates/gate-manager.js';

describe('Consolidated MCP tool factories', () => {
  let logger: MockLogger;
  let mockMcpServer: MockMcpServer;
  let promptEngine: any;
  let promptManager: any;
  let systemControl: any;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new MockLogger();
    mockMcpServer = new MockMcpServer();

    const mockPromptManagerComponent = {
      processTemplateAsync: () => Promise.resolve('mocked template result'),
      convertedPrompts: [testPrompts.simple],
      promptsData: [testPrompts.simple],
      loadAndConvertPrompts: () => Promise.resolve([testPrompts.simple]),
    };

    const mockSemanticAnalyzer = {
      analyzePrompt: () =>
        Promise.resolve({
          executionType: 'template',
          requiresExecution: true,
          confidence: 0.8,
        }),
      getConfig: () => ({
        llmIntegration: { enabled: false },
      }),
    };

    const mockFrameworkManager = {
      getCurrentFramework: () => ({ frameworkId: 'CAGEERF', frameworkName: 'CAGEERF' }),
      generateExecutionContext: () => ({
        systemPrompt: 'test system prompt',
        framework: 'CAGEERF',
      }),
    };

    const mockConfigManager = {
      getConfig: () => ({
        server: { name: 'test-server', version: '1.0.0' },
        gates: {
          definitionsDirectory: 'gates',
        },
      }),
      getPromptsFilePath: () => '/test/prompts.json',
      getPromptsDirectory: () => '/test/prompts',
      getFrameworksConfig: () => ({
        enableSystemPromptInjection: false,
        enableMethodologyGates: false,
        enableDynamicToolDescriptions: false,
      }),
      getServerRoot: () => process.cwd(),
      getVersioningConfig: () => ({
        enabled: true,
        max_versions: 50,
        auto_version: true,
      }),
      on: () => {},
    };

    const mockConversationManager = {
      addToConversationHistory: () => {},
      getConversationHistory: () => [],
      getPreviousMessage: () => '',
      clearHistory: () => {},
      getConversationStats: () => ({
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        processedTemplates: 0,
        oldestMessage: undefined,
        newestMessage: undefined,
      }),
    };

    const mockTextReferenceManager = {
      storeChainStepResult: () => {},
      getChainStepResults: () => ({}),
      getChainStepResult: () => null,
      getChainStepMetadata: () => null,
      buildChainVariables: () => ({}),
      clearChainStepResults: () => {},
      getChainStats: () => ({ totalChains: 0, totalSteps: 0, chainsWithSteps: [] }),
      getStats: () => ({ totalChains: 0, totalSteps: 0, chainsWithSteps: [] }),
    };

    const mockMcpToolsManager = {
      initialize: () => {},
      getTools: () => [],
      promptManagerTool: { handleAction: () => Promise.resolve({ content: [], isError: false }) },
      systemControl: { handleAction: () => Promise.resolve({ content: [], isError: false }) },
    };

    const stubGateManager: GateManager = {
      getGate: () => undefined,
      getActiveGates: () => [],
      listGates: () => [],
      getRegistryStats: () => ({
        totalGates: 0,
        enabledGates: 0,
        builtInGates: 0,
        customGates: 0,
        bySource: { 'yaml-runtime': 0, custom: 0, temporary: 0 },
        byType: { validation: 0, guidance: 0 },
        averageLoadTime: 0,
      }),
    } as unknown as GateManager;

    promptEngine = createPromptExecutionService(
      logger as any,
      mockMcpServer as any,
      mockPromptManagerComponent as any,
      mockConfigManager as any,
      mockSemanticAnalyzer as any,
      mockConversationManager as any,
      mockTextReferenceManager as any,
      stubGateManager,
      mockMcpToolsManager
    );

    promptManager = createConsolidatedPromptManager(
      logger as any,
      mockMcpServer as any,
      mockConfigManager as any,
      mockSemanticAnalyzer as any,
      undefined,
      mockFrameworkManager as any,
      () => Promise.resolve(),
      () => Promise.resolve()
    );

    systemControl = createConsolidatedSystemControl(logger as any, mockMcpServer as any, () =>
      Promise.resolve()
    );
  });

  afterEach(async () => {
    if (promptEngine) {
      await cleanupPromptExecutionService(promptEngine);
    }
    logger.clear();
    mockMcpServer.clear();
  });

  test('creates prompt execution service with executePromptCommand method', () => {
    expect(promptEngine).toBeDefined();
    expect(typeof promptEngine.executePromptCommand).toBe('function');
  });

  test('creates consolidated prompt manager with handleAction', () => {
    expect(promptManager).toBeDefined();
    expect(typeof promptManager.handleAction).toBe('function');
  });

  test('creates consolidated system control tool', () => {
    expect(systemControl).toBeDefined();
    expect(typeof systemControl.handleAction).toBe('function');
  });

  test('prompt engine rejects conflicting resume parameters', async () => {
    const result = await promptEngine.executePromptCommand(
      {
        command: '>>test-simple',
        force_restart: true,
        chain_id: 'chain-demo',
      },
      {}
    );

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const message = result.content[0];
    if (message.type !== 'text') {
      throw new Error('Expected text response');
    }
    expect(message.text).toContain('force_restart=true');
    expect(message.text).toContain('chain_id');
  });
});
