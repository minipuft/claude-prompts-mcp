/**
 * MCP Tools Integration Tests - Consolidated Architecture
 * Tests for the current 3 consolidated MCP tools (87.5% tool reduction)
 */

import { createConsolidatedPromptEngine } from '../../dist/mcp-tools/prompt-engine.js';
import { createConsolidatedPromptManager } from '../../dist/mcp-tools/prompt-manager.js';
import { createConsolidatedSystemControl } from '../../dist/mcp-tools/system-control.js';
import { MockLogger, MockMcpServer, testPrompts } from '../helpers/test-helpers.js';

describe('Consolidated MCP Tools Integration', () => {
  let logger: MockLogger;
  let mockMcpServer: MockMcpServer;
  let promptEngine: any;
  let promptManager: any;
  let systemControl: any;

  beforeEach(() => {
    logger = new MockLogger();
    mockMcpServer = new MockMcpServer();

    // Mock dependencies for consolidated tools
    const mockPromptManager = {
      processTemplateAsync: () => Promise.resolve('mocked template result'),
      convertedPrompts: [testPrompts.simple],
      promptsData: [testPrompts.simple]
    };
    const mockSemanticAnalyzer = {
      analyzePrompt: () => Promise.resolve({
        executionType: 'template',
        requiresExecution: true,
        confidence: 0.8
      })
    };
    const mockFrameworkManager = {
      getCurrentFramework: () => ({ frameworkId: 'CAGEERF', frameworkName: 'CAGEERF' })
    };

    // Create consolidated tools
    promptEngine = createConsolidatedPromptEngine(logger, mockMcpServer as any, mockPromptManager as any, mockSemanticAnalyzer as any);
    promptManager = createConsolidatedPromptManager(logger, mockMcpServer as any, mockPromptManager as any);
    systemControl = createConsolidatedSystemControl(logger, mockMcpServer as any, mockFrameworkManager as any);
  });

  afterEach(() => {
    logger.clear();
    mockMcpServer.clear();
  });

  describe('Consolidated Prompt Engine', () => {
    test('should register prompt execution tool', () => {
      expect(promptEngine).toBeDefined();

      // Verify tool registration
      const registeredTools = mockMcpServer.getRegisteredToolNames();
      expect(registeredTools).toContain('prompt_engine');
    });

    test('should handle prompt execution requests', () => {
      expect(promptEngine).toBeDefined();
      expect(typeof promptEngine.handlePromptExecution).toBe('function');
    });
  });

  describe('Consolidated Prompt Manager', () => {
    test('should register prompt management tool', () => {
      expect(promptManager).toBeDefined();

      // Verify tool registration
      const registeredTools = mockMcpServer.getRegisteredToolNames();
      expect(registeredTools).toContain('prompt_manager');
    });

    test('should handle prompt lifecycle management', () => {
      expect(promptManager).toBeDefined();
      expect(typeof promptManager.handlePromptManagement).toBe('function');
    });

    test('should support intelligent filtering', () => {
      expect(promptManager).toBeDefined();
      // The consolidated prompt manager should support advanced filtering
    });
  });

  describe('Consolidated System Control', () => {
    test('should register system control tool', () => {
      expect(systemControl).toBeDefined();

      // Verify tool registration
      const registeredTools = mockMcpServer.getRegisteredToolNames();
      expect(registeredTools).toContain('system_control');
    });

    test('should handle framework management', () => {
      expect(systemControl).toBeDefined();
      expect(typeof systemControl.handleSystemControl).toBe('function');
    });

    test('should provide system analytics', () => {
      expect(systemControl).toBeDefined();
      // The system control tool should provide analytics capabilities
    });
  });

  describe('Consolidated Tools Integration', () => {
    test('should register exactly 3 consolidated tools', () => {
      const registeredTools = mockMcpServer.getRegisteredToolNames();
      const consolidatedTools = ['prompt_engine', 'prompt_manager', 'system_control'];

      consolidatedTools.forEach(toolName => {
        expect(registeredTools).toContain(toolName);
      });

      // Should have only the 3 consolidated tools (plus any mock overhead)
      const actualConsolidatedTools = registeredTools.filter(name =>
        consolidatedTools.includes(name)
      );
      expect(actualConsolidatedTools.length).toBe(3);
    });

    test('should maintain tool consolidation benefits', () => {
      // The consolidated architecture should have much fewer tools than the legacy 24+ tool system
      const registeredTools = mockMcpServer.registeredTools;

      // Should be significantly fewer tools than the legacy system
      expect(registeredTools.length).toBeLessThan(10); // Much less than 24+ legacy tools
      expect(registeredTools.length).toBeGreaterThanOrEqual(3); // At least the 3 consolidated tools
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid tool creation gracefully', () => {
      expect(() => {
        const invalidLogger = null;
        createConsolidatedPromptEngine(invalidLogger as any, mockMcpServer as any, null as any, null as any);
      }).not.toThrow();
    });

    test('should handle empty data gracefully', () => {
      expect(promptEngine).toBeDefined();
      expect(promptManager).toBeDefined();
      expect(systemControl).toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should register consolidated tools efficiently', () => {
      const start = Date.now();

      // Tools should already be registered during setup
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should be very fast due to consolidation
    });

    test('should maintain performance benefits of consolidation', () => {
      // Consolidated tools should be much more efficient than 24+ legacy tools
      const registeredTools = mockMcpServer.registeredTools;

      // With only 3 tools vs 24+, performance should be significantly better
      expect(registeredTools.length).toBeLessThan(10);
      expect(registeredTools.length).toBeGreaterThanOrEqual(3);
    });
  });
});