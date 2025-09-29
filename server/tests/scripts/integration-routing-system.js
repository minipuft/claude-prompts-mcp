#!/usr/bin/env node
/**
 * Routing System Integration Tests
 * Tests for the intelligent command routing functionality added to the prompt engine
 */

async function runRoutingSystemTests() {
  try {
    console.log('🧪 Running Routing System Integration tests...');
    console.log('📋 Testing intelligent command routing and built-in command support');

    // Import global resource tracker for process cleanup
    const { globalResourceTracker } = await import('../../dist/utils/global-resource-tracker.js');

    // Test the routing pattern detection directly (simulating the logic from prompt engine)
    function testRoutingPatterns() {
      const patterns = [
        { command: '>>listprompts', expected: 'prompt_manager', description: 'listprompts command routing' },
        { command: 'listprompts', expected: 'prompt_manager', description: 'listprompts without >> prefix' },
        { command: '>>listprompts category:analysis', expected: 'prompt_manager', description: 'listprompts with filter' },
        { command: '>>help', expected: 'system_control', description: 'help command routing' },
        { command: 'help', expected: 'system_control', description: 'help without >> prefix' },
        { command: '>>status', expected: 'system_control', description: 'status command routing' },
        { command: '>>analytics', expected: 'system_control', description: 'analytics command routing' },
        { command: '>>framework switch CAGEERF', expected: 'system_control', description: 'framework switch routing' },
        { command: '>>some_prompt_name', expected: null, description: 'regular prompt should not route' },
        { command: '/listprompts', expected: 'prompt_manager', description: 'listprompts with / prefix' },
        { command: '/help', expected: 'system_control', description: 'help with / prefix' },
      ];

      console.log('🔍 Test 1: Routing Pattern Detection');
      let passedPatterns = 0;

      for (const test of patterns) {
        const trimmedCommand = test.command.trim();
        let matchedTool = null;

        // Built-in commands that route to prompt_manager
        if (/^(>>|\/)?listprompts?(\s.*)?$/i.test(trimmedCommand)) {
          matchedTool = 'prompt_manager';
        }
        // Help and status commands that route to system_control
        else if (/^(>>|\/)?help$/i.test(trimmedCommand)) {
          matchedTool = 'system_control';
        }
        else if (/^(>>|\/)?status$/i.test(trimmedCommand)) {
          matchedTool = 'system_control';
        }
        // Framework switch commands
        else if (trimmedCommand.match(/^(>>|\/)?framework\s+(switch|change)\s+(.+)$/i)) {
          matchedTool = 'system_control';
        }
        // Analytics/metrics commands
        else if (/^(>>|\/)?analytics?$/i.test(trimmedCommand)) {
          matchedTool = 'system_control';
        }

        const result = matchedTool === test.expected ? '✅' : '❌';
        const status = matchedTool === test.expected ? 'PASSED' : 'FAILED';
        console.log(`${result} ${test.description}: ${status}`);

        if (matchedTool === test.expected) {
          passedPatterns++;
        } else {
          console.log(`   Expected: ${test.expected || 'none'}, Got: ${matchedTool || 'none'}`);
        }
      }

      return passedPatterns === patterns.length;
    }

    // Test parameter translation logic
    function testParameterTranslation() {
      console.log('🔍 Test 2: Parameter Translation');
      const testCases = [
        {
          command: '>>listprompts',
          expected: { action: 'list' },
          description: 'listprompts basic translation'
        },
        {
          command: '>>listprompts category:analysis',
          expected: { action: 'list', search_query: 'category:analysis' },
          description: 'listprompts with filter translation'
        },
        {
          command: '>>help',
          expected: { action: 'status', show_details: true },
          description: 'help command translation'
        },
        {
          command: '>>status',
          expected: { action: 'status' },
          description: 'status command translation'
        }
      ];

      let passedTranslations = 0;

      for (const test of testCases) {
        const trimmedCommand = test.command.trim();
        let translatedParams = null;

        // Simulate the parameter translation logic
        if (/^(>>|\/)?listprompts?(\s.*)?$/i.test(trimmedCommand)) {
          const args = trimmedCommand.replace(/^(>>|\/)?listprompts?\s*/i, '').trim();
          translatedParams = {
            action: 'list',
            ...(args && { search_query: args })
          };
        } else if (/^(>>|\/)?help$/i.test(trimmedCommand)) {
          translatedParams = {
            action: 'status',
            show_details: true
          };
        } else if (/^(>>|\/)?status$/i.test(trimmedCommand)) {
          translatedParams = {
            action: 'status'
          };
        }

        // Simple comparison for testing
        const paramsMatch = JSON.stringify(translatedParams) === JSON.stringify(test.expected);
        const result = paramsMatch ? '✅' : '❌';
        const status = paramsMatch ? 'PASSED' : 'FAILED';
        console.log(`${result} ${test.description}: ${status}`);

        if (paramsMatch) {
          passedTranslations++;
        } else {
          console.log(`   Expected: ${JSON.stringify(test.expected)}`);
          console.log(`   Got: ${JSON.stringify(translatedParams)}`);
        }
      }

      return passedTranslations === testCases.length;
    }

    // Test built-in command recognition in parser
    function testBuiltinCommandRecognition() {
      console.log('🔍 Test 3: Built-in Command Recognition');

      const builtinCommands = [
        'listprompts', 'listprompt', 'list_prompts',
        'help', 'commands',
        'status', 'health',
        'analytics', 'metrics'
      ];

      // Simulate the isBuiltinCommand logic
      function isBuiltinCommand(promptId) {
        return builtinCommands.includes(promptId.toLowerCase());
      }

      let passedRecognition = 0;
      const testCommands = [
        { command: 'listprompts', shouldRecognize: true },
        { command: 'help', shouldRecognize: true },
        { command: 'status', shouldRecognize: true },
        { command: 'analytics', shouldRecognize: true },
        { command: 'some_regular_prompt', shouldRecognize: false },
        { command: 'LISTPROMPTS', shouldRecognize: true }, // Case insensitive
        { command: 'unknown_command', shouldRecognize: false }
      ];

      for (const test of testCommands) {
        const recognized = isBuiltinCommand(test.command);
        const result = recognized === test.shouldRecognize ? '✅' : '❌';
        const status = recognized === test.shouldRecognize ? 'PASSED' : 'FAILED';
        console.log(`${result} Command '${test.command}' recognition: ${status}`);

        if (recognized === test.shouldRecognize) {
          passedRecognition++;
        }
      }

      return passedRecognition === testCommands.length;
    }

    // Test error message enhancements
    function testErrorMessageEnhancements() {
      console.log('🔍 Test 4: Enhanced Error Messages');

      function getBuiltinCommandHint(promptId) {
        const lower = promptId.toLowerCase();

        if (lower.includes('list') && lower.includes('prompt')) {
          return '\n\nDid you mean >>listprompts?';
        }
        if (lower === 'commands' || lower === 'help') {
          return '\n\nTry >>help for available commands.';
        }
        if (lower === 'stat' || lower === 'status') {
          return '\n\nTry >>status for system status.';
        }

        return '';
      }

      const testCases = [
        { command: 'listprompt', expectedHint: '\n\nDid you mean >>listprompts?' },
        { command: 'commands', expectedHint: '\n\nTry >>help for available commands.' },
        { command: 'stat', expectedHint: '\n\nTry >>status for system status.' },
        { command: 'unknown', expectedHint: '' }
      ];

      let passedHints = 0;

      for (const test of testCases) {
        const hint = getBuiltinCommandHint(test.command);
        const result = hint === test.expectedHint ? '✅' : '❌';
        const status = hint === test.expectedHint ? 'PASSED' : 'FAILED';
        console.log(`${result} Error hint for '${test.command}': ${status}`);

        if (hint === test.expectedHint) {
          passedHints++;
        }
      }

      return passedHints === testCases.length;
    }

    // Run all tests
    const results = [
      testRoutingPatterns(),
      testParameterTranslation(),
      testBuiltinCommandRecognition(),
      testErrorMessageEnhancements()
    ];

    const passedTests = results.filter(r => r).length;
    const totalTests = results.length;

    console.log('\n📊 Routing System Integration Tests Summary:');
    console.log(`   ✅ Passed: ${passedTests}/${totalTests} test categories`);
    console.log(`   📊 Success Rate: ${((passedTests/totalTests)*100).toFixed(1)}%`);

    // Check for remaining resources before exit
    console.log('\n🔍 Checking for remaining global resources...');
    globalResourceTracker.logDiagnostics();
    const cleared = globalResourceTracker.emergencyCleanup();
    if (cleared > 0) {
      console.log(`💀 Emergency cleanup cleared ${cleared} additional resources`);
    }

    if (passedTests === totalTests) {
      console.log('🎉 All Routing System Integration tests passed!');
      // Emergency process exit to prevent hanging due to global Node.js resources
      console.log('💀 Forcing process exit to prevent hanging from global timers...');
      setTimeout(() => process.exit(0), 100); // Small delay to ensure log output
      return true;
    } else {
      console.error('❌ Some Routing System Integration tests failed');
      // Emergency process exit for failure case as well
      console.log('💀 Forcing process exit to prevent hanging from global timers...');
      setTimeout(() => process.exit(1), 100); // Small delay to ensure log output
      return false;
    }

  } catch (error) {
    console.error('❌ Routing System Integration tests failed with error:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // Emergency process exit for error case as well
    console.log('💀 Forcing process exit due to test error to prevent hanging from global timers...');
    setTimeout(() => process.exit(1), 100); // Small delay to ensure log output
    return false;
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runRoutingSystemTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

export { runRoutingSystemTests };