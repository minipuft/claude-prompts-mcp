#!/usr/bin/env node
/**
 * Enhanced MCP Server Integration Tests
 * Replaces complex inline scripts from GitHub Actions with proper test script
 */

async function enhancedIntegrationTests() {
  try {
    console.log('🧪 Running enhanced MCP server integration tests...');
    
    const { ApplicationOrchestrator } = await import('../../dist/orchestration/index.js');
    const { MockLogger } = await import('../../dist/utils/index.js');
    
    console.log('🔍 Test 1: Full server initialization sequence');
    
    const logger = new MockLogger();
    const orchestrator = new ApplicationOrchestrator(logger);
    
    await orchestrator.loadConfiguration();
    if (!orchestrator.config) {
      throw new Error('Configuration not loaded');
    }
    console.log('✅ Configuration loaded successfully');
    
    await orchestrator.loadPromptsData();
    console.log(`✅ Prompts data loaded: ${orchestrator.promptsData ? orchestrator.promptsData.length : 0} prompts`);
    
    await orchestrator.initializeModules();
    if (!orchestrator.mcpToolsManager) {
      throw new Error('MCP tools manager not initialized');
    }
    console.log('✅ Modules initialized successfully');
    
    const healthInfo = await orchestrator.getDiagnosticInfo();
    if (!healthInfo || typeof healthInfo !== 'object') {
      throw new Error('Health diagnostics failed');
    }
    console.log(`✅ Health diagnostics collected: ${Object.keys(healthInfo).length} metrics`);
    
    console.log('🎉 Enhanced integration tests completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Enhanced integration tests failed:', error.message);
    process.exit(1);
  }
}

enhancedIntegrationTests();