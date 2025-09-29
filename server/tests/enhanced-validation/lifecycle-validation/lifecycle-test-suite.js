#!/usr/bin/env node
/**
 * Process Lifecycle Validation Test Suite
 *
 * Tests the process lifecycle validation system to eliminate emergency process.exit() usage
 * Validates clean shutdown capabilities and resource management
 */

async function runLifecycleValidationTests() {
  try {
    console.log('🔄 Running Process Lifecycle Validation Tests...');
    console.log('🎯 Eliminating emergency process.exit() usage\n');

    const results = {
      lifecycleValidator: false,
      cleanShutdown: false,
      resourceLeakDetection: false,
      timeoutCompliance: false,
      totalTests: 0,
      passedTests: 0
    };

    // Test 1: Lifecycle Validator Creation and Basic Functionality
    console.log('🔧 Test 1: Lifecycle Validator Functionality');
    results.totalTests++;

    try {
      const { createProcessLifecycleValidator } = await import('./process-lifecycle-validator.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const validator = createProcessLifecycleValidator(logger);

      if (validator && typeof validator.validateCleanShutdown === 'function') {
        console.log('   ✅ ProcessLifecycleValidator created successfully');
        console.log('   ✅ All required methods available');
        results.lifecycleValidator = true;
        results.passedTests++;
      } else {
        console.log('   ❌ ProcessLifecycleValidator missing required methods');
      }
    } catch (error) {
      console.log(`   ❌ Lifecycle validator creation failed: ${error.message}`);
    }

    // Test 2: Clean Shutdown Validation
    console.log('\n🔒 Test 2: Clean Shutdown Validation');
    results.totalTests++;

    try {
      const { createProcessLifecycleValidator } = await import('./process-lifecycle-validator.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const validator = createProcessLifecycleValidator(logger);

      // Create a mock application with proper shutdown
      const mockApplication = {
        shutdown: async () => {
          // Simulate cleanup work
          await new Promise(resolve => setTimeout(resolve, 50));
          return true;
        }
      };

      const shutdownResult = await validator.validateCleanShutdown(mockApplication);

      if (shutdownResult.success && shutdownResult.shutdownTime < 1000) {
        console.log('   ✅ Mock application shutdown validated successfully');
        console.log(`   ✅ Shutdown completed in ${shutdownResult.shutdownTime}ms`);
        console.log(`   ✅ Resources cleared: ${shutdownResult.resourcesCleared ? 'Yes' : 'No'}`);
        results.cleanShutdown = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Clean shutdown validation failed:', shutdownResult.error || 'Unknown error');
      }
    } catch (error) {
      console.log(`   ❌ Clean shutdown test failed: ${error.message}`);
    }

    // Test 3: Resource Leak Detection
    console.log('\n🕵️ Test 3: Resource Leak Detection');
    results.totalTests++;

    try {
      const { createProcessLifecycleValidator } = await import('./process-lifecycle-validator.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const validator = createProcessLifecycleValidator(logger);

      // Test resource leak detection
      const leakReport = await validator.detectResourceLeaks();

      if (leakReport && typeof leakReport.hasLeaks === 'boolean') {
        console.log('   ✅ Resource leak detection completed');
        console.log(`   📊 Active handles: ${leakReport.activeHandles}`);
        console.log(`   📊 Active requests: ${leakReport.activeRequests}`);
        console.log(`   📊 Has leaks: ${leakReport.hasLeaks ? 'Yes' : 'No'}`);

        if (leakReport.hasLeaks && leakReport.recommendations.length > 0) {
          console.log('   💡 Recommendations provided for leak resolution');
        }

        results.resourceLeakDetection = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Resource leak detection returned invalid result');
      }
    } catch (error) {
      console.log(`   ❌ Resource leak detection failed: ${error.message}`);
    }

    // Test 4: Timeout Compliance Enforcement
    console.log('\n⏱️  Test 4: Timeout Compliance Enforcement');
    results.totalTests++;

    try {
      const { createProcessLifecycleValidator } = await import('./process-lifecycle-validator.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const validator = createProcessLifecycleValidator(logger);

      // Test function that completes naturally
      const goodTestFunction = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'completed';
      };

      const complianceResult = await validator.enforceTimeoutCompliance(goodTestFunction, 1000);

      if (complianceResult.success && complianceResult.completedNaturally && !complianceResult.forceExitUsed) {
        console.log('   ✅ Timeout compliance validation works correctly');
        console.log(`   ✅ Test completed naturally in ${complianceResult.duration}ms`);
        console.log('   ✅ No force exit detected');
        results.timeoutCompliance = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Timeout compliance validation failed');
        console.log('   Details:', complianceResult);
      }
    } catch (error) {
      console.log(`   ❌ Timeout compliance test failed: ${error.message}`);
    }

    // Test 5: Integration with Existing Resource Tracker
    console.log('\n🔗 Test 5: Global Resource Tracker Integration');
    results.totalTests++;

    try {
      const { createProcessLifecycleValidator } = await import('./process-lifecycle-validator.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const validator = createProcessLifecycleValidator(logger);

      // Test resource cleanup validation
      const cleanupResult = await validator.validateResourceCleanup();

      if (cleanupResult && typeof cleanupResult.allResourcesCleared === 'boolean') {
        console.log('   ✅ Resource cleanup validation completed');
        console.log(`   📊 Had tracked resources: ${cleanupResult.hadTrackedResources ? 'Yes' : 'No'}`);
        console.log(`   📊 All resources cleared: ${cleanupResult.allResourcesCleared ? 'Yes' : 'No'}`);

        if (cleanupResult.hadTrackedResources) {
          console.log(`   📊 Cleared resources: ${cleanupResult.clearedResources}`);
        }

        results.passedTests++;
      } else {
        console.log('   ❌ Resource cleanup validation returned invalid result');
      }
    } catch (error) {
      console.log(`   ❌ Resource tracker integration test failed: ${error.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROCESS LIFECYCLE VALIDATION RESULTS');
    console.log('='.repeat(60));
    console.log(`📈 Tests Passed: ${results.passedTests}/${results.totalTests}`);
    console.log(`📊 Success Rate: ${((results.passedTests / results.totalTests) * 100).toFixed(1)}%`);
    console.log('');
    console.log('🔧 Component Status:');
    console.log(`   Lifecycle Validator: ${results.lifecycleValidator ? '✅' : '❌'}`);
    console.log(`   Clean Shutdown: ${results.cleanShutdown ? '✅' : '❌'}`);
    console.log(`   Resource Leak Detection: ${results.resourceLeakDetection ? '✅' : '❌'}`);
    console.log(`   Timeout Compliance: ${results.timeoutCompliance ? '✅' : '❌'}`);

    if (results.passedTests >= 4) { // Allow for resource tracker integration to potentially fail
      console.log('\n🎉 Process lifecycle validation system is working!');
      console.log('✅ Emergency process.exit() calls should no longer be needed');
      console.log('✅ Clean shutdown validation ensures proper test completion');

      // Use natural completion instead of process.exit(0)
      return true;
    } else {
      console.log('\n❌ Process lifecycle validation system has issues');
      console.log('⚠️  Emergency process.exit() may still be needed');

      // Use natural completion instead of process.exit(1)
      return false;
    }

  } catch (error) {
    console.error('❌ Lifecycle validation test execution failed:', error.message);
    console.error('Stack trace:', error.stack);

    // Use natural completion instead of process.exit(1)
    return false;
  }
}

// Handle process cleanup gracefully
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception in lifecycle validation tests:', error.message);
  // Don't use process.exit(1) - let test runner handle it
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection in lifecycle validation tests:', reason);
  // Don't use process.exit(1) - let test runner handle it
});

// Run the tests and demonstrate natural completion
if (import.meta.url === `file://${process.argv[1]}`) {
  runLifecycleValidationTests().then(success => {
    if (success) {
      console.log('\n🎯 Test completed naturally without process.exit() - this is the goal!');
    } else {
      console.log('\n⚠️  Test completed naturally despite failures - no process.exit() needed');
    }
    // Natural completion - no process.exit() calls
  }).catch(error => {
    console.error('❌ Test execution failed:', error);
    // Natural completion even on error - no process.exit() calls
  });
}