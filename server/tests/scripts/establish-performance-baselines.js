#!/usr/bin/env node
/**
 * Performance Baseline Establishment
 *
 * Measures actual system performance to establish evidence-based baselines
 * instead of arbitrary thresholds.
 */

async function establishPerformanceBaselines() {
  try {
    console.log('📊 Establishing Evidence-Based Performance Baselines...');
    console.log('🎯 Measuring actual system performance for realistic thresholds\n');

    const measurements = {
      startup: [],
      routing: [],
      framework: [],
      memory: []
    };

    // Import performance measurement modules
    const { Application } = await import('../../dist/runtime/application.js');
    const { UnifiedCommandParser } = await import('../../dist/execution/parsers/unified-command-parser.js');
    const { FrameworkStateManager } = await import('../../dist/frameworks/framework-state-manager.js');
    const { createSimpleLogger } = await import('../../dist/logging/index.js');

    console.log('🚀 Measuring Startup Performance (5 iterations)...');

    // Measure startup performance multiple times for consistency
    for (let i = 0; i < 5; i++) {
      const logger = createSimpleLogger();
      const application = new Application(logger);

      const startupStart = performance.now();

      const configStart = performance.now();
      await application.loadConfiguration();
      const configDuration = performance.now() - configStart;

      const promptsStart = performance.now();
      await application.loadPromptsData();
      const promptsDuration = performance.now() - promptsStart;

      const modulesStart = performance.now();
      await application.initializeModules();
      const modulesDuration = performance.now() - modulesStart;

      const totalStartup = performance.now() - startupStart;

      measurements.startup.push({
        total: totalStartup,
        config: configDuration,
        prompts: promptsDuration,
        modules: modulesDuration
      });

      console.log(`   Run ${i + 1}: ${totalStartup.toFixed(0)}ms total (config: ${configDuration.toFixed(0)}ms, prompts: ${promptsDuration.toFixed(0)}ms, modules: ${modulesDuration.toFixed(0)}ms)`);
    }

    console.log('\n🧠 Measuring Command Routing Performance (100 iterations)...');

    // Measure command routing performance
    const parser = new UnifiedCommandParser();
    const testCommands = [
      '>>listprompts',
      '>>help',
      '>>status',
      '>>framework switch CAGEERF',
      '>>some_prompt_name'
    ];

    for (let i = 0; i < 100; i++) {
      for (const command of testCommands) {
        const start = performance.now();
        try {
          parser.parseCommand(command);
        } catch (error) {
          // Some commands expected to fail
        }
        const duration = performance.now() - start;
        measurements.routing.push(duration);
      }
    }

    console.log('\n🔄 Measuring Framework Switching Performance (10 iterations)...');

    // Measure framework switching performance
    const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const stateManager = new FrameworkStateManager(mockLogger);

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      try {
        await stateManager.switchFramework('CAGEERF', 'Performance baseline test');
      } catch (error) {
        // May fail in test environment, that's ok
      }
      const duration = performance.now() - start;
      measurements.framework.push(duration);
    }

    console.log('\n💾 Measuring Memory Usage...');

    // Measure memory usage
    const memoryBefore = process.memoryUsage();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const memoryAfter = process.memoryUsage();
    measurements.memory.push({
      heapUsed: memoryAfter.heapUsed,
      heapTotal: memoryAfter.heapTotal,
      external: memoryAfter.external,
      rss: memoryAfter.rss
    });

    // Calculate statistics
    console.log('\n📈 Performance Baseline Analysis:');

    // Startup baselines
    const startupStats = calculateStats(measurements.startup.map(m => m.total));
    const configStats = calculateStats(measurements.startup.map(m => m.config));
    const promptsStats = calculateStats(measurements.startup.map(m => m.prompts));
    const modulesStats = calculateStats(measurements.startup.map(m => m.modules));

    console.log('\n🚀 Startup Performance Baselines:');
    console.log(`   Total Startup: avg=${startupStats.avg.toFixed(0)}ms, max=${startupStats.max.toFixed(0)}ms, p95=${startupStats.p95.toFixed(0)}ms`);
    console.log(`   Config Loading: avg=${configStats.avg.toFixed(0)}ms, max=${configStats.max.toFixed(0)}ms, p95=${configStats.p95.toFixed(0)}ms`);
    console.log(`   Prompts Loading: avg=${promptsStats.avg.toFixed(0)}ms, max=${promptsStats.max.toFixed(0)}ms, p95=${promptsStats.p95.toFixed(0)}ms`);
    console.log(`   Modules Init: avg=${modulesStats.avg.toFixed(0)}ms, max=${modulesStats.max.toFixed(0)}ms, p95=${modulesStats.p95.toFixed(0)}ms`);

    // Routing baselines
    const routingStats = calculateStats(measurements.routing);
    console.log('\n🧠 Command Routing Performance Baselines:');
    console.log(`   Routing Detection: avg=${routingStats.avg.toFixed(2)}ms, max=${routingStats.max.toFixed(2)}ms, p95=${routingStats.p95.toFixed(2)}ms`);

    // Framework baselines
    if (measurements.framework.length > 0) {
      const frameworkStats = calculateStats(measurements.framework);
      console.log('\n🔄 Framework Switching Performance Baselines:');
      console.log(`   Framework Switch: avg=${frameworkStats.avg.toFixed(0)}ms, max=${frameworkStats.max.toFixed(0)}ms, p95=${frameworkStats.p95.toFixed(0)}ms`);
    }

    // Memory baselines
    const memUsage = measurements.memory[0];
    console.log('\n💾 Memory Usage Baselines:');
    console.log(`   Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)}MB`);

    // Generate recommended baselines (p95 + 20% margin)
    console.log('\n🎯 Recommended Evidence-Based Baselines:');

    const RECOMMENDED_BASELINES = {
      startup: Math.ceil(startupStats.p95 * 1.2),
      config: Math.ceil(configStats.p95 * 1.2),
      prompts: Math.ceil(promptsStats.p95 * 1.2),
      modules: Math.ceil(modulesStats.p95 * 1.2),
      routing: Math.ceil(routingStats.p95 * 1.2 * 100) / 100, // Round to 2 decimals
      memory: Math.ceil((memUsage.rss / 1024 / 1024) * 1.5) // 50% margin for memory
    };

    console.log(`   PERFORMANCE_BASELINES = {`);
    console.log(`     startup: ${RECOMMENDED_BASELINES.startup},     // ${RECOMMENDED_BASELINES.startup}ms max total startup`);
    console.log(`     config: ${RECOMMENDED_BASELINES.config},      // ${RECOMMENDED_BASELINES.config}ms config loading`);
    console.log(`     prompts: ${RECOMMENDED_BASELINES.prompts},    // ${RECOMMENDED_BASELINES.prompts}ms prompts loading`);
    console.log(`     modules: ${RECOMMENDED_BASELINES.modules},    // ${RECOMMENDED_BASELINES.modules}ms modules initialization`);
    console.log(`     routing: ${RECOMMENDED_BASELINES.routing},     // ${RECOMMENDED_BASELINES.routing}ms command routing detection`);
    console.log(`     memory: ${RECOMMENDED_BASELINES.memory}      // ${RECOMMENDED_BASELINES.memory}MB RSS memory usage`);
    console.log(`   };`);

    console.log('\n✅ Evidence-based performance baselines established!');
    console.log('   These baselines are based on actual measured performance with safety margins.');

    // Write baselines to a file for reference
    const baselinesConfig = {
      measured: new Date().toISOString(),
      startup: RECOMMENDED_BASELINES.startup,
      config: RECOMMENDED_BASELINES.config,
      prompts: RECOMMENDED_BASELINES.prompts,
      modules: RECOMMENDED_BASELINES.modules,
      routing: RECOMMENDED_BASELINES.routing,
      memory: RECOMMENDED_BASELINES.memory,
      measurements: {
        startup: measurements.startup,
        routing: routingStats,
        memory: memUsage
      }
    };

    require('fs').writeFileSync('performance-baselines.json', JSON.stringify(baselinesConfig, null, 2));
    console.log('\n💾 Baselines saved to performance-baselines.json');

    process.exit(0);

  } catch (error) {
    console.error('❌ Performance baseline establishment failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

function calculateStats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[p95Index];

  return { avg, min, max, p95 };
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  establishPerformanceBaselines();
}

export { establishPerformanceBaselines };