// @lifecycle canonical - Load-time diagnostic: every chain with an unresolvable step is named once.
//
// The load path REPORTS and still loads (R3). The test that matters is the pairing: the warning
// fires AND the prompts are published — a version that refused would pass a warning-only
// assertion while withholding the whole catalog.
import { describe, expect, jest, test } from '@jest/globals';

import { findBrokenChains } from '../../../src/modules/prompts/chain-step-resolution.js';
import { PromptRegistry } from '../../../src/modules/prompts/registry.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/shared/types/index.js';

const prompt = (id: string, chainSteps: Array<Record<string, unknown>> = []) =>
  ({
    id,
    name: id,
    category: 'general',
    description: id,
    userMessageTemplate: 'x',
    arguments: [],
    chainSteps,
  }) as unknown as ConvertedPrompt;

function createRegistry() {
  const warn = jest.fn();
  const registerPrompt = jest.fn();
  const logger = { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() } as unknown as Logger;
  const registry = new PromptRegistry(
    logger,
    { registerPrompt } as never,
    { add: jest.fn() } as never
  );
  return { registry, warn, registerPrompt, server: { registerPrompt } as never };
}

describe('findBrokenChains — the load posture', () => {
  test('reports a chain whose step names no loaded prompt', () => {
    const broken = findBrokenChains(
      [prompt('my_chain', [{ promptId: 'gone', stepName: 'Gone' }])],
      ['my_chain']
    );

    expect(broken).toEqual([
      {
        chainId: 'my_chain',
        unresolvedSteps: [{ stepIndex: 0, promptId: 'gone', resolution: 'unresolved' }],
      },
    ]);
  });

  test('reports an unloaded `<chainId>/<step>` child — nothing scaffolds it at load', () => {
    // The write boundary accepts this shape because the same call creates it. At load there is
    // no such call, so the directory is simply missing.
    const broken = findBrokenChains(
      [prompt('my_chain', [{ promptId: 'my_chain/step_one', stepName: 'One' }])],
      ['my_chain']
    );

    expect(broken[0]?.unresolvedSteps[0]?.resolution).toBe('scaffolded-by-this-write');
  });

  test('reports nothing when every step resolves', () => {
    expect(
      findBrokenChains(
        [prompt('my_chain', [{ promptId: 'my_chain/step_one', stepName: 'One' }])],
        ['my_chain', 'my_chain/step_one']
      )
    ).toEqual([]);
  });

  test('ignores prompts that are not chains', () => {
    expect(findBrokenChains([prompt('plain')], [])).toEqual([]);
  });
});

describe('PromptRegistry.setLivePrompts — reports, does not refuse', () => {
  test('warns exactly once per broken chain, naming chain, step index and id', () => {
    const { registry, warn } = createRegistry();

    registry.setLivePrompts([
      prompt('good_chain', [{ promptId: 'leaf', stepName: 'Leaf' }]),
      prompt('leaf'),
      prompt('broken_chain', [
        { promptId: 'leaf', stepName: 'Leaf' },
        { promptId: 'gone', stepName: 'Gone' },
      ]),
    ]);

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, fields] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("Chain 'broken_chain'");
    expect(message).toContain("step 2 references unknown promptId 'gone'");
    expect(fields).toEqual({
      chainId: 'broken_chain',
      unresolvedSteps: [{ stepIndex: 1, promptId: 'gone' }],
    });
  });

  test('serves the broken chain anyway — it is reported, not withheld', async () => {
    const { registry, warn, registerPrompt, server } = createRegistry();
    const chain = prompt('broken_chain', [{ promptId: 'gone', stepName: 'Gone' }]);

    registry.setLivePrompts([chain]);
    expect(warn).toHaveBeenCalledTimes(1);

    await registry.registerAllPrompts([chain], server);

    // The load diagnostic must not become a refusal: a client still sees the prompt.
    expect(registerPrompt).toHaveBeenCalledTimes(1);
    expect(registerPrompt.mock.calls[0]?.[0]).toBe('broken_chain');
  });

  test('says nothing when every chain resolves', () => {
    const { registry, warn } = createRegistry();

    registry.setLivePrompts([prompt('leaf'), prompt('c', [{ promptId: 'leaf', stepName: 'L' }])]);

    expect(warn).not.toHaveBeenCalled();
  });
});
