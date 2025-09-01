/**
 * Performance Benchmark Tests for Unified Parsing System
 * 
 * Comprehensive performance testing to ensure the new parsing system
 * maintains or improves upon the performance of the legacy system.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { performance } from 'perf_hooks';
import { Logger } from '../../src/logging/index.js';
import { PromptData } from '../../src/types/index.js';
import {
  createParsingSystem,
  createCompatibilityWrapper,
  type ExecutionContext
} from '../../src/execution/parsers/index.js';

// Mock logger for testing
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as any;

// Generate large set of test prompts for performance testing
function generateTestPrompts(count: number): PromptData[] {
  const prompts: PromptData[] = [];
  for (let i = 0; i < count; i++) {
    prompts.push({
      id: `test_prompt_${i}`,
      name: `test_prompt_${i}`,
      description: `Test prompt ${i}`,
      userMessageTemplate: `Process {{content}} with format {{format}}`,
      arguments: [
        {
          name: 'content',
          description: 'Content to process',
          required: true
        },
        {
          name: 'format',
          description: 'Output format',
          required: false
        }
      ],
      category: 'test'
    });
  }
  return prompts;
}

// Performance measurement utility
class PerformanceTimer {
  private startTime: number = 0;
  
  start(): void {
    this.startTime = performance.now();
  }
  
  end(): number {
    return performance.now() - this.startTime;
  }
}

describe('Parsing System Performance Benchmarks', () => {
  const LARGE_PROMPT_SET = generateTestPrompts(1000);
  const BENCHMARK_ITERATIONS = 100;
  
  describe('Command Parsing Performance', () => {
    test('should parse simple commands efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      const times: number[] = [];
      
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        timer.start();
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 10} hello world ${i}`,
          LARGE_PROMPT_SET.slice(0, 10)
        );
        times.push(timer.end());
      }
      
      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      
      console.log(`Command Parsing Performance:
        Average: ${averageTime.toFixed(2)}ms
        Min: ${minTime.toFixed(2)}ms
        Max: ${maxTime.toFixed(2)}ms
        Target: <10ms per parse`);
      
      expect(averageTime).toBeLessThan(10); // Target: under 10ms per parse
      expect(maxTime).toBeLessThan(50); // No single parse should take more than 50ms
    });

    test('should handle large prompt sets efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      
      timer.start();
      for (let i = 0; i < 50; i++) {
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i}`,
          LARGE_PROMPT_SET
        );
      }
      const totalTime = timer.end();
      const averageTime = totalTime / 50;
      
      console.log(`Large Prompt Set Performance:
        Total time for 50 parses: ${totalTime.toFixed(2)}ms
        Average per parse: ${averageTime.toFixed(2)}ms
        Prompt set size: ${LARGE_PROMPT_SET.length}`);
      
      expect(averageTime).toBeLessThan(20); // Should scale reasonably
    });

    test('should parse different command formats consistently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const formats = [
        '>>test_prompt_1 hello world',
        '/test_prompt_1 hello world',
        '{"command": ">>test_prompt_1", "args": "hello world"}',
        'test_prompt_1 {"content": "hello world"}'
      ];
      
      const results: { format: string; time: number }[] = [];
      
      for (const command of formats) {
        const timer = new PerformanceTimer();
        const times: number[] = [];
        
        for (let i = 0; i < 20; i++) {
          timer.start();
          await parsingSystem.commandParser.parseCommand(command, LARGE_PROMPT_SET.slice(0, 10));
          times.push(timer.end());
        }
        
        const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
        results.push({ format: command.split(' ')[0], time: averageTime });
      }
      
      console.log('Command Format Performance:');
      results.forEach(result => {
        console.log(`  ${result.format}: ${result.time.toFixed(2)}ms`);
      });
      
      // All formats should perform reasonably
      results.forEach(result => {
        expect(result.time).toBeLessThan(15);
      });
      
      // Performance should be consistent across formats (no format >2x slower)
      const maxTime = Math.max(...results.map(r => r.time));
      const minTime = Math.min(...results.map(r => r.time));
      expect(maxTime / minTime).toBeLessThan(2);
    });
  });

  describe('Argument Processing Performance', () => {
    test('should process arguments efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      const times: number[] = [];
      
      const context: ExecutionContext = {
        conversationHistory: [
          { role: 'user', content: 'Previous message', timestamp: Date.now() }
        ],
        environmentVars: process.env as Record<string, string>,
        promptDefaults: { format: 'text' }
      };
      
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const prompt = LARGE_PROMPT_SET[i % LARGE_PROMPT_SET.length];
        timer.start();
        await parsingSystem.argumentProcessor.processArguments(
          `test content ${i}`,
          prompt,
          context
        );
        times.push(timer.end());
      }
      
      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      
      console.log(`Argument Processing Performance:
        Average: ${averageTime.toFixed(2)}ms
        Max: ${maxTime.toFixed(2)}ms
        Target: <5ms per process`);
      
      expect(averageTime).toBeLessThan(5); // Target: under 5ms per process
      expect(maxTime).toBeLessThan(20); // No single process should take more than 20ms
    });

    test('should handle complex JSON arguments efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      const times: number[] = [];
      
      const complexJson = JSON.stringify({
        content: 'This is a complex argument with multiple fields',
        format: 'json',
        options: {
          nested: true,
          values: [1, 2, 3, 4, 5],
          metadata: { created: Date.now(), version: '1.0' }
        }
      });
      
      for (let i = 0; i < 50; i++) {
        timer.start();
        await parsingSystem.argumentProcessor.processArguments(
          complexJson,
          LARGE_PROMPT_SET[0]
        );
        times.push(timer.end());
      }
      
      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      
      console.log(`Complex JSON Processing Performance:
        Average: ${averageTime.toFixed(2)}ms
        JSON size: ${complexJson.length} characters`);
      
      expect(averageTime).toBeLessThan(10); // Complex JSON should still be fast
    });
  });

  describe('Context Resolution Performance', () => {
    test('should resolve context efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      const times: number[] = [];
      
      const context = {
        conversationHistory: Array(10).fill(null).map((_, i) => ({
          role: 'user',
          content: `Message ${i}`,
          timestamp: Date.now() - i * 1000
        }))
      };
      
      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        timer.start();
        await parsingSystem.contextResolver.resolveContext(
          `test_key_${i % 10}`,
          context
        );
        times.push(timer.end());
      }
      
      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      
      console.log(`Context Resolution Performance:
        Average: ${averageTime.toFixed(2)}ms
        Max: ${maxTime.toFixed(2)}ms
        Target: <3ms per resolution`);
      
      expect(averageTime).toBeLessThan(3); // Target: under 3ms per resolution
      expect(maxTime).toBeLessThan(15); // No single resolution should take more than 15ms
    });

    test('should benefit from caching', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      
      // First resolution (cache miss)
      timer.start();
      await parsingSystem.contextResolver.resolveContext('cached_key');
      const firstTime = timer.end();
      
      // Second resolution (cache hit)
      timer.start();
      await parsingSystem.contextResolver.resolveContext('cached_key');
      const secondTime = timer.end();
      
      console.log(`Caching Performance:
        Cache miss: ${firstTime.toFixed(2)}ms
        Cache hit: ${secondTime.toFixed(2)}ms
        Improvement: ${((firstTime - secondTime) / firstTime * 100).toFixed(1)}%`);
      
      expect(secondTime).toBeLessThan(firstTime * 0.5); // Cache should be at least 2x faster
      expect(secondTime).toBeLessThan(1); // Cache hits should be very fast
    });
  });

  describe('Memory Usage', () => {
    test('should maintain reasonable memory usage', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      
      // Get initial memory usage
      const initialMemory = process.memoryUsage();
      
      // Perform intensive operations
      for (let i = 0; i < 500; i++) {
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 100} content ${i}`,
          LARGE_PROMPT_SET.slice(0, 100)
        );
        
        await parsingSystem.argumentProcessor.processArguments(
          `content ${i}`,
          LARGE_PROMPT_SET[i % 100]
        );
        
        await parsingSystem.contextResolver.resolveContext(`key_${i % 50}`);
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      const heapGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024; // MB
      
      console.log(`Memory Usage:
        Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
        Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
        Growth: ${heapGrowth.toFixed(2)}MB`);
      
      expect(heapGrowth).toBeLessThan(50); // Should not grow by more than 50MB
    });
  });

  describe('Compatibility Wrapper Performance', () => {
    test('should maintain performance with wrapper overhead', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const wrapper = createCompatibilityWrapper(
        mockLogger,
        parsingSystem.commandParser,
        parsingSystem.argumentProcessor,
        parsingSystem.contextResolver
      );
      
      const timer = new PerformanceTimer();
      const directTimes: number[] = [];
      const wrapperTimes: number[] = [];
      
      // Benchmark direct parsing
      for (let i = 0; i < 50; i++) {
        timer.start();
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 10} content ${i}`,
          LARGE_PROMPT_SET.slice(0, 10)
        );
        directTimes.push(timer.end());
      }
      
      // Benchmark wrapper parsing
      for (let i = 0; i < 50; i++) {
        timer.start();
        await wrapper.parseCommand(`>>test_prompt_${i % 10} content ${i}`);
        wrapperTimes.push(timer.end());
      }
      
      const directAverage = directTimes.reduce((a, b) => a + b, 0) / directTimes.length;
      const wrapperAverage = wrapperTimes.reduce((a, b) => a + b, 0) / wrapperTimes.length;
      const overhead = ((wrapperAverage - directAverage) / directAverage) * 100;
      
      console.log(`Compatibility Wrapper Performance:
        Direct parsing: ${directAverage.toFixed(2)}ms
        Wrapper parsing: ${wrapperAverage.toFixed(2)}ms
        Overhead: ${overhead.toFixed(1)}%`);
      
      expect(overhead).toBeLessThan(25); // Wrapper should add less than 25% overhead
      expect(wrapperAverage).toBeLessThan(15); // Still reasonable absolute performance
    });
  });

  describe('Stress Testing', () => {
    test('should handle concurrent parsing requests', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const concurrentRequests = 20;
      const timer = new PerformanceTimer();
      
      timer.start();
      const promises = Array(concurrentRequests).fill(null).map(async (_, i) => {
        return parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 10} concurrent test ${i}`,
          LARGE_PROMPT_SET.slice(0, 10)
        );
      });
      
      await Promise.all(promises);
      const totalTime = timer.end();
      
      console.log(`Concurrent Parsing Performance:
        ${concurrentRequests} concurrent requests
        Total time: ${totalTime.toFixed(2)}ms
        Average per request: ${(totalTime / concurrentRequests).toFixed(2)}ms`);
      
      expect(totalTime).toBeLessThan(500); // Should handle concurrency well
    });

    test('should maintain performance under load', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const iterations = 1000;
      const batchSize = 100;
      const timer = new PerformanceTimer();
      
      timer.start();
      
      for (let batch = 0; batch < iterations / batchSize; batch++) {
        const batchPromises = [];
        
        for (let i = 0; i < batchSize; i++) {
          const index = batch * batchSize + i;
          batchPromises.push(
            parsingSystem.commandParser.parseCommand(
              `>>test_prompt_${index % 50} load test ${index}`,
              LARGE_PROMPT_SET.slice(0, 50)
            )
          );
        }
        
        await Promise.all(batchPromises);
      }
      
      const totalTime = timer.end();
      const averagePerParse = totalTime / iterations;
      
      console.log(`Load Testing Performance:
        ${iterations} total parses
        Total time: ${totalTime.toFixed(2)}ms
        Average per parse: ${averagePerParse.toFixed(2)}ms`);
      
      expect(averagePerParse).toBeLessThan(10); // Should maintain good performance under load
    });
  });
});

describe('Performance Regression Tests', () => {
  test('should not regress from baseline performance', async () => {
    // These would be actual baseline measurements from the old system
    const baselineCommandParsing = 15; // ms
    const baselineArgumentProcessing = 8; // ms
    const baselineContextResolution = 5; // ms
    
    const parsingSystem = createParsingSystem(mockLogger);
    const timer = new PerformanceTimer();
    
    // Test command parsing performance
    const commandTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      timer.start();
      await parsingSystem.commandParser.parseCommand(
        `>>test_prompt_${i % 5} regression test`,
        LARGE_PROMPT_SET.slice(0, 5)
      );
      commandTimes.push(timer.end());
    }
    const avgCommandTime = commandTimes.reduce((a, b) => a + b, 0) / commandTimes.length;
    
    // Test argument processing performance
    const argTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      timer.start();
      await parsingSystem.argumentProcessor.processArguments(
        'regression test content',
        LARGE_PROMPT_SET[0]
      );
      argTimes.push(timer.end());
    }
    const avgArgTime = argTimes.reduce((a, b) => a + b, 0) / argTimes.length;
    
    // Test context resolution performance
    const contextTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      timer.start();
      await parsingSystem.contextResolver.resolveContext('regression_test');
      contextTimes.push(timer.end());
    }
    const avgContextTime = contextTimes.reduce((a, b) => a + b, 0) / contextTimes.length;
    
    console.log(`Performance Regression Check:
      Command Parsing - Baseline: ${baselineCommandParsing}ms, Current: ${avgCommandTime.toFixed(2)}ms
      Argument Processing - Baseline: ${baselineArgumentProcessing}ms, Current: ${avgArgTime.toFixed(2)}ms
      Context Resolution - Baseline: ${baselineContextResolution}ms, Current: ${avgContextTime.toFixed(2)}ms`);
    
    // Allow for slight performance variations but no major regressions
    expect(avgCommandTime).toBeLessThan(baselineCommandParsing * 1.2);
    expect(avgArgTime).toBeLessThan(baselineArgumentProcessing * 1.2);
    expect(avgContextTime).toBeLessThan(baselineContextResolution * 1.2);
    
    // Ideally, we should see improvements
    console.log(`Performance Improvements:
      Command Parsing: ${((baselineCommandParsing - avgCommandTime) / baselineCommandParsing * 100).toFixed(1)}%
      Argument Processing: ${((baselineArgumentProcessing - avgArgTime) / baselineArgumentProcessing * 100).toFixed(1)}%
      Context Resolution: ${((baselineContextResolution - avgContextTime) / baselineContextResolution * 100).toFixed(1)}%`);
  });
});