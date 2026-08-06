import { describe, expect, jest, test } from '@jest/globals';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { GateAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { PromptLifecycleProcessor } from '../../../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';

import type { PromptResourceContext } from '../../../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const createSemanticAnalyzer = () => new ContentAnalyzer(createLogger());

/**
 * Builds the processor with real analysis collaborators and exactly one stub.
 *
 * `createPrompt` reaches `dependencies`, `promptAnalyzer`, `gateAnalyzer`, `fileOperations` and
 * `getData` — five of `PromptResourceContext`'s nine fields, plus `dependencies.onRefresh` via
 * `handleSystemRefresh`. The rest are never read on this path and are omitted rather than faked.
 * The single stub is
 * `fileOperations.updatePromptImplementation` — the only disk write. `PromptAnalyzer`,
 * `ContentAnalyzer` and `GateAnalyzer` are all real, deliberately: the branch under test renders
 * `GateAnalyzer`'s output, so stubbing it would assert nothing but the stub's own return value.
 */
function createProcessor() {
  const logger = createLogger();
  const onRefresh = jest.fn(async () => {});
  // `onRefresh` is reached via handleSystemRefresh after the response is assembled, so it is a
  // required collaborator even though it contributes nothing to the text under test.
  const dependencies = {
    logger,
    semanticAnalyzer: createSemanticAnalyzer(),
    onRefresh,
    onRestart: jest.fn(async () => {}),
  };
  // Typed argument so `mock.calls[0][0]` is reachable — an untyped jest.fn() infers a
  // zero-length tuple and indexing it is a type error, not just a lint nit.
  const updatePromptImplementation = jest.fn(async (_promptData: Record<string, unknown>) => ({
    message: 'written',
  }));

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: { updatePromptImplementation },
    getData: () => ({ convertedPrompts: [] }),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    updatePromptImplementation,
    onRefresh,
    logger,
  };
}

/**
 * `GateAnalyzer.analyzePromptContent` matches /code|programming|function|class|method|variable/
 * against the template, which is what produces the `code-quality` recommendation. A neutral
 * fixture yields an empty list, the `recommendedGates.length > 0` guard short-circuits, and an
 * assertion on absence would pass while proving nothing — so the wording here is load-bearing.
 */
const codePromptArgs = {
  id: 'review_code',
  name: 'Review Code',
  description: 'Reviews a code function for defects',
  category: 'general',
  user_message_template: 'Review this code function and report any defects: {{snippet}}',
  arguments: [{ name: 'snippet', type: 'string', required: true }],
};

function textOf(response: { content: Array<{ text?: string }> }): string {
  return response.content.map((part) => part.text ?? '').join('');
}

describe('PromptLifecycleProcessor.createPrompt gate recommendations', () => {
  test('suggests rule-based gates when no gate_configuration is supplied', async () => {
    const { processor } = createProcessor();

    const text = textOf((await processor.createPrompt({ ...codePromptArgs })) as never);

    expect(text).toContain('💡 **Suggested Gates**');
    // Asserted against what the real GateAnalyzer derives from the template, not a constant the
    // test supplied — a stubbed analyzer would make this assertion meaningless.
    expect(text).toContain('code-quality');
    expect(text).toContain('Use `update` action with `gate_configuration`');
  });

  test('reports the applied configuration instead of suggestions when one is supplied', async () => {
    const { processor } = createProcessor();

    const text = textOf(
      (await processor.createPrompt({
        ...codePromptArgs,
        gate_configuration: { include: ['code-quality'] },
      })) as never
    );

    expect(text).toContain('🔒 **Gate Configuration Applied**');
    expect(text).toContain('Include Gates: code-quality');
    // The branch is exclusive: an explicit configuration suppresses the suggestions entirely.
    expect(text).not.toContain('💡 **Suggested Gates**');
  });

  test('writes the prompt through the file boundary exactly once and touches no disk directly', async () => {
    const { processor, updatePromptImplementation } = createProcessor();

    await processor.createPrompt({ ...codePromptArgs });

    expect(updatePromptImplementation).toHaveBeenCalledTimes(1);
    expect(updatePromptImplementation.mock.calls[0]?.[0]).toMatchObject({
      id: 'review_code',
      category: 'general',
    });
  });

  test('reports success with the created prompt identity', async () => {
    const { processor } = createProcessor();

    const text = textOf((await processor.createPrompt({ ...codePromptArgs })) as never);

    expect(text).toContain('✅ **Prompt Created**');
    expect(text).toContain('review_code');
  });
});
