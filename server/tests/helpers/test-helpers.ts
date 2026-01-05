/**
 * Test Helpers (JavaScript version)
 * Common utilities and fixtures for tests
 */

import path from 'path';

import { jest } from '@jest/globals';

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
    return this.logs.filter((log) => log.level === level);
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
          content: [{ type: 'text', text: `Mock response for ${name}` }],
        };
      },
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
    return this.registeredTools.map((tool) => tool.name);
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
    const missingMethods = requiredMethods.filter((method) => typeof this[method] !== 'function');

    return {
      isCompliant: missingMethods.length === 0,
      missingMethods,
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
    arguments: [],
  },
  withArgs: {
    id: 'test-with-args',
    name: 'Test Prompt with Arguments',
    userMessageTemplate: 'Hello {{name}}, you are {{age}} years old',
    description: 'A prompt with template arguments',
    category: 'test',
    arguments: [
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' },
    ],
  },
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
      gates: {
        definitionsDirectory: 'gates',
      },
    };
  }

  getPromptsFilePath() {
    return '/test/prompts.json';
  }

  getFrameworksConfig() {
    return {
      enableSystemPromptInjection: true,
      enableMethodologyGates: false,
      enableDynamicToolDescriptions: false,
    };
  }

  getPromptsDirectory() {
    return '/test/prompts';
  }

  getVersioningConfig() {
    return {
      enabled: true,
      max_versions: 50,
      auto_version: true,
    };
  }

  on(event: string, handler: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: string, handler: Function) {
    if (!this.listeners.has(event)) {
      return;
    }
    const handlers = this.listeners.get(event)!;
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
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
 * Cleanup helper for PromptExecutionService instances
 * Safely cleans up prompt execution services to prevent async handle leaks
 */
export async function cleanupPromptExecutionService(engine) {
  if (!engine) return;

  if (typeof engine.cleanup === 'function') {
    try {
      await engine.cleanup();
    } catch (error) {
      // Log error but don't throw to prevent test failures
      console.error('Error cleaning up prompt execution service:', error);
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

/**
 * Mock PromptGuidanceService for testing
 *
 * Simulates PromptGuidanceService behavior without creating real infrastructure:
 * - NO MethodologyTracker with 30-second interval timers
 * - NO file system state persistence
 * - NO heavy framework operations
 *
 * This mock prevents Jest hanging issues caused by setInterval timers
 * that keep the event loop alive after tests complete.
 *
 * Usage:
 * ```typescript
 * const mockGuidance = new MockPromptGuidanceService(logger);
 * const engine = createPromptExecutionService(
 *   // ... other params,
 *   mockGuidance  // Inject mock instead of creating real service
 * );
 * ```
 */
export class MockPromptGuidanceService {
  // Jest spy functions for verification
  applyGuidance: any;
  switchMethodology: any;
  getCurrentMethodologyState: any;
  getSystemHealth: any;
  setGuidanceEnabled: any;
  updateConfig: any;
  getConfig: any;
  setFrameworkManager: any;
  initialize: any;
  shutdown: any;
  isInitialized: any;

  private initialized: boolean = false;
  private config: any;
  private currentMethodology: string = 'CAGEERF';
  private logger: any;

  constructor(logger?: any) {
    this.logger = logger;

    // Initialize all methods as jest.fn() with realistic implementations

    this.initialize = jest.fn(async (frameworkManager?: any) => {
      this.initialized = true;
      if (this.logger) {
        this.logger.debug('MockPromptGuidanceService initialized');
      }
      return Promise.resolve();
    });

    this.shutdown = jest.fn(async () => {
      this.initialized = false;
      if (this.logger) {
        this.logger.debug('MockPromptGuidanceService shutdown (no timers to clean)');
      }
      // NO TIMERS TO CLEAN UP - this is the key fix
      return Promise.resolve();
    });

    this.isInitialized = jest.fn(() => this.initialized);

    this.applyGuidance = jest.fn(async (prompt: any, options: any = {}) => {
      return {
        originalPrompt: prompt,
        enhancedPrompt: prompt,
        activeMethodology: this.currentMethodology,
        guidanceApplied: true,
        processingTimeMs: 1,
        metadata: {
          frameworkUsed: this.currentMethodology,
          enhancementsApplied: ['mock_enhancement'],
          confidenceScore: 0.9,
          semanticAware: options.semanticAnalysis !== undefined,
          semanticComplexity: options.semanticAnalysis?.complexity || 'low',
          semanticConfidence: options.semanticAnalysis?.confidence || 0.8,
        },
      };
    });

    this.switchMethodology = jest.fn(async (request: any) => {
      this.currentMethodology = request.targetMethodology;
      if (this.logger) {
        this.logger.debug(`MockPromptGuidanceService switched to ${this.currentMethodology}`);
      }
      return true;
    });

    this.getCurrentMethodologyState = jest.fn(() => ({
      activeMethodology: this.currentMethodology,
      previousMethodology: null,
      switchedAt: new Date(),
      switchReason: 'Test initialization',
      isHealthy: true,
      methodologySystemEnabled: true,
      switchingMetrics: {
        switchCount: 0,
        averageResponseTime: 0,
        errorCount: 0,
      },
    }));

    this.getSystemHealth = jest.fn(() => ({
      status: 'healthy',
      activeMethodology: this.currentMethodology,
      methodologySystemEnabled: true,
      lastSwitchTime: new Date(),
      switchingMetrics: {
        totalSwitches: 0,
        successfulSwitches: 0,
        failedSwitches: 0,
        averageResponseTime: 0,
      },
      issues: [],
    }));

    this.setGuidanceEnabled = jest.fn((enabled: boolean) => {
      // State update without side effects
      if (this.logger) {
        this.logger.debug(`MockPromptGuidanceService guidance ${enabled ? 'enabled' : 'disabled'}`);
      }
    });

    this.updateConfig = jest.fn((config: any) => {
      this.config = { ...this.config, ...config };
      if (this.logger) {
        this.logger.debug('MockPromptGuidanceService config updated');
      }
    });

    this.getConfig = jest.fn(() => ({
      systemPromptInjection: {
        enabled: true,
        injectionMethod: 'smart',
        enableTemplateVariables: true,
        enableContextualEnhancement: true,
      },
      templateEnhancement: {
        enabled: true,
        enhancementLevel: 'moderate',
        enableArgumentSuggestions: true,
        enableStructureOptimization: true,
      },
      methodologyTracking: {
        enabled: true,
        enableHealthMonitoring: false, // KEY: Disabled in tests
        persistStateToDisk: false, // KEY: Disabled in tests
      },
    }));

    this.setFrameworkManager = jest.fn((frameworkManager: any) => {
      // Accept framework manager without triggering MethodologyTracker creation
      if (this.logger) {
        this.logger.debug('MockPromptGuidanceService framework manager set');
      }
    });
  }

  /**
   * Reset all jest.fn() call counts for clean test isolation
   * Call this in afterEach if you need to verify call counts
   */
  resetMock() {
    Object.values(this).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
  }
}
