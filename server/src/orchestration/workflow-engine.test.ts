/**
 * Basic tests for workflow engine functionality
 */

import { createWorkflowEngine } from './workflow-engine.js';
import { createSimpleLogger } from '../logging/index.js';
import { Workflow, WorkflowStep, DependencyGraph, RetryPolicy, WorkflowMetadata } from '../types/index.js';

/**
 * Create a test workflow for validation
 */
function createTestWorkflow(): Workflow {
  const steps: WorkflowStep[] = [
    {
      id: 'step1',
      name: 'Initial Step',
      type: 'prompt',
      config: { promptId: 'test-prompt-1' },
      dependencies: []
    },
    {
      id: 'step2',
      name: 'Second Step',
      type: 'prompt',
      config: { promptId: 'test-prompt-2' },
      dependencies: ['step1']
    },
    {
      id: 'step3',
      name: 'Final Step',
      type: 'gate',
      config: { gateId: 'test-gate-1' },
      dependencies: ['step2']
    }
  ];

  const dependencies: DependencyGraph = {
    nodes: ['step1', 'step2', 'step3'],
    edges: [
      ['step1', 'step2'],
      ['step2', 'step3']
    ]
  };

  const retryPolicy: RetryPolicy = {
    maxRetries: 3,
    backoffStrategy: 'exponential',
    retryableErrors: ['timeout', 'network_error']
  };

  const metadata: WorkflowMetadata = {
    author: 'test-author',
    created: new Date(),
    modified: new Date(),
    tags: ['test', 'basic'],
    runtime: ['server', 'cli'],
    version: '1.0.0'
  };

  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    description: 'A simple test workflow for validation',
    version: '1.0.0',
    steps,
    dependencies,
    retryPolicy,
    metadata
  };
}

/**
 * Test workflow registration and basic functionality
 */
async function testWorkflowEngine() {
  console.log('Testing Workflow Engine...');
  
  const logger = createSimpleLogger('stdio');
  const engine = createWorkflowEngine(logger);
  
  // Test 1: Create and register a workflow
  const testWorkflow = createTestWorkflow();
  
  try {
    await engine.registerWorkflow(testWorkflow);
    console.log('✅ Workflow registration successful');
  } catch (error) {
    console.error('❌ Workflow registration failed:', error);
    return false;
  }
  
  // Test 2: Verify workflow is registered
  const retrievedWorkflow = engine.getWorkflow('test-workflow');
  if (retrievedWorkflow && retrievedWorkflow.id === 'test-workflow') {
    console.log('✅ Workflow retrieval successful');
  } else {
    console.error('❌ Workflow retrieval failed');
    return false;
  }
  
  // Test 3: List workflows
  const workflows = engine.listWorkflows();
  if (workflows.length === 1 && workflows[0].id === 'test-workflow') {
    console.log('✅ Workflow listing successful');
  } else {
    console.error('❌ Workflow listing failed');
    return false;
  }
  
  // Test 4: Execute workflow (will use placeholder implementations)
  try {
    const result = await engine.executeWorkflow('test-workflow', { 
      input: 'test input' 
    });
    
    if (result.status === 'completed') {
      console.log('✅ Workflow execution successful');
      console.log('  Result:', result.finalResult);
    } else {
      console.error('❌ Workflow execution failed:', result.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Workflow execution threw error:', error);
    return false;
  }
  
  console.log('🎉 All workflow engine tests passed!');
  return true;
}

/**
 * Test workflow with invalid configuration
 */
async function testWorkflowValidation() {
  console.log('Testing Workflow Validation...');
  
  const logger = createSimpleLogger('stdio');
  const engine = createWorkflowEngine(logger);
  
  // Test invalid workflow (missing required fields)
  const invalidWorkflow = {
    id: '',  // Invalid: empty ID
    name: 'Invalid Workflow',
    version: '1.0.0',
    steps: [],  // Invalid: no steps
    dependencies: { nodes: [], edges: [] },
    retryPolicy: { maxRetries: 1, backoffStrategy: 'linear' as const, retryableErrors: [] },
    metadata: {
      created: new Date(),
      modified: new Date(),
      tags: [],
      runtime: ['server' as const],
      version: '1.0.0'
    }
  } as Workflow;
  
  try {
    await engine.registerWorkflow(invalidWorkflow);
    console.error('❌ Invalid workflow was accepted (should have failed)');
    return false;
  } catch (error) {
    console.log('✅ Invalid workflow correctly rejected:', error instanceof Error ? error.message : String(error));
    return true;
  }
}

/**
 * Test workflow with circular dependencies
 */
async function testCircularDependencies() {
  console.log('Testing Circular Dependency Detection...');
  
  const logger = createSimpleLogger('stdio');
  const engine = createWorkflowEngine(logger);
  
  // Create workflow with circular dependency
  const circularWorkflow: Workflow = {
    id: 'circular-workflow',
    name: 'Circular Workflow',
    description: 'Workflow with circular dependencies',
    version: '1.0.0',
    steps: [
      {
        id: 'step1',
        name: 'Step 1',
        type: 'prompt',
        config: { promptId: 'test-prompt-1' },
        dependencies: ['step2']  // Circular: step1 depends on step2
      },
      {
        id: 'step2',
        name: 'Step 2',
        type: 'prompt',
        config: { promptId: 'test-prompt-2' },
        dependencies: ['step1']  // Circular: step2 depends on step1
      }
    ],
    dependencies: {
      nodes: ['step1', 'step2'],
      edges: [
        ['step1', 'step2'],
        ['step2', 'step1']
      ]
    },
    retryPolicy: {
      maxRetries: 1,
      backoffStrategy: 'linear',
      retryableErrors: []
    },
    metadata: {
      created: new Date(),
      modified: new Date(),
      tags: ['test'],
      runtime: ['server'],
      version: '1.0.0'
    }
  };
  
  try {
    await engine.registerWorkflow(circularWorkflow);
    console.error('❌ Circular workflow was accepted (should have failed)');
    return false;
  } catch (error) {
    console.log('✅ Circular dependency correctly detected:', error instanceof Error ? error.message : String(error));
    return true;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting Workflow Engine Tests\n');
  
  const tests = [
    testWorkflowEngine,
    testWorkflowValidation,
    testCircularDependencies
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
  
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! Workflow Engine is ready for integration.');
  } else {
    console.log('❌ Some tests failed. Review implementation before proceeding.');
  }
  
  return failed === 0;
}

// Export for use in other modules
export { runAllTests, testWorkflowEngine, createTestWorkflow };