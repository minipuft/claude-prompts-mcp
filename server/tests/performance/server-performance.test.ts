/**
 * Server Performance Tests
 * Tests extracted from GitHub Actions performance monitoring scripts
 */

import { ApplicationOrchestrator } from '../../dist/orchestration/index.js';
import { CAGEERFAnalyzer } from '../../dist/utils/cageerf-analyzer.js';
import { TemplateGenerator } from '../../dist/utils/template-generator.js';
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
      const orchestrator = new ApplicationOrchestrator(logger);
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
        const orchestrator = new ApplicationOrchestrator(logger);
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

  describe('CAGEERF Framework Performance', () => {
    test('should analyze prompts within performance thresholds', () => {
      const analyzer = new CAGEERFAnalyzer();
      const testPrompts = [
        'Simple analysis task',
        'Complex multi-faceted analysis requiring comprehensive context evaluation, systematic goal setting, detailed execution planning, thorough evaluation criteria, and iterative refinement processes',
        'Medium complexity prompt with CAGEERF elements including context and analysis components'
      ];

      console.log('📊 CAGEERF Analysis Performance:');
      
      testPrompts.forEach((prompt, index) => {
        const timer = new PerformanceTimer();
        timer.start();
        const analysis = analyzer.analyzeText(prompt);
        const duration = timer.stop();
        
        console.log(`   Prompt ${index + 1}: ${duration}ms (score: ${analysis.frameworkScore.toFixed(3)})`);
        
        // Performance threshold: should complete within 1 second
        expect(duration).toBeLessThan(1000);
        
        // Quality threshold: should produce valid analysis
        expect(analysis.frameworkScore).toBeGreaterThanOrEqual(0);
        expect(analysis.frameworkScore).toBeLessThanOrEqual(1);
      });
    });

    test('should handle batch analysis efficiently', () => {
      const analyzer = new CAGEERFAnalyzer();
      const batchSize = 50;
      const testPrompts = Array(batchSize).fill(null).map((_, i) => 
        `Test prompt ${i} with context analysis and framework components`
      );

      const initialMemory = getMemoryUsage();
      const timer = new PerformanceTimer();
      
      timer.start();
      const results = testPrompts.map(prompt => analyzer.analyzeText(prompt));
      const totalDuration = timer.stop();
      
      const finalMemory = getMemoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      console.log(`Batch analysis: ${batchSize} prompts in ${totalDuration}ms`);
      console.log(`Average per prompt: ${(totalDuration / batchSize).toFixed(2)}ms`);
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)}MB`);
      
      // Performance thresholds
      expect(totalDuration).toBeLessThan(batchSize * 100); // Average 100ms per prompt max
      expect(memoryIncrease).toBeLessThan(50); // Less than 50MB memory increase
      expect(results).toHaveLength(batchSize);
      
      // All results should be valid
      results.forEach(result => {
        expect(result.frameworkScore).toBeGreaterThanOrEqual(0);
        expect(result.frameworkScore).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Template Generation Performance', () => {
    test('should generate templates within performance thresholds', async () => {
      const generator = new TemplateGenerator();
      const complexities = ['simple', 'intermediate', 'advanced'] as const;

      console.log('📊 Template Generation Performance:');
      
      for (const complexity of complexities) {
        const timer = new PerformanceTimer();
        timer.start();
        
        const template = await generator.generateTemplate({
          useCase: 'Performance Test',
          domain: 'Testing',
          complexity: complexity,
          frameworkEmphasis: {
            context: true, analysis: true, goals: true,
            execution: true, evaluation: true, refinement: true, framework: true
          },
          templateStyle: 'structured'
        });
        
        const duration = timer.stop();
        
        console.log(`   ${complexity}: ${duration}ms (length: ${template.userMessageTemplate.length}, score: ${template.qualityScore.toFixed(3)})`);
        
        // Performance threshold: should complete within 2 seconds
        expect(duration).toBeLessThan(2000);
        
        // Quality thresholds
        expect(template.userMessageTemplate.length).toBeGreaterThan(0);
        expect(template.qualityScore).toBeGreaterThan(0);
      }
    });

    test('should handle concurrent template generation', async () => {
      const generator = new TemplateGenerator();
      const concurrency = 5;
      
      const requests = Array(concurrency).fill(null).map((_, i) => ({
        useCase: `Concurrent Test ${i}`,
        domain: 'Testing',
        complexity: 'simple' as const,
        frameworkEmphasis: {
          context: true, analysis: true, goals: true,
          execution: true, evaluation: true, refinement: true, framework: true
        },
        templateStyle: 'structured' as const
      }));

      const timer = new PerformanceTimer();
      timer.start();
      
      const templates = await Promise.all(
        requests.map(request => generator.generateTemplate(request))
      );
      
      const totalDuration = timer.stop();
      
      console.log(`Concurrent generation: ${concurrency} templates in ${totalDuration}ms`);
      console.log(`Average per template: ${(totalDuration / concurrency).toFixed(2)}ms`);
      
      // Performance thresholds
      expect(totalDuration).toBeLessThan(5000); // All should complete within 5 seconds
      expect(templates).toHaveLength(concurrency);
      
      // All templates should be valid
      templates.forEach(template => {
        expect(template.userMessageTemplate).toBeTruthy();
        expect(template.qualityScore).toBeGreaterThan(0);
      });
    });
  });

  describe('Memory Usage Tests', () => {
    test('should not have significant memory leaks', async () => {
      const analyzer = new CAGEERFAnalyzer();
      const generator = new TemplateGenerator();
      
      const initialMemory = getMemoryUsage();
      console.log(`Initial memory: ${initialMemory.heapUsed}MB heap, ${initialMemory.rss}MB RSS`);
      
      // Perform multiple operations
      for (let i = 0; i < 50; i++) {
        analyzer.analyzeText(`Memory test prompt ${i} with comprehensive analysis components`);
        
        await generator.generateTemplate({
          useCase: `Memory Test ${i}`,
          domain: 'Testing',
          complexity: 'simple',
          frameworkEmphasis: {
            context: true, analysis: true, goals: true,
            execution: true, evaluation: true, refinement: true, framework: true
          },
          templateStyle: 'structured'
        });
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
      console.log(`Memory increase: ${memoryIncrease.toFixed(2)}MB for 50 operations`);
      
      // Memory leak threshold: should not increase by more than 25MB for 50 operations
      if (memoryIncrease > 25) {
        console.warn(`⚠️  Potential memory leak: ${memoryIncrease.toFixed(2)}MB increase`);
      } else {
        console.log(`✅ Memory usage acceptable: ${memoryIncrease.toFixed(2)}MB increase for 50 operations`);
      }
      
      expect(memoryIncrease).toBeLessThan(100); // Hard limit: less than 100MB increase
    }, 30000); // 30 second timeout

    test('should maintain stable memory usage under load', async () => {
      const analyzer = new CAGEERFAnalyzer();
      const measurements: number[] = [];
      
      // Take memory measurements during sustained load
      for (let i = 0; i < 10; i++) {
        // Perform batch of operations
        for (let j = 0; j < 10; j++) {
          analyzer.analyzeText(`Load test prompt ${i}-${j} with analysis framework components`);
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