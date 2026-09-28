// @lifecycle test - Branch coverage for the mid-chain blocking-unknown interrupt decision.
import { describe, expect, test } from '@jest/globals';

import {
  decideInterrupt,
  UNKNOWN_INTERRUPT_GATE_ID,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';

import type {
  ChainInterrupt,
  DecideInterruptInput,
  InterruptNodeSummary,
} from '../../../../src/engine/execution/pipeline/decisions/mutation/index.js';
import type { ChainNode } from '../../../../src/shared/types/chain-execution.js';
import type { UnknownLedgerEntry } from '../../../../src/shared/types/chain-session.js';

/**
 * The four criteria row 1.1 names, plus the two the derivation rule implies (a passed declared
 * target, and multi-unknown collection). Each test's comment names the guard in
 * `interrupt-policy.ts` it exercises.
 */
const NODES: ChainNode[] = [
  { id: 'n1', promptId: 'p1', stepName: 'Survey', origin: 'planned' },
  { id: 'n2', promptId: 'p2', stepName: 'Draft', origin: 'planned' },
  { id: 'n3', promptId: 'p3', stepName: 'Review n3', origin: 'planned' },
  { id: 'n4', promptId: 'p4', stepName: 'Ship', origin: 'planned' },
];

function entry(overrides: Partial<UnknownLedgerEntry> & { id: string }): UnknownLedgerEntry {
  return {
    statement: `${overrides.id} statement`,
    state: 'active',
    blocking: false,
    discoveredAtStep: 1,
    ...overrides,
  };
}

function buildInput(overrides: Partial<DecideInterruptInput> = {}): DecideInterruptInput {
  return {
    ledger: [],
    nodes: NODES,
    currentNodeId: 'n1',
    ...overrides,
  };
}

/**
 * `expect(x).toEqual<T>(...)` generic call syntax is not supported by this repo's `@jest/globals`
 * type definitions (TS2558 — the same constraint `mutation-policy.test.ts` documents). Routing
 * the two whole-shape assertions through helpers typed on the module's own exports keeps the
 * compile-time shape check those call sites would otherwise lose.
 */
function expectInterrupt(actual: ChainInterrupt | undefined, expected: ChainInterrupt): void {
  expect(actual).toEqual(expected);
}

function expectRemaining(
  actual: readonly InterruptNodeSummary[] | undefined,
  expected: readonly InterruptNodeSummary[]
): void {
  expect(actual).toEqual(expected);
}

describe('decideInterrupt', () => {
  test('no interrupt when the ledger holds no OPEN BLOCKING unknown', () => {
    // Guard: selectTriggeringUnknown's `state !== 'active' || blocking !== true` continue.
    // All three near-misses in one ledger, so a regression that relaxes either half of the
    // predicate turns this red rather than passing on the remaining member.
    const ledger = [
      entry({ id: 'non-blocking', blocking: false }),
      entry({ id: 'resolved-blocking', blocking: true, state: 'resolved', resolution: 'answered' }),
      entry({
        id: 'resolved-irrelevant',
        blocking: true,
        state: 'resolved',
        resolution: 'irrelevant',
      }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))).toBeUndefined();
  });

  test('an open blocking unknown raises an interrupt naming itself and the remaining plan', () => {
    // Guard: the happy path — selection, remainingNodes slice, reason literal.
    const ledger = [entry({ id: 'cache-ttl', blocking: true, statement: 'TTL is undecided' })];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: 'n2' }));

    expectInterrupt(interrupt, {
      reason: 'blocking_unknown',
      unknownId: 'cache-ttl',
      statement: 'TTL is undecided',
      openBlockingUnknowns: [{ id: 'cache-ttl', statement: 'TTL is undecided' }],
      // No node was inserted for it in this fixture.
      uninvestigatedUnknownIds: ['cache-ttl'],
      affectedStepIds: [],
      remainingNodes: [
        { id: 'n3', promptId: 'p3', stepName: 'Review n3' },
        { id: 'n4', promptId: 'p4', stepName: 'Ship' },
      ],
      paused: false,
    });
  });

  test('affectedStepIds comes from DECLARED target_step_id links only (OQ-2)', () => {
    // Guard: collectAffectedStepIds reads `entry.targetStepId` and nothing else.
    //
    // The fixture is the plan's old OQ-2 close condition: `mentions-n3` names node `n3` inside
    // its free-text statement — and `n3`'s own stepName is 'Review n3', so a scanner over either
    // string would find it — while declaring no link. `declares-n4` declares one. Only the
    // declared link may appear.
    const ledger = [
      entry({
        id: 'mentions-n3',
        blocking: true,
        statement: 'unclear whether n3 still applies once the cache is warm',
      }),
      entry({ id: 'declares-n4', blocking: true, targetStepId: 'n4', discoveredAtStep: 2 }),
    ];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: 'n2' }));

    expect(interrupt?.affectedStepIds).toEqual(['n4']);
    expect(interrupt?.affectedStepIds).not.toContain('n3');
  });

  test('a declared link is dropped when it is unknown to the run or already passed', () => {
    // Guard: collectAffectedStepIds' `ordinal === -1 || ordinal <= here` filter. `n1` is behind
    // the current node and `ghost` is not in the run at all; neither is re-plannable.
    const ledger = [
      entry({ id: 'behind', blocking: true, targetStepId: 'n1' }),
      entry({ id: 'current', blocking: true, targetStepId: 'n2' }),
      entry({ id: 'absent', blocking: true, targetStepId: 'ghost' }),
      entry({ id: 'ahead', blocking: true, targetStepId: 'n3' }),
    ];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: 'n2' }));

    expect(interrupt?.affectedStepIds).toEqual(['n3']);
  });

  test('links from every open blocking unknown are collected, deduplicated, in run order', () => {
    // Guard: the `byOrdinal` map + ordinal sort. Declared out of run order and with a duplicate,
    // so both the dedup and the sort are load-bearing for this assertion.
    const ledger = [
      entry({ id: 'later', blocking: true, targetStepId: 'n4' }),
      entry({ id: 'earlier', blocking: true, targetStepId: 'n3' }),
      entry({ id: 'duplicate', blocking: true, targetStepId: 'n4' }),
      entry({ id: 'not-blocking', blocking: false, targetStepId: 'n2' }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))?.affectedStepIds).toEqual(['n3', 'n4']);
  });

  test('an open blocking unknown from the latest discovery step is the one reported', () => {
    // Guard: selectTriggeringUnknown's comparison on discoveredAtStep. Declared oldest-last so
    // ledger order and discovery order disagree.
    const ledger = [
      entry({ id: 'fresh', blocking: true, discoveredAtStep: 3 }),
      entry({ id: 'stale', blocking: true, discoveredAtStep: 1 }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))?.unknownId).toBe('fresh');
  });

  test('P6.224: within one discovery step, the first declared is the one reported', () => {
    // Guard: selectTriggeringUnknown's strict `>`. The mutation policy inserts for the first
    // blocking discovery of a call, so the interrupt names that one, not the last (R119).
    const ledger = [
      entry({ id: 'older', blocking: true, discoveredAtStep: 1 }),
      entry({ id: 'u-a', blocking: true, discoveredAtStep: 2 }),
      entry({ id: 'u-b', blocking: true, discoveredAtStep: 2 }),
    ];

    const interrupt = decideInterrupt(buildInput({ ledger }));
    expect(interrupt?.unknownId).toBe('u-a');
    expect(interrupt?.statement).toBe('u-a statement');
  });

  test('P6.208: openBlockingUnknowns lists every open blocking entry, in ledger order', () => {
    // Guard: the completed-run section names each of these (R105); a non-blocking entry and a
    // resolved one are not unresolved blockers.
    const ledger = [
      entry({ id: 'fresh', blocking: true, discoveredAtStep: 3 }),
      entry({ id: 'advisory', blocking: false }),
      entry({ id: 'closed', blocking: true, state: 'resolved' }),
      entry({ id: 'stale', blocking: true, discoveredAtStep: 1 }),
    ];

    expect(decideInterrupt(buildInput({ ledger }))?.openBlockingUnknowns).toEqual([
      { id: 'fresh', statement: 'fresh statement' },
      { id: 'stale', statement: 'stale statement' },
    ]);
  });

  test('P6.217: uninvestigatedUnknownIds lists the open blocking entries no inserted node names', () => {
    // Guard: one call inserts at most one investigation step (the first blocking discovery), so
    // the second of two declared together has no `inserted` node; the reply names it (R114).
    const ledger = [
      entry({ id: 'u-a', blocking: true }),
      entry({ id: 'u-b', blocking: true }),
      entry({ id: 'advisory', blocking: false }),
    ];
    const inserted = (unknownId: string): ChainNode => ({
      id: `inv-${unknownId}`,
      promptId: 'investigate_unknown',
      stepName: 'Investigate',
      origin: 'inserted',
      originUnknownId: unknownId,
    });
    const withA = [NODES[0]!, inserted('u-a'), ...NODES.slice(1)];
    expect(decideInterrupt(buildInput({ ledger, nodes: withA }))?.uninvestigatedUnknownIds).toEqual(
      ['u-b']
    );
    // Control: once both have their step, nothing is left out.
    const withBoth = [NODES[0]!, inserted('u-b'), inserted('u-a'), ...NODES.slice(1)];
    expect(
      decideInterrupt(buildInput({ ledger, nodes: withBoth }))?.uninvestigatedUnknownIds
    ).toEqual([]);
  });

  test('P6.241: a re-opened unknown whose only step predates the re-open is listed until it gets one', () => {
    // Guard: `investigatedUnknownIds` compares each inserted node's ordinal with the entry's
    // current `discoveredAtStep` (R127). `u-old` was investigated at ordinal 2, then resolved and
    // re-opened at n2 (ordinal 3) beside `u-new`, whose step sits at ordinal 4.
    const inserted = (id: string, unknownId: string): ChainNode => ({
      id,
      promptId: 'investigate_unknown',
      stepName: 'Investigate',
      origin: 'inserted',
      originUnknownId: unknownId,
    });
    const ledger = [
      entry({ id: 'u-old', blocking: true, discoveredAtStep: 3 }),
      entry({ id: 'u-new', blocking: true, discoveredAtStep: 3 }),
    ];
    const reopened = [
      NODES[0]!,
      inserted('inv-u-old', 'u-old'),
      NODES[1]!,
      inserted('inv-u-new', 'u-new'),
    ];
    // Control: `u-new` has its step since its discovery and is not listed.
    expect(
      decideInterrupt(buildInput({ ledger, nodes: reopened, currentNodeId: 'inv-u-new' }))
        ?.uninvestigatedUnknownIds
    ).toEqual(['u-old']);
    const withNewStep = [...reopened, inserted('inv-u-old-2', 'u-old'), NODES[2]!];
    expect(
      decideInterrupt(buildInput({ ledger, nodes: withNewStep, currentNodeId: 'inv-u-new' }))
        ?.uninvestigatedUnknownIds
    ).toEqual([]);
  });

  test('paused mirrors the pauseOnBlocking knob in both directions', () => {
    // Guard: `input.pauseOnBlocking === true`. Absent and explicit-false are the same posture
    // here — unlike maxInsertions, this knob has no server default to narrow.
    const ledger = [entry({ id: 'blocked', blocking: true })];

    expect(decideInterrupt(buildInput({ ledger }))?.paused).toBe(false);
    expect(decideInterrupt(buildInput({ ledger, pauseOnBlocking: false }))?.paused).toBe(false);
    expect(decideInterrupt(buildInput({ ledger, pauseOnBlocking: true }))?.paused).toBe(true);
  });

  test('a run past its terminal node has nothing remaining and nothing affected', () => {
    // Guard: currentOrdinal folding `null` into nodes.length + 1, in both slice and filter.
    const ledger = [entry({ id: 'blocked', blocking: true, targetStepId: 'n4' })];

    const interrupt = decideInterrupt(buildInput({ ledger, currentNodeId: null }));

    expectRemaining(interrupt?.remainingNodes, []);
    expect(interrupt?.affectedStepIds).toEqual([]);
  });

  test('the reserved gate id is the double-underscore form no authored gate can take', () => {
    // The id is a contract with the Python hook side, which carries the literal rather than an
    // import — so the literal is pinned here.
    expect(UNKNOWN_INTERRUPT_GATE_ID).toBe('__unknown_interrupt__');
  });
});
