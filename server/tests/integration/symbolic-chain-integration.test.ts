import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createConsolidatedPromptEngine } from '../../src/mcp-tools/prompt-engine/index.js';
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
    const chainStepStore: Record<string, Record<number, { content: string; metadata?: any }>> = {};

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
      getChainStepResult: (chainId: string, stepNumber: number) => {
        return chainStepStore[chainId]?.[stepNumber]?.content ?? null;
      },
      getChainStepMetadata: (chainId: string, stepNumber: number) => {
        return chainStepStore[chainId]?.[stepNumber]?.metadata ?? null;
      },
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
        const results = mockTextReferenceManager.getChainStepResults(chainId);
        const variables: Record<string, any> = { chain_id: chainId, step_results: results };
        Object.entries(results).forEach(([step, content]) => {
          const stepNumber = Number(step);
          variables[`step${stepNumber}_result`] = content;
          variables.previous_step_result = content;
          variables.previous_step_output = content;
          variables.input = content;
        });
        return variables;
      },
      clearChainStepResults: (chainId: string) => {
        delete chainStepStore[chainId];
      }
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
      getChainState: () => null
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

  afterEach(async () => {
    // Cleanup prompt engine to prevent async handle leaks
    if (promptEngine) {
      await cleanupPromptEngine(promptEngine);
    }
    
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

    const assistantOutput = 'Analysis report: sample content reviewed successfully.';
    const second = await promptEngine.executePromptCommand(
      { command },
      { previous_step_output: assistantOutput }
    );
    expect(second.isError).toBeFalsy();
    expect(second.content).toHaveLength(1);

    const secondText = second.content[0].text;
    expect(secondText).toContain('improve results');
    expect(secondText).toContain(assistantOutput);
    expect(secondText).toContain(`Session ID: ${sessionId}`);
    expect(secondText).toContain('✓ Chain complete (2/2).');
  });

  test('evaluates inline gate and reports pass summary', async () => {
    const gateSystem = promptEngine.getLightweightGateSystem();
    const createGateSpy = jest.spyOn(gateSystem, 'createTemporaryGate').mockReturnValue('inline_gate_pass');
    const validateSpy = jest.spyOn(gateSystem, 'validateContent').mockResolvedValue([
      { gateId: 'inline_gate_pass', passed: true, retryHints: [] },
    ]);

    const command = '>>content_analysis content="all criteria satisfied" :: "inline gate criteria"';

    const response = await promptEngine.executePromptCommand({ command }, {});

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('Inline gate passed all criteria.');
    expect(text).toContain('✓ Chain complete (1/1).');

    const structured = response.structuredContent?.gateValidation;
    expect(structured).toBeDefined();
    expect(structured).toMatchObject({
      passed: true,
      retryRequired: false,
      totalGates: 1,
      retryHints: [],
    });

    expect(createGateSpy).toHaveBeenCalled();
    expect(validateSpy).toHaveBeenCalledWith(
      ['inline_gate_pass'],
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ executionId: expect.any(String) }) }),
    );

    createGateSpy.mockRestore();
    validateSpy.mockRestore();
  });

  test('reports inline gate failure with retry recommendation and hints', async () => {
    const gateSystem = promptEngine.getLightweightGateSystem();
    const createGateSpy = jest.spyOn(gateSystem, 'createTemporaryGate').mockReturnValue('inline_gate_fail');
    const validateSpy = jest.spyOn(gateSystem, 'validateContent').mockResolvedValue([
      {
        gateId: 'inline_gate_fail',
        passed: false,
        retryHints: ['add quantitative findings'],
      },
    ]);

    const command = '>>content_analysis content="needs improvement" :: "provide quantitative findings"';

    const response = await promptEngine.executePromptCommand({ command }, {});

    expect(response.isError).toBeFalsy();
    const text = response.content[0].text;
    expect(text).toContain('❌ Inline gate failed 1 criterion. Retry recommended: add quantitative findings');

    const structured = response.structuredContent?.gateValidation;
    expect(structured).toMatchObject({
      passed: false,
      retryRequired: true,
      failedGates: expect.any(Array),
      retryHints: ['add quantitative findings'],
    });

    createGateSpy.mockRestore();
    validateSpy.mockRestore();
  });
});
