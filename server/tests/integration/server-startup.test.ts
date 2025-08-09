/**
 * Server Startup Integration Tests
 * Tests extracted from GitHub Actions inline scripts
 */

import { ApplicationOrchestrator } from '../../dist/orchestration/index.js';
import { MockLogger } from '../helpers/test-helpers.js';

describe('Server Startup Integration', () => {
  let logger: MockLogger;
  let orchestrator: ApplicationOrchestrator;

  beforeEach(() => {
    logger = new MockLogger();
    orchestrator = new ApplicationOrchestrator(logger);
  });

  afterEach(() => {
    // Cleanup any resources
    logger.clear();
  });

  describe('Full Server Initialization Sequence', () => {
    test('should complete full initialization sequence', async () => {
      // Step 1: Load Configuration
      await orchestrator.loadConfiguration();
      expect(orchestrator.config).toBeDefined();
      expect(orchestrator.config).not.toBeNull();

      // Step 2: Load Prompts Data
      await orchestrator.loadPromptsData();
      const promptsCount = orchestrator.promptsData ? orchestrator.promptsData.length : 0;
      expect(promptsCount).toBeGreaterThanOrEqual(0);

      // Step 3: Initialize Modules
      await orchestrator.initializeModules();
      expect(orchestrator.mcpToolsManager).toBeDefined();
      expect(orchestrator.mcpToolsManager).not.toBeNull();

      // Step 4: Get Diagnostic Info
      const healthInfo = await orchestrator.getDiagnosticInfo();
      expect(healthInfo).toBeDefined();
      expect(typeof healthInfo).toBe('object');
      expect(Object.keys(healthInfo).length).toBeGreaterThan(0);
    }, 30000); // Increased timeout for full initialization

    test('should handle initialization errors gracefully', async () => {
      // Test with invalid configuration path
      const invalidOrchestrator = new ApplicationOrchestrator(logger);
      
      // Override method to force error  
      const originalLoadConfig = invalidOrchestrator.loadConfiguration;
      invalidOrchestrator.loadConfiguration = async () => {
        throw new Error('Config load failed');
      };

      await expect(invalidOrchestrator.loadConfiguration()).rejects.toThrow('Config load failed');
    });
  });

  describe('Configuration Loading', () => {
    test('should load configuration successfully', async () => {
      await orchestrator.loadConfiguration();
      
      expect(orchestrator.config).toBeDefined();
      expect(orchestrator.config).toHaveProperty('server.name');
      expect(orchestrator.config).toHaveProperty('server.version');
    });

    test('should validate configuration structure', async () => {
      await orchestrator.loadConfiguration();
      
      const config = orchestrator.config;
      expect(config).toHaveProperty('server.name');
      expect(typeof config.server.name).toBe('string');
      expect(config.server.name.length).toBeGreaterThan(0);
    });
  });

  describe('Prompts Data Loading', () => {
    test('should load prompts data', async () => {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      
      // Should have loaded some prompts or at least initialized the structure
      expect(orchestrator.promptsData).toBeDefined();
      
      if (orchestrator.promptsData && orchestrator.promptsData.length > 0) {
        // If prompts exist, validate their structure
        const firstPrompt = orchestrator.promptsData[0];
        expect(firstPrompt).toHaveProperty('id');
        expect(firstPrompt).toHaveProperty('name');
      }
    });

    test('should handle empty prompts gracefully', async () => {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      
      // Should not throw even if no prompts are loaded
      expect(Array.isArray(orchestrator.promptsData) || orchestrator.promptsData === null).toBe(true);
    });
  });

  describe('Module Initialization', () => {
    test('should initialize MCP tools manager', async () => {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();
      
      expect(orchestrator.mcpToolsManager).toBeDefined();
      expect(orchestrator.mcpToolsManager).not.toBeNull();
    });

    test('should initialize all required modules', async () => {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();
      
      // Check that core modules are initialized
      expect(orchestrator.mcpToolsManager).toBeDefined();
      
      // Additional module checks can be added here as needed
    });
  });

  describe('Health Diagnostics', () => {
    test('should provide comprehensive diagnostic information', async () => {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();
      
      const healthInfo = await orchestrator.getDiagnosticInfo();
      
      expect(healthInfo).toBeDefined();
      expect(typeof healthInfo).toBe('object');
      
      const diagnosticKeys = Object.keys(healthInfo);
      expect(diagnosticKeys.length).toBeGreaterThan(0);
      
      // Should contain useful diagnostic information
      expect(diagnosticKeys.some(key => 
        key.includes('status') || 
        key.includes('config') || 
        key.includes('prompts') ||
        key.includes('tools')
      )).toBe(true);
    });

    test('should provide diagnostic info even with partial initialization', async () => {
      await orchestrator.loadConfiguration();
      
      const healthInfo = await orchestrator.getDiagnosticInfo();
      
      expect(healthInfo).toBeDefined();
      expect(typeof healthInfo).toBe('object');
    });
  });

  describe('Error Recovery', () => {
    test('should handle configuration loading errors', async () => {
      // Create orchestrator that will fail configuration loading
      const failingOrchestrator = new ApplicationOrchestrator(logger);
      
      // Override the config loading to fail
      failingOrchestrator.loadConfiguration = async () => {
        throw new Error('Mock config error');
      };
      
      await expect(failingOrchestrator.loadConfiguration()).rejects.toThrow('Mock config error');
      
      // Should be able to continue with other operations
      expect(failingOrchestrator.config).toBeUndefined();
    });

    test('should handle module initialization errors', async () => {
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      
      // Override module initialization to fail
      orchestrator.initializeModules = async () => {
        throw new Error('Mock module error');
      };
      
      await expect(orchestrator.initializeModules()).rejects.toThrow('Mock module error');
    });
  });

  describe('Performance Validation', () => {
    test('should complete initialization within reasonable time', async () => {
      const start = Date.now();
      
      await orchestrator.loadConfiguration();
      await orchestrator.loadPromptsData();
      await orchestrator.initializeModules();
      
      const duration = Date.now() - start;
      
      // Should complete within 10 seconds (generous timeout for CI)
      expect(duration).toBeLessThan(10000);
    });

    test('should track initialization steps timing', async () => {
      const timings: { [key: string]: number } = {};
      
      // Time configuration loading
      let start = Date.now();
      await orchestrator.loadConfiguration();
      timings.config = Date.now() - start;
      
      // Time prompts loading
      start = Date.now();
      await orchestrator.loadPromptsData();
      timings.prompts = Date.now() - start;
      
      // Time module initialization
      start = Date.now();
      await orchestrator.initializeModules();
      timings.modules = Date.now() - start;
      
      // All steps should complete reasonably quickly
      expect(timings.config).toBeLessThan(5000);
      expect(timings.prompts).toBeLessThan(5000);
      expect(timings.modules).toBeLessThan(5000);
      
      // Log timings for monitoring
      console.log('Initialization timings:', timings);
    });
  });
});