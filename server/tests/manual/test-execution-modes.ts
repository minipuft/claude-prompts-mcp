/**
 * Manual test for execution mode functionality
 *
 * Run with: npx tsx tests/manual/test-execution-modes.ts
 */

import { ToolDetectionService } from '../../src/scripts/detection/tool-detection-service.js';
import { ExecutionModeService } from '../../src/scripts/execution/execution-mode-service.js';
import { DEFAULT_EXECUTION_CONFIG } from '../../src/scripts/types.js';
import type { LoadedScriptTool, ExecutionConfig } from '../../src/scripts/types.js';

// Test fixtures matching actual prompts
const wordCountTool: LoadedScriptTool = {
  id: 'word_count',
  name: 'Word Counter',
  description: 'Counts words, characters, and lines in text',
  scriptPath: 'script.py',
  runtime: 'python',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to analyze' },
      include_whitespace: { type: 'boolean', description: 'Include whitespace', default: false },
    },
    required: ['text'],
  },
  toolDir: '/prompts/general/test_prompt/tools/word_count',
  absoluteScriptPath: '/prompts/general/test_prompt/tools/word_count/script.py',
  promptId: 'test_prompt',
  descriptionContent: 'Counts words',
  enabled: true,
  execution: {
    mode: 'auto',
    trigger: 'parameter_match',
    confidence: 0.8,
  },
};

const methodologyBuilderTool: LoadedScriptTool = {
  id: 'methodology_builder',
  name: 'Methodology Builder',
  description: 'Validates methodology definitions',
  scriptPath: 'script.py',
  runtime: 'python',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      methodology: { type: 'string' },
    },
    required: ['name', 'methodology'],
  },
  toolDir: '/prompts/framework-authoring/create_methodology/tools/methodology_builder',
  absoluteScriptPath: '/prompts/framework-authoring/create_methodology/tools/methodology_builder/script.py',
  promptId: 'create_methodology',
  descriptionContent: 'Builds methodologies',
  enabled: true,
  execution: {
    mode: 'confirm',
    trigger: 'parameter_match',
    confidence: 0.85,
    confirmMessage: 'Create new methodology with the provided configuration?',
  },
};

const manualTool: LoadedScriptTool = {
  ...wordCountTool,
  id: 'expensive_analyzer',
  name: 'Expensive Analyzer',
  execution: {
    mode: 'manual',
    trigger: 'parameter_match',
    confidence: 0.8,
  },
};

