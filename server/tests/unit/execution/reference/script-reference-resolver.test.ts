/**
 * Unit tests for ScriptReferenceResolver
 *
 * Tests runtime resolution of {{script:id}} references:
 * - Pattern detection
 * - Script execution
 * - Field access
 * - Inline arguments
 * - Error handling
 */

import { jest, describe, it, expect } from '@jest/globals';

import {
  ScriptReferenceResolver,
  parseInlineScriptArgs,
  ScriptNotRegisteredError,
  InvalidFieldAccessError,
  InvalidScriptOutputError,
  type ScriptLoader,
} from '../../../../src/engine/execution/reference/index.js';
import { processTemplate } from '../../../../src/shared/utils/jsonUtils.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ScriptExecutorPort } from '../../../../src/shared/types/index.js';
import type { LoadedScriptTool } from '../../../../src/modules/automation/types.js';

/**
 * Render a resolver result the way every production consumer does.
 *
 * `preResolve` returns TEMPLATE SOURCE, not final text: script output is wrapped
 * so Nunjucks cannot evaluate it (see `neutralizeTemplateSyntax`). Asserting on
 * the raw `resolvedTemplate` would pin the wrapper's spelling, which is an
 * implementation detail; every real consumer — `processTemplateWithRefs` and
 * `PromptReferenceResolver` — renders before anyone reads it.
 */
function render(resolvedTemplate: string, args: Record<string, unknown> = {}): string {
  return processTemplate(resolvedTemplate, args);
}

