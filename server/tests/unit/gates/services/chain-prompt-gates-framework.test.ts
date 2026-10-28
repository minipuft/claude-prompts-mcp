// @lifecycle canonical - The chain prompt's own gate resolution is decided against the run's framework.
import { describe, expect, jest, test } from '@jest/globals';

import { chainPromptGates } from '../../../../src/engine/gates/services/chain-step-gate-bindings.js';
import { GateSetResolver } from '../../../../src/engine/gates/services/gate-set-resolver.js';
import { isGateActiveForContext } from '../../../../src/engine/gates/utils/gate-activation.js';

import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type { PromptRequestContext } from '../../../../src/engine/execution/context/index.js';
import type { GateActivationRules } from '../../../../src/engine/gates/types/index.js';

/**
 * A `development` chain run under ReACT must not receive a category gate that declares
 * `framework_context: [RADIANT]`. The chain prompt's own gates are resolved apart from the
 * steps' (`chainPromptGates`); that resolution once carried no framework id, so the registry
 * saw "no framework" and the gate's framework rule had nothing to refuse.
 */

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const radiantCategoryGate: { id: string; activation: GateActivationRules } = {
  id: 'radiant-only-category-gate',
  activation: { prompt_categories: ['development'], framework_context: ['RADIANT'] },
};

/** Registry fake that filters through the production activation check, as `selectGates` does. */
const registry = {
  selectGates: jest.fn((context: { promptCategory?: string; framework?: string }) => ({
    selectedIds: isGateActiveForContext(radiantCategoryGate.activation, {
      promptCategory: context.promptCategory,
      framework: context.framework,
    })
      ? [radiantCategoryGate.id]
      : [],
    guides: [],
    skippedIds: [],
    metadata: { selectionMethod: 'category', selectionTime: 0 },
  })),
};

const chainContext = {
  parsedCommand: {
    convertedPrompt: {
      id: 'review-chain',
      name: 'Review chain',
      category: 'development',
      userMessageTemplate: 'x',
      chainSteps: [{ promptId: 'step-one' }],
    },
  },
  executionPlan: undefined,
} as unknown as PromptRequestContext;

const steps = [{ stepNumber: 1, promptId: 'step-one' }] as unknown as ChainStepPrompt[];

const acceptedFor = async (frameworkId: string | undefined): Promise<string[]> => {
  const resolver = new GateSetResolver(logger as never, registry as never, undefined, undefined);
  const result = await chainPromptGates(
    resolver,
    chainContext,
    steps,
    undefined,
    new Set(),
    frameworkId
  );
  return (result?.resolution.accepted ?? []).map((gate) => gate.id);
};

describe('chain prompt gates are resolved against the run framework', () => {
  test('a category gate declaring a framework is not attached under another framework', async () => {
    expect(await acceptedFor('react')).toEqual([]);
  });

  test('a category gate declaring a framework is not attached when no framework applies', async () => {
    expect(await acceptedFor(undefined)).toEqual([]);
  });

  test('control: the same gate is attached under the framework it declares', async () => {
    expect(await acceptedFor('radiant')).toEqual([radiantCategoryGate.id]);
  });
});
