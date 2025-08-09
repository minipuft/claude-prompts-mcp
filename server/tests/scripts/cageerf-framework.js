#!/usr/bin/env node
/**
 * CAGEERF Framework Comprehensive Tests
 * Replaces complex inline scripts from GitHub Actions with proper test script
 */

async function comprehensiveFrameworkTests() {
  try {
    console.log('🧪 Running comprehensive CAGEERF framework tests...');
    
    const { CAGEERFAnalyzer } = await import('../../dist/utils/cageerf-analyzer.js');
    const { TemplateGenerator } = await import('../../dist/utils/template-generator.js');
    const { TemplateRepositoryBuilder } = await import('../../dist/utils/template-repository.js');
    const { SemanticAnalyzer } = await import('../../dist/utils/semanticAnalyzer.js');
    const { MockLogger } = await import('../../dist/utils/index.js');
    
    console.log('🔍 Test 1: CAGEERF Analyzer edge cases');
    
    const analyzer = new CAGEERFAnalyzer();
    
    const testCases = [
      'Simple prompt',
      'Context analysis goals execution evaluation refinement framework methodology',
      'A'.repeat(1000),  // Long input
      '🚀 Analyze 📊 the data with systematic approach! 🎯'  // With emojis
    ];
    
    for (let i = 0; i < testCases.length; i++) {
      const analysis = analyzer.analyzeText(testCases[i]);
      if (!analysis.compliance || analysis.frameworkScore === undefined || analysis.overallCompliance === undefined) {
        throw new Error(`Invalid analysis structure for test case ${i + 1}`);
      }
      if (analysis.frameworkScore < 0 || analysis.frameworkScore > 1) {
        throw new Error(`Invalid framework score: ${analysis.frameworkScore}`);
      }
      console.log(`✅ Test case ${i + 1} passed (score: ${analysis.frameworkScore.toFixed(3)})`);
    }
    
    console.log('🔍 Test 2: Template Generator validation');
    const generator = new TemplateGenerator();
    const complexities = ['simple', 'intermediate', 'advanced'];
    const styles = ['structured', 'conversational', 'professional'];
    
    for (const complexity of complexities) {
      for (const style of styles) {
        const template = await generator.generateTemplate({
          useCase: `Test ${complexity} ${style}`,
          domain: 'Testing',
          complexity: complexity,
          frameworkEmphasis: {
            context: true, analysis: true, goals: true,
            execution: true, evaluation: true, refinement: true, framework: true
          },
          templateStyle: style,
          includePlaceholders: true
        });
        
        if (!template.userMessageTemplate || typeof template.userMessageTemplate !== 'string') {
          throw new Error('Invalid template content');
        }
        if (!template.qualityScore || template.qualityScore < 0 || template.qualityScore > 1) {
          throw new Error(`Invalid CAGEERF score: ${template.qualityScore}`);
        }
        console.log(`✅ Template ${complexity}/${style} passed (score: ${template.qualityScore.toFixed(3)})`);
      }
    }
    
    console.log('🔍 Test 3: Template Repository validation');
    const repository = TemplateRepositoryBuilder.buildRepository();
    if (!repository.templates || !Array.isArray(repository.templates)) {
      throw new Error('Invalid templates array');
    }
    console.log(`✅ Repository validation passed: ${repository.templates.length} templates`);
    
    console.log('🔍 Test 4: Semantic Analyzer enhanced functionality');
    const semanticAnalyzer = new SemanticAnalyzer(new MockLogger());
    const testPrompt = {
      id: 'test-prompt-001',
      name: 'Test Analysis Prompt',
      userMessageTemplate: 'Analyze the context, set goals, execute systematic evaluation',
      description: 'Test prompt for semantic analysis',
      category: 'test',
      arguments: [],
      systemMessage: 'Test system message'
    };
    
    const classification = semanticAnalyzer.classifyPrompt(testPrompt);
    if (!classification.executionType || classification.confidence === undefined) {
      throw new Error('Invalid classification structure');
    }
    if (!classification.cageerfAnalysis || classification.frameworkCompliance === undefined) {
      throw new Error('Missing CAGEERF integration');
    }
    console.log(`✅ Semantic analysis passed: ${classification.executionType} (confidence: ${classification.confidence.toFixed(3)})`);
    
    console.log('🎉 Comprehensive CAGEERF framework tests completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ CAGEERF framework tests failed:', error.message);
    process.exit(1);
  }
}

comprehensiveFrameworkTests();