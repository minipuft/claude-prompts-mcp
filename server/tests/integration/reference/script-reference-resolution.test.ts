/**
 * Integration tests for script reference resolution.
 *
 * Tests the {{script:id}} template syntax for inline script execution.
 * Uses real ScriptReferenceResolver with mocked script loader and executor.
 */

import { describe, beforeEach, expect, test, jest } from '@jest/globals';

import {
  ScriptReferenceResolver,
  ScriptNotRegisteredError,
  InvalidFieldAccessError,
  InvalidScriptOutputError,
  ScriptExecutionFailedError,
} from '../../../dist/execution/reference/index.js';
import { processTemplateWithRefs } from '../../../dist/utils/jsonUtils.js';

import type { Logger } from '../../../dist/logging/index.js';
import type { LoadedScriptTool, ScriptExecutionResult } from '../../../dist/scripts/types.js';
import type {
  IScriptLoader,
  IScriptExecutorService,
} from '../../../dist/execution/reference/script-reference-resolver.js';

describe('ScriptReferenceResolver Integration', () => {
  let resolver: ScriptReferenceResolver;
  let mockLogger: Logger;
  let mockLoader: IScriptLoader;
  let mockExecutor: IScriptExecutorService;
  let scripts: Record<string, LoadedScriptTool>;

  // Helper to create mock script tool
  const createScriptTool = (
    id: string,
    overrides: Partial<LoadedScriptTool> = {}
  ): LoadedScriptTool => ({
    id,
    name: `${id} Script`,
    description: `Test script ${id}`,
    scriptPath: `${id}.py`,
    runtime: 'python',
    inputSchema: { type: 'object', properties: {} },
    execution: { trigger: 'explicit', confirm: false, strict: false },
    toolDir: `/scripts/${id}`,
    absoluteScriptPath: `/scripts/${id}/${id}.py`,
    promptId: 'test',
    ...overrides,
  });

  // Helper to create script execution result
  const createExecutionResult = (
    output: unknown,
    success = true
  ): ScriptExecutionResult => ({
    success,
    output,
    exitCode: success ? 0 : 1,
    stdout: JSON.stringify(output),
    stderr: success ? '' : 'Script error',
  });

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    // Create test scripts
    scripts = {
      analyzer: createScriptTool('analyzer'),
      formatter: createScriptTool('formatter'),
      calculator: createScriptTool('calculator'),
      json_output: createScriptTool('json_output'),
    };

    // Create mock loader
    mockLoader = {
      scriptExists: jest.fn((id: string) => scripts[id] !== undefined),
      loadScript: jest.fn((id: string) => scripts[id]),
      getSearchedPaths: jest.fn(() => ['/workspace/scripts', '/prompt/tools']),
    };

    // Default mock executor - returns based on toolId
    mockExecutor = {
      execute: jest.fn(async (request: { toolId: string; inputs: Record<string, unknown> }) => {
        const outputs: Record<string, unknown> = {
          analyzer: { count: 42, status: 'complete' },
          formatter: { formatted: 'Hello World', length: 11 },
          calculator: { result: 100, operation: 'sum' },
          json_output: { nested: { value: 'deep' }, array: [1, 2, 3] },
        };
        return createExecutionResult(outputs[request.toolId] ?? null);
      }),
    };

    resolver = new ScriptReferenceResolver(mockLogger, mockLoader, mockExecutor);
  });

  describe('Basic Script Resolution', () => {
    test('resolves simple script reference', async () => {
      const result = await resolver.preResolve('Count: {{script:analyzer}}', {});

      expect(result.resolvedTemplate).toBe('Count: {"count":42,"status":"complete"}');
      expect(result.scriptResults.size).toBe(1);
      expect(result.diagnostics.scriptsResolved).toBe(1);
    });

    test('resolves script with field access', async () => {
      const result = await resolver.preResolve('Count: {{script:analyzer.count}}', {});

      expect(result.resolvedTemplate).toBe('Count: 42');
    });

    test('resolves nested field access', async () => {
      const result = await resolver.preResolve('Value: {{script:json_output.nested}}', {});

      expect(result.resolvedTemplate).toBe('Value: {"value":"deep"}');
    });

    test('returns template unchanged when no script references', async () => {
      const template = 'Plain text with {{variable}}';
      const result = await resolver.preResolve(template, {});

      expect(result.resolvedTemplate).toBe(template);
      expect(result.scriptResults.size).toBe(0);
    });
  });

  describe('Multiple Script References', () => {
    test('resolves multiple different scripts', async () => {
      const result = await resolver.preResolve(
        'A: {{script:analyzer.count}} B: {{script:formatter.length}}',
        {}
      );

      expect(result.resolvedTemplate).toBe('A: 42 B: 11');
      expect(result.scriptResults.size).toBe(2);
    });

    test('resolves same script referenced multiple times', async () => {
      const result = await resolver.preResolve(
        '{{script:analyzer.count}} + {{script:analyzer.count}} = double',
        {}
      );

      expect(result.resolvedTemplate).toBe('42 + 42 = double');
      // Script only executed once (cached)
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Inline Arguments', () => {
    test('passes inline string arguments to executor', async () => {
      await resolver.preResolve("Result: {{script:analyzer key='value'}}", {});

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          toolId: 'analyzer',
          inputs: expect.objectContaining({ key: 'value' }),
        }),
        expect.anything()
      );
    });

    test('passes inline numeric arguments', async () => {
      await resolver.preResolve('Result: {{script:calculator num=42}}', {});

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({ num: 42 }),
        }),
        expect.anything()
      );
    });

    test('passes inline boolean arguments', async () => {
      await resolver.preResolve('Result: {{script:analyzer flag=true}}', {});

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({ flag: true }),
        }),
        expect.anything()
      );
    });

    test('combines context and inline arguments', async () => {
      await resolver.preResolve("Result: {{script:analyzer inline='arg'}}", {
        contextVar: 'context_value',
      });

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            contextVar: 'context_value',
            inline: 'arg',
          }),
        }),
        expect.anything()
      );
    });

    test('inline arguments override context arguments', async () => {
      await resolver.preResolve("Result: {{script:analyzer key='inline'}}", {
        key: 'context',
      });

      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({ key: 'inline' }),
        }),
        expect.anything()
      );
    });
  });

  describe('Error Handling', () => {
    test('throws ScriptNotRegisteredError for unknown script', async () => {
      await expect(
        resolver.preResolve('Value: {{script:unknown}}', {})
      ).rejects.toThrow(ScriptNotRegisteredError);
    });

    test('throws InvalidFieldAccessError for non-existent field', async () => {
      await expect(
        resolver.preResolve('Value: {{script:analyzer.missing}}', {})
      ).rejects.toThrow(InvalidFieldAccessError);
    });

    test('throws InvalidScriptOutputError for non-object with field access', async () => {
      mockExecutor.execute = jest.fn().mockResolvedValue(
        createExecutionResult('plain string')
      );

      await expect(
        resolver.preResolve('Value: {{script:analyzer.field}}', {})
      ).rejects.toThrow(InvalidScriptOutputError);
    });

    test('throws ScriptExecutionFailedError on script failure', async () => {
      mockExecutor.execute = jest.fn().mockResolvedValue({
        success: false,
        output: null,
        exitCode: 1,
        stdout: '',
        stderr: 'Script crashed',
      });

      await expect(
        resolver.preResolve('Value: {{script:analyzer}}', {})
      ).rejects.toThrow(ScriptExecutionFailedError);
    });

    test('error includes script ID for debugging', async () => {
      try {
        await resolver.preResolve('Value: {{script:unknown}}', {});
      } catch (error) {
        expect(error).toBeInstanceOf(ScriptNotRegisteredError);
        expect((error as ScriptNotRegisteredError).scriptId).toBe('unknown');
      }
    });
  });

  describe('Detection Methods', () => {
    test('detectScriptReferences finds all patterns', () => {
      const refs = resolver.detectScriptReferences(
        '{{script:a}} {{script:b.field}} {{script:c key="val"}}'
      );

      expect(refs).toHaveLength(3);
      expect(refs[0].scriptId).toBe('a');
      expect(refs[1].scriptId).toBe('b');
      expect(refs[1].fieldAccess).toBe('field');
      expect(refs[2].scriptId).toBe('c');
      expect(refs[2].inlineArgs).toEqual({ key: 'val' });
    });

    test('hasScriptReferences returns true for script patterns', () => {
      expect(resolver.hasScriptReferences('Has {{script:test}}')).toBe(true);
      expect(resolver.hasScriptReferences('No scripts here')).toBe(false);
    });

    test('does not detect {{ref:...}} as script references', () => {
      const refs = resolver.detectScriptReferences('{{ref:prompt}} {{script:tool}}');

      expect(refs).toHaveLength(1);
      expect(refs[0].scriptId).toBe('tool');
    });
  });

  describe('Integration with processTemplateWithRefs', () => {
    test('processes both ref and script patterns', async () => {
      // This test verifies the integration point works
      const result = await processTemplateWithRefs(
        'Script: {{script:analyzer.count}} Variable: {{name}}',
        { name: 'Test' },
        {},
        undefined,
        { scriptResolver: resolver }
      );

      expect(result.content).toBe('Script: 42 Variable: Test');
    });

    test('script references resolved before template variables', async () => {
      const result = await processTemplateWithRefs(
        'Count is {{script:analyzer.count}}, name is {{name}}',
        { name: 'Alice' },
        {},
        undefined,
        { scriptResolver: resolver }
      );

      expect(result.content).toBe('Count is 42, name is Alice');
    });
  });

  describe('Diagnostics', () => {
    test('tracks resolution time', async () => {
      const result = await resolver.preResolve('{{script:analyzer}}', {});

      expect(result.diagnostics.resolutionTimeMs).toBeGreaterThanOrEqual(0);
    });

    test('tracks number of scripts resolved', async () => {
      const result = await resolver.preResolve(
        '{{script:analyzer}} {{script:formatter}}',
        {}
      );

      expect(result.diagnostics.scriptsResolved).toBe(2);
    });

    test('collects warnings for non-fatal issues', async () => {
      // Diagnostics should be present even on success
      const result = await resolver.preResolve('{{script:analyzer}}', {});

      expect(result.diagnostics).toBeDefined();
      expect(Array.isArray(result.diagnostics.warnings)).toBe(true);
    });
  });
});
