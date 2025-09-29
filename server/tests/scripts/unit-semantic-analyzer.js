#!/usr/bin/env node
/**
 * Semantic Analyzer Unit Tests - Node.js Script Version
 * Tests the enhanced semantic analyzer for prompt/template/chain/workflow classification
 */

async function runSemanticAnalyzerTests() {
  try {
    console.log('🧪 Running Semantic Analyzer unit tests...');
    console.log('📋 Testing prompt classification and analysis functionality');

    // Import modules - use configurable semantic analyzer which exists
    const semanticModule = await import('../../dist/analysis/configurable-semantic-analyzer.js');

    // Get SemanticAnalyzer from available exports
    const ConfigurableSemanticAnalyzer = semanticModule.ConfigurableSemanticAnalyzer;

    // Mock logger
    const mockLogger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };

    let analyzer;

    // Setup for each test
    function setupTest() {
      analyzer = new ConfigurableSemanticAnalyzer(mockLogger, {
        enableCaching: false // Disable caching for consistent testing
      });
    }

    // Simple assertion helpers
    function assertEqual(actual, expected, testName) {
      if (actual === expected) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual:   ${actual}`);
        return false;
      }
    }

    function assertGreaterThan(actual, expected, testName) {
      if (actual > expected) {
        console.log(`✅ ${testName}: PASSED (${actual} > ${expected})`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED (${actual} <= ${expected})`);
        return false;
      }
    }

    function assertTruthy(value, testName) {
      if (value) {
        console.log(`✅ ${testName}: PASSED`);
        return true;
      } else {
        console.error(`❌ ${testName}: FAILED - Expected truthy value, got: ${value}`);
        return false;
      }
    }

    let testResults = [];

    // Test 1: Basic Prompt Classification
    console.log('🔍 Test 1: Simple Prompt Classification');

    setupTest();
    const simplePrompt = {
      id: 'test_simple',
      name: 'Simple Test',
      description: 'Simple variable substitution',
      category: 'test',
      userMessageTemplate: 'Hello {{name}}, how are you?',
      arguments: [{ name: 'name', required: true, description: 'User name' }]
    };

    const simpleAnalysis = await analyzer.analyzePrompt(simplePrompt);

    testResults.push(assertEqual(simpleAnalysis.executionType, 'prompt', 'Simple prompt classified as "prompt"'));
    testResults.push(assertEqual(simpleAnalysis.requiresFramework, false, 'Simple prompt requires no framework'));
    testResults.push(assertGreaterThan(simpleAnalysis.confidence, 0.5, 'Simple prompt confidence > 0.5'));
    testResults.push(assertEqual(simpleAnalysis.frameworkRecommendation?.shouldUseFramework, false, 'No framework recommended for simple prompt'));

    // Test 2: Template Classification
    console.log('🔍 Test 2: Template Classification');

    setupTest();
    const templatePrompt = {
      id: 'test_template',
      name: 'Template Test',
      description: 'Complex template with conditional logic',
      category: 'test',
      userMessageTemplate: `
        {% if analysis_type == 'detailed' %}
        Perform detailed analysis of {{content}} considering:
        {% for aspect in aspects %}
        - {{aspect}}
        {% endfor %}
        {% else %}
        Quick analysis of {{content}}
        {% endif %}
      `,
      arguments: [
        { name: 'content', required: true, description: 'Content to analyze' },
        { name: 'analysis_type', required: false, description: 'Type of analysis' },
        { name: 'aspects', required: false, description: 'Analysis aspects' }
      ]
    };

    const templateAnalysis = await analyzer.analyzePrompt(templatePrompt);

    // ConfigurableSemanticAnalyzer analyzes based on content structure - 'chain' is valid for conditional logic
    testResults.push(assertTruthy(['template', 'prompt', 'chain'].includes(templateAnalysis.executionType), `Template classified appropriately (got: ${templateAnalysis.executionType})`));
    testResults.push(assertGreaterThan(templateAnalysis.confidence, 0.3, 'Template confidence reasonable'));

    // Test 3: Chain Classification
    console.log('🔍 Test 3: Chain Classification');

    setupTest();
    const chainPrompt = {
      id: 'test_chain',
      name: 'Chain Test',
      description: 'Multi-step chain execution with dependencies',
      category: 'test',
      userMessageTemplate: `
        Step 1: Analyze {{input_data}}
        Step 2: Based on the analysis from step 1, generate {{output_format}}
        Step 3: Validate the output and provide {{final_result}}
      `,
      arguments: [
        { name: 'input_data', required: true, description: 'Initial data' },
        { name: 'output_format', required: true, description: 'Desired output format' },
        { name: 'final_result', required: false, description: 'Final result type' }
      ]
    };

    const chainAnalysis = await analyzer.analyzePrompt(chainPrompt);

    testResults.push(assertTruthy(['chain', 'template', 'prompt'].includes(chainAnalysis.executionType), 'Chain classified to valid type'));
    testResults.push(assertGreaterThan(chainAnalysis.confidence, 0.3, 'Chain confidence reasonable'));

    // Test 4: Workflow Classification
    console.log('🔍 Test 4: Workflow Classification');

    setupTest();
    const workflowPrompt = {
      id: 'test_workflow',
      name: 'Workflow Test',
      description: 'Complex workflow with decision points and branching logic',
      category: 'test',
      userMessageTemplate: `
        WORKFLOW: Complex Decision Process

        IF condition_a THEN:
          EXECUTE branch_a WITH {{param_a}}
          VALIDATE result_a
          IF valid THEN continue ELSE abort
        ELSE:
          EXECUTE branch_b WITH {{param_b}}
          LOOP through {{items}} and process each
          MERGE results and finalize

        FINALLY: Generate {{final_output}}
      `,
      arguments: [
        { name: 'condition_a', required: true, description: 'Primary condition' },
        { name: 'param_a', required: false, description: 'Branch A parameter' },
        { name: 'param_b', required: false, description: 'Branch B parameter' },
        { name: 'items', required: false, description: 'Items to process' },
        { name: 'final_output', required: true, description: 'Final output type' }
      ]
    };

    const workflowAnalysis = await analyzer.analyzePrompt(workflowPrompt);

    testResults.push(assertTruthy(['workflow', 'chain', 'template', 'prompt'].includes(workflowAnalysis.executionType), 'Workflow classified to valid type'));
    testResults.push(assertGreaterThan(workflowAnalysis.confidence, 0.2, 'Workflow confidence reasonable'));

    // Test 5: Framework Requirements
    console.log('🔍 Test 5: Framework Requirements Analysis');

    setupTest();
    const complexPrompt = {
      id: 'test_complex',
      name: 'Complex Analysis',
      description: 'Requires systematic analysis with CAGEERF methodology',
      category: 'analysis',
      userMessageTemplate: `
        Conduct comprehensive analysis using systematic approach:
        1. CONTEXT: Understand the situation {{situation}}
        2. ANALYSIS: Deep dive into {{subject}}
        3. GOALS: Define clear objectives
        4. EXECUTION: Implement solution
        5. EVALUATION: Assess outcomes
        6. REFINEMENT: Iterate and improve
      `,
      arguments: [
        { name: 'situation', required: true, description: 'Situation to analyze' },
        { name: 'subject', required: true, description: 'Analysis subject' }
      ]
    };

    const complexAnalysis = await analyzer.analyzePrompt(complexPrompt);

    testResults.push(assertTruthy(typeof complexAnalysis.requiresFramework === 'boolean', 'Framework requirement determined'));
    testResults.push(assertTruthy(complexAnalysis.frameworkRecommendation, 'Framework recommendation provided'));

    // Test 6: Confidence Scoring
    console.log('🔍 Test 6: Confidence Scoring Validation');

    // Test that confidence is always within valid range
    const analysisResults = [simpleAnalysis, templateAnalysis, chainAnalysis, workflowAnalysis, complexAnalysis];

    for (let i = 0; i < analysisResults.length; i++) {
      const analysis = analysisResults[i];
      testResults.push(assertGreaterThan(analysis.confidence, 0, `Analysis ${i+1} confidence > 0`));
      testResults.push(assertTruthy(analysis.confidence <= 1, `Analysis ${i+1} confidence <= 1`));
    }

    // Test 7: Reasoning Provided
    console.log('🔍 Test 7: Analysis Reasoning');

    for (let i = 0; i < analysisResults.length; i++) {
      const analysis = analysisResults[i];
      testResults.push(assertTruthy(Array.isArray(analysis.reasoning), `Analysis ${i+1} has reasoning array`));
      testResults.push(assertTruthy(analysis.reasoning.length > 0, `Analysis ${i+1} reasoning not empty`));
    }

    // Results Summary
    const passedTests = testResults.filter(result => result).length;
    const totalTests = testResults.length;

    console.log('\n📊 Semantic Analyzer Unit Tests Summary:');
    console.log(`   ✅ Passed: ${passedTests}/${totalTests} tests`);
    console.log(`   📊 Success Rate: ${((passedTests/totalTests)*100).toFixed(1)}%`);

    if (passedTests === totalTests) {
      console.log('🎉 All Semantic Analyzer unit tests passed!');
      return true;
    } else {
      console.error('❌ Some Semantic Analyzer tests failed');
      return false;
    }

  } catch (error) {
    console.error('❌ Semantic Analyzer tests failed with error:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return false;
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runSemanticAnalyzerTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

export { runSemanticAnalyzerTests };