describe('ScriptReferenceResolver', () => {
  // Mock logger
  const mockLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as Logger;

  // Mock script tool
  const mockScriptTool: LoadedScriptTool = {
    id: 'analyzer',
    name: 'Test Analyzer',
    description: 'A test script',
    scriptPath: 'script.py',
    runtime: 'python',
    inputSchema: { type: 'object', properties: {} },
    execution: { trigger: 'explicit', confirm: false, strict: false },
    toolDir: '/path/to/tool',
    absoluteScriptPath: '/path/to/tool/script.py',
    promptId: 'test',
  };

  // Helper to create mock script loader
  const createMockLoader = (
    scripts: Record<string, LoadedScriptTool | undefined>
  ): ScriptLoader => ({
    scriptExists: jest.fn((id: string) => scripts[id] !== undefined),
    loadScript: jest.fn((id: string) => scripts[id]),
    getSearchedPaths: jest.fn(() => ['/test/path']),
  });

  // Helper to create mock executor
  const createMockExecutor = (outputs: Record<string, unknown>): ScriptExecutorPort => ({
    execute: jest.fn(async (request: { toolId: string }) => ({
      success: true,
      output: outputs[request.toolId] ?? null,
      exitCode: 0,
      stdout: JSON.stringify(outputs[request.toolId] ?? {}),
      stderr: '',
      durationMs: 1,
    })),
  });

  describe('detectScriptReferences()', () => {
    it('should detect simple script reference', () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const refs = resolver.detectScriptReferences('Count: {{script:analyzer}}');

      expect(refs).toHaveLength(1);
      expect(refs[0].scriptId).toBe('analyzer');
      expect(refs[0].fieldAccess).toBeUndefined();
      // No inline args provided, so empty or undefined
      expect(refs[0].inlineArgs).toBeUndefined();
    });

    it('should detect script reference with field access', () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const refs = resolver.detectScriptReferences('Value: {{script:analyzer.row_count}}');

      expect(refs).toHaveLength(1);
      expect(refs[0].scriptId).toBe('analyzer');
      expect(refs[0].fieldAccess).toBe('row_count');
    });

    it('should detect script reference with inline arguments', () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const refs = resolver.detectScriptReferences(
        "Result: {{script:analyzer key='value' num=42}}"
      );

      expect(refs).toHaveLength(1);
      expect(refs[0].scriptId).toBe('analyzer');
      expect(refs[0].inlineArgs).toEqual({ key: 'value', num: 42 });
    });

    it('should detect multiple script references', () => {
      const loader = createMockLoader({
        analyzer: mockScriptTool,
        formatter: { ...mockScriptTool, id: 'formatter' },
      });
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const refs = resolver.detectScriptReferences(
        'A: {{script:analyzer}} B: {{script:formatter}}'
      );

      expect(refs).toHaveLength(2);
      expect(refs[0].scriptId).toBe('analyzer');
      expect(refs[1].scriptId).toBe('formatter');
    });

    it('should return empty array for template without script references', () => {
      const loader = createMockLoader({});
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const refs = resolver.detectScriptReferences('Plain text without references');

      expect(refs).toHaveLength(0);
    });

    it('should not match {{ref:...}} patterns', () => {
      const loader = createMockLoader({});
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const refs = resolver.detectScriptReferences('Ref: {{ref:some_prompt}}');

      expect(refs).toHaveLength(0);
    });
  });

  describe('hasScriptReferences()', () => {
    it('should return true when template has script references', () => {
      const loader = createMockLoader({});
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      expect(resolver.hasScriptReferences('Has {{script:test}}')).toBe(true);
    });

    it('should return false when template has no script references', () => {
      const loader = createMockLoader({});
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      expect(resolver.hasScriptReferences('No script refs here')).toBe(false);
    });
  });

  describe('raw-block containment (Tier 2.3 security probe)', () => {
    // `{% raw %}` runs BEFORE Nunjucks, over raw template text, and is the only thing
    // stopping a template that DOCUMENTS `{{script:id}}` from executing it. A hole here
    // does not leak data directly — it runs a script that a reader believed was inert,
    // which is a side effect before a guaranteed parse error.

    it('does not execute a reference inside a closed raw block', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve('{% raw %}{{script:analyzer}}{% endraw %}', {});

      expect(result.diagnostics.scriptsResolved).toBe(0);
      expect(result.scriptResults.size).toBe(0);
    });

    it('does not execute a reference after an UNCLOSED raw block', async () => {
      // An unclosed tag covers the rest of the template by design: Nunjucks rejects
      // the template anyway, so the only question is whether a script ran first.
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve('{% raw %}{{script:analyzer}}', {});

      expect(result.diagnostics.scriptsResolved).toBe(0);
    });

    it('does not execute a reference inside a nested raw opener', async () => {
      // The block pattern is lazy, so the inner opener falls INSIDE the first
      // range. What must not happen is the inner tag resetting containment.
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve(
        '{% raw %}A{% raw %}{{script:analyzer}}{% endraw %}',
        {}
      );

      expect(result.diagnostics.scriptsResolved).toBe(0);
    });

    it('does not execute a reference after a closed block followed by an unclosed one', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve(
        '{% raw %}A{% endraw %}B{% raw %}{{script:analyzer}}',
        {}
      );

      expect(result.diagnostics.scriptsResolved).toBe(0);
    });

    it('DOES execute a reference that sits outside every raw block', async () => {
      // The containment must not become a blanket refusal — otherwise the previous
      // four assertions would pass on a resolver that never resolves anything.
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve(
        '{% raw %}{{script:analyzer}}{% endraw %} then {{script:analyzer}}',
        {}
      );

      expect(result.diagnostics.scriptsResolved).toBe(1);
    });

    it('does not let whitespace-control tag spellings slip past containment', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve('{%- raw -%}{{script:analyzer}}{%- endraw -%}', {});

      expect(result.diagnostics.scriptsResolved).toBe(0);
    });
  });

  describe('preResolve()', () => {
    it('should resolve script reference and replace with output', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42 } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve('Count: {{script:analyzer}}', {});

      expect(render(result.resolvedTemplate)).toBe('Count: {"count":42}');
      expect(result.scriptResults.size).toBe(1);
      expect(result.diagnostics.scriptsResolved).toBe(1);
    });

    it('should resolve script reference with field access', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: { count: 42, name: 'test' } });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve('Count: {{script:analyzer.count}}', {});

      expect(render(result.resolvedTemplate)).toBe('Count: 42');
    });

    it('should pass context and inline args to executor', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const mockExecuteFn = jest.fn().mockResolvedValue({
        success: true,
        output: { result: 'ok' },
        exitCode: 0,
        stdout: '{"result":"ok"}',
        stderr: '',
      });
      const executor: ScriptExecutorPort = { execute: mockExecuteFn };
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      await resolver.preResolve("Value: {{script:analyzer key='test'}}", {
        contextArg: 'value',
      });

      expect(mockExecuteFn).toHaveBeenCalledWith(
        expect.objectContaining({
          toolId: 'analyzer',
          inputs: expect.objectContaining({
            contextArg: 'value',
            key: 'test',
          }),
        }),
        mockScriptTool
      );
    });

    it('should throw ScriptNotRegisteredError for unknown script', async () => {
      const loader = createMockLoader({});
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      await expect(resolver.preResolve('Value: {{script:unknown}}', {})).rejects.toThrow(
        ScriptNotRegisteredError
      );
    });

    it('should throw InvalidFieldAccessError for non-existent field', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      // Create executor with explicit object return to ensure correct output format
      const executor: ScriptExecutorPort = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          output: { count: 42 },
          exitCode: 0,
          stdout: '{"count":42}',
          stderr: '',
          durationMs: 1,
        }),
      };
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      await expect(resolver.preResolve('Value: {{script:analyzer.missing}}', {})).rejects.toThrow(
        InvalidFieldAccessError
      );
    });

    it('should throw InvalidScriptOutputError for non-object output with field access', async () => {
      const loader = createMockLoader({ analyzer: mockScriptTool });
      const executor = createMockExecutor({ analyzer: 'plain string' });
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      await expect(resolver.preResolve('Value: {{script:analyzer.field}}', {})).rejects.toThrow(
        InvalidScriptOutputError
      );
    });

    it('should return template unchanged if no script references', async () => {
      const loader = createMockLoader({});
      const executor = createMockExecutor({});
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve('Plain text', {});

      expect(result.resolvedTemplate).toBe('Plain text');
      expect(result.scriptResults.size).toBe(0);
      expect(result.diagnostics.scriptsResolved).toBe(0);
    });

    it('should resolve multiple scripts in order', async () => {
      const loader = createMockLoader({
        first: { ...mockScriptTool, id: 'first' },
        second: { ...mockScriptTool, id: 'second' },
      });
      // Create explicit mock to control output for both scripts
      const executor: ScriptExecutorPort = {
        execute: jest.fn().mockImplementation(async (request: { toolId: string }) => ({
          success: true,
          output: request.toolId === 'first' ? { value: 1 } : { value: 2 },
          exitCode: 0,
          stdout: request.toolId === 'first' ? '{"value":1}' : '{"value":2}',
          stderr: '',
          durationMs: 1,
        })),
      };
      const resolver = new ScriptReferenceResolver(mockLogger, loader, executor);

      const result = await resolver.preResolve(
        'A: {{script:first.value}} B: {{script:second.value}}',
        {}
      );

      expect(render(result.resolvedTemplate)).toBe('A: 1 B: 2');
      expect(result.scriptResults.size).toBe(2);
    });
  });
});

