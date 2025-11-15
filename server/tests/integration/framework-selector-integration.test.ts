import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createConsolidatedPromptEngine } from '../../dist/mcp-tools/prompt-engine/index.js';
import { MockLogger, MockMcpServer, cleanupPromptEngine } from '../helpers/test-helpers.js';

const contentAnalysisPrompt = {
  id: 'content_analysis',
  name: 'Content Analysis',
  description: 'Analyze supplied content',
  category: 'analysis',
  systemMessage:
    'You are a content analysis expert. Follow the provided framework to systematically break down and analyze the given content.',
  userMessageTemplate: 'Perform a comprehensive content analysis of the following material:\n\n{{content}}',
  arguments: [
    {
      name: 'content',
      type: 'string',
      description: 'Content to analyze',
    },
  ],
};

const queryRefinementPrompt = {
  id: 'query_refinement',
  name: 'Query Refinement',
  description: 'Refine a search query based on previous analysis',
  category: 'analysis',
  systemMessage: 'You specialise in transforming prior findings into better search queries.',
  userMessageTemplate:
    'Refine the search query using the previous findings:\n\nPrevious findings:\n{{previous_step_output}}\n\nInitial query: {{query}}',
  arguments: [
    {
      name: 'query',
      type: 'string',
      description: 'Initial query to refine',
    },
  ],
};

describe('Symbolic framework selector integration', () => {
  let logger: MockLogger;
  let mockMcpServer: MockMcpServer;
  let promptEngine: any;
  let switchFrameworkMock: jest.Mock<Promise<boolean>, [any]>;
  let getActiveFrameworkMock: jest.Mock<any, []>;
  let isFrameworkSystemEnabledMock: jest.Mock<boolean, []>;
  let frameworkSystemEnabled: boolean;
  let activeFramework: string;

  beforeEach(() => {
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
      {
        id: queryRefinementPrompt.id,
        name: queryRefinementPrompt.name,
        description: queryRefinementPrompt.description,
        category: queryRefinementPrompt.category,
        arguments: queryRefinementPrompt.arguments,
      },
    ];

    const convertedPrompts = [
      {
        ...contentAnalysisPrompt,
        requiresExecution: true,
      },
      {
        ...queryRefinementPrompt,
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

    frameworkSystemEnabled = true;
    activeFramework = 'CAGEERF';
    const availableFrameworks = new Set(['CAGEERF', 'REACT']);

    getActiveFrameworkMock = jest.fn(() => ({
      id: activeFramework,
      name: activeFramework,
      description: `${activeFramework} description`,
      methodology: activeFramework,
      systemPromptTemplate: '',
      executionGuidelines: [],
      applicableTypes: [],
      priority: 1,
      enabled: true,
    }));

    switchFrameworkMock = jest.fn(async ({ targetFramework }: { targetFramework: string }) => {
      if (!availableFrameworks.has(targetFramework)) {
        throw new Error(`Target framework '${targetFramework}' not found`);
      }

      if (!frameworkSystemEnabled) {
        return false;
      }

      activeFramework = targetFramework;
      return true;
    });

    isFrameworkSystemEnabledMock = jest.fn(() => frameworkSystemEnabled);

    const mockFrameworkStateManager = {
      switchFramework: switchFrameworkMock,
      getActiveFramework: getActiveFrameworkMock,
      isFrameworkSystemEnabled: isFrameworkSystemEnabledMock,
    };

    const mockConfigManager = {
      getConfig: () => ({
        server: { name: 'test-server', version: '1.0.0' },
        gates: {
          definitionsDirectory: 'src/gates/definitions',
          templatesDirectory: 'src/gates/templates',
        },
      }),
      getPromptsFilePath: () => '/test/prompts.json',
      getFrameworksConfig: () => ({
        enableSystemPromptInjection: false,
        enableMethodologyGates: false,
        enableDynamicToolDescriptions: false,
      }),
      on: () => {},
    };

    const mockConversationManager = {
      addToConversationHistory: () => {},
      getConversationHistory: () => [],
      saveStepResult: () => {},
      getStepResult: () => null,
      setChainSessionManager: () => {},
      setTextReferenceManager: () => {},
      setChainState: () => {},
    };

    const mockTextReferenceManager = {
      extractReferences: () => [],
      resolveReferences: () => {},
      addReference: () => {},
      storeChainStepResult: () => {},
      buildChainVariables: () => ({}),
      getChainStepMetadata: () => null,
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

    promptEngine.setFrameworkManager(mockFrameworkManager as any);
    promptEngine.setFrameworkStateManager(mockFrameworkStateManager as any);

    promptEngine.updateData(promptsData as any, convertedPrompts as any);
  });

  afterEach(async () => {
    // Cleanup prompt engine to prevent async handle leaks
    if (promptEngine) {
      await cleanupPromptEngine(promptEngine);
    }
    
    logger.clear();
    mockMcpServer.clear();
    switchFrameworkMock.mockClear();
    getActiveFrameworkMock.mockClear();
    isFrameworkSystemEnabledMock.mockClear();
  });

  test('applies and restores framework override on each invocation', async () => {
    const command = '@ReACT >>content_analysis content="sample" --> query_refinement query="improve"';

    const first = await promptEngine.executePromptCommand({ command }, {});
    expect(first.isError).toBeFalsy();
    expect(first.content[0].text).toContain('Session ID:');

    expect(switchFrameworkMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      targetFramework: 'REACT',
      reason: 'Symbolic command framework override',
    }));
    expect(switchFrameworkMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      targetFramework: 'CAGEERF',
      reason: 'Restoring framework after symbolic execution',
    }));

    const second = await promptEngine.executePromptCommand({ command }, {});
    expect(second.isError).toBeFalsy();
    expect(second.content[0].text).toContain('✓ Chain complete');

    expect(switchFrameworkMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ targetFramework: 'REACT' }));
    expect(switchFrameworkMock).toHaveBeenNthCalledWith(4, expect.objectContaining({ targetFramework: 'CAGEERF' }));
  });

  test('fails when framework system is disabled', async () => {
    frameworkSystemEnabled = false;
    const command = '@ReACT >>content_analysis content="sample"';

    await expect(promptEngine.executePromptCommand({ command }, {})).rejects.toThrow(
      'Framework overrides are disabled',
    );

    expect(switchFrameworkMock).not.toHaveBeenCalled();
  });

  test('surfaces invalid framework errors from state manager', async () => {
    const command = '@Unknown >>content_analysis content="sample"';

    await expect(promptEngine.executePromptCommand({ command }, {})).rejects.toThrow(
      "Unable to apply '@Unknown' framework override",
    );

    expect(switchFrameworkMock).toHaveBeenCalledTimes(1);
    const [[callArgs]] = switchFrameworkMock.mock.calls;
    expect(callArgs.targetFramework).toBe('UNKNOWN');
  });
});
