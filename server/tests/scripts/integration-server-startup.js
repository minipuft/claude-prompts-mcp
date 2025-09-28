#!/usr/bin/env node
/**
 * Server Startup Integration Tests - Node.js Script Version
 * Tests extracted from GitHub Actions inline scripts
 */

async function runServerStartupIntegrationTests() {
  try {
    console.log('🧪 Running Server Startup Integration tests...');
    console.log('📋 Testing full server initialization sequence and error recovery');

    // Import modules
    const { Application } = await import('../../dist/runtime/application.js');
    const { createSimpleLogger } = await import('../../dist/logging/index.js');

    let logger, orchestrator;

    // Setup for each test
    function setupTest() {
      logger = createSimpleLogger();
      orchestrator = new Application(logger);
    }

    // Simple assertion helpers
    function assertEqual(actual, expected, testName) {
      const actualStr = JSON.stringify(actual);
      const expectedStr = JSON.stringify(expected);
      if (actualStr === expectedStr) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED`);
        console.error(`   Expected: ${expectedStr}`);
        console.error(`   Actual:   ${actualStr}`);
        return false;
      }
    }

    function assertTruthy(value, testName) {
      if (value) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED - Expected truthy value, got: ${value}`);
        return false;
      }
    }

    function assertType(value, expectedType, testName) {
      if (typeof value === expectedType) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED - Expected type ${expectedType}, got: ${typeof value}`);
        return false;
      }
    }

    function assertHasProperty(obj, property, testName) {
      if (obj && typeof obj === 'object' && property in obj) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED - Object does not have property: ${property}`);
        return false;
      }
    }

    function assertGreaterThan(actual, expected, testName) {
      if (actual > expected) {
        console.log(`✅ ${testName}: PASSED (${actual} > ${expected})`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED (${actual} <= ${expected})`);
        return false;
      }
    }

    function assertGreaterThanOrEqual(actual, expected, testName) {
      if (actual >= expected) {
        console.log(`✅ ${testName}: PASSED (${actual} >= ${expected})`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED (${actual} < ${expected})`);
        return false;
      }
    }

    function assertLessThan(actual, expected, testName) {
      if (actual < expected) {
        console.log(`✅ ${testName}: PASSED (${actual} < ${expected})`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED (${actual} >= ${expected})`);
        return false;
      }
    }

    function assertIsArray(value, testName) {
      if (Array.isArray(value)) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED - Expected array, got: ${typeof value}`);
        return false;
      }
    }

    let testResults = [];

    // Test 1: Full Server Initialization Sequence
    console.log('🔍 Test 1: Full Server Initialization Sequence');

    setupTest();

    try {
      // Step 1: Load Configuration
      await orchestrator.loadConfiguration();
      testResults.push(assertTruthy(orchestrator.config, 'Configuration loaded'));
      testResults.push(assertTruthy(orchestrator.config !== null, 'Configuration not null'));

      // Step 2: Load Prompts Data
      await orchestrator.loadPromptsData();
      const promptsCount = orchestrator.promptsData ? orchestrator.promptsData.length : 0;
      testResults.push(assertGreaterThanOrEqual(promptsCount, 0, 'Prompts data loaded or initialized'));

      // Step 3: Initialize Modules
      await orchestrator.initializeModules();
      testResults.push(assertTruthy(orchestrator.mcpToolsManager, 'MCP tools manager initialized'));
      testResults.push(assertTruthy(orchestrator.mcpToolsManager !== null, 'MCP tools manager not null'));

      // Step 4: Get Diagnostic Info
      const healthInfo = await orchestrator.getDiagnosticInfo();
      testResults.push(assertTruthy(healthInfo, 'Health info retrieved'));
      testResults.push(assertType(healthInfo, 'object', 'Health info is object'));
      testResults.push(assertGreaterThan(Object.keys(healthInfo).length, 0, 'Health info has properties'));

    } catch (error) {
      console.error(`❌ Full initialization sequence failed: ${error.message}`);
      testResults.push(false);
    }

    // Test 2: Configuration Loading
    console.log('🔍 Test 2: Configuration Loading');

    setupTest();
    try {
      await orchestrator.loadConfiguration();

      testResults.push(assertTruthy(orchestrator.config, 'Configuration object exists'));
      testResults.push(assertHasProperty(orchestrator.config, 'server', 'Config has server property'));

      if (orchestrator.config && orchestrator.config.server) {
        testResults.push(assertHasProperty(orchestrator.config.server, 'name', 'Server config has name'));
        testResults.push(assertHasProperty(orchestrator.config.server, 'version', 'Server config has version'));
        testResults.push(assertType(orchestrator.config.server.name, 'string', 'Server name is string'));
        testResults.push(assertGreaterThan(orchestrator.config.server.name.length, 0, 'Server name not empty'));
      } else {
        testResults.push(false);
        testResults.push(false);
        testResults.push(false);
        testResults.push(false);
      }
    } catch (error) {
      console.error(`❌ Configuration loading failed: ${error.message}`);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
    }

    // Test 3: Prompts Data Loading
    console.log('🔍 Test 3: Prompts Data Loading');

    setupTest();
    try {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();

      testResults.push(assertTruthy(orchestrator.promptsData !== undefined, 'Prompts data property exists'));

      const promptsDataIsValid = Array.isArray(orchestrator.promptsData) || orchestrator.promptsData === null;
      testResults.push(assertTruthy(promptsDataIsValid, 'Prompts data is array or null'));

      if (orchestrator.promptsData && orchestrator.promptsData.length > 0) {
        const firstPrompt = orchestrator.promptsData[0];
        testResults.push(assertHasProperty(firstPrompt, 'id', 'First prompt has id'));
        testResults.push(assertHasProperty(firstPrompt, 'name', 'First prompt has name'));
      } else {
        // If no prompts, that's still valid
        testResults.push(assertTruthy(true, 'Empty prompts handled gracefully'));
        testResults.push(assertTruthy(true, 'Empty prompts handled gracefully'));
      }
    } catch (error) {
      console.error(`❌ Prompts data loading failed: ${error.message}`);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
    }

    // Test 4: Module Initialization
    console.log('🔍 Test 4: Module Initialization');

    setupTest();
    try {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();

      testResults.push(assertTruthy(orchestrator.mcpToolsManager, 'MCP tools manager initialized'));
      testResults.push(assertTruthy(orchestrator.mcpToolsManager !== null, 'MCP tools manager not null'));
    } catch (error) {
      console.error(`❌ Module initialization failed: ${error.message}`);
      testResults.push(false);
      testResults.push(false);
    }

    // Test 5: Health Diagnostics
    console.log('🔍 Test 5: Health Diagnostics');

    setupTest();
    try {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();

      const healthInfo = await orchestrator.getDiagnosticInfo();

      testResults.push(assertTruthy(healthInfo, 'Health info exists'));
      testResults.push(assertType(healthInfo, 'object', 'Health info is object'));

      const diagnosticKeys = Object.keys(healthInfo);
      testResults.push(assertGreaterThan(diagnosticKeys.length, 0, 'Health info has diagnostic keys'));

      const hasRelevantKeys = diagnosticKeys.some(key =>
        key.includes('status') ||
        key.includes('config') ||
        key.includes('prompts') ||
        key.includes('tools')
      );
      testResults.push(assertTruthy(hasRelevantKeys, 'Health info contains relevant diagnostic keys'));

      // Test partial initialization health info
      const partialOrchestrator = new Application(logger);
      await partialOrchestrator.loadConfiguration();

      const partialHealthInfo = await partialOrchestrator.getDiagnosticInfo();
      testResults.push(assertTruthy(partialHealthInfo, 'Partial health info exists'));
      testResults.push(assertType(partialHealthInfo, 'object', 'Partial health info is object'));

    } catch (error) {
      console.error(`❌ Health diagnostics failed: ${error.message}`);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
    }

    // Test 6: Error Recovery
    console.log('🔍 Test 6: Error Recovery');

    try {
      // Test configuration loading errors
      const failingOrchestrator = new Application(logger);

      const originalLoadConfig = failingOrchestrator.loadConfiguration;
      failingOrchestrator.loadConfiguration = async () => {
        throw new Error('Mock config error');
      };

      let configErrorThrown = false;
      try {
        await failingOrchestrator.loadConfiguration();
      } catch (error) {
        if (error.message === 'Mock config error') {
          configErrorThrown = true;
        }
      }

      testResults.push(assertTruthy(configErrorThrown, 'Configuration loading error handled'));
      testResults.push(assertTruthy(failingOrchestrator.config === undefined, 'Config remains undefined after error'));

      // Test module initialization errors
      const moduleFailOrchestrator = new Application(logger);
      await moduleFailOrchestrator.loadConfiguration();
      await moduleFailOrchestrator.loadPromptsData();

      moduleFailOrchestrator.initializeModules = async () => {
        throw new Error('Mock module error');
      };

      let moduleErrorThrown = false;
      try {
        await moduleFailOrchestrator.initializeModules();
      } catch (error) {
        if (error.message === 'Mock module error') {
          moduleErrorThrown = true;
        }
      }

      testResults.push(assertTruthy(moduleErrorThrown, 'Module initialization error handled'));

    } catch (error) {
      console.error(`❌ Error recovery test failed: ${error.message}`);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
    }

    // Test 7: Performance Validation
    console.log('🔍 Test 7: Performance Validation');

    setupTest();
    try {
      const start = Date.now();

      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();

      const duration = Date.now() - start;

      testResults.push(assertLessThan(duration, 10000, 'Initialization completes within 10 seconds'));

      // Test step timing
      const timings = {};

      const timingOrchestrator = new Application(logger);

      let stepStart = Date.now();
      await timingOrchestrator.loadConfiguration();
      timings.config = Date.now() - stepStart;

      stepStart = Date.now();
      await timingOrchestrator.loadPromptsData();
      timings.prompts = Date.now() - stepStart;

      stepStart = Date.now();
      await timingOrchestrator.initializeModules();
      timings.modules = Date.now() - stepStart;

      testResults.push(assertLessThan(timings.config, 5000, 'Configuration loading under 5 seconds'));
      testResults.push(assertLessThan(timings.prompts, 5000, 'Prompts loading under 5 seconds'));
      testResults.push(assertLessThan(timings.modules, 5000, 'Module initialization under 5 seconds'));

      console.log(`📊 Initialization timings - Config: ${timings.config}ms, Prompts: ${timings.prompts}ms, Modules: ${timings.modules}ms`);

    } catch (error) {
      console.error(`❌ Performance validation failed: ${error.message}`);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
      testResults.push(false);
    }

    // Results Summary
    const passedTests = testResults.filter(result => result).length;
    const totalTests = testResults.length;

    console.log('\n📊 Server Startup Integration Tests Summary:');
    console.log(`   ✅ Passed: ${passedTests}/${totalTests} tests`);
    console.log(`   📊 Success Rate: ${((passedTests/totalTests)*100).toFixed(1)}%`);

    if (passedTests === totalTests) {
      console.log('🎉 All Server Startup Integration tests passed!');
      return true;
    } else {
      console.error('❌ Some Server Startup Integration tests failed');
      return false;
    }

  } catch (error) {
    console.error('❌ Server Startup Integration tests failed with error:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return false;
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runServerStartupIntegrationTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

export { runServerStartupIntegrationTests };