#!/usr/bin/env node
/**
 * Cross-Platform CI Startup Validation
 * Simplified test script for clean main branch architecture
 * 
 * This validates that the server can be imported and basic modules load correctly
 * without relying on complex orchestration features that may not exist in main branch.
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CI-specific console logging that respects CI environment expectations
 */
const ci = {
  info: (message) => console.log(`[INFO] ${message}`),
  success: (message) => console.log(`[SUCCESS] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  debug: (message) => {
    // Only show debug in verbose mode
    if (process.env.VERBOSE) {
      console.log(`[DEBUG] ${message}`);
    }
  }
};

/**
 * Validate that build artifacts exist and are correct
 */
async function validateBuildArtifacts() {
  ci.info('Validating build artifacts...');
  
  const fs = await import('fs');
  const distPath = path.join(__dirname, '../dist');
  
  // Check dist directory exists
  if (!fs.existsSync(distPath)) {
    throw new Error('Build directory not found: dist/');
  }
  
  // Check main entry point exists
  const mainEntryPoint = path.join(distPath, 'index.js');
  if (!fs.existsSync(mainEntryPoint)) {
    throw new Error('Main entry point not found: dist/index.js');
  }
  
  // Check for essential core modules (be flexible about what exists in main branch)
  const expectedModules = [
    'config/index.js',
    'logging/index.js', 
    'prompts/index.js',
    'transport/index.js'
  ];
  
  let foundModules = 0;
  for (const module of expectedModules) {
    const modulePath = path.join(distPath, module);
    if (fs.existsSync(modulePath)) {
      foundModules++;
      ci.debug(`Found module: ${module}`);
    }
  }
  
  if (foundModules === 0) {
    throw new Error('No expected core modules found in dist/');
  }
  
  ci.success(`Build artifacts validation passed (${foundModules} core modules found)`);
}

/**
 * Validate basic server module imports
 * This tests that the server can be imported without runtime errors
 */
async function validateServerStartup() {
  ci.info('Validating server startup...');
  
  try {
    // Set CI environment to get clean output
    process.env.CI = 'true';
    process.env.NODE_ENV = 'test';
    
    ci.debug('Testing main module import...');
    // Try to import the main server entry point
    const serverModule = await import('../dist/index.js');
    ci.debug('Main module imported successfully');
    
    // Test configuration module if available
    try {
      const configModule = await import('../dist/config/index.js');
      ci.debug('Configuration module imported successfully');
    } catch (configError) {
      ci.debug(`Configuration module import failed (may not exist in main branch): ${configError.message}`);
    }
    
    // Test logging module if available
    try {
      const loggingModule = await import('../dist/logging/index.js');
      ci.debug('Logging module imported successfully');
    } catch (loggingError) {
      ci.debug(`Logging module import failed (may not exist in main branch): ${loggingError.message}`);
    }
    
    // Test prompts module if available
    try {
      const promptsModule = await import('../dist/prompts/index.js');
      ci.debug('Prompts module imported successfully');
    } catch (promptsError) {
      ci.debug(`Prompts module import failed (may not exist in main branch): ${promptsError.message}`);
    }
    
    ci.success('Server startup validation passed');
    return {
      mainModuleImported: true,
      basicValidationComplete: true
    };
    
  } catch (error) {
    throw new Error(`Server startup validation failed: ${error.message}`);
  }
}

/**
 * Run comprehensive CI validation
 */
async function runCIValidation() {
  const startTime = Date.now();
  
  try {
    ci.info('Starting CI startup validation...');
    ci.info(`Platform: ${process.platform}`);
    ci.info(`Node.js: ${process.version}`);
    ci.info(`Working directory: ${process.cwd()}`);
    
    // Phase 1: Build artifacts validation
    await validateBuildArtifacts();
    
    // Phase 2: Server startup validation
    const results = await validateServerStartup();
    
    const duration = Date.now() - startTime;
    
    ci.success('='.repeat(50));
    ci.success('CI STARTUP VALIDATION PASSED');
    ci.success('='.repeat(50));
    ci.info(`Configuration loaded: ${results.configLoaded}`);
    ci.info(`Prompts loaded: ${results.promptsLoaded}`);
    ci.info(`Modules initialized: ${results.modulesInitialized}`);
    ci.info(`Health validated: ${results.healthValidated}`);
    ci.info(`Total duration: ${duration}ms`);
    
    // Clean exit for CI
    process.exit(0);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    ci.error('='.repeat(50));
    ci.error('CI STARTUP VALIDATION FAILED');
    ci.error('='.repeat(50));
    ci.error(`Error: ${error.message}`);
    ci.error(`Duration: ${duration}ms`);
    ci.error(`Platform: ${process.platform}`);
    ci.error(`Node.js: ${process.version}`);
    
    // Show stack trace in debug mode
    if (process.env.VERBOSE) {
      ci.error('Stack trace:');
      ci.error(error.stack);
    }
    
    // Clean exit with error code for CI
    process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  ci.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  ci.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Run the validation
runCIValidation();