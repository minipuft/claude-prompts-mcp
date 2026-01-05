/**
 * Integration tests for prompt reference resolution.
 *
 * Tests the {{ref:prompt_id}} template syntax for modular prompt composition.
 * Uses real PromptReferenceResolver with mocked dependencies.
 */

import { describe, beforeEach, expect, test, jest } from '@jest/globals';

import { PromptReferenceResolver } from '../../../dist/execution/reference/prompt-reference-resolver.js';
import {
  CircularReferenceError,
  MaxDepthExceededError,
  PromptNotFoundError,
} from '../../../dist/execution/reference/errors.js';
import { processTemplateWithRefs } from '../../../dist/utils/jsonUtils.js';

import type { ConvertedPrompt } from '../../../dist/execution/types.js';
import type { Logger } from '../../../dist/logging/index.js';
import type { LoadedScriptTool, ScriptExecutionResult, ToolDetectionMatch } from '../../../dist/scripts/types.js';
import type { IToolDetectionService, IScriptExecutor } from '../../../dist/execution/reference/prompt-reference-resolver.js';

describe('PromptReferenceResolver', () => {
  let resolver: PromptReferenceResolver;
  let mockLogger: Logger;
  let prompts: ConvertedPrompt[];

  // Helper to create mock prompts
  const createPrompt = (
    id: string,
    template: string,
    overrides: Partial<ConvertedPrompt> = {}
  ): ConvertedPrompt => ({
    id,
    name: `${id} Prompt`,
    description: `Test prompt ${id}`,
    category: 'test',
    userMessageTemplate: template,
    arguments: [],
    ...overrides,
  });

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    // Create test prompts
    prompts = [
      createPrompt('intro', 'Welcome to {{topic}}!'),
      createPrompt('shared_header', '# Header: {{title}}'),
      createPrompt('with_ref', 'Start: {{ref:intro}} End.'),
      createPrompt('nested_ref', '{{ref:with_ref}} -- More content'),
      createPrompt('circular_a', '{{ref:circular_b}} from A'),
      createPrompt('circular_b', '{{ref:circular_a}} from B'),
      createPrompt('multi_ref', '{{ref:intro}} | {{ref:shared_header}}'),
      createPrompt('deep_1', '{{ref:deep_2}}'),
      createPrompt('deep_2', '{{ref:deep_3}}'),
      createPrompt('deep_3', '{{ref:deep_4}}'),
      createPrompt('deep_4', '{{ref:deep_5}}'),
      createPrompt('deep_5', 'Finally!'),
    ];

    resolver = new PromptReferenceResolver(mockLogger, prompts);
  });

  describe('detectReferences', () => {
    test('detects single reference', () => {
      const refs = resolver.detectReferences('Hello {{ref:intro}} world');
      expect(refs).toHaveLength(1);
      expect(refs[0]?.promptId).toBe('intro');
      expect(refs[0]?.fullMatch).toBe('{{ref:intro}}');
    });

    test('detects multiple references', () => {
      const refs = resolver.detectReferences('{{ref:intro}} and {{ref:shared_header}}');
      expect(refs).toHaveLength(2);
      expect(refs[0]?.promptId).toBe('intro');
      expect(refs[1]?.promptId).toBe('shared_header');
    });

    test('returns empty array for no references', () => {
      const refs = resolver.detectReferences('No references here {{normal}}');
      expect(refs).toHaveLength(0);
    });

    test('supports prompt IDs with hyphens and underscores', () => {
      const refs = resolver.detectReferences('{{ref:my-prompt_v2}}');
      expect(refs).toHaveLength(1);
      expect(refs[0]?.promptId).toBe('my-prompt_v2');
    });
  });

  describe('hasReferences', () => {
    test('returns true when template contains references', () => {
      expect(resolver.hasReferences('{{ref:intro}}')).toBe(true);
    });

    test('returns false when template has no references', () => {
      expect(resolver.hasReferences('{{normal}} variable')).toBe(false);
    });
  });

  describe('resolveReference', () => {
    test('resolves simple reference with context', async () => {
      const result = await resolver.resolveReference('intro', { topic: 'Testing' });

      expect(result.content).toBe('Welcome to Testing!');
      expect(result.resolvedPromptIds.has('intro')).toBe(true);
      expect(result.resolutionChain).toEqual(['intro']);
    });

    test('throws PromptNotFoundError for unknown prompt', async () => {
      await expect(resolver.resolveReference('unknown', {})).rejects.toThrow(PromptNotFoundError);
    });

    test('resolves nested references', async () => {
      const result = await resolver.resolveReference('nested_ref', { topic: 'Nesting' });

      // nested_ref -> with_ref -> intro
      expect(result.content).toContain('Welcome to Nesting!');
      expect(result.resolvedPromptIds.has('nested_ref')).toBe(true);
      expect(result.resolvedPromptIds.has('with_ref')).toBe(true);
      expect(result.resolvedPromptIds.has('intro')).toBe(true);
    });

    test('throws CircularReferenceError for circular references', async () => {
      await expect(resolver.resolveReference('circular_a', {})).rejects.toThrow(CircularReferenceError);
    });

    test('includes circular chain in error', async () => {
      try {
        await resolver.resolveReference('circular_a', {});
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularReferenceError);
        expect((error as CircularReferenceError).chain).toContain('circular_a');
        expect((error as CircularReferenceError).chain).toContain('circular_b');
      }
    });
  });

  describe('preResolve', () => {
    test('resolves all references in template', async () => {
      const result = await resolver.preResolve('Before {{ref:intro}} After', { topic: 'World' });

      expect(result.resolvedTemplate).toBe('Before Welcome to World! After');
      expect(result.diagnostics.referencesResolved).toBe(1);
    });

    test('handles multiple references in same template', async () => {
      const result = await resolver.preResolve('{{ref:intro}} | {{ref:shared_header}}', {
        topic: 'Multi',
        title: 'Test',
      });

      expect(result.resolvedTemplate).toBe('Welcome to Multi! | # Header: Test');
      expect(result.diagnostics.referencesResolved).toBe(2);
    });

    test('returns unchanged template when no references', async () => {
      const template = 'No refs: {{variable}}';
      const result = await resolver.preResolve(template, {});

      expect(result.resolvedTemplate).toBe(template);
      expect(result.diagnostics.referencesResolved).toBe(0);
    });

    test('handles deeply nested references', async () => {
      const result = await resolver.preResolve('{{ref:deep_1}}', {});

      expect(result.resolvedTemplate).toBe('Finally!');
      expect(result.resolvedPromptIds.size).toBe(5);
    });

    test('respects maxDepth option', async () => {
      const shallowResolver = new PromptReferenceResolver(mockLogger, prompts, undefined, undefined, {
        maxDepth: 3,
      });

      await expect(shallowResolver.preResolve('{{ref:deep_1}}', {})).rejects.toThrow(MaxDepthExceededError);
    });

    test('tracks resolution time in diagnostics', async () => {
      const result = await resolver.preResolve('{{ref:intro}}', { topic: 'Time' });

      expect(result.diagnostics.resolutionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('with throwOnMissing: false', () => {
    test('replaces missing references with empty string and logs warning', async () => {
      const lenientResolver = new PromptReferenceResolver(mockLogger, prompts, undefined, undefined, {
        throwOnMissing: false,
      });

      const result = await lenientResolver.preResolve('Start {{ref:unknown}} End', {});

      expect(result.resolvedTemplate).toBe('Start  End');
      expect(result.diagnostics.warnings).toContain('Reference to unknown prompt: unknown');
    });
  });
});

describe('processTemplateWithRefs', () => {
  let mockLogger: Logger;
  let prompts: ConvertedPrompt[];

  const createPrompt = (id: string, template: string): ConvertedPrompt => ({
    id,
    name: `${id} Prompt`,
    description: `Test prompt ${id}`,
    category: 'test',
    userMessageTemplate: template,
    arguments: [],
  });

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    prompts = [
      createPrompt('greeting', 'Hello, {{name}}!'),
      createPrompt('with_greeting', '{{ref:greeting}} Welcome to {{place}}.'),
    ];
  });

  test('processes template without resolver (standard Nunjucks)', async () => {
    const result = await processTemplateWithRefs('Hello, {{name}}!', { name: 'World' });

    expect(result.content).toBe('Hello, World!');
    expect(result.resolvedPromptIds.size).toBe(0);
  });

  test('processes template with resolver for reference resolution', async () => {
    const resolver = new PromptReferenceResolver(mockLogger, prompts);

    const result = await processTemplateWithRefs(
      '{{ref:greeting}} Goodbye.',
      { name: 'Alice' },
      {},
      resolver
    );

    expect(result.content).toBe('Hello, Alice! Goodbye.');
    expect(result.resolvedPromptIds.has('greeting')).toBe(true);
  });

  test('merges context across reference and parent template', async () => {
    const resolver = new PromptReferenceResolver(mockLogger, prompts);

    const result = await processTemplateWithRefs(
      '{{ref:with_greeting}}',
      { name: 'Bob', place: 'Wonderland' },
      {},
      resolver
    );

    expect(result.content).toBe('Hello, Bob! Welcome to Wonderland.');
  });
});

describe('PromptReferenceResolver with scripts', () => {
  let mockLogger: Logger;
  let prompts: ConvertedPrompt[];
  let mockToolDetection: jest.Mocked<IToolDetectionService>;
  let mockScriptExecutor: jest.Mocked<IScriptExecutor>;

  const createScriptTool = (id: string): LoadedScriptTool => ({
    id,
    name: `${id} Tool`,
    description: 'Test tool',
    scriptPath: 'script.py',
    inputSchema: { type: 'object' },
    toolDir: '/test/tools',
    absoluteScriptPath: '/test/tools/script.py',
    promptId: 'with_script',
    descriptionContent: 'Test tool description',
  });

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const scriptTool = createScriptTool('analyzer');

    prompts = [
      {
        id: 'with_script',
        name: 'With Script',
        description: 'Prompt with script',
        category: 'test',
        userMessageTemplate: 'Result: {{tool_analyzer}}',
        arguments: [],
        scriptTools: [scriptTool],
      } as ConvertedPrompt,
      {
        id: 'refs_script',
        name: 'Refs Script',
        description: 'References prompt with script',
        category: 'test',
        userMessageTemplate: '{{ref:with_script}}',
        arguments: [],
      } as ConvertedPrompt,
    ];

    mockToolDetection = {
      detectTools: jest.fn().mockReturnValue([
        {
          toolId: 'analyzer',
          promptId: 'with_script',
          priority: 1.0,
          matchReason: 'always_match',
          extractedInputs: { data: 'test' },
          requiresConfirmation: false,
        } as ToolDetectionMatch,
      ]),
    } as unknown as jest.Mocked<IToolDetectionService>;

    mockScriptExecutor = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        output: 'Script output!',
        stdout: 'Script output!',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      } as ScriptExecutionResult),
    } as unknown as jest.Mocked<IScriptExecutor>;
  });

  test('executes scripts when resolving reference with scriptTools', async () => {
    const resolver = new PromptReferenceResolver(
      mockLogger,
      prompts,
      mockToolDetection,
      mockScriptExecutor,
      { executeScripts: true }
    );

    const result = await resolver.resolveReference('with_script', { data: 'test' });

    expect(mockScriptExecutor.execute).toHaveBeenCalled();
    expect(result.scriptResults.has('analyzer')).toBe(true);
    expect(result.content).toBe('Result: Script output!');
  });

  test('makes script results available in template context', async () => {
    const resolver = new PromptReferenceResolver(
      mockLogger,
      prompts,
      mockToolDetection,
      mockScriptExecutor
    );

    const result = await resolver.preResolve('{{ref:with_script}}', { data: 'test' });

    expect(result.scriptResults.has('with_script:analyzer')).toBe(true);
  });

  test('skips script execution when executeScripts is false', async () => {
    const resolver = new PromptReferenceResolver(
      mockLogger,
      prompts,
      mockToolDetection,
      mockScriptExecutor,
      { executeScripts: false }
    );

    await resolver.resolveReference('with_script', {});

    expect(mockScriptExecutor.execute).not.toHaveBeenCalled();
  });

  test('skips tools requiring confirmation', async () => {
    mockToolDetection.detectTools.mockReturnValue([
      {
        toolId: 'analyzer',
        promptId: 'with_script',
        priority: 1.0,
        matchReason: 'schema_match',
        extractedInputs: {},
        requiresConfirmation: true, // Requires confirmation
      } as ToolDetectionMatch,
    ]);

    const resolver = new PromptReferenceResolver(
      mockLogger,
      prompts,
      mockToolDetection,
      mockScriptExecutor
    );

    const result = await resolver.resolveReference('with_script', {});

    expect(mockScriptExecutor.execute).not.toHaveBeenCalled();
    expect(result.scriptResults.size).toBe(0);
  });
});
