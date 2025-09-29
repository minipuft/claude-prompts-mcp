#!/usr/bin/env node
/**
 * Cross-Platform CI Startup Validation
 * Industry-standard Node.js test script for CI/CD pipelines
 * 
 * This replaces all shell-specific validation logic with programmatic testing
 * that works identically across Windows, macOS, and Linux.
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
  
  // Check key modules exist
  const requiredModules = [
    'runtime/application.js',
    'runtime/startup.js',
    'utils/index.js',
    'config/index.js',
    'logging/index.js',
    'mcp-tools/prompt-engine/index.js',
    'mcp-tools/prompt-manager/index.js',
    'mcp-tools/system-control.js'
  ];
  
  for (const module of requiredModules) {
    const modulePath = path.join(distPath, module);
    if (!fs.existsSync(modulePath)) {
      throw new Error(`Required module not found: dist/${module}`);
    }
  }
  
  ci.success('Build artifacts validation passed');
}

/**
 * Validate server startup using direct module imports
 * This is much more reliable than parsing shell output
 */
async function validateServerStartup() {
  ci.info('Validating server startup...');
  
  try {
    // Set CI environment to get clean output
    process.env.CI = 'true';
    process.env.NODE_ENV = 'test';
    
    // Import the runtime application directly
    const { Application } = await import('../dist/runtime/application.js');
    const { MockLogger } = await import('../dist/utils/index.js');
    
    ci.debug('Creating application instance...');
    const logger = new MockLogger();
    const app = new Application(logger);
    
    // Test application configuration loading
    ci.debug('Loading configuration...');
    await app.loadConfiguration();
    
    ci.debug('Configuration loaded successfully');
    
    // Test prompts data loading
    ci.debug('Loading prompts data...');
    await app.loadPromptsData();
    
    ci.debug('Prompts data loaded successfully');
    
    // Test modules initialization
    ci.debug('Initializing modules...');
    await app.initializeModules();
    
    ci.debug('Modules initialized successfully');
    
    // Test health validation
    ci.debug('Validating health...');
    const healthInfo = app.validateHealth();
    
    if (!healthInfo || typeof healthInfo !== 'object') {
      throw new Error('Health validation failed - invalid health info');
    }
    
    ci.debug(`Health info collected: ${Object.keys(healthInfo).length} metrics`);
    
    // Clean shutdown
    ci.debug('Shutting down application...');
    await app.shutdown();
    
    ci.success('Server startup validation passed');
    return {
      configLoaded: true,
      promptsLoaded: true,
      modulesInitialized: true,
      healthValidated: true,
      shutdownClean: true
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
    ci.info(`Clean shutdown: ${results.shutdownClean}`);
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