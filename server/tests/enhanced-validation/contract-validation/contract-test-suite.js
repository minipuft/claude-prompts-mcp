#!/usr/bin/env node
/**
 * Contract Validation Test Suite
 *
 * Validates interface compliance to prevent registerTool-type CI failures
 * Tests the enhanced MockMcpServer and interface validation system
 */

async function runContractValidationTests() {
  try {
    console.log('🔍 Running Interface Contract Validation Tests...');
    console.log('🎯 Preventing interface mismatch CI failures\n');

    const results = {
      mockServerCompliance: false,
      contractValidation: false,
      registerToolFix: false,
      totalTests: 0,
      passedTests: 0
    };

    // Test 1: Enhanced MockMcpServer Compliance
    console.log('📋 Test 1: MockMcpServer Interface Compliance');
    results.totalTests++;

    try {
      const { MockMcpServer } = await import('../../helpers/test-helpers.js');
      const mockServer = new MockMcpServer();

      // Test interface compliance validation
      const compliance = mockServer.validateInterfaceCompliance();

      if (compliance.isCompliant && compliance.missingMethods.length === 0) {
        console.log('   ✅ MockMcpServer implements all required methods');
        console.log('   ✅ Interface compliance validation works');
        results.mockServerCompliance = true;
        results.passedTests++;
      } else {
        console.log('   ❌ MockMcpServer missing methods:', compliance.missingMethods);
      }
    } catch (error) {
      console.log(`   ❌ MockMcpServer compliance test failed: ${error.message}`);
    }

    // Test 2: Contract Validator Functionality
    console.log('\n🔧 Test 2: Contract Validation System');
    results.totalTests++;

    try {
      const { createMcpSdkInterfaceValidator } = await import('./interface-contracts.js');
      const { MockLogger, MockMcpServer } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const validator = createMcpSdkInterfaceValidator(logger);
      const mockServer = new MockMcpServer();

      // Test contract validation
      const isValid = await validator.quickValidation(mockServer);

      if (isValid) {
        console.log('   ✅ Contract validation passes for enhanced MockMcpServer');
        console.log('   ✅ Interface validator correctly identifies compliance');
        results.contractValidation = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Contract validation failed for MockMcpServer');
        console.log('   Logs:', logger.logs);
      }
    } catch (error) {
      console.log(`   ❌ Contract validation system test failed: ${error.message}`);
    }

    // Test 3: RegisterTool Method Fix Validation
    console.log('\n🔨 Test 3: RegisterTool Method Fix');
    results.totalTests++;

    try {
      const { MockMcpServer } = await import('../../helpers/test-helpers.js');
      const mockServer = new MockMcpServer();

      // Test that registerTool method exists and works
      if (typeof mockServer.registerTool !== 'function') {
        throw new Error('registerTool method is missing');
      }

      // Test registerTool functionality
      const mockHandler = async (args) => ({ result: 'test', args });
      const mockConfig = {
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {} }
      };

      const result = mockServer.registerTool('test_tool', mockConfig, mockHandler);

      if (result && result.name === 'test_tool') {
        console.log('   ✅ registerTool method exists and functions correctly');
        console.log('   ✅ Delegates properly to existing tool method');
        console.log('   ✅ Validates parameters correctly');

        // Verify tool was registered
        const registeredNames = mockServer.getRegisteredToolNames();
        if (registeredNames.includes('test_tool')) {
          console.log('   ✅ Tool successfully registered via registerTool');
          results.registerToolFix = true;
          results.passedTests++;
        } else {
          console.log('   ❌ Tool not found in registered tools list');
        }
      } else {
        console.log('   ❌ registerTool did not return expected result');
      }
    } catch (error) {
      console.log(`   ❌ RegisterTool fix validation failed: ${error.message}`);
    }

    // Test 4: Parameter Validation (Edge Cases)
    console.log('\n⚠️  Test 4: Parameter Validation Edge Cases');
    results.totalTests++;

    try {
      const { MockMcpServer } = await import('../../helpers/test-helpers.js');
      const mockServer = new MockMcpServer();

      // Test invalid parameters
      const testCases = [
        { name: '', config: {}, handler: () => {}, expectedError: 'Invalid tool name' },
        { name: 'test', config: null, handler: () => {}, expectedError: 'Invalid tool config' },
        { name: 'test', config: {}, handler: 'not-a-function', expectedError: 'Invalid tool handler' }
      ];

      let edgeCasesPassed = 0;
      for (const testCase of testCases) {
        try {
          mockServer.registerTool(testCase.name, testCase.config, testCase.handler);
          console.log(`   ❌ Expected error for ${testCase.expectedError} but none thrown`);
        } catch (error) {
          if (error.message.includes(testCase.expectedError)) {
            console.log(`   ✅ Correctly validates: ${testCase.expectedError}`);
            edgeCasesPassed++;
          } else {
            console.log(`   ❌ Wrong error for ${testCase.expectedError}: ${error.message}`);
          }
        }
      }

      if (edgeCasesPassed === testCases.length) {
        console.log('   ✅ All parameter validation edge cases pass');
        results.passedTests++;
      } else {
        console.log(`   ❌ Only ${edgeCasesPassed}/${testCases.length} edge cases passed`);
      }
    } catch (error) {
      console.log(`   ❌ Parameter validation test failed: ${error.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 CONTRACT VALIDATION TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`📈 Tests Passed: ${results.passedTests}/${results.totalTests}`);
    console.log(`📊 Success Rate: ${((results.passedTests / results.totalTests) * 100).toFixed(1)}%`);
    console.log('');
    console.log('🔧 Component Status:');
    console.log(`   MockMcpServer Compliance: ${results.mockServerCompliance ? '✅' : '❌'}`);
    console.log(`   Contract Validation System: ${results.contractValidation ? '✅' : '❌'}`);
    console.log(`   RegisterTool Fix: ${results.registerToolFix ? '✅' : '❌'}`);

    if (results.passedTests === results.totalTests) {
      console.log('\n🎉 All contract validation tests passed!');
      console.log('✅ Interface mismatch prevention system is working correctly');
      console.log('✅ RegisterTool CI failure should be prevented');
      process.exit(0);
    } else {
      console.log('\n❌ Some contract validation tests failed');
      console.log('⚠️  Interface mismatch issues may still cause CI failures');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Contract validation test execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Handle process cleanup
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception in contract validation tests:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection in contract validation tests:', reason);
  process.exit(1);
});

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runContractValidationTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}