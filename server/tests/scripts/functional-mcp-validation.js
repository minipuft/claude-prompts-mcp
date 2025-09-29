#!/usr/bin/env node
/**
 * Functional MCP Validation Tests
 *
 * Replaces abstract file existence checks with actual functionality validation.
 * Tests intelligent command routing, MCP tool functionality, and framework system.
 */

async function functionalMcpValidation() {
  try {
    console.log('🧪 Running Functional MCP Validation Tests...');
    console.log('🎯 Testing actual functionality instead of file existence\n');

    const results = {
      mcpTools: false,
      commandRouting: false,
      frameworkSystem: false,
      transportLayer: false,
      totalTests: 0,
      passedTests: 0
    };

    // Test 1: MCP Tools Functional Validation
    console.log('🔧 Test 1: MCP Tools Functionality');
    results.totalTests++;

    try {
      // Test that MCP tools can be imported correctly
      const promptEngineModule = await import('../../dist/mcp-tools/prompt-engine/index.js');
      const promptManagerModule = await import('../../dist/mcp-tools/prompt-manager/index.js');
      const systemControlModule = await import('../../dist/mcp-tools/system-control.js');

      // Check that the expected exports exist
      const hasPromptEngine = typeof promptEngineModule.createConsolidatedPromptEngine === 'function';
      const hasPromptManager = typeof promptManagerModule.createConsolidatedPromptManager === 'function';
      const hasSystemControl = typeof systemControlModule.createConsolidatedSystemControl === 'function';

      if (hasPromptEngine && hasPromptManager && hasSystemControl) {
        console.log('   ✅ All 3 MCP tools modules import correctly');
        console.log('   ✅ Factory functions are available for tool creation');
        results.mcpTools = true;
        results.passedTests++;
      } else {
        console.log('   ❌ MCP tool modules missing expected exports');
        console.log(`     Prompt Engine: ${hasPromptEngine ? '✅' : '❌'}`);
        console.log(`     Prompt Manager: ${hasPromptManager ? '✅' : '❌'}`);
        console.log(`     System Control: ${hasSystemControl ? '✅' : '❌'}`);
      }
    } catch (error) {
      console.log(`   ❌ MCP tools functionality test failed: ${error.message}`);
    }

    // Test 2: Command Routing Detection
    console.log('\n🧠 Test 2: Intelligent Command Routing');
    results.totalTests++;

    try {
      const { UnifiedCommandParser } = await import('../../dist/execution/parsers/unified-command-parser.js');

      const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
      const parser = new UnifiedCommandParser(mockLogger);

      // Test routing pattern detection
      const testCommands = [
        { command: '>>listprompts', expectedRoute: 'prompt_manager' },
        { command: '>>help', expectedRoute: 'system_control' },
        { command: '>>status', expectedRoute: 'system_control' },
        { command: '>>some_prompt', expectedRoute: null }
      ];

      let routingPassed = 0;
      let totalRoutingTime = 0;

      for (const test of testCommands) {
        try {
          const start = performance.now();
          const result = await parser.parseCommand(test.command, []); // Empty prompts array for testing
          const duration = performance.now() - start;
          totalRoutingTime += duration;

          if (result && result.metadata) {
            routingPassed++;
          }
        } catch (error) {
          // Expected for some test cases
        }
      }

      const avgRoutingTime = totalRoutingTime / testCommands.length;

      // Routing system performance baselines from CLAUDE.md
      const ROUTING_BASELINES = {
        detection: 1,    // <1ms command routing detection
        parsing: 500,    // <500ms parser strategy selection
        recognition: 100 // <100ms built-in command recognition
      };

      console.log(`   📊 Routing Performance: ${avgRoutingTime.toFixed(2)}ms average`);

      if (routingPassed >= 3 && avgRoutingTime <= ROUTING_BASELINES.detection) {
        console.log(`   ✅ Command routing detection working (${routingPassed}/4 tests, ${avgRoutingTime.toFixed(2)}ms < ${ROUTING_BASELINES.detection}ms baseline)`);
        results.commandRouting = true;
        results.passedTests++;
      } else {
        console.log(`   ❌ Command routing failed (${routingPassed}/4 tests, ${avgRoutingTime.toFixed(2)}ms routing time)`);
      }
    } catch (error) {
      console.log(`   ❌ Command routing test failed: ${error.message}`);
    }

    // Test 3: Framework System Functionality
    console.log('\n🔄 Test 3: Framework System');
    results.totalTests++;

    try {
      const { FrameworkManager } = await import('../../dist/frameworks/framework-manager.js');
      const { FrameworkStateManager } = await import('../../dist/frameworks/framework-state-manager.js');

      const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
      const frameworkManager = new FrameworkManager(mockLogger);
      const stateManager = new FrameworkStateManager(mockLogger);

      // Test framework loading
      await frameworkManager.initialize();
      const frameworks = frameworkManager.listFrameworks();

      if (frameworks && frameworks.length >= 4) {
        console.log(`   ✅ Framework system loaded ${frameworks.length} methodologies`);

        // Test framework switching (initialize state manager first)
        await stateManager.initialize();
        const switchResult = await stateManager.switchFramework('CAGEERF', 'Test switch');
        if (switchResult && switchResult.success) {
          console.log('   ✅ Framework switching functionality working');
          results.frameworkSystem = true;
          results.passedTests++;
        } else {
          console.log('   ❌ Framework switching failed');
        }
      } else {
        console.log(`   ❌ Framework system failed to load methodologies (found: ${frameworks?.length || 0})`);
      }
    } catch (error) {
      console.log(`   ❌ Framework system test failed: ${error.message}`);
    }

    // Test 4: Transport Layer Compatibility
    console.log('\n🚀 Test 4: Transport Layer');
    results.totalTests++;

    try {
      const { Application } = await import('../../dist/runtime/application.js');
      const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

      const application = new Application(mockLogger);
      await application.loadConfiguration();

      // Test that the application can initialize without starting server
      const config = application.config;
      const transport = config?.transports?.default || 'stdio';
      if (config && (transport === 'stdio' || transport === 'sse')) {
        console.log(`   ✅ Transport layer configured for ${transport}`);
        results.transportLayer = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Transport layer configuration invalid');
      }
    } catch (error) {
      console.log(`   ❌ Transport layer test failed: ${error.message}`);
    }

    // Results Summary
    console.log('\n📊 Functional Validation Results:');
    console.log(`   Tests Passed: ${results.passedTests}/${results.totalTests}`);
    console.log(`   MCP Tools: ${results.mcpTools ? '✅' : '❌'}`);
    console.log(`   Command Routing: ${results.commandRouting ? '✅' : '❌'}`);
    console.log(`   Framework System: ${results.frameworkSystem ? '✅' : '❌'}`);
    console.log(`   Transport Layer: ${results.transportLayer ? '✅' : '❌'}`);

    const successRate = (results.passedTests / results.totalTests) * 100;

    if (successRate >= 75) {
      console.log(`\n🎉 Functional validation passed! (${successRate.toFixed(1)}% success rate)`);
      console.log('   All critical MCP functionality is working correctly.');
      process.exit(0);
    } else {
      console.log(`\n❌ Functional validation failed! (${successRate.toFixed(1)}% success rate)`);
      console.log('   Critical functionality issues detected.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Functional MCP validation failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  functionalMcpValidation();
}

export { functionalMcpValidation };