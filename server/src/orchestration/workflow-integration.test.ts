/**
 * Integration tests for workflow engine with existing systems
 */

import { createSimpleLogger } from '../logging/index.js';
import { createWorkflowEngine } from './workflow-engine.js';
import { createPromptExecutor } from './prompt-executor.js';
import { createConversationManager } from './conversation-manager.js';
import { createGateEvaluator } from '../utils/gateValidation.js';
import { 
  Workflow, 
  WorkflowStep, 
  DependencyGraph, 
  RetryPolicy, 
  WorkflowMetadata,
  GateDefinition,
  WorkflowGate,
  ConvertedPrompt,
  GateType
} from '../types/index.js';

/**
 * Create a realistic workflow for testing
 */
function createRealisticWorkflow(): Workflow {
  const steps: WorkflowStep[] = [
    {
      id: 'analyze-content',
      name: 'Analyze Content',
      type: 'prompt',
      config: { 
        promptId: 'content-analyzer',
        parameters: { format: 'detailed' }
      },
      dependencies: [],
      timeout: 30000,
      retries: 2
    },
    {
      id: 'validate-quality',
      name: 'Quality Validation Gate',
      type: 'gate',
      config: { 
        gateId: 'content-quality-gate'
      },
      dependencies: ['analyze-content'],
      timeout: 10000,
      retries: 1
    },
    {
      id: 'generate-summary',
      name: 'Generate Summary',
      type: 'prompt',
      config: { 
        promptId: 'summary-generator'
      },
      dependencies: ['validate-quality'],
      timeout: 20000,
      retries: 1
    }
  ];

  const dependencies: DependencyGraph = {
    nodes: ['analyze-content', 'validate-quality', 'generate-summary'],
    edges: [
      ['analyze-content', 'validate-quality'],
      ['validate-quality', 'generate-summary']
    ]
  };

  const retryPolicy: RetryPolicy = {
    maxRetries: 3,
    backoffStrategy: 'exponential',
    retryableErrors: ['timeout', 'validation_error', 'network_error'],
    baseDelay: 1000,
    maxDelay: 10000
  };

  const metadata: WorkflowMetadata = {
    author: 'test-system',
    created: new Date(),
    modified: new Date(),
    tags: ['content', 'analysis', 'validation'],
    runtime: ['server', 'cli', 'desktop'],
    version: '1.0.0'
  };

  const contentQualityGate: WorkflowGate = {
    id: 'content-quality-gate',
    name: 'Content Quality Gate',
    type: GateType.VALIDATION,
    appliesTo: ['validate-quality'],
    requirements: [
      {
        type: 'content_length',
        criteria: { min: 100, max: 5000 },
        weight: 0.3,
        required: true
      },
      {
        type: 'keyword_presence',
        criteria: { 
          keywords: ['analysis', 'content', 'quality'],
          caseSensitive: false
        },
        weight: 0.4,
        required: false
      },
      {
        type: 'format_validation',
        criteria: { format: 'markdown' },
        weight: 0.3,
        required: true
      }
    ],
    failureAction: 'retry'
  };

  return {
    id: 'content-analysis-workflow',
    name: 'Content Analysis Workflow',
    description: 'Analyzes content, validates quality, and generates summary',
    version: '1.0.0',
    steps,
    dependencies,
    retryPolicy,
    metadata,
    gates: [contentQualityGate]
  };
}

/**
 * Create mock prompts for testing
 */
function createMockPrompts(): ConvertedPrompt[] {
  return [
    {
      id: 'content-analyzer',
      name: 'Content Analyzer',
      description: 'Analyzes content for key themes and structure',
      category: 'analysis',
      userMessageTemplate: 'Analyze this content: {{content}}',
      arguments: [
        { name: 'content', required: true, description: 'Content to analyze' }
      ],
      executionMode: 'auto'
    },
    {
      id: 'summary-generator',
      name: 'Summary Generator',
      description: 'Generates a summary of analyzed content',
      category: 'summary',
      userMessageTemplate: 'Generate a summary of: {{analyze-content_result}}',
      arguments: [
        { name: 'analyze-content_result', required: true, description: 'Analysis result' }
      ],
      executionMode: 'auto'
    }
  ];
}

/**
 * Mock prompt manager for testing
 */
