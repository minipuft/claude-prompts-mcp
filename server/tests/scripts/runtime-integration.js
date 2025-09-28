#!/usr/bin/env node
/**
 * Runtime System Integration Tests
 * Tests the new consolidated runtime architecture (application.ts + startup.ts)
 * Cross-platform compatible test script with robust error handling
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runtimeIntegrationTests() {
  try {
    console.log('🧪 Running runtime system integration tests...');
    console.log(`🔧 Platform: ${process.platform}`);
    console.log(`🔧 Node.js: ${process.version}`);
    console.log(`🔧 Working directory: ${process.cwd()}`);
    
    // Check if build artifacts exist
    const distPath = path.join(__dirname, '../../dist');
    console.log(`🔍 Checking build artifacts at: ${distPath}`);
    
    try {
      const runtimePath = path.join(distPath, 'runtime', 'application.js');
      const startupPath = path.join(distPath, 'runtime', 'startup.js');
      const utilsPath = path.join(distPath, 'utils', 'index.js');
      
      console.log(`🔍 Looking for runtime module: ${runtimePath}`);
      console.log(`🔍 Looking for startup module: ${startupPath}`);
      console.log(`🔍 Looking for utils module: ${utilsPath}`);
      
      // Verify files exist before importing
      const fs = await import('fs');
      if (!fs.existsSync(runtimePath)) {
        throw new Error(`Runtime application module not found at: ${runtimePath}`);
      }
      if (!fs.existsSync(startupPath)) {
        throw new Error(`Startup module not found at: ${startupPath}`);
      }
      if (!fs.existsSync(utilsPath)) {
        throw new Error(`Utils module not found at: ${utilsPath}`);
      }
      
      console.log('✅ Build artifacts verified');
    } catch (fsError) {
      console.error('❌ Build artifacts check failed:', fsError.message);
      throw fsError;
    }
    
    // Dynamic imports with error handling
    let Application, MockLogger;
    
    try {
      console.log('🔍 Importing Application runtime...');
      const runtimeModule = await import('../../dist/runtime/application.js');
      Application = runtimeModule.Application;
      
      if (!Application) {
        throw new Error('Application not exported from runtime module');
      }
      console.log('✅ Application runtime imported successfully');
    } catch (importError) {
      console.error('❌ Failed to import Application runtime:', importError.message);
      throw importError;
    }
    
    try {
      console.log('🔍 Importing MockLogger...');
      const utilsModule = await import('../../dist/utils/index.js');
      MockLogger = utilsModule.MockLogger;
      
      if (!MockLogger) {
        throw new Error('MockLogger not exported from utils module');
      }
      console.log('✅ MockLogger imported successfully');
    } catch (importError) {
      console.error('❌ Failed to import MockLogger:', importError.message);
      throw importError;
    }
    
    console.log('🔍 Test 1: New runtime system validation');
    
    const logger = new MockLogger();
    console.log('✅ Logger instance created');
    
    const app = new Application(logger);
    console.log('✅ Application runtime instance created');
    
    // Test configuration loading
    try {
      await app.loadConfiguration();
      console.log('✅ Configuration loaded successfully');
    } catch (configError) {
      console.error('❌ Configuration loading failed:', configError.message);
      throw configError;
    }
    
    // Test prompts data loading
    try {
      await app.loadPromptsData();
      console.log('✅ Prompts data loaded successfully');
    } catch (promptsError) {
      console.error('❌ Prompts data loading failed:', promptsError.message);
      throw promptsError;
    }
    
    // Test modules initialization
    try {
      await app.initializeModules();
      console.log('✅ Modules initialized successfully');
    } catch (modulesError) {
      console.error('❌ Modules initialization failed:', modulesError.message);
      throw modulesError;
    }
    
    // Test health diagnostics
    try {
      const healthInfo = app.validateHealth();
      if (!healthInfo || typeof healthInfo !== 'object') {
        throw new Error('Health diagnostics failed - invalid response');
      }
      console.log(`✅ Health diagnostics validated: ${Object.keys(healthInfo).length} metrics`);
    } catch (healthError) {
      console.error('❌ Health diagnostics failed:', healthError.message);
      throw healthError;
    }
    
    // Test graceful shutdown
    try {
      await app.shutdown();
      console.log('✅ Application shutdown completed successfully');
    } catch (shutdownError) {
      console.error('❌ Application shutdown failed:', shutdownError.message);
      throw shutdownError;
    }
    
    console.log('🎉 Runtime system integration tests completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Runtime system integration tests failed:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Additional debugging information
    console.error('\n🔍 Debugging information:');
    console.error(`Current working directory: ${process.cwd()}`);
    console.error(`Script location: ${__dirname}`);
    console.error(`Platform: ${process.platform}`);
    console.error(`Node.js version: ${process.version}`);
    
    process.exit(1);
  }
}

runtimeIntegrationTests();