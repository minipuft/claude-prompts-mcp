#!/usr/bin/env node
/**
 * MCP Tools Comprehensive Tests
 * Replaces complex inline scripts from GitHub Actions with proper test script
 */

async function comprehensiveMcpToolsTests() {
  try {
    console.log('🧪 Running comprehensive MCP tools tests...');
    
    const { McpToolsManager } = await import('../../dist/mcp-tools/index.js');
    const { TemplateGenerationTools } = await import('../../dist/mcp-tools/template-generation-tools.js');
    const { MockLogger } = await import('../../dist/utils/index.js');
    
    console.log('🔍 Test 1: MCP Tools Manager functionality');
    
    const toolCalls = [];
    const mockMcpServer = {
      tool: function(name, description, schema) {
        toolCalls.push({ name, description, schema });
        return {
          name,
          handler: async (args) => {
            return {
              content: [{ type: 'text', text: `Mock response for ${name}` }]
            };
          }
        };
      }
    };
    
    const logger = new MockLogger();
    const toolsManager = new McpToolsManager(logger, mockMcpServer, {});
    
    const testPromptsData = [
      {
        id: 'test-1',
        name: 'Test Prompt 1',
        content: 'Test content with context and analysis components',
        description: 'Test prompt description'
      }
    ];
    
    const testConvertedPrompts = [
      {
        id: 'test-1',
        name: 'Test Prompt 1',
        content: 'Test content',
        description: 'Test description',
        category: 'test',
        executionMode: 'template'
      }
    ];
    
    const testCategories = [
      { name: 'test', description: 'Test category' }
    ];
    
    toolsManager.updateData(testPromptsData, testConvertedPrompts, testCategories);
    toolsManager.registerAllTools();
    
    if (toolCalls.length === 0) {
      throw new Error('No tools were registered');
    }
    console.log(`✅ MCP Tools Manager registered ${toolCalls.length} tools`);
    
    const registeredNames = toolCalls.map(t => t.name);
    const essentialTools = ['update_prompt', 'list_prompts', 'execute_prompt'];
    
    for (const tool of essentialTools) {
      if (!registeredNames.includes(tool)) {
        console.log(`⚠️  Essential tool missing: ${tool}`);
      } else {
        console.log(`✅ Essential tool found: ${tool}`);
      }
    }
    
    console.log('🔍 Test 2: Template Generation Tools validation');
    const templateTools = new TemplateGenerationTools(logger, mockMcpServer);
    const beforeCount = toolCalls.length;
    
    templateTools.registerAllTools();
    const templateToolsCount = toolCalls.length - beforeCount;
    
    if (templateToolsCount === 0) {
      throw new Error('No template generation tools were registered');
    }
    console.log(`✅ Template Generation Tools registered ${templateToolsCount} additional tools`);
    
    console.log('🎉 Comprehensive MCP tools tests completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ MCP tools tests failed:', error.message);
    process.exit(1);
  }
}

comprehensiveMcpToolsTests();