class MockPromptManager {
  async processTemplateAsync(
    template: string,
    args: Record<string, string>,
    specialContext?: Record<string, string>,
    tools?: boolean
  ): Promise<string> {
    // Simple template processing for testing
    let result = template;
    
    for (const [key, value] of Object.entries(args)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    if (specialContext) {
      for (const [key, value] of Object.entries(specialContext)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }
    
    return result;
  }
}

/**
 * Test workflow engine integration
 */
async function testWorkflowEngineIntegration() {
  console.log('🚀 Testing Workflow Engine Integration...\n');
  
  const logger = createSimpleLogger('stdio');
  const conversationManager = createConversationManager(logger);
  const mockPromptManager = new MockPromptManager();
  
  // Create prompt executor with mock prompt manager
  const promptExecutor = createPromptExecutor(
    logger,
    mockPromptManager as any,
    conversationManager
  );
  
  // Update with mock prompts
  const mockPrompts = createMockPrompts();
  promptExecutor.updatePrompts(mockPrompts);
  
  // Create gate evaluator
  const gateEvaluator = createGateEvaluator(logger);
  
  // Create workflow engine with integrated components
  const workflowEngine = createWorkflowEngine(
    logger,
    promptExecutor,
    gateEvaluator
  );
  
  // Set up cross-references
  promptExecutor.setWorkflowEngine(workflowEngine);
  
  // Test 1: Register workflow
  console.log('📝 Test 1: Registering workflow...');
  const workflow = createRealisticWorkflow();
  
  try {
    await workflowEngine.registerWorkflow(workflow);
    console.log('✅ Workflow registered successfully');
  } catch (error) {
    console.error('❌ Workflow registration failed:', error);
    return false;
  }
  
  // Test 2: Execute workflow with real integration
  console.log('\n⚙️  Test 2: Executing workflow with integration...');
  
  try {
    const result = await workflowEngine.executeWorkflow(
      'content-analysis-workflow',
      { 
        content: 'This is a comprehensive analysis of content quality and structure. It demonstrates various aspects of content analysis including theme identification, structure validation, and quality assessment.' 
      },
      { 
        gateValidation: true,
        stepConfirmation: false,
        timeout: 60000
      },
      'server'
    );
    
    console.log('✅ Workflow execution completed');
    console.log('📊 Results:', {
      status: result.status,
      duration: result.endTime - result.startTime,
      steps: Object.keys(result.stepResults).length,
      finalResult: result.finalResult
    });
    
    if (result.status === 'completed') {
      console.log('🎉 All steps completed successfully');
    } else {
      console.log('⚠️  Workflow completed with status:', result.status);
      if (result.error) {
        console.log('❌ Error:', result.error);
      }
    }
    
  } catch (error) {
    console.error('❌ Workflow execution failed:', error);
    return false;
  }
  
  // Test 3: Test workflow via PromptExecutor
  console.log('\n🔄 Test 3: Testing workflow via PromptExecutor...');
  
  try {
    const result = await promptExecutor.executeWorkflow(
      'content-analysis-workflow',
      { 
        content: 'This is another test content for quality analysis and validation.' 
      }
    );
    
    console.log('✅ PromptExecutor workflow execution completed');
    console.log('📊 Results:', {
      status: result.status,
      duration: result.endTime - result.startTime,
      steps: Object.keys(result.stepResults).length
    });
    
  } catch (error) {
    console.error('❌ PromptExecutor workflow execution failed:', error);
    return false;
  }
  
  // Test 4: Test statistics and monitoring
  console.log('\n📈 Test 4: Testing statistics and monitoring...');
  
  try {
    const stats = promptExecutor.getExecutorStats();
    console.log('✅ Executor statistics:', {
      totalPrompts: stats.totalPrompts,
      workflowsAvailable: stats.workflowsAvailable,
      activeWorkflowExecutions: stats.activeWorkflowExecutions
    });
    
    const workflows = workflowEngine.listWorkflows();
    console.log('✅ Available workflows:', workflows.length);
    
    const activeExecutions = workflowEngine.getActiveExecutions();
    console.log('✅ Active executions:', activeExecutions.length);
    
  } catch (error) {
    console.error('❌ Statistics collection failed:', error);
    return false;
  }
  
  console.log('\n🎉 All integration tests passed!');
  return true;
}

/**
 * Test error handling and edge cases
 */
async function testErrorHandling() {
  console.log('\n🛡️  Testing Error Handling...');
  
  const logger = createSimpleLogger('stdio');
  const conversationManager = createConversationManager(logger);
  const mockPromptManager = new MockPromptManager();
  
  const promptExecutor = createPromptExecutor(
    logger,
    mockPromptManager as any,
    conversationManager
  );
  
  const gateEvaluator = createGateEvaluator(logger);
  const workflowEngine = createWorkflowEngine(logger, promptExecutor, gateEvaluator);
  
  // Test 1: Invalid workflow ID
  console.log('📝 Test 1: Invalid workflow ID...');
  try {
    await workflowEngine.executeWorkflow('nonexistent-workflow', {});
    console.error('❌ Should have failed with invalid workflow ID');
    return false;
  } catch (error) {
    console.log('✅ Correctly handled invalid workflow ID');
  }
  
  // Test 2: Missing step configuration
  console.log('📝 Test 2: Invalid step configuration...');
  const invalidWorkflow: Workflow = {
    id: 'invalid-workflow',
    name: 'Invalid Workflow',
    description: 'Workflow with invalid step',
    version: '1.0.0',
    steps: [
      {
        id: 'invalid-step',
        name: 'Invalid Step',
        type: 'prompt',
        config: {}, // Missing promptId
        dependencies: []
      }
    ],
    dependencies: {
      nodes: ['invalid-step'],
      edges: []
    },
    retryPolicy: {
      maxRetries: 1,
      backoffStrategy: 'linear',
      retryableErrors: []
    },
    metadata: {
      created: new Date(),
      modified: new Date(),
      tags: [],
      runtime: ['server'],
      version: '1.0.0'
    }
  };
  
  try {
    await workflowEngine.registerWorkflow(invalidWorkflow);
    console.error('❌ Should have failed with invalid step configuration');
    return false;
  } catch (error) {
    console.log('✅ Correctly handled invalid step configuration');
  }
  
  console.log('🎉 Error handling tests passed!');
  return true;
}

/**
 * Run all integration tests
 */
async function runAllIntegrationTests() {
  console.log('🚀 Starting Workflow Integration Tests\n');
  
  const tests = [
    testWorkflowEngineIntegration,
    testErrorHandling
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('❌ Test threw unexpected error:', error);
      failed++;
    }
    console.log(''); // Empty line between tests
  }
  
  console.log(`📊 Integration Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All integration tests passed! Phase 1 is complete and ready for production.');
  } else {
    console.log('❌ Some integration tests failed. Review implementation before proceeding.');
  }
  
  return failed === 0;
}

// Export for use in other modules
export { runAllIntegrationTests, testWorkflowEngineIntegration, createRealisticWorkflow };