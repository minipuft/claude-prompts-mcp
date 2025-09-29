/**
 * Simplified Performance Benchmark Tests for Parsing System
 *
 * Core performance tests focusing on essential benchmarks
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { performance } from 'perf_hooks';
import { Logger } from '../../src/logging/index.js';
import { PromptData } from '../../src/types/index.js';
import {
  createParsingSystem,
  type ExecutionContext
} from '../../src/execution/parsers/index.js';

// Mock logger for testing
const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
} as any;

// Generate test prompts
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
  const TEST_PROMPTS = generateTestPrompts(100);
  const BENCHMARK_ITERATIONS = 50;

  describe('Command Parsing Performance', () => {
    test('should parse commands efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      const times: number[] = [];

      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        timer.start();
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 10} hello world ${i}`,
          TEST_PROMPTS.slice(0, 10)
        );
        times.push(timer.end());
      }

      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      console.log(`Command Parsing Performance:
        Average: ${averageTime.toFixed(2)}ms
        Max: ${maxTime.toFixed(2)}ms`);

      expect(averageTime).toBeLessThan(10); // Target: under 10ms per parse
      expect(maxTime).toBeLessThan(50); // No single parse should take more than 50ms
    });

    test('should handle different command formats consistently', async () => {
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

        for (let i = 0; i < 10; i++) {
          timer.start();
          await parsingSystem.commandParser.parseCommand(command, TEST_PROMPTS.slice(0, 10));
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

      // Performance should be consistent across formats
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
        const prompt = TEST_PROMPTS[i % TEST_PROMPTS.length];
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
        Max: ${maxTime.toFixed(2)}ms`);

      expect(averageTime).toBeLessThan(5); // Target: under 5ms per process
      expect(maxTime).toBeLessThan(20); // No single process should take more than 20ms
    });
  });

  describe('Context Resolution Performance', () => {
    test('should resolve context efficiently', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();
      const times: number[] = [];

      for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        timer.start();
        await parsingSystem.contextResolver.resolveContext(`test_key_${i % 10}`);
        times.push(timer.end());
      }

      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      console.log(`Context Resolution Performance:
        Average: ${averageTime.toFixed(2)}ms
        Max: ${maxTime.toFixed(2)}ms`);

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
      for (let i = 0; i < 200; i++) {
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 50} content ${i}`,
          TEST_PROMPTS.slice(0, 50)
        );

        await parsingSystem.argumentProcessor.processArguments(
          `content ${i}`,
          TEST_PROMPTS[i % 50]
        );

        await parsingSystem.contextResolver.resolveContext(`key_${i % 25}`);
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

      expect(heapGrowth).toBeLessThan(25); // Should not grow by more than 25MB
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent parsing requests', async () => {
      const parsingSystem = createParsingSystem(mockLogger);
      const concurrentRequests = 10;
      const timer = new PerformanceTimer();

      timer.start();
      const promises = Array(concurrentRequests).fill(null).map(async (_, i) => {
        return parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 5} concurrent test ${i}`,
          TEST_PROMPTS.slice(0, 5)
        );
      });

      await Promise.all(promises);
      const totalTime = timer.end();

      console.log(`Concurrent Parsing Performance:
        ${concurrentRequests} concurrent requests
        Total time: ${totalTime.toFixed(2)}ms
        Average per request: ${(totalTime / concurrentRequests).toFixed(2)}ms`);

      expect(totalTime).toBeLessThan(250); // Should handle concurrency well
    });
  });

  describe('Performance Regression Tests', () => {
    test('should not regress from baseline performance', async () => {
      // Baseline measurements (these would be actual measurements from previous versions)
      const baselineCommandParsing = 15; // ms
      const baselineArgumentProcessing = 8; // ms
      const baselineContextResolution = 5; // ms

      const parsingSystem = createParsingSystem(mockLogger);
      const timer = new PerformanceTimer();

      // Test command parsing performance
      const commandTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
        timer.start();
        await parsingSystem.commandParser.parseCommand(
          `>>test_prompt_${i % 5} regression test`,
          TEST_PROMPTS.slice(0, 5)
        );
        commandTimes.push(timer.end());
      }
      const avgCommandTime = commandTimes.reduce((a, b) => a + b, 0) / commandTimes.length;

      // Test argument processing performance
      const argTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
        timer.start();
        await parsingSystem.argumentProcessor.processArguments(
          'regression test content',
          TEST_PROMPTS[0]
        );
        argTimes.push(timer.end());
      }
      const avgArgTime = argTimes.reduce((a, b) => a + b, 0) / argTimes.length;

      // Test context resolution performance
      const contextTimes: number[] = [];
      for (let i = 0; i < 10; i++) {
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
    });
  });
});