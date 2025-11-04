/**
 * Test Helpers (JavaScript version)
 * Common utilities and fixtures for tests
 */

import path from 'path';

// Get project root for consistent paths
// Using process.cwd() for Jest compatibility (avoids import.meta.url issues)
export const PROJECT_ROOT = process.cwd();
export const DIST_PATH = path.join(PROJECT_ROOT, 'dist');

/**
 * Mock Logger Implementation
 */
export class MockLogger {
  constructor() {
    this.logs = [];
  }

  info(message, ...args) {
    this.logs.push({ level: 'info', message, args });
  }

  warn(message, ...args) {
    this.logs.push({ level: 'warn', message, args });
  }

  error(message, ...args) {
    this.logs.push({ level: 'error', message, args });
  }

  debug(message, ...args) {
    this.logs.push({ level: 'debug', message, args });
  }

  clear() {
    this.logs = [];
  }

  getLogsByLevel(level) {
    return this.logs.filter(log => log.level === level);
  }
}

/**
 * Mock MCP Server for testing
 * Enhanced with interface contract compliance
 */
export class MockMcpServer {
  constructor() {
    this.registeredTools = [];
    this.toolHandlers = new Map();
  }

  tool(name, description, schema) {
    this.registeredTools.push({ name, description, schema });

    // Return mock tool handler
    return {
      name,
      handler: async (args) => {
        const handler = this.toolHandlers.get(name);
        if (handler) {
          return handler(args);
        }
        return {
          content: [{ type: 'text', text: `Mock response for ${name}` }]
        };
      }
    };
  }

  /**
   * MCP SDK compatible registerTool method
   * Fixes the interface mismatch that caused CI failures
   */
  registerTool(name, config, handler) {
    // Validate MCP SDK registerTool parameters
    if (typeof name !== 'string' || !name) {
      throw new Error(`Invalid tool name: ${name}`);
    }
    if (!config || typeof config !== 'object') {
      throw new Error(`Invalid tool config for ${name}`);
    }
    if (typeof handler !== 'function') {
      throw new Error(`Invalid tool handler for ${name}`);
    }

    // Extract description and schema from MCP SDK config format
    const description = config.description || config.title || name;
    const schema = config.inputSchema || {};

    // Store the handler for this tool
    this.addToolHandler(name, handler);

    // Delegate to existing tool method for registration
    return this.tool(name, description, schema);
  }

  addToolHandler(name, handler) {
    this.toolHandlers.set(name, handler);
  }

  getRegisteredToolNames() {
    return this.registeredTools.map(tool => tool.name);
  }

  clear() {
    this.registeredTools = [];
    this.toolHandlers.clear();
  }

  /**
   * Interface compliance validation
   */
  validateInterfaceCompliance() {
    const requiredMethods = ['tool', 'registerTool'];
    const missingMethods = requiredMethods.filter(method =>
      typeof this[method] !== 'function'
    );

    return {
      isCompliant: missingMethods.length === 0,
      missingMethods
    };
  }
}

/**
 * Test Data Fixtures
 */
export const testPrompts = {
  simple: {
    id: 'test-simple',
    name: 'Simple Test Prompt',
    userMessageTemplate: 'This is a simple test prompt',
    description: 'A basic prompt for testing',
    category: 'test',
    arguments: []
  },
  withArgs: {
    id: 'test-with-args',
    name: 'Test Prompt with Arguments',
    userMessageTemplate: 'Hello {{name}}, you are {{age}} years old',
    description: 'A prompt with template arguments',
    category: 'test',
    arguments: [
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' }
    ]
  }
};

/**
 * Performance Test Utilities
 */
export class PerformanceTimer {
  constructor() {
    this.startTime = 0;
    this.endTime = 0;
  }

  start() {
    this.startTime = Date.now();
  }

  stop() {
    this.endTime = Date.now();
    return this.getDuration();
  }

  getDuration() {
    return this.endTime - this.startTime;
  }
}

/**
 * Mock ConfigManager with proper event listener cleanup
 * Simulates EventEmitter behavior for testing
 */
export class MockConfigManager {
  private listeners = new Map<string, Function[]>();

  getConfig() {
    return {
      server: { name: 'test-server', version: '1.0.0' },
      gates: { definitionsDirectory: 'src/gates/definitions', templatesDirectory: 'src/gates/templates' }
    };
  }

  getPromptsFilePath() {
    return '/test/prompts.json';
  }

  getFrameworksConfig() {
    return {
      enableSystemPromptInjection: true,
      enableMethodologyGates: false,
      enableDynamicToolDescriptions: false
    };
  }

  on(event: string, handler: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  shutdown() {
    this.listeners.clear();
  }
}

/**
 * Mock FrameworkStateManager with proper cleanup
 * Includes jest.fn() methods for testing framework switching
 */
export class MockFrameworkStateManager {
  switchFramework: any;
  getActiveFramework: any;
  isFrameworkSystemEnabled: any;

  constructor() {
    this.switchFramework = jest.fn(({ targetFramework }: { targetFramework: string }) => {
      // Accept any framework for testing
      return Promise.resolve(true);
    });
    this.getActiveFramework = jest.fn(() => ({ id: 'CAGEERF' }));
    this.isFrameworkSystemEnabled = jest.fn(() => true);
  }

  shutdown() {
    // Clear any timers or listeners if needed in the future
    // For now, just ensure the mock functions can be garbage collected
  }
}

/**
 * Cleanup helper for ConsolidatedPromptEngine instances
 * Safely cleans up prompt engines to prevent async handle leaks
 */
export async function cleanupPromptEngine(engine) {
  if (!engine) return;

  if (typeof engine.cleanup === 'function') {
    try {
      await engine.cleanup();
    } catch (error) {
      // Log error but don't throw to prevent test failures
      console.error('Error cleaning up prompt engine:', error);
    }
  }

  // Additional defensive cleanup for any lingering listeners
  if (typeof engine.removeAllListeners === 'function') {
    try {
      engine.removeAllListeners();
    } catch (error) {
      // Silent cleanup to prevent cascading errors
    }
  }
}