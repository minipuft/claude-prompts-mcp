/**
 * P6.309 — `confirm` is declared exactly where a call deletes something the caller sent no
 * replacement for, and refused by name everywhere else.
 *
 * Four cases through one router, over the REAL prompt lifecycle processor and a recording gate
 * handler. The two prompt cases need the real processor because the refusal of a
 * `tool_operation: "remove"` without `confirm` lives there, and the two gate cases need the
 * router because the refusal of an undeclared `confirm` lives there. Before the contract declared
 * `confirm` on `prompt:update`, case 3 failed (a gate update carrying `confirm` was accepted and
 * ignored) while cases 1, 2 and 4 passed.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import { GateAnalyzer } from '../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { ComparisonEngine } from '../../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { ObjectDiffGenerator } from '../../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptLifecycleProcessor } from '../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { ResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import type { ResourceManagerInput } from '../../../../src/mcp/tools/resource-manager/core/types.js';
import type { PromptResourceContext } from '../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../../src/shared/types/index.js';

const textOf = (response: ToolResponse): string =>
  response.content.map((part) => ('text' in part ? part.text : '')).join('');

describe('P6.309: confirm is declared where a call deletes, refused where it cannot', () => {
  let router: ResourceManagerRouter;
  let gateHandler: {
    handleAction: jest.Mock<(args: Record<string, unknown>) => Promise<ToolResponse>>;
  };
  let updatePromptImplementation: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

  beforeEach(() => {
    const logger = new MockLogger() as unknown as Logger;
    const dependencies = {
      logger,
      configManager: {
        getConfigPath: () => '/test/config.yaml',
        getServerRoot: () => '/test',
        getResolvedPromptsDirectory: () => '/test/prompts',
      } as unknown as ConfigManager,
      onRefresh: jest.fn(async () => {}),
      onRestart: jest.fn(async () => {}),
    };
    const stored = {
      id: 'tooled',
      name: 'Tooled',
      category: 'general',
      description: 'Has tools.',
      userMessageTemplate: 'Body.',
      arguments: [],
      chainSteps: [],
    };
    updatePromptImplementation = jest.fn(async () => ({ message: 'written' }));
    const context = {
      dependencies,
      promptAnalyzer: new PromptAnalyzer(),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: { updatePromptImplementation, projectPromptWrite: jest.fn(async () => []) },
      getData: () => ({ convertedPrompts: [stored] }),
      versionHistoryService: { isAutoVersionEnabled: () => false, loadHistory: jest.fn() },
      textDiffService: new ObjectDiffGenerator(),
      comparisonEngine: new ComparisonEngine(logger),
    } as unknown as PromptResourceContext;
    const processor = new PromptLifecycleProcessor(context);

    gateHandler = {
      handleAction: jest.fn(async () => ({
        content: [{ type: 'text', text: 'Gate updated' }],
        isError: false,
      })),
    };
    const unused = { handleAction: jest.fn() };

    type Deps = Parameters<typeof createResourceManagerRouter>[0];
    router = createResourceManagerRouter({
      logger: logger as unknown as Deps['logger'],
      promptResourceHandler: {
        handleAction: (args: Record<string, unknown>) => processor.updatePrompt(args as never),
      } as unknown as Deps['promptResourceHandler'],
      gateManager: gateHandler as unknown as Deps['gateManager'],
      frameworkManager: unused as unknown as Deps['frameworkManager'],
      categoryManager: unused as unknown as Deps['categoryManager'],
    });
  });

  const removeTool = (extra: Record<string, unknown>): ResourceManagerInput =>
    ({
      resource_type: 'prompt',
      action: 'update',
      id: 'tooled',
      tool_operation: 'remove',
      tool_ids: ['alpha'],
      ...extra,
    }) as unknown as ResourceManagerInput;

  test('1. a prompt update removing a tool is refused without confirm and writes nothing', async () => {
    const response = await router.handleAction(removeTool({}), {});

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('confirm: true');
    expect(updatePromptImplementation).not.toHaveBeenCalled();
  });

  test('2. the same prompt update is accepted with confirm and reaches the writer', async () => {
    const response = await router.handleAction(removeTool({ confirm: true }), {});

    expect(response.isError).toBeFalsy();
    expect(textOf(response)).not.toContain('is not read by');
    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
  });

  test('3. a gate update carrying confirm is refused by name and never dispatched', async () => {
    const response = await router.handleAction(
      {
        resource_type: 'gate',
        action: 'update',
        id: 'g',
        description: 'x',
        confirm: true,
      } as unknown as ResourceManagerInput,
      {}
    );

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain(
      `'confirm' is not read by resource_type:"gate" action:"update"`
    );
    expect(gateHandler.handleAction).not.toHaveBeenCalled();
  });

  test('4. a gate update without confirm succeeds', async () => {
    const response = await router.handleAction(
      {
        resource_type: 'gate',
        action: 'update',
        id: 'g',
        description: 'x',
      } as unknown as ResourceManagerInput,
      {}
    );

    expect(response.isError).toBe(false);
    expect(gateHandler.handleAction).toHaveBeenCalledTimes(1);
  });
});
