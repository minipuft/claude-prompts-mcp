async function quickFrameworkTest() {
  const { CAGEERFAnalyzer } = await import('./dist/utils/cageerf-analyzer.js');
  const { TemplateGenerator } = await import('./dist/utils/template-generator.js');
  const { MockLogger } = await import('./dist/utils/index.js');
  
  console.log('🔍 Quick framework test...');
  
  // Test CAGEERF Analyzer
  const analyzer = new CAGEERFAnalyzer();
  const analysis = analyzer.analyzePrompt('Test prompt with context and analysis components');
  if (\!analysis.compliance || \!analysis.frameworkScore) {
    throw new Error('CAGEERF Analyzer failed');
  }
  console.log('✅ CAGEERF Analyzer working');
  
  // Test Template Generator
  const generator = new TemplateGenerator();
  const template = await generator.generateTemplate({
    useCase: 'Test',
    domain: 'Testing',
    complexity: 'simple',
    frameworkEmphasis: { context: true, analysis: true, goals: true, execution: true, evaluation: true, refinement: true, framework: true },
    templateStyle: 'structured'
  });
  if (\!template.userMessageTemplate) {
    throw new Error('Template Generator failed');
  }
  console.log('✅ Template Generator working');
  
  console.log('🎉 Quick framework test completed successfully');
}

quickFrameworkTest().catch(error => {
  console.error('❌ Framework test failed:', error.message);
  process.exit(1);
});
