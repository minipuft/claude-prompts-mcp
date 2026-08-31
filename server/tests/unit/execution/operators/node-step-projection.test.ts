// @lifecycle test - P4 row 3.4: node-driven render order (DEV-T3-7).
/**
 * The projection that replaced `parsedCommand.steps[currentStep - 1]`.
 *
 * The integration suite drives the two cases a client can produce (an insertion, and an
 * unmutated run); these cover the ones it cannot reach — a chain parsed before node ids existed,
 * a run whose current node has vanished from the list, and an inserted node whose ledger entry
 * is gone. Each of those falls back rather than throwing, and a fallback nobody tests is a
 * fallback nobody knows the shape of.
 */

import { describe, expect, test } from '@jest/globals';

import { planNodeDrivenRender } from '../../../../src/engine/execution/operators/node-step-projection.js';

import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type { ChainNode } from '../../../../src/shared/types/chain-execution.js';
import type { UnknownLedgerEntry } from '../../../../src/shared/types/chain-session.js';

const step = (nodeId: string | undefined, stepNumber: number): ChainStepPrompt =>
  ({
    stepNumber,
    ...(nodeId !== undefined ? { nodeId } : {}),
    promptId: `prompt-${stepNumber}`,
    args: { seed: stepNumber },
  }) as ChainStepPrompt;

const node = (id: string, promptId: string, extra: Partial<ChainNode> = {}): ChainNode => ({
  id,
  promptId,
  stepName: id,
  origin: 'planned',
  ...extra,
});

const PARSED = [step('draft', 1), step('analyze', 2), step('review', 3)];
const PLANNED_NODES = [
  node('draft', 'prompt-1'),
  node('analyze', 'prompt-2'),
  node('review', 'prompt-3'),
];

