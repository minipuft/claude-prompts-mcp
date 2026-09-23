/**
 * Category `reload` refuses an `id` instead of answering a targeted reload that never happened.
 *
 * `common:reload` declares `id` for all four resource types, and three of them read it. A category
 * reload cannot: every category is rebuilt by the one walk that loads prompts. Before this, an
 * `id` was accepted, ignored, and the reply reported a reload — found by
 * `validate:tool-parameter-reads` (`category:reload 'id'`). The twin below differs only in the
 * `id`, so the refusal is keyed on it and not on anything else in the call.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { CategoryLifecycleProcessor } from '../../../../src/mcp/tools/category-manager/services/category-lifecycle-processor.js';

import type { CategoryResourceContext } from '../../../../src/mcp/tools/category-manager/core/context.js';
import type { Logger } from '../../../../src/shared/types/index.js';

function processorWithRefresh(): {
  processor: CategoryLifecycleProcessor;
  onRefresh: jest.Mock<() => Promise<void>>;
} {
  const onRefresh = jest.fn(async () => undefined);
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const processor = new CategoryLifecycleProcessor({
    logger: logger as unknown as Logger,
    onRefresh,
  } as unknown as CategoryResourceContext);
  return { processor, onRefresh };
}

describe('CategoryLifecycleProcessor.handleReload — id', () => {
  it('refuses an id by name and reloads nothing', async () => {
    const { processor, onRefresh } = processorWithRefresh();

    const result = await processor.handleReload({ action: 'reload', id: 'analysis' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Category reload takes no 'id'");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('reloads every category when the same call carries no id', async () => {
    const { processor, onRefresh } = processorWithRefresh();

    const result = await processor.handleReload({ action: 'reload', reason: 'twin' });

    expect(result.isError).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('Prompt data reloaded');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
