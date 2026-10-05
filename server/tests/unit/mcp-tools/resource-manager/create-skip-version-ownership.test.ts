/**
 * `skip_version` on `create` is declared for the types whose create records a version (row 2.8).
 *
 * The prompt, gate and framework create handlers read `skip_version` and skip the version-1
 * snapshot, but no create command declared it, so the per-action refusal left it unchecked on
 * every create: a category create accepted it, read nothing, and answered success. Found by the
 * reverse direction of `validate:tool-parameter-reads`. With it declared on the three readers'
 * create commands, the router refuses it on a category create by name. The twins send the same
 * key to the readers: one identifier apart.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createResourceManagerRouter } from '../../../../src/mcp/tools/resource-manager/core/router.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { ResourceManagerInput } from '../../../../src/mcp/tools/resource-manager/core/types.js';
import type { ToolResponse } from '../../../../src/shared/types/index.js';

type ResourceType = 'prompt' | 'gate' | 'framework' | 'category';
type Handler = {
  handleAction: jest.Mock<
    (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<ToolResponse>
  >;
};

describe('skip_version on create', () => {
  let handlers: Record<ResourceType, Handler>;
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

  const create = (resource_type: ResourceType) =>
    router.handleAction(
      {
        resource_type,
        action: 'create',
        id: 'target',
        skip_version: true,
      } as unknown as ResourceManagerInput,
      {}
    );

  test('category create with skip_version is refused by name and never dispatched', async () => {
    const result = await create('category');

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      `'skip_version' is not read by resource_type:"category" action:"create"`
    );
    expect(handlers.category.handleAction).not.toHaveBeenCalled();
  });

  test.each(['prompt', 'gate', 'framework'] as const)(
    '%s create forwards skip_version to its handler',
    async (resource_type) => {
      const result = await create(resource_type);

      expect(result.isError).toBe(false);
      expect(handlers[resource_type].handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', skip_version: true }),
        expect.anything()
      );
    }
  );
});
