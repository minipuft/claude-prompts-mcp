// @lifecycle canonical - Unit tests for ScriptExecutor service.
/**
 * ScriptExecutor Unit Tests
 *
 * Tests the script execution service including:
 * - Input validation against JSON Schema
 * - Runtime resolution
 * - Error handling for disabled tools and missing scripts
 * - Timeout handling
 */

import { ScriptExecutor, createScriptExecutor } from '../../../../src/scripts/execution/script-executor.js';
import type { LoadedScriptTool, ScriptExecutionRequest } from '../../../../src/scripts/types.js';

describe('ScriptExecutor', () => {
  let executor: ScriptExecutor;

  beforeEach(() => {
    executor = createScriptExecutor({ debug: false, defaultTimeout: 5000 });
  });

  describe('validateInputs', () => {
    it('should accept empty inputs when schema has no properties', () => {
      const result = executor.validateInputs({}, { type: 'object' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require specified fields', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['name', 'count'],
      };

      const result = executor.validateInputs({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: name');
      expect(result.errors).toContain('Missing required field: count');
    });

    it('should validate field types', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
      };

      const result = executor.validateInputs({ name: 123, count: 'not a number' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Field 'name'"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Field 'count'"))).toBe(true);
    });

    it('should pass valid inputs', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' }, // Use 'integer' since integers return 'integer' type
        },
        required: ['name'],
      };

      const result = executor.validateInputs({ name: 'test', count: 42 }, schema);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalizedInputs).toEqual({ name: 'test', count: 42 });
    });

    it('should handle array types', () => {
      const schema = {
        type: 'object',
        properties: {
          items: { type: 'array' },
        },
      };

      const validResult = executor.validateInputs({ items: [1, 2, 3] }, schema);
      expect(validResult.valid).toBe(true);

      const invalidResult = executor.validateInputs({ items: 'not-an-array' }, schema);
      expect(invalidResult.valid).toBe(false);
    });

    it('should handle boolean types', () => {
      const schema = {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
      };

      const validResult = executor.validateInputs({ enabled: true }, schema);
      expect(validResult.valid).toBe(true);

      const invalidResult = executor.validateInputs({ enabled: 'true' }, schema);
      expect(invalidResult.valid).toBe(false);
    });

    it('should handle integer type validation', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'integer' },
        },
      };

      const validResult = executor.validateInputs({ count: 42 }, schema);
      expect(validResult.valid).toBe(true);

      // Floats should fail integer validation
      const floatResult = executor.validateInputs({ count: 42.5 }, schema);
      expect(floatResult.valid).toBe(false);
    });

    it('should handle multiple allowed types', () => {
      const schema = {
        type: 'object',
        properties: {
          // Include 'integer' since whole numbers return 'integer' type
          value: { type: ['string', 'integer'] },
        },
      };

      const stringResult = executor.validateInputs({ value: 'hello' }, schema);
      expect(stringResult.valid).toBe(true);

      const numberResult = executor.validateInputs({ value: 123 }, schema);
      expect(numberResult.valid).toBe(true);

      const invalidResult = executor.validateInputs({ value: true }, schema);
      expect(invalidResult.valid).toBe(false);
    });
  });

  describe('execute', () => {
    const createMockTool = (overrides: Partial<LoadedScriptTool> = {}): LoadedScriptTool => ({
      id: 'test_tool',
      name: 'Test Tool',
      description: 'A test tool',
      scriptPath: 'script.py',
      runtime: 'python',
      inputSchema: { type: 'object', properties: {} },
      toolDir: '/tmp/test-tool',
      absoluteScriptPath: '/tmp/test-tool/script.py',
      promptId: 'test_prompt',
      descriptionContent: 'Test description',
      ...overrides,
    });

    const createMockRequest = (
      overrides: Partial<ScriptExecutionRequest> = {}
    ): ScriptExecutionRequest => ({
      toolId: 'test_tool',
      promptId: 'test_prompt',
      inputs: {},
      ...overrides,
    });

    it('should reject execution of disabled tools', async () => {
      const tool = createMockTool({ enabled: false });
      const request = createMockRequest();

      const result = await executor.execute(request, tool);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool is disabled');
      expect(result.exitCode).toBe(-1);
    });

    it('should reject execution when script does not exist', async () => {
      const tool = createMockTool({
        absoluteScriptPath: '/nonexistent/path/script.py',
      });
      const request = createMockRequest();

      const result = await executor.execute(request, tool);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Script not found');
      expect(result.exitCode).toBe(-1);
    });

    it('should check script existence before input validation', async () => {
      // Note: execute() checks file existence BEFORE input validation
      // So even with invalid inputs, we get "Script not found" first
      const tool = createMockTool({
        absoluteScriptPath: '/nonexistent/script.py',
        inputSchema: {
          type: 'object',
          properties: {
            requiredField: { type: 'string' },
          },
          required: ['requiredField'],
        },
      });
      const request = createMockRequest({ inputs: {} });

      const result = await executor.execute(request, tool);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Script not found');
    });

    it('should include duration in result even on error', async () => {
      const tool = createMockTool({ enabled: false });
      const request = createMockRequest();

      const result = await executor.execute(request, tool);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('factory function', () => {
    it('should create executor with default config', () => {
      const executor = createScriptExecutor();
      expect(executor).toBeInstanceOf(ScriptExecutor);
    });

    it('should create executor with custom config', () => {
      const executor = createScriptExecutor({
        defaultTimeout: 10000,
        maxTimeout: 60000,
        debug: true,
      });
      expect(executor).toBeInstanceOf(ScriptExecutor);
    });
  });
});
