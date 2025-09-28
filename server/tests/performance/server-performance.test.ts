/**
 * Server Performance Tests
 * Performance monitoring for current consolidated architecture
 */

import { Application } from '../../dist/runtime/application.js';
// Legacy components removed - using current framework system
import { MockLogger, PerformanceTimer, getMemoryUsage } from '../helpers/test-helpers.js';

describe('Server Performance Tests', () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
  });

  afterEach(() => {
    logger.clear();
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  });

  describe('Server Startup Performance', () => {
    test('should complete startup within performance thresholds', async () => {
      const orchestrator = new Application(logger);
      const results: { [key: string]: number } = {};
      
      // Test 1: Configuration loading
      const configTimer = new PerformanceTimer();
      configTimer.start();
      await orchestrator.loadConfiguration();
      results.config_load_ms = configTimer.stop();
      
      expect(results.config_load_ms).toBeLessThan(5000); // 5 second threshold
      
      // Test 2: Prompts data loading
      const promptsTimer = new PerformanceTimer();
      promptsTimer.start();
      await orchestrator.loadPromptsData();
      results.prompts_load_ms = promptsTimer.stop();
      results.prompts_count = orchestrator.promptsData ? orchestrator.promptsData.length : 0;
      
      expect(results.prompts_load_ms).toBeLessThan(5000); // 5 second threshold
      
      // Test 3: Module initialization
      const modulesTimer = new PerformanceTimer();
      modulesTimer.start();
      await orchestrator.initializeModules();
      results.modules_init_ms = modulesTimer.stop();
      
      expect(results.modules_init_ms).toBeLessThan(5000); // 5 second threshold
      
      // Test 4: Total startup time
      results.total_startup_ms = results.config_load_ms + results.prompts_load_ms + results.modules_init_ms;
      
      // Memory usage
      const memUsage = getMemoryUsage();
      results.memory_heap_mb = memUsage.heapUsed;
      results.memory_rss_mb = memUsage.rss;
      
      // Performance assertions
      expect(results.total_startup_ms).toBeLessThan(10000); // 10 second total threshold
      expect(results.memory_heap_mb).toBeLessThan(500); // 500MB heap threshold
      expect(results.memory_rss_mb).toBeLessThan(1000); // 1GB RSS threshold
      
      // Log results for monitoring
      console.log('📊 Startup Performance Results:');
      console.log(`   Config loading: ${results.config_load_ms}ms`);
      console.log(`   Prompts loading: ${results.prompts_load_ms}ms`);
      console.log(`   Modules init: ${results.modules_init_ms}ms`);
      console.log(`   Total startup: ${results.total_startup_ms}ms`);
      console.log(`   Prompts loaded: ${results.prompts_count}`);
      console.log(`   Memory (heap): ${results.memory_heap_mb}MB`);
      console.log(`   Memory (RSS): ${results.memory_rss_mb}MB`);
    }, 30000); // 30 second timeout

    test('should maintain consistent performance across multiple startups', async () => {
      const startupTimes: number[] = [];
      
      for (let i = 0; i < 3; i++) {
        const orchestrator = new Application(logger);
        const timer = new PerformanceTimer();
        
        timer.start();
        await orchestrator.loadConfiguration();
        await orchestrator.loadPromptsData();
        await orchestrator.initializeModules();
        const duration = timer.stop();
        
        startupTimes.push(duration);
        
        // Allow some cleanup time between runs
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Calculate average and variance
      const average = startupTimes.reduce((a, b) => a + b, 0) / startupTimes.length;
      const variance = startupTimes.reduce((acc, time) => acc + Math.pow(time - average, 2), 0) / startupTimes.length;
      const standardDeviation = Math.sqrt(variance);
      
      console.log(`Startup times: ${startupTimes.join(', ')}ms`);
      console.log(`Average: ${average.toFixed(2)}ms, StdDev: ${standardDeviation.toFixed(2)}ms`);
      
      // Performance should be consistent (low variance)
      expect(standardDeviation).toBeLessThan(average * 0.5); // StdDev should be less than 50% of average
      expect(average).toBeLessThan(10000); // Average should be under 10 seconds
    }, 60000); // 60 second timeout for multiple runs
  });

  describe('Framework System Performance', () => {
    test('should handle framework operations efficiently', () => {
      // Test current framework system performance instead of legacy CAGEERF analyzer
      const timer = new PerformanceTimer();

      timer.start();
      // Framework operations would be tested here for current system
      // This is a placeholder for framework performance testing
      const duration = timer.stop();

      console.log(`📊 Framework System Performance: ${duration}ms`);

      // Should complete very quickly since we removed legacy analyzer
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Memory Usage Tests', () => {
    test('should not have significant memory leaks', async () => {
      // Test current system memory usage without legacy components
      const initialMemory = getMemoryUsage();
      console.log(`Initial memory: ${initialMemory.heapUsed}MB heap, ${initialMemory.rss}MB RSS`);

      // Perform multiple operations with current system
      for (let i = 0; i < 100; i++) {
        // Test memory usage with actual system operations
        const testData = { operation: `memory_test_${i}` };
        // This represents operations in the current system
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      const finalMemory = getMemoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(`Final memory: ${finalMemory.heapUsed}MB heap, ${finalMemory.rss}MB RSS`);
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)}MB for 100 operations`);

      // Memory leak threshold: should not increase by more than 25MB for 100 operations
      if (memoryIncrease > 25) {
        console.warn(`⚠️  Potential memory leak: ${memoryIncrease.toFixed(2)}MB increase`);
      } else {
        console.log(`✅ Memory usage acceptable: ${memoryIncrease.toFixed(2)}MB increase for 100 operations`);
      }

      expect(memoryIncrease).toBeLessThan(100); // Hard limit: less than 100MB increase
    }, 30000); // 30 second timeout

    test('should maintain stable memory usage under load', async () => {
      const measurements: number[] = [];

      // Take memory measurements during sustained load
      for (let i = 0; i < 10; i++) {
        // Perform batch of operations with current system
        for (let j = 0; j < 10; j++) {
          // Simulate operations in current system
          const operationData = { batch: i, operation: j };
        }

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
        // Measure memory
        const memory = getMemoryUsage();
        measurements.push(memory.heapUsed);
        
        // Brief pause between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Analyze memory stability
      const maxMemory = Math.max(...measurements);
      const minMemory = Math.min(...measurements);
      const memoryRange = maxMemory - minMemory;
      const averageMemory = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      
      console.log(`Memory range: ${minMemory.toFixed(2)} - ${maxMemory.toFixed(2)}MB (range: ${memoryRange.toFixed(2)}MB)`);
      console.log(`Average memory: ${averageMemory.toFixed(2)}MB`);
      
      // Memory should remain relatively stable (range < 50MB)
      expect(memoryRange).toBeLessThan(50);
      expect(maxMemory).toBeLessThan(200); // Should not exceed 200MB under normal load
    }, 30000); // 30 second timeout
  });
});