describe('parseInlineScriptArgs', () => {
  it('should parse string values with single quotes', () => {
    const result = parseInlineScriptArgs("key='value'");
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse string values with double quotes', () => {
    const result = parseInlineScriptArgs('key="value"');
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse integer values', () => {
    const result = parseInlineScriptArgs('num=42');
    expect(result).toEqual({ num: 42 });
  });

  it('should parse floating point values', () => {
    const result = parseInlineScriptArgs('num=3.14');
    expect(result).toEqual({ num: 3.14 });
  });

  it('should parse boolean true', () => {
    const result = parseInlineScriptArgs('flag=true');
    expect(result).toEqual({ flag: true });
  });

  it('should parse boolean false', () => {
    const result = parseInlineScriptArgs('flag=false');
    expect(result).toEqual({ flag: false });
  });

  it('should parse multiple arguments', () => {
    const result = parseInlineScriptArgs("key='value' num=42 flag=true");
    expect(result).toEqual({ key: 'value', num: 42, flag: true });
  });

  it('should return empty object for empty string', () => {
    const result = parseInlineScriptArgs('');
    expect(result).toEqual({});
  });

  it('should handle whitespace-only string', () => {
    const result = parseInlineScriptArgs('   ');
    expect(result).toEqual({});
  });
});
