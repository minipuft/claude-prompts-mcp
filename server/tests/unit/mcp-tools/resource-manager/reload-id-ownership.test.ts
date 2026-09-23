/**
 * `reload` is declared per resource type (R7), and category's declares no `id`.
 *
 * Categories are rebuilt by the one walk that loads prompts, so a category reload has nothing an
 * `id` could select. Before the split, `common:reload` declared `id` for every type, a category
 * reload accepted it, ignored it, and reported success — found by `validate:tool-parameter-reads`
 * (`category:reload 'id'`). The router's per-action ownership now refuses it before dispatch. The
 * twin sends the same `id` to a prompt reload, which reads it: one identifier apart.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { ResourceManagerInput } from '../../../../src/mcp/tools/resource-manager/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

type Handler = {
  handleAction: jest.Mock<
    (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
  >;
};

describe('reload id ownership', () => {
  let handlers: Record<'prompt' | 'gate' | 'framework' | 'category', Handler>;
  let router: ReturnType<typeof createResourceManagerRouter>;

  beforeEach(() => {
    const makeHandler = (): Handler => ({
      handleAction: jest.fn(() =>
        Promise.resolve({ content: [{ type: 'text' as const, text: 'Success' }], isError: false })
      ),
    });
    handlers = {
      prompt: makeHandler(),
      gate: makeHandler(),
      framework: makeHandler(),
      category: makeHandler(),
    };
    type Deps = Parameters<typeof createResourceManagerRouter>[0];
    router = createResourceManagerRouter({
      logger: new MockLogger() as unknown as Deps['logger'],
      promptResourceHandler: handlers.prompt as unknown as Deps['promptResourceHandler'],
      gateManager: handlers.gate as unknown as Deps['gateManager'],
      frameworkManager: handlers.framework as unknown as Deps['frameworkManager'],
      categoryManager: handlers.category as unknown as Deps['categoryManager'],
    });
  });

  const reload = (resource_type: string, extra: Record<string, unknown>) =>
    router.handleAction(
      { resource_type, action: 'reload', ...extra } as unknown as ResourceManagerInput,
      {}
    );

  test('category reload with an id is refused by name and never dispatched', async () => {
    const result = await reload('category', { id: 'analysis' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      `'id' is not read by resource_type:"category" action:"reload"`
    );
    expect(handlers.category.handleAction).not.toHaveBeenCalled();
  });

  test('prompt reload with the same id is accepted', async () => {
    const result = await reload('prompt', { id: 'analysis' });

    expect(result.isError).toBe(false);
    expect(handlers.prompt.handleAction).toHaveBeenCalledTimes(1);
  });

  test('category reload without an id is accepted', async () => {
    const result = await reload('category', { reason: 'rebuild' });

    expect(result.isError).toBe(false);
    expect(handlers.category.handleAction).toHaveBeenCalledTimes(1);
  });
});
