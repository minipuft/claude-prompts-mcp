// @lifecycle test - P6.79 / R40: a Workflow IR node naming a chain prompt is expanded into the prompt's projected steps.
import { describe, expect, test } from '@jest/globals';

import { expandChainPromptNodes } from '../../../src/modules/workflow-ir/chain-prompt-expansion.js';
import { compileWorkflowIR } from '../../../src/modules/workflow-ir/compiler.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { WorkflowIR } from '../../../src/modules/workflow-ir/types.js';

const prompt = (id: string, extra: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'test',
  arguments: [],
  userMessageTemplate: `BODY-${id}`,
  ...extra,
});

const svA = prompt('sv_a', { agentType: 'researcher' });
const svB = prompt('sv_b');
const svChain = prompt('sv_chain', {
  userMessageTemplate: 'CHAIN-OWN-TEMPLATE',
  chainSteps: [
    { promptId: 'sv_a', stepName: 'A', inlineGateIds: ['sv-block'] },
    { promptId: 'sv_b', stepName: 'B', inlineGateIds: ['sv-block'], args: { depth: 'deep' } },
    { promptId: 'sv_a', stepName: 'C', inlineGateIds: ['sv-block'] },
  ],
});
const lookup = (id: string): ConvertedPrompt | undefined =>
  [svA, svB, svChain].find((candidate) => candidate.id === id);

const shape = (ir: WorkflowIR, order: readonly string[]) =>
  order.map((id) => {
    const node = ir.nodes.find((candidate) => candidate.id === id);
    return `${id}:${node?.promptId}:${JSON.stringify(node?.inlineGateIds ?? [])}`;
  });

describe('expandChainPromptNodes', () => {
  test('a chain-prompt node becomes its steps in place, ids kebab-minted from the node id', () => {
    const ir: WorkflowIR = {
      version: 1,
      nodes: [
        { id: 'x', promptId: 'sv_chain' },
        { id: 'y', promptId: 'sv_b' },
      ],
      edges: [{ from: 'x', to: 'y' }],
    };
    const expanded = expandChainPromptNodes(ir, ['x', 'y'], lookup);

    expect(shape(expanded.ir, expanded.order)).toEqual([
      'x-a:sv_a:["sv-block"]',
      'x-b:sv_b:["sv-block"]',
      'x-c:sv_a:["sv-block"]',
      'y:sv_b:[]',
    ]);
    // Edge out of the segment leaves from its LAST step; the steps are linked in order
    expect(expanded.ir.edges).toEqual([
      { from: 'x-c', to: 'y' },
      { from: 'x-a', to: 'x-b' },
      { from: 'x-b', to: 'x-c' },
    ]);
    for (const id of expanded.order) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    // The input IR is not mutated
    expect(ir.nodes.map((node) => node.id)).toEqual(['x', 'y']);
  });

  test("the node's args are the run args; its gates and declarations bind every step", () => {
    const ir: WorkflowIR = {
      version: 1,
      nodes: [
        { id: 'n1', promptId: 'sv_a' },
        {
          id: 'n2',
          promptId: 'sv_chain',
          args: { topic: 'TOPIC-X' },
          inlineGateCriteria: ['CRIT-each-node'],
          inlineGateIds: ['extra-gate'],
          delegated: true,
          subagentModel: 'fast',
        },
      ],
    };
    const { ir: out, order } = expandChainPromptNodes(ir, ['n1', 'n2'], lookup);

    expect(order).toEqual(['n1', 'n2-a', 'n2-b', 'n2-c']);
    const steps = order.slice(1).map((id) => out.nodes.find((node) => node.id === id));
    expect(steps.map((node) => node?.args)).toEqual([
      { topic: 'TOPIC-X' },
      { topic: 'TOPIC-X', depth: 'deep' },
      { topic: 'TOPIC-X' },
    ]);
    for (const node of steps) {
      expect(node?.inlineGateCriteria).toEqual(['CRIT-each-node']);
      expect(node?.inlineGateIds).toEqual(['sv-block', 'extra-gate']);
      expect(node?.delegated).toBe(true);
      expect(node?.subagentModel).toBe('fast');
    }
    // The step prompt's own fallback survives where the segment declares nothing
    expect(steps[0]?.agentType).toBe('researcher');
  });

  test('control: an IR of single prompts is returned as given', () => {
    const ir: WorkflowIR = {
      version: 1,
      nodes: [
        { id: 'x', promptId: 'sv_a' },
        { id: 'y', promptId: 'sv_b' },
      ],
      edges: [{ from: 'x', to: 'y' }],
    };
    const order = ['x', 'y'];
    const expanded = expandChainPromptNodes(ir, order, lookup);
    expect(expanded.ir).toBe(ir);
    expect(expanded.order).toBe(order);
  });

  test('a minted id that collides with a declared node id takes the next free suffix', () => {
    const ir: WorkflowIR = {
      version: 1,
      nodes: [
        { id: 'x', promptId: 'sv_chain' },
        { id: 'x-a', promptId: 'sv_b' },
      ],
    };
    expect(expandChainPromptNodes(ir, ['x', 'x-a'], lookup).order).toEqual([
      'x-a-2',
      'x-b',
      'x-c',
      'x-a',
    ]);
  });

  test('compileWorkflowIR runs the expansion: a chain-prompt node compiles to its steps', () => {
    const compiled = compileWorkflowIR(
      {
        version: 1,
        nodes: [
          { id: 'x', promptId: 'sv_chain' },
          { id: 'y', promptId: 'sv_b' },
        ],
      },
      ['x', 'y'],
      { lookupPrompt: lookup }
    );
    expect(compiled.steps.map((step) => `${step.nodeId}:${step.promptId}`)).toEqual([
      'x-a:sv_a',
      'x-b:sv_b',
      'x-c:sv_a',
      'y:sv_b',
    ]);
    expect(compiled.steps.map((step) => step.stepNumber)).toEqual([1, 2, 3, 4]);
    expect(compiled.steps[0]?.convertedPrompt).toBe(svA);
  });
});
