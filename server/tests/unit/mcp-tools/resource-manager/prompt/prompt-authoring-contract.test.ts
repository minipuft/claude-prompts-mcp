import { describe, expect, jest, test } from '@jest/globals';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { ComparisonEngine } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

interface Harness {
  processor: PromptLifecycleProcessor;
  updatePromptImplementation: jest.Mock<
    (prompt: Record<string, unknown>) => Promise<{
      message: string;
      affectedFiles: string[];
    }>
  >;
  recordEditResult: jest.Mock;
  onRefresh: jest.Mock;
}

function createHarness(
  options: { currentVersion?: number; refreshMatches?: boolean } = {}
): Harness {
  const logger = createLogger();
  const configManager = {
    getConfigPath: () => '/workspace/config.yaml',
    getServerRoot: () => '/workspace',
    getResolvedPromptsDirectory: () => '/workspace/prompts',
  } as unknown as ConfigManager;
  let currentVersion = options.currentVersion ?? 4;
  let pendingPrompt: Record<string, unknown> | undefined;
  let convertedPrompts: Record<string, unknown>[] = [
    {
      id: 'existing_prompt',
      name: 'Existing Prompt',
      category: 'general',
      description: 'Existing description',
      systemMessage: '',
      userMessageTemplate: 'Before {{input}}',
      arguments: [{ name: 'input', required: true }],
      chainSteps: [],
    },
  ];

  const onRefresh = jest.fn(async () => {
    if (pendingPrompt !== undefined && options.refreshMatches !== false) {
      convertedPrompts = [
        ...convertedPrompts.filter((prompt) => prompt['id'] !== pendingPrompt?.['id']),
        pendingPrompt,
      ];
    }
  });
  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(logger),
    onRefresh,
    onRestart: jest.fn(async () => {}),
  };
  const updatePromptImplementation = jest.fn(async (prompt: Record<string, unknown>) => {
    pendingPrompt = prompt;
    return {
      message: 'written',
      affectedFiles: [`/workspace/prompts/general/${String(prompt['id'])}/prompt.yaml`],
    };
  });
  const loadHistory = jest.fn(async (_type: string, id: string) =>
    id === 'existing_prompt' || pendingPrompt?.['id'] === id
      ? ({ current_version: currentVersion } as never)
      : null
  );
  const recordEditResult = jest.fn(async () => {
    currentVersion += 1;
    return { success: true, version: currentVersion, bridged: false };
  });
  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    comparisonEngine: new ComparisonEngine(logger),
    textDiffService: new ObjectDiffGenerator(),
    fileOperations: { updatePromptImplementation },
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory,
      recordEditResult,
    },
    getData: () => ({ convertedPrompts }),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    updatePromptImplementation,
    recordEditResult,
    onRefresh,
  };
}

const draftBase = {
  name: 'Draft Prompt',
  description: 'A prompt creation draft',
};

describe('prompt validate/create authoring contract', () => {
  test.each([
    ['template', { user_message_template: 'Do {{input}}' }],
    ['system-only', { system_message: 'Answer tersely.' }],
    [
      'chain-only',
      { chain_steps: [{ promptId: 'existing_prompt', stepName: 'Use existing prompt' }] },
    ],
  ])('validates a %s draft without mutating state', async (variant, content) => {
    const harness = createHarness();

    const response = await harness.processor.validatePrompt({
      ...draftBase,
      id: `draft_${variant.replace('-', '_')}`,
      ...content,
    } as never);

    expect(response.isError).toBe(false);
    expect(response.structuredContent).toMatchObject({
      action: 'validate',
      valid: true,
      mutated: false,
    });
    expect(harness.updatePromptImplementation).not.toHaveBeenCalled();
    expect(harness.recordEditResult).not.toHaveBeenCalled();
    expect(harness.onRefresh).not.toHaveBeenCalled();
  });

  test('rejects a draft with no content and accepts a complete script-tool definition', async () => {
    const harness = createHarness();
    const invalid = await harness.processor.validatePrompt({ id: 'empty', ...draftBase } as never);
    const valid = await harness.processor.validatePrompt({
      id: 'with_tool',
      ...draftBase,
      user_message_template: 'Use {{input}}',
      tools: [
        {
          id: 'echo_input',
          name: 'Echo input',
          runtime: 'python',
          script: 'import json\nprint(json.dumps({"ok": True}))',
          schema: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          },
        },
      ],
    } as never);

    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({ valid: false, mutated: false });
    expect(valid.isError).toBe(false);
    expect(valid.structuredContent).toMatchObject({ valid: true, mutated: false });
  });

  test('returns a verified, addressable receipt after create and refresh', async () => {
    const harness = createHarness();

    const response = await harness.processor.createPrompt({
      id: 'created_prompt',
      ...draftBase,
      user_message_template: 'Create {{input}}',
    } as never);

    expect(response.isError).toBe(false);
    expect(response.structuredContent).toMatchObject({
      action: 'create',
      mutated: true,
      receipt: {
        id: 'created_prompt',
        config_path: '/workspace/config.yaml',
        server_root: '/workspace',
        resource_root: '/workspace/prompts',
        refresh_status: 'loaded',
        loaded_after_refresh: true,
        current_version: 4,
      },
    });
    expect(harness.onRefresh).toHaveBeenCalledTimes(1);
  });

  test('marks a write as failed when refresh does not expose the produced state', async () => {
    const harness = createHarness({ refreshMatches: false });

    const response = await harness.processor.createPrompt({
      id: 'stale_prompt',
      ...draftBase,
      user_message_template: 'Create {{input}}',
    } as never);

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      receipt: { refresh_status: 'verification_failed', loaded_after_refresh: false },
    });
  });
});

describe('prompt update optimistic concurrency', () => {
  test('matching expected_version writes once and advances the receipt version', async () => {
    const harness = createHarness({ currentVersion: 4 });

    const response = await harness.processor.updatePrompt({
      id: 'existing_prompt',
      description: 'Updated description',
      expected_version: 4,
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.updatePromptImplementation).toHaveBeenCalledTimes(1);
    expect(harness.recordEditResult).toHaveBeenCalledTimes(1);
    expect(response.structuredContent).toMatchObject({ receipt: { current_version: 5 } });
  });

  test('stale expected_version returns a conflict without a write or version', async () => {
    const harness = createHarness({ currentVersion: 4 });

    const response = await harness.processor.updatePrompt({
      id: 'existing_prompt',
      description: 'Stale update',
      expected_version: 3,
    } as never);

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      conflict: true,
      expected_version: 3,
      current_version: 4,
      mutated: false,
    });
    expect(harness.updatePromptImplementation).not.toHaveBeenCalled();
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('expected_version cannot be combined with skip_version', async () => {
    const harness = createHarness({ currentVersion: 4 });

    const response = await harness.processor.updatePrompt({
      id: 'existing_prompt',
      description: 'Unsafe update',
      expected_version: 4,
      skip_version: true,
    } as never);

    expect(response.isError).toBe(true);
    expect(harness.updatePromptImplementation).not.toHaveBeenCalled();
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });
});
