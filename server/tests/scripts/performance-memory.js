#!/usr/bin/env node
/**
 * Performance and Memory Tests
 * Replaces complex inline scripts from GitHub Actions with proper test script
 */

async function performanceTests() {
  try {
    console.log('🧪 Running performance and memory tests...');
    
    const { CAGEERFAnalyzer } = await import('../../dist/utils/cageerf-analyzer.js');
    const { TemplateGenerator } = await import('../../dist/utils/template-generator.js');
    
    console.log('⏱️  Starting performance tests...');
    
    const analyzer = new CAGEERFAnalyzer();
    const generator = new TemplateGenerator();
    
    // Performance benchmark
    const testPrompts = [
      'Simple analysis task',
      'Complex multi-faceted analysis requiring comprehensive context evaluation, systematic goal setting, detailed execution planning, thorough evaluation criteria, and iterative refinement processes',
      'Medium complexity prompt with CAGEERF elements'
    ];
    
    console.log('📊 Analysis Performance:');
    for (let i = 0; i < testPrompts.length; i++) {
      const start = Date.now();
      const analysis = analyzer.analyzeText(testPrompts[i]);
      const duration = Date.now() - start;
      console.log(`   Prompt ${i + 1}: ${duration}ms (score: ${analysis.frameworkScore.toFixed(3)})`);
      
      if (duration > 1000) {
        console.log(`⚠️  Warning: Analysis took ${duration}ms (threshold: 1000ms)`);
      }
    }
    
    // Template generation performance
    console.log('📊 Template Generation Performance:');
    const complexities = ['simple', 'intermediate', 'advanced'];
    
    for (const complexity of complexities) {
      const start = Date.now();
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
      const duration = Date.now() - start;
      console.log(`   ${complexity}: ${duration}ms (length: ${template.userMessageTemplate.length}, score: ${template.qualityScore.toFixed(3)})`);
      
      if (duration > 2000) {
        console.log(`⚠️  Warning: Template generation took ${duration}ms (threshold: 2000ms)`);
      }
    }
    
    // Memory usage test
    console.log('💾 Memory Usage Test:');
    const initialMemory = process.memoryUsage().heapUsed;
    console.log(`Initial memory: ${Math.round(initialMemory / 1024 / 1024)}MB heap`);
    
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
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;
    
    console.log(`Final memory: ${Math.round(finalMemory / 1024 / 1024)}MB heap`);
    console.log(`Memory increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB for 50 operations`);
    
    if (memoryIncrease > 25 * 1024 * 1024) {
      console.log(`⚠️  Potential memory leak: ${Math.round(memoryIncrease / 1024 / 1024)}MB increase`);
    } else {
      console.log(`✅ Memory usage acceptable: ${Math.round(memoryIncrease / 1024 / 1024)}MB increase for 50 operations`);
    }
    
    // Memory stability test
    console.log('📊 Memory Stability Test:');
    const measurements = [];
    
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
      const memory = process.memoryUsage().heapUsed;
      measurements.push(memory);
      
      // Brief pause between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Analyze memory stability
    const maxMemory = Math.max(...measurements);
    const minMemory = Math.min(...measurements);
    const memoryRange = maxMemory - minMemory;
    const averageMemory = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    
    console.log(`Memory range: ${Math.round(minMemory / 1024 / 1024)} - ${Math.round(maxMemory / 1024 / 1024)}MB (range: ${Math.round(memoryRange / 1024 / 1024)}MB)`);
    console.log(`Average memory: ${Math.round(averageMemory / 1024 / 1024)}MB`);
    
    // Memory should remain relatively stable (range < 50MB)
    if (memoryRange > 50 * 1024 * 1024) {
      console.log(`⚠️  Memory instability detected: ${Math.round(memoryRange / 1024 / 1024)}MB range`);
    } else {
      console.log(`✅ Memory stability acceptable: ${Math.round(memoryRange / 1024 / 1024)}MB range`);
    }
    
    console.log('✅ Performance and memory tests completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Performance tests failed:', error.message);
    process.exit(1);
  }
}

performanceTests();