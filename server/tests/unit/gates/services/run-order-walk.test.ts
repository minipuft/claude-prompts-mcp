// @lifecycle canonical - P6.160 / R71: the gate walk follows the run's node order, every contributed node included.
import { describe, expect, test } from '@jest/globals';

import { runOrderWalk } from '../../../../src/engine/gates/services/gate-enhancement-service.js';

import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type { ChainNode } from '../../../../src/shared/types/chain-execution.js';

const node = (id: string, promptId: string, origin: ChainNode['origin']): ChainNode =>
  ({ id, promptId, stepName: id, origin }) as ChainNode;
const step = (nodeId: string, promptId: string, stepNumber: number): ChainStepPrompt => ({
  stepNumber,
  nodeId,
  promptId,
  args: {},
});

describe('runOrderWalk (P6.160, R71)', () => {
  const parse = [step('n1', 'sv_a', 1), step('n2', 'sv_b', 2), step('n3', 'sv_a', 3)];

  test('a replace remainder: the walk is the run order, the dropped parse steps are absent', () => {
    const walk = runOrderWalk(
      [
        node('n1', 'sv_a', 'planned'),
        node('inv-u1', 'investigate_unknown', 'inserted'),
        node('r1-a', 'sv_d', 'remainder'),
        node('r1-b', 'sv_e', 'remainder'),
      ],
      parse
    );
    expect(walk?.steps.map((s) => `${s.nodeId}:${s.promptId}`)).toEqual([
      'n1:sv_a',
      'r1-a:sv_d',
      'r1-b:sv_e',
    ]);
    expect(walk?.steps[0]).toBe(parse[0]);
    expect(walk?.contributed.map((s) => s.nodeId)).toEqual(['r1-a', 'r1-b']);
  });

  test('an append after an insertion walks the planned steps first, then every contributed one', () => {
    const walk = runOrderWalk(
      [
        node('n1', 'sv_a', 'planned'),
        node('inv-u1', 'investigate_unknown', 'inserted'),
        node('n2', 'sv_b', 'planned'),
        node('n3', 'sv_a', 'planned'),
        node('r1', 'sv_d', 'remainder'),
      ],
      parse
    );
    expect(walk?.steps.map((s) => s.nodeId)).toEqual(['n1', 'n2', 'n3', 'r1']);
  });

  test('control: a run with no contributed node, and a legacy chain, walk the parse steps as given', () => {
    const insertedOnly = [
      node('n1', 'sv_a', 'planned'),
      node('inv-u1', 'investigate_unknown', 'inserted'),
      node('n2', 'sv_b', 'planned'),
      node('n3', 'sv_a', 'planned'),
    ];
    expect(runOrderWalk(insertedOnly, parse)).toBeUndefined();
    expect(runOrderWalk([], parse)).toBeUndefined();
    const legacy = parse.map(({ nodeId: _unused, ...rest }) => rest);
    expect(
      runOrderWalk([...insertedOnly, node('r1', 'sv_d', 'remainder')], legacy)
    ).toBeUndefined();
  });
});
