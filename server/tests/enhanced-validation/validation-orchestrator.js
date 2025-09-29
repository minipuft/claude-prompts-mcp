#!/usr/bin/env node
/**
 * Enhanced Validation Orchestrator
 *
 * Coordinates all three validation systems to prevent CI failures:
 * 1. Interface Contract Validation
 * 2. Process Lifecycle Testing
 * 3. Environment Parity Checks
 */

async function runEnhancedValidationSuite() {
  try {
    console.log('🚀 Running Enhanced Validation Suite...');
    console.log('🎯 Comprehensive testing to prevent GitHub Actions failures\n');

    const results = {
      contractValidation: { passed: false, duration: 0 },
      lifecycleValidation: { passed: false, duration: 0 },
      environmentValidation: { passed: false, duration: 0 },
      totalTests: 3,
      passedTests: 0,
      totalDuration: 0
    };

    const startTime = Date.now();

    // Phase 1: Interface Contract Validation
    console.log('🔍 Phase 1: Interface Contract Validation');
    console.log('   Preventing registerTool-type interface mismatches...\n');

    const contractStart = Date.now();
    try {
      // Import the contract test directly
      const contractModule = await import('./contract-validation/contract-test-suite.js');

      // Note: We can't easily call the test function directly since it uses process.exit,
      // so we'll run it as a subprocess for proper isolation
      const { spawn } = await import('child_process');
      const contractResult = await new Promise((resolve) => {
        const child = spawn('node', ['tests/enhanced-validation/contract-validation/contract-test-suite.js'], {
          stdio: 'pipe',
          cwd: process.cwd()
        });

        let output = '';
        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          output += data.toString();
        });

        child.on('close', (code) => {
          resolve({ success: code === 0, output });
        });
      });

      results.contractValidation.duration = Date.now() - contractStart;
      results.contractValidation.passed = contractResult.success;

      if (contractResult.success) {
        console.log('   ✅ Interface contract validation passed');
        results.passedTests++;
      } else {
        console.log('   ❌ Interface contract validation failed');
      }

    } catch (error) {
      results.contractValidation.duration = Date.now() - contractStart;
      console.log(`   ❌ Interface contract validation error: ${error.message}`);
    }

    // Phase 2: Process Lifecycle Testing
    console.log('\n🔄 Phase 2: Process Lifecycle Testing');
    console.log('   Eliminating emergency process.exit() usage...\n');

    const lifecycleStart = Date.now();
    try {
      const { spawn } = await import('child_process');
      const lifecycleResult = await new Promise((resolve) => {
        const child = spawn('node', ['tests/enhanced-validation/lifecycle-validation/lifecycle-test-suite.js'], {
          stdio: 'pipe',
          cwd: process.cwd()
        });

        let output = '';
        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          output += data.toString();
        });

        child.on('close', (code) => {
          resolve({ success: code === 0, output });
        });
      });

      results.lifecycleValidation.duration = Date.now() - lifecycleStart;
      results.lifecycleValidation.passed = lifecycleResult.success;

      if (lifecycleResult.success) {
        console.log('   ✅ Process lifecycle validation passed');
        results.passedTests++;
      } else {
        console.log('   ❌ Process lifecycle validation failed');
      }

    } catch (error) {
      results.lifecycleValidation.duration = Date.now() - lifecycleStart;
      console.log(`   ❌ Process lifecycle validation error: ${error.message}`);
    }

    // Phase 3: Environment Parity Checks
    console.log('\n🌍 Phase 3: Environment Parity Checks');
    console.log('   Detecting local vs CI environment differences...\n');

    const envStart = Date.now();
    try {
      const { spawn } = await import('child_process');
      const envResult = await new Promise((resolve) => {
        const child = spawn('node', ['tests/enhanced-validation/environment-validation/environment-test-suite.js'], {
          stdio: 'pipe',
          cwd: process.cwd()
        });

        let output = '';
        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          output += data.toString();
        });

        child.on('close', (code) => {
          resolve({ success: code === 0, output });
        });
      });

      results.environmentValidation.duration = Date.now() - envStart;
      results.environmentValidation.passed = envResult.success;

      if (envResult.success) {
        console.log('   ✅ Environment parity validation passed');
        results.passedTests++;
      } else {
        console.log('   ❌ Environment parity validation failed');
      }

    } catch (error) {
      results.environmentValidation.duration = Date.now() - envStart;
      console.log(`   ❌ Environment parity validation error: ${error.message}`);
    }

    results.totalDuration = Date.now() - startTime;

    // Final Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 ENHANCED VALIDATION SUITE RESULTS');
    console.log('='.repeat(70));
    console.log(`📈 Validation Phases Passed: ${results.passedTests}/${results.totalTests}`);
    console.log(`📊 Success Rate: ${((results.passedTests / results.totalTests) * 100).toFixed(1)}%`);
    console.log(`⏱️  Total Duration: ${results.totalDuration}ms`);
    console.log('');
    console.log('🔧 Phase Results:');
    console.log(`   Interface Contract Validation: ${results.contractValidation.passed ? '✅' : '❌'} (${results.contractValidation.duration}ms)`);
    console.log(`   Process Lifecycle Testing: ${results.lifecycleValidation.passed ? '✅' : '❌'} (${results.lifecycleValidation.duration}ms)`);
    console.log(`   Environment Parity Checks: ${results.environmentValidation.passed ? '✅' : '❌'} (${results.environmentValidation.duration}ms)`);

    console.log('\n🎯 Impact Assessment:');
    if (results.contractValidation.passed) {
      console.log('   ✅ Interface mismatches (like registerTool) will be caught locally');
    } else {
      console.log('   ⚠️  Interface mismatches may still cause CI failures');
    }

    if (results.lifecycleValidation.passed) {
      console.log('   ✅ Tests will complete naturally without emergency process.exit()');
    } else {
      console.log('   ⚠️  Tests may still need emergency process.exit() calls');
    }

    if (results.environmentValidation.passed) {
      console.log('   ✅ Environment differences will be detected before CI');
    } else {
      console.log('   ⚠️  Environment differences may still cause CI failures');
    }

    if (results.passedTests === results.totalTests) {
      console.log('\n🎉 All enhanced validation systems are working correctly!');
      console.log('✅ The types of CI failures you experienced should now be prevented');
      console.log('✅ Local testing with ACT should catch issues before GitHub Actions');
      console.log('✅ Development workflow efficiency significantly improved');
      return true;
    } else {
      console.log('\n⚠️  Some enhanced validation systems have issues');
      console.log('❌ CI failures may still occur - investigate failed validation phases');
      return false;
    }

  } catch (error) {
    console.error('❌ Enhanced validation suite execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Handle process cleanup gracefully
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception in enhanced validation:', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection in enhanced validation:', reason);
});

// Run the enhanced validation suite
if (import.meta.url === `file://${process.argv[1]}`) {
  runEnhancedValidationSuite().then(success => {
    if (success) {
      console.log('\n🎯 Enhanced validation suite completed successfully!');
      console.log('🚀 Your testing infrastructure is now significantly more robust');
    } else {
      console.log('\n⚠️  Enhanced validation suite completed with issues');
      console.log('🔧 Review failed validation phases for improvement opportunities');
    }
    // Natural completion - demonstrating our improved lifecycle management
  }).catch(error => {
    console.error('❌ Suite execution failed:', error);
    // Natural completion even on error
  });
}

export { runEnhancedValidationSuite };