/**
 * Test Helpers
 * Common utilities and fixtures for tests
 */

import path from 'path';
import { fileURLToPath } from 'url';

// Get project root for consistent paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DIST_PATH = path.join(PROJECT_ROOT, 'dist');

/**
 * Mock Logger Implementation
 */
export class MockLogger {
  public logs: Array<{ level: string; message: string; args: any[] }> = [];

  info(message: string, ...args: any[]) {
    this.logs.push({ level: 'info', message, args });
  }

  warn(message: string, ...args: any[]) {
    this.logs.push({ level: 'warn', message, args });
  }

  error(message: string, ...args: any[]) {
    this.logs.push({ level: 'error', message, args });
  }

  debug(message: string, ...args: any[]) {
    this.logs.push({ level: 'debug', message, args });
  }

  clear() {
    this.logs = [];
  }

  getLogsByLevel(level: string) {
    return this.logs.filter(log => log.level === level);
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
  },
  cageerf: {
    id: 'test-cageerf',
    name: 'CAGEERF Test Prompt',
    userMessageTemplate: 'Analyze the context, set clear goals, execute the plan, evaluate results, and refine the framework',
    description: 'A prompt designed to test CAGEERF framework compliance',
    category: 'analysis',
    arguments: []
  }
};

/**
 * Mock MCP Server for testing
 */
export class MockMcpServer {
  public registeredTools: Array<{ name: string; description: string; schema: any }> = [];
  public toolHandlers: Map<string, Function> = new Map();

  tool(name: string, description: string, schema: any) {
    this.registeredTools.push({ name, description, schema });
    
    // Return mock tool handler
    return {
      name,
      handler: async (args: any) => {
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

  addToolHandler(name: string, handler: Function) {
    this.toolHandlers.set(name, handler);
  }

  getRegisteredToolNames() {
    return this.registeredTools.map(tool => tool.name);
  }

  clear() {
    this.registeredTools = [];
    this.toolHandlers.clear();
  }
}

/**
 * Performance Test Utilities
 */
export class PerformanceTimer {
  private startTime: number = 0;
  private endTime: number = 0;

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
 * Memory Usage Utilities
 */
export function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100, // MB
    rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100, // MB
    external: Math.round(usage.external / 1024 / 1024 * 100) / 100 // MB
  };
}

/**
 * Async Test Utilities
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * File System Test Utilities
 */
export function createTempConfig(overrides: any = {}) {
  return {
    name: 'test-server',
    version: '1.0.0',
    port: 3000,
    logging: {
      directory: './logs',
      level: 'info'
    },
    ...overrides
  };
}

/**
 * ConvertedPrompt Test Utilities
 */
export function createConvertedPrompt(content: string, id?: string) {
  return {
    id: id || 'test-prompt',
    name: 'Test Prompt',
    description: 'A test prompt',
    content: content,
    category: 'test',
    arguments: [],
    template: content,
    userMessageTemplate: content,
    systemMessageTemplate: '',
    role: 'user' as const
  };
}