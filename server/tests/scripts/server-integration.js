#!/usr/bin/env node
/**
 * Enhanced MCP Server Integration Tests
 * Cross-platform compatible test script with robust error handling
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function enhancedIntegrationTests() {
  try {
    console.log('🧪 Running enhanced MCP server integration tests...');
    console.log(`🔧 Platform: ${process.platform}`);
    console.log(`🔧 Node.js: ${process.version}`);
    console.log(`🔧 Working directory: ${process.cwd()}`);
    
    // Check if build artifacts exist
    const distPath = path.join(__dirname, '../../dist');
    console.log(`🔍 Checking build artifacts at: ${distPath}`);
    
    try {
      const orchestrationPath = path.join(distPath, 'orchestration', 'index.js');
      const utilsPath = path.join(distPath, 'utils', 'index.js');
      
      console.log(`🔍 Looking for orchestration module: ${orchestrationPath}`);
      console.log(`🔍 Looking for utils module: ${utilsPath}`);
      
      // Verify files exist before importing
      const fs = await import('fs');
      if (!fs.existsSync(orchestrationPath)) {
        throw new Error(`Orchestration module not found at: ${orchestrationPath}`);
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
    let ApplicationOrchestrator, MockLogger;
    
    try {
      console.log('🔍 Importing ApplicationOrchestrator...');
      const orchestrationModule = await import('../../dist/orchestration/index.js');
      ApplicationOrchestrator = orchestrationModule.ApplicationOrchestrator;
      
      if (!ApplicationOrchestrator) {
        throw new Error('ApplicationOrchestrator not exported from orchestration module');
      }
      console.log('✅ ApplicationOrchestrator imported successfully');
    } catch (importError) {
      console.error('❌ Failed to import ApplicationOrchestrator:', importError.message);
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
    
    console.log('🔍 Test 1: Full server initialization sequence');
    
    const logger = new MockLogger();
    console.log('✅ Logger instance created');
    
    const orchestrator = new ApplicationOrchestrator(logger);
    console.log('✅ Orchestrator instance created');
    
    // Test configuration loading
    try {
      await orchestrator.loadConfiguration();
      if (!orchestrator.config) {
        throw new Error('Configuration not loaded - config property is null/undefined');
      }
      console.log('✅ Configuration loaded successfully');
    } catch (configError) {
      console.error('❌ Configuration loading failed:', configError.message);
      throw configError;
    }
    
    // Test prompts data loading
    try {
      await orchestrator.loadPromptsData();
      const promptCount = orchestrator.promptsData ? orchestrator.promptsData.length : 0;
      console.log(`✅ Prompts data loaded: ${promptCount} prompts`);
    } catch (promptsError) {
      console.error('❌ Prompts data loading failed:', promptsError.message);
      throw promptsError;
    }
    
    // Test module initialization
    try {
      await orchestrator.initializeModules();
      if (!orchestrator.mcpToolsManager) {
        throw new Error('MCP tools manager not initialized');
      }
      console.log('✅ Modules initialized successfully');
    } catch (modulesError) {
      console.error('❌ Modules initialization failed:', modulesError.message);
      throw modulesError;
    }
    
    // Test health diagnostics
    try {
      const healthInfo = await orchestrator.getDiagnosticInfo();
      if (!healthInfo || typeof healthInfo !== 'object') {
        throw new Error('Health diagnostics failed - invalid response');
      }
      console.log(`✅ Health diagnostics collected: ${Object.keys(healthInfo).length} metrics`);
    } catch (healthError) {
      console.error('❌ Health diagnostics failed:', healthError.message);
      throw healthError;
    }
    
    console.log('🎉 Enhanced integration tests completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Enhanced integration tests failed:', error.message);
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

enhancedIntegrationTests();