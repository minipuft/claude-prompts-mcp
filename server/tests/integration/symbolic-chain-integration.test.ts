import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createConsolidatedPromptEngine } from '../../dist/mcp-tools/prompt-engine/index.js';
import { MockLogger, MockMcpServer } from '../helpers/test-helpers.js';

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
    }
  ]
};

const queryRefinementPrompt = {
  id: 'query_refinement',
  name: 'Query Refinement',
  description: 'Refine a search query based on previous analysis',
  category: 'analysis',
  systemMessage: 'You specialise in transforming prior findings into better search queries.',
  userMessageTemplate: 'Refine the search query using the previous findings:\n\nPrevious findings:\n{{previous_step_output}}\n\nInitial query: {{query}}',
  arguments: [
    {
      name: 'query',
      type: 'string',
      description: 'Initial query to refine',
    }
  ]
};

describe('Symbolic chain execution integration', () => {
  let logger: MockLogger;
  let mockMcpServer: MockMcpServer;
  let promptEngine: any;

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
      }
    ];

    const convertedPrompts = [
      {
        ...contentAnalysisPrompt,
        requiresExecution: true,
      },
      {
        ...queryRefinementPrompt,
        requiresExecution: true,
      }
    ];

    const mockPromptManagerComponent = {
      processTemplateAsync: () => Promise.resolve('mocked template result'),
      convertedPrompts,
      promptsData,
      loadAndConvertPrompts: () => Promise.resolve(convertedPrompts)
    };

    const mockSemanticAnalyzer = {
      analyzePrompt: () => Promise.resolve({
        executionType: 'template',
        requiresExecution: true,
        confidence: 0.8
      }),
      getConfig: () => ({
        llmIntegration: { enabled: false }
      })
    };

    const mockFrameworkManager = {
      getCurrentFramework: () => ({ frameworkId: 'CAGEERF', frameworkName: 'CAGEERF' }),
      generateExecutionContext: () => ({
        systemPrompt: 'test system prompt',
        framework: 'CAGEERF'
      })
    };

    const mockFrameworkStateManager = {
      switchFramework: () => Promise.resolve(),
      getActiveFramework: () => ({ id: 'CAGEERF' }),
      isFrameworkSystemEnabled: () => true
    };

    const mockConfigManager = {
      getConfig: () => ({
        server: { name: 'test-server', version: '1.0.0' },
        gates: { definitionsDirectory: 'src/gates/definitions', templatesDirectory: 'src/gates/templates' }
      }),
      getPromptsFilePath: () => '/test/prompts.json',
      getFrameworksConfig: () => ({
        enableSystemPromptInjection: false,
        enableMethodologyGates: false,
        enableDynamicToolDescriptions: false
      }),
      on: () => {}
    };

    const mockConversationManager = {
      addToConversationHistory: () => {},
      getConversationHistory: () => [],
      saveStepResult: () => {},
      getStepResult: () => null,
      setChainSessionManager: () => {},
      setTextReferenceManager: () => {}
    };

    const mockTextReferenceManager = {
      extractReferences: () => [],
      resolveReferences: () => {},
      addReference: () => {},
      storeChainStepResult: () => {},
      buildChainVariables: () => ({})
    };

    const mockMcpToolsManager = {
      initialize: () => {},
      getTools: () => [],
      promptManagerTool: { handleAction: () => Promise.resolve({ content: [], isError: false }) },
      systemControl: { handleAction: () => Promise.resolve({ content: [], isError: false }) }
    };

    promptEngine = createConsolidatedPromptEngine(
      logger,
      mockMcpServer as any,
      mockPromptManagerComponent as any,
      mockConfigManager as any,
      mockSemanticAnalyzer as any,
      mockConversationManager as any,
      mockTextReferenceManager as any,
      mockMcpToolsManager
    );

    promptEngine.setFrameworkManager(mockFrameworkManager as any);
    promptEngine.setFrameworkStateManager(mockFrameworkStateManager as any);

    // Ensure prompt data used by symbolic parser matches our fixtures
    promptEngine.updateData(promptsData as any, convertedPrompts as any);
  });

  afterEach(() => {
    logger.clear();
    mockMcpServer.clear();
  });

  test('executes symbolic chain across multiple invocations', async () => {
    const command = '>>content_analysis content="sample content" --> query_refinement query="improve results"';

    const first = await promptEngine.executePromptCommand({ command }, {});
    expect(first.isError).toBeFalsy();
    expect(first.content).toHaveLength(1);

    const firstText = first.content[0].text;
    expect(firstText).toContain('sample content');
    expect(firstText).toContain('Session ID:');
    expect(firstText).toContain('Chain ID:');
    expect(firstText).toContain('→ Run the same command to continue with Step 2');

    const sessionMatch = firstText.match(/Session ID: ([^\n]+)/);
    expect(sessionMatch).not.toBeNull();
    const sessionId = sessionMatch ? sessionMatch[1] : '';

    const second = await promptEngine.executePromptCommand({ command }, {});
    expect(second.isError).toBeFalsy();
    expect(second.content).toHaveLength(1);

    const secondText = second.content[0].text;
    expect(secondText).toContain('improve results');
    expect(secondText).toContain(`Session ID: ${sessionId}`);
    expect(secondText).toContain('✓ Chain complete (2/2).');
  });
});
