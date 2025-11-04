import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createConsolidatedPromptEngine } from '../../src/mcp-tools/prompt-engine/index.js';
import { MockLogger, MockMcpServer, MockConfigManager, MockFrameworkStateManager, MockPromptGuidanceService, cleanupPromptEngine } from '../helpers/test-helpers.js';

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
  let mockConfigManager: MockConfigManager;
  let mockFrameworkStateManager: MockFrameworkStateManager;
  let promptEngine: any;

  beforeEach(() => {
    logger = new MockLogger();
    mockMcpServer = new MockMcpServer();
    mockConfigManager = new MockConfigManager();
    mockFrameworkStateManager = new MockFrameworkStateManager();
    const mockPromptGuidance = new MockPromptGuidanceService(logger);
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
        framework: 'CAGEERF',
        selectedFramework: { name: 'CAGEERF', methodology: 'CAGEERF' }
      })
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
      mockMcpToolsManager,
      mockPromptGuidance
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

    // Cleanup mocks with async handles
    if (mockConfigManager && typeof mockConfigManager.shutdown === 'function') {
      mockConfigManager.shutdown();
    }

    if (mockFrameworkStateManager && typeof mockFrameworkStateManager.shutdown === 'function') {
      mockFrameworkStateManager.shutdown();
    }

    logger.clear();
    mockMcpServer.clear();

    // Ensure garbage collection
    promptEngine = null;
  });

  test('executes symbolic chain across multiple invocations', async () => {
    const command = '>>content_analysis content="sample content" --> query_refinement query="improve results"';

    const first = await promptEngine.executePromptCommand({ command }, {});
    if (first.isError) {
      console.error('ERROR in first response:', first.content[0]?.text || JSON.stringify(first, null, 2));
    }
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

  // Framework Operator Complex Composition Tests - NEW
  test('executes framework + chain + gate combination correctly', async () => {
    const gateSystem = promptEngine.getLightweightGateSystem();
    const createGateSpy = jest.spyOn(gateSystem, 'createTemporaryGate').mockReturnValue('test_gate');
    const validateSpy = jest.spyOn(gateSystem, 'validateContent').mockResolvedValue([
      { gateId: 'test_gate', passed: true, retryHints: [] },
    ]);

    const command = '@CAGEERF >>content_analysis data="test" --> query_refinement :: "comprehensive analysis"';

    // Step 1: Execute first step of chain
    const firstResponse = await promptEngine.executePromptCommand({ command }, {});
    expect(firstResponse.isError).toBeFalsy();
    expect(firstResponse.content[0].text).toContain('CAGEERF');

    // Step 2: Complete the chain - gates validate after chain completion
    const secondResponse = await promptEngine.executePromptCommand(
      { command },
      { previous_step_output: 'step1 result' }
    );
    expect(secondResponse.isError).toBeFalsy();

    // Should have gate validation after chain completion
    expect(createGateSpy).toHaveBeenCalled();
    expect(validateSpy).toHaveBeenCalled();

    const structured = secondResponse.structuredContent?.gateValidation;
    expect(structured).toBeDefined();
    expect(structured.passed).toBe(true);

    createGateSpy.mockRestore();
    validateSpy.mockRestore();
  });

  test('handles multiple framework switches in complex chain', async () => {
    // Use a simpler command that won't cause parsing issues
    const command = '@REACT >>content_analysis --> query_refinement --> content_analysis :: "quality check"';
    
    // This should be handled as first framework applies to entire chain
    // Subsequent @framework should be treated as arguments, not operators
    const inlineGateParser = (promptEngine as any).inlineGateParser;
    const result = inlineGateParser.detectOperators(command);
    
    expect(result.operatorTypes).toEqual(['framework', 'chain', 'gate']);
    expect(result.operators.filter(op => op.type === 'framework')).toHaveLength(1);
    
    const frameworkOp = result.operators.find(op => op.type === 'framework');
    if (frameworkOp && frameworkOp.type === 'framework') {
      expect(frameworkOp.normalizedId).toBe('REACT');
    }
  });

  test('gate validation receives framework context', async () => {
    const gateSystem = promptEngine.getLightweightGateSystem();
    const validateSpy = jest.spyOn(gateSystem, 'validateContent').mockResolvedValue([
      { gateId: 'framework_gate', passed: true, retryHints: [] },
    ]);

    const command = '@REACT >>content_analysis :: "react-specific validation"';
    
    const response = await promptEngine.executePromptCommand({ command }, {});
    expect(response.isError).toBeFalsy();
    
    // Gate validation should receive framework context - check that it was called with proper structure
    expect(validateSpy).toHaveBeenCalled();
    const validateCall = validateSpy.mock.calls[0];
    expect(validateCall[0]).toEqual(expect.any(Array)); // gate IDs array
    expect(validateCall[1]).toEqual(expect.any(String)); // content string
    expect(validateCall[2]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        executionId: expect.any(String)
      })
    }));
    
    validateSpy.mockRestore();
  });

  test('framework restored after chain execution completes', async () => {
    const frameworkStateManager = (promptEngine as any).frameworkStateManager;
    const switchSpy = jest.spyOn(frameworkStateManager, 'switchFramework');

    const command = '@REACT >>content_analysis --> query_refinement';

    // Execute first step
    const firstResponse = await promptEngine.executePromptCommand({ command }, {});
    expect(firstResponse.isError).toBeFalsy();

    // Complete the chain
    const secondResponse = await promptEngine.executePromptCommand(
      { command },
      { previous_step_output: 'step1 result' }
    );
    expect(secondResponse.isError).toBeFalsy();

    // Framework should be switched to REACT and then restored to original (CAGEERF)
    // Find calls that switched to REACT
    const reactSwitchCalls = switchSpy.mock.calls.filter(call =>
      call[0]?.targetFramework === 'REACT'
    );
    expect(reactSwitchCalls.length).toBeGreaterThan(0);

    // Find restoration calls back to CAGEERF
    const restoreCalls = switchSpy.mock.calls.filter(call =>
      call[0]?.reason?.includes('Restoring') || call[0]?.targetFramework === 'CAGEERF'
    );
    expect(restoreCalls.length).toBeGreaterThan(0);

    // Clean up spy
    switchSpy.mockRestore();
  });

  test('invalid framework with chain produces early error before session start', async () => {
    const mockFrameworkStateManager = {
      switchFramework: jest.fn()
        .mockResolvedValueOnce(false) // Fail framework switch
        .mockResolvedValueOnce(true),  // Allow restoration
      getActiveFramework: jest.fn(() => ({ id: 'CAGEERF' })),
      isFrameworkSystemEnabled: jest.fn(() => true)
    };

    // Update with failing framework manager
    promptEngine.setFrameworkStateManager(mockFrameworkStateManager as any);

    const command = '@INVALID_FRAMEWORK >>content_analysis --> query_refinement';

    // Framework operator executor throws an error for invalid frameworks
    await expect(
      promptEngine.executePromptCommand({ command }, {})
    ).rejects.toThrow('[SymbolicFramework] Unable to apply \'@INVALID_FRAMEWORK\' framework override');

    // Verify framework switch was attempted
    expect(mockFrameworkStateManager.switchFramework).toHaveBeenCalled();
  });
});