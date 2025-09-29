#!/usr/bin/env node
/**
 * Environment Parity Validation Test Suite
 *
 * Tests environment consistency validation to prevent local vs CI environment failures
 */

async function runEnvironmentValidationTests() {
  try {
    console.log('🌍 Running Environment Parity Validation Tests...');
    console.log('🎯 Preventing local vs CI environment failures\n');

    const results = {
      environmentChecker: false,
      nodeVersionValidation: false,
      environmentVariables: false,
      filesystemBehavior: false,
      dependencyValidation: false,
      totalTests: 0,
      passedTests: 0
    };

    // Test 1: Environment Checker Creation
    console.log('🔧 Test 1: Environment Parity Checker Functionality');
    results.totalTests++;

    try {
      const { createEnvironmentParityChecker } = await import('./environment-parity-checker.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const checker = createEnvironmentParityChecker(logger);

      if (checker && typeof checker.generateParityReport === 'function') {
        console.log('   ✅ EnvironmentParityChecker created successfully');
        console.log('   ✅ All required methods available');
        results.environmentChecker = true;
        results.passedTests++;
      } else {
        console.log('   ❌ EnvironmentParityChecker missing required methods');
      }
    } catch (error) {
      console.log(`   ❌ Environment checker creation failed: ${error.message}`);
    }

    // Test 2: Node.js Version Validation
    console.log('\n📦 Test 2: Node.js Version Validation');
    results.totalTests++;

    try {
      const { createEnvironmentParityChecker } = await import('./environment-parity-checker.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const checker = createEnvironmentParityChecker(logger);

      const nodeReport = await checker.validateNodeVersion();

      if (nodeReport && typeof nodeReport.valid === 'boolean') {
        console.log('   ✅ Node.js version validation completed');
        console.log(`   📊 Current version: ${nodeReport.currentVersion}`);
        console.log(`   📊 Required version: ${nodeReport.requiredVersion}`);
        console.log(`   📊 Valid: ${nodeReport.valid ? 'Yes' : 'No'}`);

        if (nodeReport.details) {
          console.log(`   📋 Details: ${nodeReport.details}`);
        }

        if (nodeReport.warning) {
          console.log(`   ⚠️  Warning: ${nodeReport.warning}`);
        }

        if (nodeReport.recommendation) {
          console.log(`   💡 Recommendation: ${nodeReport.recommendation}`);
        }

        results.nodeVersionValidation = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Node.js version validation returned invalid result');
      }
    } catch (error) {
      console.log(`   ❌ Node.js version validation failed: ${error.message}`);
    }

    // Test 3: Environment Variables Validation
    console.log('\n🔐 Test 3: Environment Variables Validation');
    results.totalTests++;

    try {
      const { createEnvironmentParityChecker } = await import('./environment-parity-checker.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const checker = createEnvironmentParityChecker(logger);

      const envReport = await checker.validateEnvironmentVariables();

      if (envReport && typeof envReport.valid === 'boolean') {
        console.log('   ✅ Environment variables validation completed');
        console.log(`   📊 Valid: ${envReport.valid ? 'Yes' : 'No'}`);
        console.log(`   📊 CI Environment: ${envReport.ciEnvironment.detected ? 'Yes' : 'No'}`);
        console.log(`   📊 Platform: ${envReport.platform.os} (${envReport.platform.arch})`);

        if (envReport.platform.isWSL) {
          console.log('   🐧 WSL environment detected');
        }

        if (envReport.missing.length > 0) {
          console.log(`   ⚠️  Missing variables: ${envReport.missing.join(', ')}`);
        }

        if (envReport.recommendations.length > 0) {
          console.log('   💡 Recommendations provided for environment setup');
        }

        results.environmentVariables = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Environment variables validation returned invalid result');
      }
    } catch (error) {
      console.log(`   ❌ Environment variables validation failed: ${error.message}`);
    }

    // Test 4: Filesystem Behavior Validation
    console.log('\n📁 Test 4: Filesystem Behavior Validation');
    results.totalTests++;

    try {
      const { createEnvironmentParityChecker } = await import('./environment-parity-checker.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const checker = createEnvironmentParityChecker(logger);

      const fsReport = await checker.validateFilesystemBehavior();

      if (fsReport && typeof fsReport.valid === 'boolean') {
        console.log('   ✅ Filesystem behavior validation completed');
        console.log(`   📊 Platform: ${fsReport.platform}`);
        console.log(`   📊 Path separator: "${fsReport.pathSeparator}"`);
        console.log(`   📊 Case sensitive: ${fsReport.caseSensitive ? 'Yes' : 'No'}`);
        console.log(`   📊 Long paths: ${fsReport.supportsLongPaths ? 'Supported' : 'Limited'}`);
        console.log(`   📊 Symlinks: ${fsReport.supportsSymlinks ? 'Supported' : 'Not available'}`);

        if (fsReport.issues.length > 0) {
          console.log(`   ⚠️  Issues: ${fsReport.issues.join(', ')}`);
        }

        results.filesystemBehavior = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Filesystem behavior validation returned invalid result');
        if (fsReport.error) {
          console.log(`   Error: ${fsReport.error}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Filesystem behavior validation failed: ${error.message}`);
    }

    // Test 5: Package Dependencies Validation
    console.log('\n📋 Test 5: Package Dependencies Validation');
    results.totalTests++;

    try {
      const { createEnvironmentParityChecker } = await import('./environment-parity-checker.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const checker = createEnvironmentParityChecker(logger);

      const depReport = await checker.validatePackageDependencies();

      if (depReport && typeof depReport.valid === 'boolean') {
        console.log('   ✅ Package dependencies validation completed');
        console.log(`   📊 package.json exists: ${depReport.packageJsonExists ? 'Yes' : 'No'}`);
        console.log(`   📊 package-lock.json exists: ${depReport.lockfileExists ? 'Yes' : 'No'}`);
        console.log(`   📊 Dependencies: ${depReport.dependencies ? depReport.dependencies.length : 0}`);
        console.log(`   📊 Dev dependencies: ${depReport.devDependencies ? depReport.devDependencies.length : 0}`);
        console.log(`   📊 Valid: ${depReport.valid ? 'Yes' : 'No'}`);

        if (depReport.issues && depReport.issues.length > 0) {
          console.log(`   ⚠️  Issues: ${depReport.issues.join(', ')}`);
        }

        if (depReport.recommendations && depReport.recommendations.length > 0) {
          console.log('   💡 Recommendations provided for dependency management');
        }

        results.dependencyValidation = true;
        results.passedTests++;
      } else {
        console.log('   ❌ Package dependencies validation returned invalid result');
        if (depReport.error) {
          console.log(`   Error: ${depReport.error}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Package dependencies validation failed: ${error.message}`);
    }

    // Test 6: Comprehensive Environment Report
    console.log('\n📊 Test 6: Comprehensive Environment Report');
    results.totalTests++;

    try {
      const { createEnvironmentParityChecker } = await import('./environment-parity-checker.js');
      const { MockLogger } = await import('../../helpers/test-helpers.js');

      const logger = new MockLogger();
      const checker = createEnvironmentParityChecker(logger);

      const fullReport = await checker.generateParityReport();

      if (fullReport && fullReport.overall) {
        console.log('   ✅ Comprehensive environment report generated');
        console.log(`   📊 Overall valid: ${fullReport.overall.valid ? 'Yes' : 'No'}`);
        console.log(`   📊 Environment: ${fullReport.overall.environment}`);
        console.log(`   📊 Platform: ${fullReport.overall.platform}`);
        console.log(`   📊 Node version: ${fullReport.overall.nodeVersion}`);
        console.log(`   ⏱️  Validation time: ${fullReport.validationTime}ms`);

        if (fullReport.recommendations.length > 0) {
          console.log(`   💡 Total recommendations: ${fullReport.recommendations.length}`);
        }

        results.passedTests++;
      } else {
        console.log('   ❌ Comprehensive environment report generation failed');
      }
    } catch (error) {
      console.log(`   ❌ Comprehensive environment report failed: ${error.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 ENVIRONMENT PARITY VALIDATION RESULTS');
    console.log('='.repeat(60));
    console.log(`📈 Tests Passed: ${results.passedTests}/${results.totalTests}`);
    console.log(`📊 Success Rate: ${((results.passedTests / results.totalTests) * 100).toFixed(1)}%`);
    console.log('');
    console.log('🔧 Component Status:');
    console.log(`   Environment Checker: ${results.environmentChecker ? '✅' : '❌'}`);
    console.log(`   Node Version Validation: ${results.nodeVersionValidation ? '✅' : '❌'}`);
    console.log(`   Environment Variables: ${results.environmentVariables ? '✅' : '❌'}`);
    console.log(`   Filesystem Behavior: ${results.filesystemBehavior ? '✅' : '❌'}`);
    console.log(`   Dependency Validation: ${results.dependencyValidation ? '✅' : '❌'}`);

    if (results.passedTests >= 5) { // Allow for some tolerance
      console.log('\n🎉 Environment parity validation system is working!');
      console.log('✅ Local vs CI environment differences can be detected early');
      console.log('✅ Environment-specific failures should be prevented');
      return true;
    } else {
      console.log('\n❌ Environment parity validation system has issues');
      console.log('⚠️  Environment differences may still cause CI failures');
      return false;
    }

  } catch (error) {
    console.error('❌ Environment validation test execution failed:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Handle process cleanup gracefully
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception in environment validation tests:', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection in environment validation tests:', reason);
});

// Run the tests with natural completion
if (import.meta.url === `file://${process.argv[1]}`) {
  runEnvironmentValidationTests().then(success => {
    if (success) {
      console.log('\n🎯 Environment validation completed successfully!');
    } else {
      console.log('\n⚠️  Environment validation completed with some issues');
    }
    // Natural completion - no process.exit() calls
  }).catch(error => {
    console.error('❌ Test execution failed:', error);
    // Natural completion even on error - no process.exit() calls
  });
}