describe('planNodeDrivenRender', () => {
  test('an unmutated run returns the very same step objects, in order', () => {
    const plan = planNodeDrivenRender({
      nodes: PLANNED_NODES,
      parseSteps: PARSED,
      currentNodeId: 'analyze',
      fallbackOrdinal: 2,
    });

    // Identity, not equality: the parse steps carry mutations other stages wrote onto them
    // (`metadata.gateInstructions`), so copying them would silently drop that work.
    expect(plan.steps[0]).toBe(PARSED[0]);
    expect(plan.steps[1]).toBe(PARSED[1]);
    expect(plan.steps[2]).toBe(PARSED[2]);
    expect(plan.currentIndex).toBe(1);
    expect(plan.nodeDriven).toBe(true);
  });

  test('an inserted node renders its own prompt with the ledger statement as its argument', () => {
    const nodes = [
      PLANNED_NODES[0]!,
      node('inv-cache-ttl', 'investigate_unknown', {
        origin: 'inserted',
        originUnknownId: 'cache-ttl',
        stepName: 'Investigate: TTL undecided',
      }),
      PLANNED_NODES[1]!,
      PLANNED_NODES[2]!,
    ];
    const ledger = [
      { id: 'cache-ttl', statement: 'TTL undecided', state: 'active', blocking: true },
    ] as unknown as UnknownLedgerEntry[];

    const plan = planNodeDrivenRender({
      nodes,
      parseSteps: PARSED,
      currentNodeId: 'inv-cache-ttl',
      fallbackOrdinal: 2,
      ledger,
    });

    expect(plan.currentIndex).toBe(1);
    expect(plan.steps[1]).toEqual({
      stepNumber: 2,
      nodeId: 'inv-cache-ttl',
      promptId: 'investigate_unknown',
      args: { unknown_id: 'cache-ttl', statement: 'TTL undecided' },
    });
    // Everything after the insertion moves to its NODE ordinal — the whole point.
    expect(plan.steps.map((entry) => [entry.stepNumber, entry.promptId])).toEqual([
      [1, 'prompt-1'],
      [2, 'investigate_unknown'],
      [3, 'prompt-2'],
      [4, 'prompt-3'],
    ]);
  });

  test('a remainder node renders the arguments and delegation it declared (row A.5)', () => {
    // The end of the path row A.5 widened: `RemainderNodeSpec` → `ChainNode` → `chain_run_nodes`
    // → here. A contributed node has NO entry in `parseSteps` by construction, so this function
    // is the only thing that can put its declaration on the rendered step — which is why
    // accepting a field the node does not carry is accepting a field the run never sees.
    const nodes = [
      PLANNED_NODES[0]!,
      node('write-up', 'prompt-alt', {
        origin: 'remainder',
        originUnknownId: 'plan-shape',
        stepName: 'Write up',
        args: { topic: 'cache TTL' },
        delegated: true,
      }),
    ];

    const plan = planNodeDrivenRender({
      nodes,
      parseSteps: PARSED,
      currentNodeId: 'write-up',
      fallbackOrdinal: 2,
      ledger: [
        { id: 'plan-shape', statement: 'the plan is wrong', state: 'active', blocking: true },
      ] as unknown as UnknownLedgerEntry[],
    });

    expect(plan.steps[1]).toEqual({
      stepNumber: 2,
      nodeId: 'write-up',
      promptId: 'prompt-alt',
      args: { topic: 'cache TTL' },
      delegated: true,
    });
  });

  test('a remainder node does NOT inherit the investigation arguments an insertion rebuilds', () => {
    // Both node kinds carry `originUnknownId`, and before row A.5 that alone drove the rebuild —
    // so a caller-authored step was rendered with `unknown_id`/`statement` arguments its prompt
    // never declared. The provenance, not the presence of an id, decides which kind this is.
    const nodes = [
      PLANNED_NODES[0]!,
      node('write-up', 'prompt-alt', {
        origin: 'remainder',
        originUnknownId: 'plan-shape',
        stepName: 'Write up',
      }),
    ];

    const plan = planNodeDrivenRender({
      nodes,
      parseSteps: PARSED,
      currentNodeId: 'write-up',
      fallbackOrdinal: 2,
      ledger: [
        { id: 'plan-shape', statement: 'the plan is wrong', state: 'active', blocking: true },
      ] as unknown as UnknownLedgerEntry[],
    });

    expect(plan.steps[1]?.args).toEqual({});
  });

  test('an inserted node with no ledger entry recovers its statement from the step name', () => {
    const nodes = [
      PLANNED_NODES[0]!,
      node('inv-cache-ttl', 'investigate_unknown', {
        origin: 'inserted',
        originUnknownId: 'cache-ttl',
        stepName: 'Investigate: TTL undecided',
      }),
    ];

    const plan = planNodeDrivenRender({
      nodes,
      parseSteps: PARSED,
      currentNodeId: 'inv-cache-ttl',
      fallbackOrdinal: 2,
    });

    // Truncated, but not empty: a rendered investigation with no statement in it is worse than
    // one with a shortened statement.
    expect(plan.steps[1]?.args).toEqual({
      unknown_id: 'cache-ttl',
      statement: 'TTL undecided',
    });
  });

  test('a chain parsed before node ids were minted pairs positionally, as it always did', () => {
    const legacyParsed = [step(undefined, 1), step(undefined, 2), step(undefined, 3)];

    const plan = planNodeDrivenRender({
      nodes: PLANNED_NODES,
      parseSteps: legacyParsed,
      currentNodeId: 'review',
      fallbackOrdinal: 3,
    });

    expect(plan.steps[0]).toBe(legacyParsed[0]);
    expect(plan.steps[2]).toBe(legacyParsed[2]);
    expect(plan.currentIndex).toBe(2);
    // Flagged, because such a chain cannot render an insertion at all — its steps carry no
    // identity to match one against.
    expect(plan.nodeDriven).toBe(false);
  });

  test('with no nodes at all it hands back the parse-time array and clamps the ordinal', () => {
    const plan = planNodeDrivenRender({
      nodes: [],
      parseSteps: PARSED,
      currentNodeId: null,
      fallbackOrdinal: 9,
    });

    expect(plan.steps).toEqual(PARSED);
    expect(plan.currentIndex).toBe(2);
    expect(plan.nodeDriven).toBe(false);
  });

  test('a current node id that is not in the list falls back to the ordinal, clamped', () => {
    const plan = planNodeDrivenRender({
      nodes: PLANNED_NODES,
      parseSteps: PARSED,
      currentNodeId: 'vanished',
      fallbackOrdinal: 42,
    });

    expect(plan.currentIndex).toBe(2);
  });

  test('the plan holds exactly one entry per node, retired ones included', () => {
    // The projection is deliberately blind to step lifecycle: retiring a node is a milestone on
    // its row, not a deletion, and the footer counts it. Filtering skipped nodes out HERE would
    // renumber everything after one, putting the rendered ordinal and the footer's ordinal back
    // on different scales — the exact defect this module exists to remove. A skipped node is
    // unreachable because the run never stands on it, not because it is missing from the plan.
    const plan = planNodeDrivenRender({
      nodes: PLANNED_NODES,
      parseSteps: PARSED,
      currentNodeId: 'analyze',
      fallbackOrdinal: 2,
    });

    expect(plan.steps).toHaveLength(PLANNED_NODES.length);
    expect(plan.steps.map((entry) => entry.stepNumber)).toEqual([1, 2, 3]);
  });
});
