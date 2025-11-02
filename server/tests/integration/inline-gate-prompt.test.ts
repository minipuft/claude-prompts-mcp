import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createConsolidatedPromptEngine } from '../../dist/mcp-tools/prompt-engine/index.js';
import { MockLogger, MockMcpServer, cleanupPromptEngine } from '../helpers/test-helpers.js';

const contentAnalysisPrompt = {
  id: 'content_analysis',
  name: 'Content Analysis',
  description: 'Analyze supplied content',
  category: 'analysis',
  systemMessage: 'You are a content analysis expert. Follow the provided framework to systematically break down and analyze the given content.',
  userMessageTemplate: 'Perform a comprehensive content analysis of the following material:\n\n{{content}}',
  arguments: [
    {
      name: 'content',
      type: 'string',
      description: 'Content to analyze',
      required: true,
    },
  ],
};

describe('Inline gate prompt execution', () => {
  let logger: MockLogger;
  let mockMcpServer: MockMcpServer;
  let promptEngine: any;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new MockLogger();
    mockMcpServer = new MockMcpServer();

    const promptsData = [
      {
        id: contentAnalysisPrompt.id,
        name: contentAnalysisPrompt.name,
        description: contentAnalysisPrompt.description,
        category: contentAnalysisPrompt.category,
        arguments: contentAnalysisPrompt.arguments,
      },
    ];

    const convertedPrompts = [
      {
        ...contentAnalysisPrompt,
        requiresExecution: true,
      },
    ];

    const mockPromptManagerComponent = {
      processTemplateAsync: () => Promise.resolve('mocked template result'),
      convertedPrompts,
      promptsData,
      loadAndConvertPrompts: () => Promise.resolve(convertedPrompts),
    };

    const mockSemanticAnalyzer = {
      analyzePrompt: () =>
        Promise.resolve({
          executionType: 'prompt',
          requiresExecution: true,
          confidence: 0.8,
        }),
      getConfig: () => ({
        llmIntegration: { enabled: false },
      }),
    };

    const mockConfigManager = {
      getConfig: () => ({
        server: { name: 'test-server', version: '1.0.0' },
        gates: { definitionsDirectory: 'src/gates/definitions', templatesDirectory: 'src/gates/templates' },
      }),
      getPromptsFilePath: () => '/test/prompts.json',
      getFrameworksConfig: () => ({
        enableSystemPromptInjection: false,
        enableMethodologyGates: false,
        enableDynamicToolDescriptions: false,
      }),
      on: () => {},
    };

    const chainStepStore: Record<string, Record<number, { content: string; metadata?: any }>> = {};

    const mockTextReferenceManager = {
      extractReferences: () => [],
      resolveReferences: () => {},
      addReference: () => {},
      storeChainStepResult: (chainId: string, stepNumber: number, content: string, metadata?: any) => {
        if (!chainStepStore[chainId]) {
          chainStepStore[chainId] = {};
        }
        chainStepStore[chainId][stepNumber] = { content, metadata };
      },
      getChainStepResult: (chainId: string, stepNumber: number) =>
        chainStepStore[chainId]?.[stepNumber]?.content ?? null,
      getChainStepMetadata: (chainId: string, stepNumber: number) =>
        chainStepStore[chainId]?.[stepNumber]?.metadata ?? null,
      getChainStepResults: (chainId: string) => {
        const store = chainStepStore[chainId];
        if (!store) {
          return {};
        }
        const results: Record<number, string> = {};
        Object.entries(store).forEach(([step, record]) => {
          results[Number(step)] = record.content;
        });
        return results;
      },
      buildChainVariables: (chainId: string) => {
        const results = chainStepStore[chainId] || {};
        const variables: Record<string, any> = { chain_id: chainId, step_results: {} };
        Object.entries(results).forEach(([step, record]) => {
          const stepNumber = Number(step);
          variables.step_results[stepNumber] = record.content;
        });
        return variables;
      },
      clearChainStepResults: (chainId: string) => {
        delete chainStepStore[chainId];
      },
    };

    const mockConversationManager = {
      addToConversationHistory: () => {},
      getConversationHistory: () => [],
      saveStepResult: (chainId: string, stepNumber: number, result: string, isPlaceholder: boolean, metadata?: any) => {
        mockTextReferenceManager.storeChainStepResult(chainId, stepNumber, result, {
          ...(metadata || {}),
          isPlaceholder,
        });
      },
      getStepResult: (chainId: string, stepNumber: number) =>
        mockTextReferenceManager.getChainStepResult(chainId, stepNumber),
      setChainSessionManager: () => {},
      setTextReferenceManager: () => {},
      setChainState: () => {},
      getChainState: () => null,
    };

    const mockMcpToolsManager = {
      initialize: () => {},
      getTools: () => [],
      promptManagerTool: { handleAction: () => Promise.resolve({ content: [], isError: false }) },
      systemControl: { handleAction: () => Promise.resolve({ content: [], isError: false }) },
    };

    promptEngine = createConsolidatedPromptEngine(
      logger,
      mockMcpServer as any,
      mockPromptManagerComponent as any,
      mockConfigManager as any,
      mockSemanticAnalyzer as any,
      mockConversationManager as any,
      mockTextReferenceManager as any,
      mockMcpToolsManager,
    );

    promptEngine.updateData(promptsData as any, convertedPrompts as any);
  });

  afterEach(async () => {
    // Cleanup prompt engine to prevent async handle leaks
    if (promptEngine) {
      await cleanupPromptEngine(promptEngine);
    }
    
    logger.clear();
    mockMcpServer.clear();
  });

  /**
   * Integration test for inline gate rendering in prompt execution.
   *
   * Phase 3 Architecture Notes:
   * - Inline gates provide guidance only (no active validation yet)
   * - Criteria are rendered as a numbered list for clarity
   * - Validation feedback is disabled until LLM feedback API is available
   * - Footer reminders were removed to keep the primary template output clean
   */
  test('renders inline gate guidance for prompt execution', async () => {
    const command = '>>content_analysis content="sample content" :: "clear, comprehensive"';

    const response = await promptEngine.executePromptCommand({ command }, {});

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('### 🎯 **Inline Quality Criteria** (PRIMARY VALIDATION)');
    expect(text).toContain('Evaluate the output against these criteria:');
    expect(text).toMatch(/1\.\s+clear/);
    expect(text).toMatch(/2\.\s+comprehensive/);
  });
});