function runTests() {
  const detectionService = new ToolDetectionService({ debug: true, minConfidence: 0.7 });
  const modeService = new ExecutionModeService({ debug: true });

  console.log('\n' + '='.repeat(70));
  console.log('SCRIPT-TOOLS EXECUTION MODE TESTS');
  console.log('='.repeat(70));

  // ===== TEST 1: Auto mode - PASS (text provided) =====
  console.log('\n--- TEST 1: Auto mode with matching args (should PASS) ---');
  const test1Matches = detectionService.detectTools('', { text: 'Hello world' }, [wordCountTool]);
  console.log('Args: { text: "Hello world" }');
  console.log('Matches:', test1Matches.length);
  if (test1Matches.length > 0) {
    console.log('  Tool:', test1Matches[0].toolId);
    console.log('  Confidence:', test1Matches[0].confidence);
    console.log('  Mode:', test1Matches[0].recommendedMode);
    console.log('  Explicit:', test1Matches[0].explicitRequest);

    const filterResult = modeService.filterByExecutionMode(test1Matches, [wordCountTool], 'test_prompt');
    console.log('Filter result:');
    console.log('  Ready for execution:', filterResult.readyForExecution.length);
    console.log('  Requires confirmation:', filterResult.requiresConfirmation);
    console.log('✅ PASS - Tool detected and ready for execution');
  } else {
    console.log('❌ FAIL - Tool not detected');
  }

  // ===== TEST 2: Auto mode - FAIL (text missing) =====
  console.log('\n--- TEST 2: Auto mode with missing args (should FAIL detection) ---');
  const test2Matches = detectionService.detectTools('', { other: 'value' }, [wordCountTool]);
  console.log('Args: { other: "value" }');
  console.log('Matches:', test2Matches.length);
  if (test2Matches.length === 0) {
    console.log('✅ PASS - Tool correctly NOT detected (missing required args)');
  } else {
    console.log('❌ FAIL - Tool should not have been detected');
  }

  // ===== TEST 3: Confirm mode - pending confirmation =====
  console.log('\n--- TEST 3: Confirm mode (should require confirmation) ---');
  const test3Matches = detectionService.detectTools('', { name: 'TestMethod', methodology: 'TEST' }, [methodologyBuilderTool]);
  console.log('Args: { name: "TestMethod", methodology: "TEST" }');
  console.log('Matches:', test3Matches.length);
  if (test3Matches.length > 0) {
    console.log('  Tool:', test3Matches[0].toolId);
    console.log('  Confidence:', test3Matches[0].confidence);
    console.log('  Mode:', test3Matches[0].recommendedMode);

    const filterResult = modeService.filterByExecutionMode(test3Matches, [methodologyBuilderTool], 'create_methodology');
    console.log('Filter result:');
    console.log('  Ready for execution:', filterResult.readyForExecution.length);
    console.log('  Pending confirmation:', filterResult.pendingConfirmation.length);
    console.log('  Requires confirmation:', filterResult.requiresConfirmation);

    if (filterResult.requiresConfirmation) {
      console.log('Confirmation message:', filterResult.pendingConfirmation[0]?.message);
      const response = modeService.buildConfirmationResponse(filterResult, 'create_methodology');
      console.log('Resume command:', response.resumeCommand);
      console.log('✅ PASS - Tool requires confirmation as expected');
    } else {
      console.log('❌ FAIL - Tool should require confirmation');
    }
  } else {
    console.log('❌ FAIL - Tool not detected');
  }

  // ===== TEST 4: Confirm mode - explicit bypass =====
  console.log('\n--- TEST 4: Confirm mode with explicit tool arg (should bypass) ---');
  const test4Matches = detectionService.detectTools('', {
    name: 'TestMethod',
    methodology: 'TEST',
    'tool:methodology_builder': true  // Explicit request
  }, [methodologyBuilderTool]);
  console.log('Args: { name: "TestMethod", methodology: "TEST", "tool:methodology_builder": true }');
  console.log('Matches:', test4Matches.length);
  if (test4Matches.length > 0) {
    console.log('  Explicit:', test4Matches[0].explicitRequest);

    const filterResult = modeService.filterByExecutionMode(test4Matches, [methodologyBuilderTool], 'create_methodology');
    console.log('Filter result:');
    console.log('  Ready for execution:', filterResult.readyForExecution.length);
    console.log('  Requires confirmation:', filterResult.requiresConfirmation);

    if (!filterResult.requiresConfirmation && filterResult.readyForExecution.length > 0) {
      console.log('✅ PASS - Explicit arg bypassed confirmation');
    } else {
      console.log('❌ FAIL - Should have bypassed confirmation');
    }
  }

  // ===== TEST 5: Manual mode - skipped without explicit =====
  console.log('\n--- TEST 5: Manual mode without explicit (should skip) ---');
  const test5Matches = detectionService.detectTools('', { text: 'Hello world' }, [manualTool]);
  console.log('Args: { text: "Hello world" }');
  console.log('Matches:', test5Matches.length);
  if (test5Matches.length === 0) {
    console.log('✅ PASS - Manual tool correctly skipped without explicit request');
  } else {
    console.log('❌ FAIL - Manual tool should have been skipped');
  }

  // ===== TEST 6: Manual mode - with explicit arg =====
  console.log('\n--- TEST 6: Manual mode with explicit arg (should execute) ---');
  const test6Matches = detectionService.detectTools('', {
    text: 'Hello world',
    tool: 'expensive_analyzer'  // Explicit request
  }, [manualTool]);
  console.log('Args: { text: "Hello world", tool: "expensive_analyzer" }');
  console.log('Matches:', test6Matches.length);
  if (test6Matches.length > 0) {
    console.log('  Explicit:', test6Matches[0].explicitRequest);

    const filterResult = modeService.filterByExecutionMode(test6Matches, [manualTool], 'test_prompt');
    console.log('Filter result:');
    console.log('  Ready for execution:', filterResult.readyForExecution.length);
    console.log('  Skipped manual:', filterResult.skippedManual.length);

    if (filterResult.readyForExecution.length > 0) {
      console.log('✅ PASS - Manual tool executed with explicit request');
    } else {
      console.log('❌ FAIL - Manual tool should have executed');
    }
  } else {
    console.log('❌ FAIL - Tool not detected');
  }

  // ===== TEST 7: Confidence threshold - below threshold =====
  console.log('\n--- TEST 7: Confidence below tool threshold (should FAIL) ---');
  const highConfTool: LoadedScriptTool = {
    ...wordCountTool,
    id: 'high_conf_tool',
    execution: {
      mode: 'auto',
      trigger: 'parameter_match',
      confidence: 0.95,  // Higher than the 0.9 that parameter match produces
    },
  };
  const test7Matches = detectionService.detectTools('', { text: 'Hello world' }, [highConfTool]);
  console.log('Tool confidence threshold: 0.95');
  console.log('Args: { text: "Hello world" }');
  console.log('Matches:', test7Matches.length);
  if (test7Matches.length === 0) {
    console.log('✅ PASS - Tool correctly not matched (confidence 0.9 < threshold 0.95)');
  } else {
    console.log('Confidence achieved:', test7Matches[0].confidence);
    console.log('❌ FAIL - Tool should not have matched at 0.95 threshold');
  }

  // ===== TEST 8: Always trigger =====
  console.log('\n--- TEST 8: Always trigger (should always match) ---');
  const alwaysTool: LoadedScriptTool = {
    ...wordCountTool,
    id: 'always_tool',
    execution: {
      mode: 'auto',
      trigger: 'always',
      confidence: 0.8,
    },
  };
  const test8Matches = detectionService.detectTools('completely unrelated input', {}, [alwaysTool]);
  console.log('Args: {} (empty)');
  console.log('Matches:', test8Matches.length);
  if (test8Matches.length > 0) {
    console.log('  Confidence:', test8Matches[0].confidence);
    console.log('✅ PASS - Always trigger matched with no args');
  } else {
    console.log('❌ FAIL - Always trigger should have matched');
  }

  console.log('\n' + '='.repeat(70));
  console.log('TESTS COMPLETE');
  console.log('='.repeat(70) + '\n');
}

runTests();
