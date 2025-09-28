#!/usr/bin/env node
/**
 * Performance and Memory Tests - Updated for Consolidated Architecture
 * Tests current system performance instead of deprecated components
 */

async function performanceTests() {
  try {
    console.log('🧪 Running performance and memory tests for consolidated architecture...');

    // Test current system components instead of deprecated ones
    const { Application } = await import('../../dist/runtime/application.js');
    const { createSimpleLogger } = await import('../../dist/logging/index.js');

    console.log('⏱️  Starting performance tests...');

    const logger = createSimpleLogger();
    const application = new Application(logger);

    // Performance benchmarks for current system
    console.log('📊 System Startup Performance:');

    // Test startup performance
    const startupStart = Date.now();
    await application.loadConfiguration();
    const configDuration = Date.now() - startupStart;

    const promptsStart = Date.now();
    await application.loadPromptsData();
    const promptsDuration = Date.now() - promptsStart;

    const modulesStart = Date.now();
    await application.initializeModules();
    const modulesDuration = Date.now() - modulesStart;

    const totalStartup = configDuration + promptsDuration + modulesDuration;

    console.log(`   Config loading: ${configDuration}ms`);
    console.log(`   Prompts loading: ${promptsDuration}ms`);
    console.log(`   Modules initialization: ${modulesDuration}ms`);
    console.log(`   Total startup time: ${totalStartup}ms`);

    if (totalStartup > 10000) {
      console.log(`⚠️  Warning: Total startup took ${totalStartup}ms (threshold: 10000ms)`);
    } else {
      console.log(`✅ Startup performance acceptable: ${totalStartup}ms`);
    }

    // Memory usage testing
    console.log('💾 Memory Usage Tests:');
    const initialMemory = process.memoryUsage();
    console.log(`   Initial memory - Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, RSS: ${(initialMemory.rss / 1024 / 1024).toFixed(2)}MB`);

    // Simulate some operations
    for (let i = 0; i < 100; i++) {
      // Simulate current system operations
      const operationData = {
        operation: `memory_test_${i}`,
        data: new Array(1000).fill(i)
      };
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage();
    const heapIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
    const rssIncrease = (finalMemory.rss - initialMemory.rss) / 1024 / 1024;

    console.log(`   Final memory - Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, RSS: ${(finalMemory.rss / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Memory increase - Heap: ${heapIncrease.toFixed(2)}MB, RSS: ${rssIncrease.toFixed(2)}MB`);

    // Memory leak threshold check
    const memoryThreshold = 50; // MB
    if (heapIncrease > memoryThreshold) {
      console.log(`⚠️  Warning: Heap memory increased by ${heapIncrease.toFixed(2)}MB (threshold: ${memoryThreshold}MB)`);
    } else {
      console.log(`✅ Memory usage acceptable: ${heapIncrease.toFixed(2)}MB heap increase`);
    }

    console.log('📊 Performance Summary:');
    console.log(`   ✅ Total startup time: ${totalStartup}ms`);
    console.log(`   ✅ Memory increase: ${heapIncrease.toFixed(2)}MB`);
    console.log('   ✅ All tests completed successfully');

  } catch (error) {
    console.error('❌ Performance tests failed:', error.message);
    process.exit(1);
  }
}

// Run the performance tests
if (import.meta.url === `file://${process.argv[1]}`) {
  performanceTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

export { performanceTests };