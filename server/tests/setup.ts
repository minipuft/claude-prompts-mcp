/**
 * Jest Test Setup
 * Global configuration and utilities for all tests
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Provide require() polyfill for ESM tests where some utilities use dynamic require()
import { createRequire } from 'module';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).require = (global as any).require || createRequire(import.meta.url);

// Global test timeout - commented out as it's set in jest.config.cjs
// jest.setTimeout(30000);

// Mock console methods in tests if needed
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// These jest globals are setup in individual test files since ES modules handle setup differently
// beforeEach(() => {
//   // Reset mocks before each test
//   jest.clearAllMocks();
// });

// afterEach(() => {
//   // Cleanup after each test
//   jest.restoreAllMocks();
// });

// Global test utilities - simplified for ES modules
global.testUtils = {
  // Suppress console output during tests
  suppressConsole: () => {
    console.error = () => {};
    console.warn = () => {};
  },

  // Restore console output
  restoreConsole: () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  },

  // Wait for async operations
  waitFor: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),

  // Create mock logger - implementation will use jest mocks in individual tests
  createMockLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
};

// Extend Jest matchers if needed
declare global {
  namespace jest {
    interface Matchers<R> {
      // Add custom matchers here if needed
    }
  }

  var testUtils: {
    suppressConsole: () => void;
    restoreConsole: () => void;
    waitFor: (ms: number) => Promise<void>;
    createMockLogger: () => any;
  };
}

// Export statement required for ES modules, but empty to avoid issues
export {};
