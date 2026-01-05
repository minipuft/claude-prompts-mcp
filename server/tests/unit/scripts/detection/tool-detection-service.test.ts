// @lifecycle canonical - Unit tests for ToolDetectionService.
/**
 * ToolDetectionService Unit Tests
 *
 * Tests the smart tool detection service including:
 * - Explicit tool requests (tool:<id> pattern)
 * - Schema-based matching (trigger: schema_match)
 * - Always and never trigger types
 * - Strict mode matching
 */

import {
  ToolDetectionService,
  createToolDetectionService,
} from '../../../../src/scripts/detection/tool-detection-service.js';
import { DEFAULT_EXECUTION_CONFIG } from '../../../../src/scripts/types.js';
import type { LoadedScriptTool, ExecutionConfig } from '../../../../src/scripts/types.js';

describe('ToolDetectionService', () => {
  let service: ToolDetectionService;

  beforeEach(() => {
    service = createToolDetectionService({ debug: false });
  });

  const createMockTool = (overrides: Partial<LoadedScriptTool> = {}): LoadedScriptTool => ({
    id: 'analyze_csv',
    name: 'CSV Analyzer',
    description: 'Analyzes CSV files and returns statistics',
    scriptPath: 'script.py',
    runtime: 'python',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to CSV file' },
        columns: { type: 'array', description: 'Columns to analyze' },
      },
      required: ['file'],
    },
    toolDir: '/tmp/tools/analyze_csv',
    absoluteScriptPath: '/tmp/tools/analyze_csv/script.py',
    promptId: 'data_analyzer',
    descriptionContent: 'Analyzes CSV files',
    ...overrides,
  });

  describe('detectTools', () => {
    it('should return empty array when no tools are provided', () => {
      // Note: detectTools signature is (input, args, availableTools)
      const result = service.detectTools('test', {}, []);
      expect(result).toHaveLength(0);
    });

    it('should detect tool by explicit tool request', () => {
      const tool = createMockTool();
      // Use explicit tool arg instead of name in input string
      const result = service.detectTools('', { tool: 'analyze_csv' }, [tool]);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].toolId).toBe('analyze_csv');
      expect(result[0].matchReason).toBe('name_match');
      expect(result[0].explicitRequest).toBe(true);
    });

    it('should detect tool by argument name matching schema', () => {
      const tool = createMockTool();
      const result = service.detectTools('', { file: 'data.csv' }, [tool]);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].toolId).toBe('analyze_csv');
      expect(result[0].matchReason).toBe('schema_match');
    });

    it('should assign higher priority to explicit requests over schema matches', () => {
      const tool = createMockTool();
      // Explicit tool request gets priority 1.0
      const explicitMatch = service.detectTools('', { tool: 'analyze_csv' }, [tool]);
      // Schema match gets priority 0.8-0.9
      const schemaMatch = service.detectTools('', { file: 'test.csv' }, [tool]);

      expect(explicitMatch.length).toBeGreaterThan(0);
      expect(schemaMatch.length).toBeGreaterThan(0);
      expect(explicitMatch[0].priority).toBeGreaterThanOrEqual(schemaMatch[0].priority);
    });

    it('should sort results by priority descending', () => {
      const tool1 = createMockTool({ id: 'tool_a' });
      const tool2 = createMockTool({ id: 'tool_b' });

      // Both tools have same schema, so both should match via schema_match
      const result = service.detectTools('', { file: 'test.csv' }, [tool1, tool2]);

      if (result.length >= 2) {
        expect(result[0].priority).toBeGreaterThanOrEqual(result[1].priority);
      }
    });

    it('should handle tools with empty input schema', () => {
      const tool = createMockTool({
        inputSchema: { type: 'object', properties: {} },
      });

      // Should not crash with empty schema - won't match without schema properties
      const result = service.detectTools('', { file: 'test.csv' }, [tool]);
      expect(Array.isArray(result)).toBe(true);
      // Empty schema means no match possible via schema_match
      expect(result).toHaveLength(0);
    });

    it('should detect multiple required parameters', () => {
      const tool = createMockTool({
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            format: { type: 'string' },
          },
          required: ['file', 'format'],
        },
      });

      const result = service.detectTools('', { file: 'data.csv', format: 'csv' }, [tool]);

      expect(result.length).toBeGreaterThan(0);
    });

    it('should skip disabled tools', () => {
      const tool = createMockTool({ enabled: false });
      const result = service.detectTools('analyze_csv', {}, [tool]);

      expect(result).toHaveLength(0);
    });
  });

  describe('factory function', () => {
    it('should create service with default config', () => {
      const service = createToolDetectionService();
      expect(service).toBeInstanceOf(ToolDetectionService);
    });

    it('should create service with custom config', () => {
      const service = createToolDetectionService({
        debug: true,
      });
      expect(service).toBeInstanceOf(ToolDetectionService);
    });
  });

  describe('execution config and trigger types', () => {
    const createToolWithExecution = (
      id: string,
      execution: Partial<ExecutionConfig>
    ): LoadedScriptTool => ({
      id,
      name: `Tool ${id}`,
      description: 'Test tool',
      scriptPath: 'script.py',
      runtime: 'python',
      inputSchema: {
        type: 'object',
        properties: { data: { type: 'string' } },
        required: ['data'],
      },
      toolDir: `/tmp/tools/${id}`,
      absoluteScriptPath: `/tmp/tools/${id}/script.py`,
      promptId: 'test_prompt',
      descriptionContent: 'Test',
      enabled: true,
      execution: { ...DEFAULT_EXECUTION_CONFIG, ...execution },
    });

    describe('trigger types', () => {
      it('should match always trigger regardless of args', () => {
        const tool = createToolWithExecution('always_tool', { trigger: 'always' });
        const result = service.detectTools('unrelated input', {}, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].toolId).toBe('always_tool');
        expect(result[0].priority).toBe(1.0);
      });

      it('should only match explicit trigger with tool:<id> arg', () => {
        const tool = createToolWithExecution('explicit_tool', { trigger: 'explicit' });

        // Without explicit arg - should not match
        const noMatch = service.detectTools('', { data: 'value' }, [tool]);
        expect(noMatch).toHaveLength(0);

        // With explicit arg - should match
        const withExplicit = service.detectTools('', { 'tool:explicit_tool': true }, [tool]);
        expect(withExplicit).toHaveLength(1);
        expect(withExplicit[0].toolId).toBe('explicit_tool');
      });

      it('should match schema_match trigger with matching args', () => {
        const tool = createToolWithExecution('schema_tool', { trigger: 'schema_match' });

        const result = service.detectTools('', { data: 'test value' }, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].toolId).toBe('schema_tool');
        expect(result[0].matchReason).toBe('schema_match');
      });
    });

    describe('strict mode matching', () => {
      it('should match with partial params when strict is false (default)', () => {
        const tool = createToolWithExecution('partial_tool', { strict: false });
        tool.inputSchema = {
          type: 'object',
          properties: {
            required1: { type: 'string' },
            required2: { type: 'string' },
          },
          required: ['required1', 'required2'],
        };

        // Only providing one of two required params
        const result = service.detectTools('', { required1: 'value' }, [tool]);

        // Non-strict mode should match with partial params
        expect(result).toHaveLength(1);
        expect(result[0].toolId).toBe('partial_tool');
        expect(result[0].priority).toBe(0.8); // Partial match priority
      });

      it('should not match with partial params when strict is true', () => {
        const tool = createToolWithExecution('strict_tool', { strict: true });
        tool.inputSchema = {
          type: 'object',
          properties: {
            required1: { type: 'string' },
            required2: { type: 'string' },
          },
          required: ['required1', 'required2'],
        };

        // Only providing one of two required params
        const result = service.detectTools('', { required1: 'value' }, [tool]);

        // Strict mode should NOT match with partial params
        expect(result).toHaveLength(0);
      });

      it('should match in strict mode when all required params present', () => {
        const tool = createToolWithExecution('strict_tool', { strict: true });
        tool.inputSchema = {
          type: 'object',
          properties: {
            required1: { type: 'string' },
            required2: { type: 'string' },
          },
          required: ['required1', 'required2'],
        };

        // Providing all required params
        const result = service.detectTools('', { required1: 'a', required2: 'b' }, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].toolId).toBe('strict_tool');
        expect(result[0].priority).toBe(0.9); // Full match priority
      });
    });

    describe('match result annotations', () => {
      it('should include requiresConfirmation in match result', () => {
        const tool = createToolWithExecution('confirm_tool', { confirm: true });
        // Use explicit tool request to trigger match
        const result = service.detectTools('', { tool: 'confirm_tool' }, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].requiresConfirmation).toBe(true);
      });

      it('should include explicitRequest flag in match result', () => {
        const tool = createToolWithExecution('test_tool', {});
        const result = service.detectTools('', { tool: 'test_tool' }, [tool]);

        expect(result[0].explicitRequest).toBe(true);
      });

      it('should set explicitRequest false for parameter matches', () => {
        const tool = createToolWithExecution('param_tool', {});
        tool.inputSchema = {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        };

        const result = service.detectTools('', { value: 'test' }, [tool]);

        expect(result[0].explicitRequest).toBe(false);
        // Default is now confirm: true (secure by default)
        expect(result[0].requiresConfirmation).toBe(true);
      });

      it('should allow explicit confirm: false override', () => {
        const tool = createToolWithExecution('no_confirm_tool', { confirm: false });
        tool.inputSchema = {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        };

        const result = service.detectTools('', { value: 'test' }, [tool]);

        expect(result[0].explicitRequest).toBe(false);
        expect(result[0].requiresConfirmation).toBe(false);
      });
    });

    describe('explicit tool extraction', () => {
      it('should extract tool from tool arg', () => {
        const tool = createToolWithExecution('my_tool', { trigger: 'explicit' });
        const result = service.detectTools('', { tool: 'my_tool' }, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].explicitRequest).toBe(true);
      });

      it('should extract tool from tool_id arg', () => {
        const tool = createToolWithExecution('my_tool', { trigger: 'explicit' });
        const result = service.detectTools('', { tool_id: 'my_tool' }, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].explicitRequest).toBe(true);
      });

      it('should extract tool from toolId arg (camelCase)', () => {
        const tool = createToolWithExecution('my_tool', { trigger: 'explicit' });
        const result = service.detectTools('', { toolId: 'my_tool' }, [tool]);

        expect(result).toHaveLength(1);
        expect(result[0].explicitRequest).toBe(true);
      });

      it('should handle comma-separated tool list', () => {
        const tool1 = createToolWithExecution('tool_a', { trigger: 'explicit' });
        const tool2 = createToolWithExecution('tool_b', { trigger: 'explicit' });

        const result = service.detectTools('', { tool: 'tool_a, tool_b' }, [tool1, tool2]);

        expect(result).toHaveLength(2);
        expect(result.map((m) => m.toolId).sort()).toEqual(['tool_a', 'tool_b']);
      });
    });
  });
});
