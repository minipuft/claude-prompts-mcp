// @lifecycle test - P6.74 / R36: one projection of a chain prompt's steps for every command source.
import { describe, expect, test } from '@jest/globals';

import { projectChainPromptSteps } from '../../../../src/engine/execution/parsers/chain-step-projection.js';
import { PromptError } from '../../../../src/shared/utils/index.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const prompt = (id: string, extra: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'test',
  arguments: [],
  userMessageTemplate: `BODY-${id}`,
  ...extra,
});

const stepA = prompt('step_a', { agentType: 'researcher' });
const stepB = prompt('step_b');
const lookup = (id: string): ConvertedPrompt | undefined =>
  [stepA, stepB].find((candidate) => candidate.id === id);

const chain = prompt('chain', {
  userMessageTemplate: 'chain',
  chainSteps: [
    { promptId: 'step_a', stepName: 'A', inlineGateIds: ['g-a'], args: { depth: 'deep' } },
    { promptId: 'step_b', stepName: 'B', inlineGateCriteria: ['be brief'], retries: 2 },
  ],
  budget: { maxInsertions: 1 },
});

describe('projectChainPromptSteps', () => {
  test('a single prompt projects nothing', () => {
    expect(projectChainPromptSteps(stepA, {}, lookup)).toBeUndefined();
    expect(
      projectChainPromptSteps(prompt('empty', { chainSteps: [] }), {}, lookup)
    ).toBeUndefined();
  });

  test('each step carries its own prompt, node id, gates and arguments', () => {
    const runArgs = { topic: 'db' };
    const projection = projectChainPromptSteps(chain, runArgs, lookup);

    expect(projection?.commandType).toBe('chain');
    expect(projection?.budget).toEqual({ maxInsertions: 1 });
    const [first, second] = projection?.steps ?? [];
    expect(first).toMatchObject({
      stepNumber: 1,
      nodeId: 'a',
      promptId: 'step_a',
      variableName: 'A',
      inlineGateIds: ['g-a'],
      agentType: 'researcher',
      args: { topic: 'db', depth: 'deep' },
    });
    expect(first?.convertedPrompt).toBe(stepA);
    expect(second).toMatchObject({
      stepNumber: 2,
      nodeId: 'b',
      promptId: 'step_b',
      inlineGateCriteria: ['be brief'],
      retries: 2,
    });
    // A step declaring no args shares the run's object, so a later request merge reaches it;
    // a step declaring args gets its own copy (control)
    expect(second?.args).toBe(runArgs);
    expect(first?.args).not.toBe(runArgs);
  });

  test('a step naming an unregistered prompt throws by name', () => {
    const broken = prompt('broken', { chainSteps: [{ promptId: 'missing', stepName: 'X' }] });
    expect(() => projectChainPromptSteps(broken, {}, lookup)).toThrow(PromptError);
    expect(() => projectChainPromptSteps(broken, {}, lookup)).toThrow(
      'Converted prompt data not found for chain step: missing'
    );
  });
});
