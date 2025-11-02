#!/usr/bin/env node
/**
 * Test script for inline gate functionality (Phase 2B)
 */

async function testInlineGate() {
  console.log('🧪 Testing Phase 2B: Inline Gate Functionality\n');

  // Import the engine
  const { createConsolidatedPromptEngine } = await import('./dist/mcp-tools/prompt-engine/index.js');

  // Mock dependencies
  const mockLogger = {
    debug: (...args) => console.log('[DEBUG]', ...args),
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args)
  };

  const mockMcpServer = {
    request: () => Promise.resolve({}),
    notification: () => Promise.resolve(),
    notifications: []
  };

  const promptsData = [{
    id: 'test_api_message_v2',
    name: 'Test API Message V2',
    description: 'Testing API analysis message',
    category: 'testing',
    arguments: [{ name: 'input', type: 'string', description: 'Test input' }]
  }];

  const convertedPrompts = [{
    id: 'test_api_message_v2',
    name: 'Test API Message V2',
    description: 'Testing API analysis message',
    category: 'testing',
    systemMessage: 'You are a test system.',
    userMessageTemplate: 'Analyze: {{input}}',
    requiresExecution: true,
    arguments: [{ name: 'input', type: 'string', description: 'Test input' }]
  }];

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
    getConfig: () => ({ llmIntegration: { enabled: false } }),
    isLLMEnabled: () => false
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
      gates: {
        definitionsDirectory: 'src/gates/definitions',
        templatesDirectory: 'src/gates/templates'
      }
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
    setTextReferenceManager: () => {},
    setChainState: () => {},
    getChainState: () => ({ currentStep: 0, totalSteps: 0 })
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

  const promptEngine = createConsolidatedPromptEngine(
    mockLogger,
    mockMcpServer,
    mockPromptManagerComponent,
    mockConfigManager,
    mockSemanticAnalyzer,
    mockConversationManager,
    mockTextReferenceManager,
    mockMcpToolsManager
  );

  promptEngine.setFrameworkManager(mockFrameworkManager);
  promptEngine.setFrameworkStateManager(mockFrameworkStateManager);
  promptEngine.updateData(promptsData, convertedPrompts);

  // Test 1: Simple inline gate
  console.log('📋 Test 1: Single-step command with inline gate\n');
  const command1 = '>>test_api_message_v2 input="test data" :: "clear, concise"';
  console.log(`Command: ${command1}\n`);

  const result1 = await promptEngine.executePromptCommand({ command: command1 }, {});
  console.log('Result:', result1.content[0].text);
  console.log('\nStructured Content:', JSON.stringify(result1.structuredContent, null, 2));

  console.log('\n' + '='.repeat(80) + '\n');

  console.log('✅ Phase 2B inline gate functionality test complete!');
  process.exit(0);
}

testInlineGate().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
