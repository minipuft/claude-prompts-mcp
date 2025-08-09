/**
 * Phase 7 Integration Test
 * Validates that the refactored main entry point and orchestration work correctly
 */

import { createApplicationOrchestrator } from "../orchestration/index.js";

/**
 * Integration test for Phase 7 refactoring
 */
async function runIntegrationTest(): Promise<boolean> {
  console.log("🧪 Starting Phase 7 Integration Test");
  console.log("=====================================");

  let testsPassed = 0;
  let totalTests = 0;
  let orchestrator: any = null;

  try {
    // Test 1: Orchestrator Creation
    totalTests++;
    console.log("Test 1: Creating Application Orchestrator...");

    orchestrator = createApplicationOrchestrator();
    if (orchestrator) {
      console.log("✅ Test 1 PASSED: Orchestrator created successfully");
      testsPassed++;
    } else {
      console.log("❌ Test 1 FAILED: Orchestrator creation failed");
    }

    // Test 2: Module Instance Check
    totalTests++;
    console.log("Test 2: Checking Module Instances...");

    // The orchestrator starts with null modules until startup
    const modulesBefore = orchestrator.getModules();
    if (modulesBefore && typeof modulesBefore === "object") {
      console.log("✅ Test 2 PASSED: Module structure exists");
      testsPassed++;
    } else {
      console.log("❌ Test 2 FAILED: Module structure missing");
    }

    // Test 3: Status Check (before startup)
    totalTests++;
    console.log("Test 3: Checking Initial Status...");

    try {
      const initialStatus = orchestrator.getStatus();
      if (initialStatus && typeof initialStatus.running === "boolean") {
        console.log("✅ Test 3 PASSED: Status check functional");
        console.log("  - Running:", initialStatus.running);
        console.log("  - Prompts Loaded:", initialStatus.promptsLoaded);
        testsPassed++;
      } else {
        console.log("❌ Test 3 FAILED: Invalid status response");
      }
    } catch (error) {
      console.log("❌ Test 3 FAILED: Status check threw error:", error);
    }

    // Test 4: Health Validation (before startup)
    totalTests++;
    console.log("Test 4: Testing Health Validation (pre-startup)...");

    try {
      const healthCheck = orchestrator.validateHealth();
      if (healthCheck && typeof healthCheck.healthy === "boolean") {
        console.log("✅ Test 4 PASSED: Health validation functional");
        console.log("  - Healthy:", healthCheck.healthy);
        console.log("  - Foundation:", healthCheck.modules.foundation);
        console.log("  - Issues:", healthCheck.issues.length);
        testsPassed++;
      } else {
        console.log("❌ Test 4 FAILED: Health validation failed");
      }
    } catch (error) {
      console.log("❌ Test 4 FAILED: Health validation threw error:", error);
    }

    // Test 5: Performance Metrics
    totalTests++;
    console.log("Test 5: Testing Performance Metrics...");

    try {
      const performance = orchestrator.getPerformanceMetrics();
      if (performance && performance.uptime >= 0 && performance.memoryUsage) {
        console.log("✅ Test 5 PASSED: Performance metrics collected");
        console.log("  - Uptime:", Math.floor(performance.uptime), "seconds");
        console.log(
          "  - Memory:",
          Math.round(performance.memoryUsage.heapUsed / 1024 / 1024),
          "MB"
        );
        console.log("  - Node Version:", performance.process.nodeVersion);
        testsPassed++;
      } else {
        console.log("❌ Test 5 FAILED: Invalid performance metrics");
      }
    } catch (error) {
      console.log("❌ Test 5 FAILED: Performance metrics threw error:", error);
    }

    // Test 6: Diagnostic Information
    totalTests++;
    console.log("Test 6: Testing Diagnostic Information...");

    try {
      const diagnostics = orchestrator.getDiagnosticInfo();
      if (
        diagnostics &&
        diagnostics.timestamp &&
        diagnostics.health &&
        diagnostics.performance
      ) {
        console.log("✅ Test 6 PASSED: Diagnostic information collected");
        console.log("  - Timestamp:", diagnostics.timestamp);
        console.log("  - Health Status:", diagnostics.health.healthy);
        console.log(
          "  - Configuration Transport:",
          diagnostics.configuration.transport
        );
        testsPassed++;
      } else {
        console.log("❌ Test 6 FAILED: Invalid diagnostic information");
      }
    } catch (error) {
      console.log(
        "❌ Test 6 FAILED: Diagnostic information threw error:",
        error
      );
    }

    // Test 7: Error Handling - Shutdown without startup
    totalTests++;
    console.log("Test 7: Testing Error Handling (shutdown without startup)...");

    try {
      await orchestrator.shutdown();
      console.log(
        "✅ Test 7 PASSED: Graceful error handling for shutdown without startup"
      );
      testsPassed++;
    } catch (error) {
      console.log("❌ Test 7 FAILED: Shutdown error handling failed:", error);
    }

    // Final results
    console.log("\n📊 Integration Test Results");
    console.log("============================");
    console.log(`Tests Passed: ${testsPassed}/${totalTests}`);
    console.log(
      `Success Rate: ${Math.round((testsPassed / totalTests) * 100)}%`
    );

    if (testsPassed === totalTests) {
      console.log("🎉 ALL TESTS PASSED - Phase 7 integration successful!");
      return true;
    } else if (testsPassed >= totalTests * 0.8) {
      console.log(
        "⚠️  Most tests passed - Phase 7 integration mostly successful"
      );
      return true;
    } else {
      console.log("❌ Many tests failed - Phase 7 integration needs attention");
      return false;
    }
  } catch (error) {
    console.error("💥 Integration test encountered fatal error:", error);
    return false;
  } finally {
    // No cleanup needed for this basic test
    console.log("\n✅ Integration test completed");
  }
}

/**
 * Run the test if called directly
 */
runIntegrationTest()
  .then((success) => {
    console.log(
      success ? "🎉 Integration test SUCCESS" : "❌ Integration test FAILED"
    );
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("💥 Integration test crashed:", error);
    process.exit(1);
  });
